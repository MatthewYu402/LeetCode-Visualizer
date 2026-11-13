"""The pipeline end to end: python3 -m pipeline, and run() behind it.

These need a compiler and the built rewriter, and are skipped without them.
Run with:  python3 -m unittest discover -s pipeline/tests -t .
"""

import io
import json
import subprocess
import sys
import tempfile
import unittest
from contextlib import redirect_stderr, redirect_stdout
from pathlib import Path

from driver.tests.support import check_trace, needs_compiler
from driver.tests.test_fixtures import CASES, FIXTURES
from pipeline import EXIT_INPUT, EXIT_RUN, REWRITER, PipelineError, run
from pipeline.__main__ import main

needs_rewriter = unittest.skipUnless(REWRITER.exists(), f"rewriter not built ({REWRITER}); run make -C adapters/cpp/rewriter")


def solution(body, signature="int f(int n)"):
    return f"class Solution {{\npublic:\n    {signature} {{\n{body}\n    }}\n}};\n"


@needs_rewriter
@needs_compiler
class Fixtures(unittest.TestCase):
    def test_every_fixture_gives_its_golden_trace(self):
        for golden, (stem, example, prefix) in CASES.items():
            with self.subTest(fixture=golden):
                source = prefix + (FIXTURES / f"{stem}_trace.cpp").read_text(encoding="utf-8")
                trace = run(source, example).trace
                expected = json.loads((FIXTURES / f"{golden}.trace.json").read_text(encoding="utf-8"))
                if prefix:
                    # The pasted Node comment moves every line down; the steps are otherwise the same.
                    self.assertEqual(len(trace["steps"]), len(expected["steps"]))
                    self.assertEqual(trace["result"], expected["result"])
                    continue
                with tempfile.TemporaryDirectory() as work:
                    path = Path(work) / "trace.json"
                    path.write_text(json.dumps(trace), encoding="utf-8")
                    status, output = check_trace("--equals", FIXTURES / f"{golden}.trace.json", path)
                self.assertEqual(status, 0, output)

    def test_command_line_writes_the_trace(self):
        with tempfile.TemporaryDirectory() as work:
            out = Path(work) / "trace.json"
            err = io.StringIO()
            with redirect_stderr(err):
                status = main([str(FIXTURES / "two_sum_trace.cpp"), "--example", "nums = [2,7,11,15], target = 9", "-o", str(out)])
            self.assertEqual(status, 0, err.getvalue())
            self.assertIn("steps, result", err.getvalue())
            code, output = check_trace("--equals", FIXTURES / "two-sum.trace.json", out)
            self.assertEqual(code, 0, output)

    def test_command_line_prints_to_stdout(self):
        out, err = io.StringIO(), io.StringIO()
        with redirect_stdout(out), redirect_stderr(err):
            status = main([str(FIXTURES / "subsets_trace.cpp"), "--example", "nums = [1,2,3]"])
        self.assertEqual(status, 0, err.getvalue())
        self.assertEqual(json.loads(out.getvalue())["result"]["kind"], "array")

    def test_runs_as_a_module(self):
        r = subprocess.run([sys.executable, "-m", "pipeline", str(FIXTURES / "subsets_trace.cpp"), "--example", "nums = [1]"],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 0, r.stderr)
        self.assertIn('"steps"', r.stdout)


@needs_rewriter
@needs_compiler
class Failures(unittest.TestCase):
    def fails(self, source, example="n = 3", **options):
        with self.assertRaises(PipelineError) as caught:
            run(source, example, **options)
        return caught.exception

    def test_bad_example(self):
        error = self.fails(solution("        return n;"), "n = [1,2]")
        self.assertEqual((error.stage, error.exit_code), ("driver", EXIT_INPUT))

    def test_compile_error_names_the_users_file_and_line(self):
        error = self.fails(solution("        int x = n\n        return x;"), source_name="mine.cpp")
        self.assertEqual((error.stage, error.exit_code), ("rewriter", EXIT_INPUT))
        self.assertIn("mine.cpp:4:", str(error))
        self.assertNotIn("trace-run-", str(error))

    def test_endless_loop_is_cut_at_the_step_limit(self):
        trace = run(solution("        int x = 0;\n        while (true) {\n            x += n;\n        }\n        return x;"), "n = 3").trace
        self.assertTrue(trace["truncated"])
        self.assertNotIn("result", trace)

    def test_crash(self):
        error = self.fails(solution("        int* p = nullptr;\n        if (n > 0) p = nullptr;\n        return *p + n;"))
        self.assertEqual((error.stage, error.exit_code), ("run", EXIT_RUN))
        self.assertIn("crashed", str(error))

    def test_time_limit(self):
        error = self.fails(solution("        volatile int x = 0;\n        while (true) {}\n        return x + n;"), timeout=2)
        self.assertEqual((error.stage, error.exit_code), ("run", EXIT_RUN))
        self.assertIn("did not finish within 2 seconds", str(error))

    def test_what_the_program_prints_is_kept(self):
        source = "#include <iostream>\n" + solution('        std::cout << "hello " << n << std::endl;\n        return n;')
        result = run(source, "n = 3")
        self.assertEqual(result.output.strip(), "hello 3")

    def test_command_line_exit_status(self):
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / "s.cpp"
            path.write_text(solution("        return n;"), encoding="utf-8")
            with redirect_stderr(io.StringIO()):
                self.assertEqual(main([str(path), "--example", "n = [1,2]"]), EXIT_INPUT)
                self.assertEqual(main([str(Path(work) / "missing.cpp"), "--example", "n = 3"]), EXIT_INPUT)


if __name__ == "__main__":
    unittest.main()
