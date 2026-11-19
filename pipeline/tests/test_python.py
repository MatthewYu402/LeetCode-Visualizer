"""The pipeline for Python Solutions: run(..., language="python") and python3 -m pipeline on a .py file.

These need Python 3.12 or later (TRACE_PYTHON, python3.12, or this interpreter), and are
skipped without it. Run with:  python3 -m unittest discover -s pipeline/tests -t .
"""

import io
import json
import shutil
import sys
import tempfile
import unittest
from contextlib import redirect_stderr
from pathlib import Path

from driver.tests.support import check_trace
from pipeline import EXIT_INPUT, EXIT_RUN, PipelineError, run
from pipeline.__main__ import main

ROOT = Path(__file__).resolve().parents[2]
FIXTURES = ROOT / "fixtures"
CASES = {
    "two-sum": ("two_sum", "nums = [2,7,11,15], target = 9"),
    "reverse-list": ("reverse_list", "head = [1,2,3,4,5]"),
    "preorder-traversal": ("preorder_traversal", "root = [1,null,2,3]"),
    "clone-graph": ("clone_graph", "adjList = [[2,4],[1,3],[2,4],[1,3]]"),
    "max-depth": ("max_depth", "root = [3,9,20,null,null,15,7]"),
    "subsets": ("subsets", "nums = [1,2,3]"),
}
needs_python = unittest.skipUnless(shutil.which("python3.12") or sys.version_info >= (3, 12), "needs Python 3.12 or later")


def solution(body, signature="def f(self, n: int) -> int:"):
    return f"class Solution:\n    {signature}\n{body}\n"


@needs_python
class Python(unittest.TestCase):
    def test_every_fixture_gives_its_golden_trace(self):
        for golden, (stem, example) in CASES.items():
            with self.subTest(fixture=golden):
                source = (FIXTURES / f"{stem}_trace.py").read_text(encoding="utf-8")
                trace = run(source, example, language="python").trace
                with tempfile.TemporaryDirectory() as work:
                    path = Path(work) / "trace.json"
                    path.write_text(json.dumps(trace), encoding="utf-8")
                    status, output = check_trace("--equals", FIXTURES / f"{golden}.python.trace.json", path)
                self.assertEqual(status, 0, output)
                self.assertEqual(trace["language"], "python")

    def test_command_line_picks_python_from_the_extension(self):
        with tempfile.TemporaryDirectory() as work:
            out = Path(work) / "trace.json"
            err = io.StringIO()
            with redirect_stderr(err):
                status = main([str(FIXTURES / "two_sum_trace.py"), "--example", "nums = [2,7,11,15], target = 9", "-o", str(out)])
            self.assertEqual(status, 0, err.getvalue())
            code, output = check_trace("--equals", FIXTURES / "two-sum.python.trace.json", out)
            self.assertEqual(code, 0, output)

    def test_an_exception_shows_the_users_traceback(self):
        with self.assertRaises(PipelineError) as caught:
            run(solution("        print('before')\n        return [1][n]"), "n = 3", language="python")
        self.assertEqual(caught.exception.exit_code, EXIT_RUN)
        message = str(caught.exception)
        self.assertIn("IndexError", message)
        self.assertIn('File "solution.py", line 4', message)
        self.assertIn("before", message)
        self.assertNotIn("tracer.py", message)

    def test_syntax_error_is_bad_input(self):
        with self.assertRaises(PipelineError) as caught:
            run("class Solution:\n    def f(self, n: int) -> int\n        return n\n", "n = 3", language="python")
        self.assertEqual((caught.exception.stage, caught.exception.exit_code), ("driver", EXIT_INPUT))

    def test_a_loop_that_never_ends_is_truncated(self):
        result = run(solution("        while n > 0:\n            pass\n        return n"), "n = 3", language="python")
        self.assertTrue(result.trace.get("truncated"))
        self.assertEqual(len(result.trace["steps"]), 2000)

    def test_timeout(self):
        # One line that never ends: no steps after it, so only the time limit stops it.
        with self.assertRaises(PipelineError) as caught:
            run(solution("        x = sum(range(10 ** 12))\n        return n"), "n = 3", language="python", timeout=1)
        self.assertEqual(caught.exception.exit_code, EXIT_RUN)
        self.assertIn("did not finish within 1 seconds", str(caught.exception))

    def test_what_the_program_prints_is_kept(self):
        result = run(solution("        print('hello', n)\n        return n"), "n = 3", language="python")
        self.assertEqual(result.output.strip(), "hello 3")

    def test_unknown_language(self):
        with self.assertRaises(ValueError):
            run("", "", language="java")


if __name__ == "__main__":
    unittest.main()
