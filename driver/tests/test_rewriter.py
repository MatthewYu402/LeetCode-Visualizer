"""The rewriter (adapters/cpp/rewriter), through the driver.

The rewriter instruments a plain Solution; the driver supplies the prelude and
main. Together they replace every hand-written step of the old fixtures, so:

1. Every golden fixture, rewritten from its plain source, must produce its
   golden trace exactly. That is roadmap Phase 4's "done when".
2. Constructs the fixtures do not cover (unbraced bodies, else-if chains,
   shadowing, lambdas, switch, iterators, void returns) must compile, run,
   and give the steps written out in each test.

The rewriter binary is $TRACE_REWRITE, or adapters/cpp/rewriter/build/trace-rewrite.
Build it with `make -C adapters/cpp/rewriter`. These tests are skipped when it
is missing, so the rest of the suite runs without LLVM.
"""

import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from driver.cpp import generate

from .support import ROOT, RUNTIME, build_and_run, check_trace, needs_compiler
from .test_fixtures import CASES, FIXTURES

REWRITER = Path(os.environ.get("TRACE_REWRITE", ROOT / "adapters" / "cpp" / "rewriter" / "build" / "trace-rewrite"))
needs_rewriter = unittest.skipUnless(REWRITER.exists(), f"rewriter not built ({REWRITER}); run make -C adapters/cpp/rewriter")


def rewrite(source_path, program):
    """Runs the rewriter on a file, parsing it with the program's prelude. Returns the instrumented text."""
    work = Path(tempfile.mkdtemp(prefix="rewrite-"))
    prelude = work / "prelude.hpp"
    prelude.write_text(program.prelude, encoding="utf-8")
    r = subprocess.run([str(REWRITER), str(source_path), "--", "-std=c++20", "-I", str(RUNTIME), "-include", str(prelude)],
                       capture_output=True, text=True)
    if r.returncode != 0:
        raise AssertionError(f"trace-rewrite failed ({r.returncode}):\n{r.stderr}")
    return r.stdout


def run_source(source, example, method=None):
    """Generate, rewrite, compile, run. Returns (trace, instrumented code)."""
    work = Path(tempfile.mkdtemp(prefix="rewrite-src-"))
    path = work / "solution.cpp"
    path.write_text(source, encoding="utf-8")
    program = generate(source, example, method)
    code = rewrite(path, program)
    trace, trace_path = build_and_run(program, code)
    status, output = check_trace(trace_path)
    if status != 0:
        raise AssertionError(output + "\n--- instrumented ---\n" + code)
    return trace, code


def steps(trace):
    """Each step as (top frame's function, line, sorted local names, return value if any)."""
    out = []
    for step in trace["steps"]:
        top = step["frames"][-1]
        out.append((top["function"], top["line"], sorted(top["locals"]), top.get("return_value", "-")))
    return out


def lines(trace):
    return [s["frames"][-1]["line"] for s in trace["steps"]]


@needs_rewriter
@needs_compiler
class GoldenFixtures(unittest.TestCase):
    def test_every_fixture_from_its_plain_source(self):
        for golden, (stem, example, prefix) in CASES.items():
            with self.subTest(fixture=golden):
                plain = FIXTURES / f"{stem}_trace.cpp"
                # The driver reads the source as LeetCode shows it (with the Node comment);
                # the rewriter reads the fixture file itself, whose lines the golden trace uses.
                program = generate(prefix + plain.read_text(encoding="utf-8"), example)
                code = rewrite(plain, program)
                _, trace_path = build_and_run(program, code)
                status, output = check_trace("--equals", FIXTURES / f"{golden}.trace.json", trace_path)
                self.assertEqual(status, 0, output + "\n--- instrumented ---\n" + code)

    def test_lines_are_preserved(self):
        for stem, example, prefix in CASES.values():
            with self.subTest(fixture=stem):
                plain = FIXTURES / f"{stem}_trace.cpp"
                original = plain.read_text(encoding="utf-8")
                code = rewrite(plain, generate(prefix + original, example))
                self.assertEqual(code.count("\n"), original.count("\n"))
                # Each original line is still on its own line: its characters appear in
                # order in the rewritten line, with only insertions between them.
                for number, (before, after) in enumerate(zip(original.split("\n"), code.split("\n")), 1):
                    rest = iter(after)
                    self.assertTrue(all(ch in rest for ch in before), f"line {number} changed:\n{before}\n{after}")


@needs_rewriter
@needs_compiler
class Constructs(unittest.TestCase):
    def test_unbraced_bodies_and_else_if(self):
        src = """class Solution {
public:
    int classify(int n) {
        int score = 0;
        if (n < 0) score = -1;
        else if (n == 0) score = 0;
        else score = 1;
        for (int i = 0; i < 2; ++i) score += i;
        while (score > 10) score /= 2;
        return score;
    }
};"""
        trace, code = run_source(src, "n = 5")
        # n = 5: the else branch (7), the for body twice (8), and the while body never runs
        self.assertEqual(lines(trace), [4, 5, 6, 7, 8, 8, 10, 10])
        self.assertEqual(trace["result"], 2)
        self.assertEqual(code.count("\n"), src.count("\n"))

    def test_else_if_takes_the_middle_branch(self):
        src = """class Solution {
public:
    int pick(int n) {
        if (n > 5) return 1;
        else if (n > 2) return 2;
        else return 3;
    }
};"""
        trace, _ = run_source(src, "n = 3")
        # record at the first if, record at the else-if, record at its return, the return step
        self.assertEqual(lines(trace), [4, 5, 5, 5])
        self.assertEqual(trace["steps"][-1]["frames"][-1]["return_value"], 2)

    def test_loop_variable_scope(self):
        src = """class Solution {
public:
    int sum(vector<int>& nums) {
        int total = 0;
        for (int i = 0; i < (int)nums.size(); i++) {
            int x = nums[i];
            total += x;
        }
        for (int v : nums) total -= v;
        return total;
    }
};"""
        trace, _ = run_source(src, "nums = [1,2]")
        for function, line, names, _ in steps(trace):
            if line == 6:
                self.assertEqual(names, ["i", "nums", "total"])
            if line == 7:
                self.assertEqual(names, ["i", "nums", "total", "x"])
            if line == 9:
                self.assertEqual(names, ["nums", "total", "v"])  # the range-for variable
            if line == 10:
                self.assertEqual(names, ["nums", "total"])       # neither i, x, nor v
        self.assertIn(9, lines(trace))

    def test_shadowing_keeps_the_innermost(self):
        src = """class Solution {
public:
    int f(int n) {
        int x = 1;
        {
            int x = 2;
            n += x;
        }
        return n + x;
    }
};"""
        trace, _ = run_source(src, "n = 10")
        inner = [s for s in trace["steps"] if s["frames"][-1]["line"] == 7][0]
        self.assertEqual(inner["frames"][-1]["locals"]["x"], 2)
        self.assertEqual(trace["result"], 13)

    def test_no_duplicate_keys_anywhere(self):
        src = """class Solution {
public:
    int f(int i) {
        int sum = 0;
        for (int i = 0; i < 2; ++i) { int j = i; sum += j; }
        return i + sum;
    }
};"""
        work = Path(tempfile.mkdtemp())
        path = work / "s.cpp"
        path.write_text(src, encoding="utf-8")
        program = generate(src, "i = 7")  # the parameter i and the loop's i are both in scope in the loop
        _, trace_path = build_and_run(program, rewrite(path, program))

        def no_duplicates(pairs):
            keys = [k for k, _ in pairs]
            self.assertEqual(len(keys), len(set(keys)), f"duplicate key in {keys}")
            return dict(pairs)

        json.loads(trace_path.read_text(encoding="utf-8"), object_pairs_hook=no_duplicates)

    def test_recursion_and_private_helper(self):
        src = """class Solution {
public:
    int climbStairs(int n) {
        return ways(n);
    }
private:
    int ways(int n) {
        if (n <= 2) return n;
        return ways(n - 1) + ways(n - 2);
    }
};"""
        trace, _ = run_source(src, "n = 4")
        self.assertEqual(trace["result"], 5)
        self.assertEqual(max(len(s["frames"]) for s in trace["steps"]), 4)  # climbStairs, ways(4), ways(3), ways(2)
        returns = [s["frames"][-1]["return_value"] for s in trace["steps"] if "return_value" in s["frames"][-1]]
        self.assertEqual(returns[-1], 5)
        self.assertEqual(sorted(returns[:-1]), [1, 2, 2, 3, 5])

    def test_lambdas_are_left_alone(self):
        src = """class Solution {
public:
    int f(vector<int>& nums) {
        auto twice = [](int x) {
            int y = 2 * x;
            return y;
        };
        sort(nums.begin(), nums.end(), [](int a, int b) { return a > b; });
        return twice(nums[0]);
    }
};"""
        trace, code = run_source(src, "nums = [1,3,2]")
        self.assertEqual(trace["result"], 6)
        self.assertNotIn("record(5", code)  # nothing inside the lambda
        self.assertEqual(lines(trace), [4, 8, 9, 9])
        self.assertNotIn("twice", trace["steps"][1]["frames"][-1]["locals"])  # a lambda has no serializer

    def test_iterator_from_find_is_an_index(self):
        src = """class Solution {
public:
    bool has(vector<int>& nums, int x) {
        auto it = find(nums.begin(), nums.end(), x);
        return it != nums.end();
    }
};"""
        trace, code = run_source(src, "nums = [1,2], x = 2")
        self.assertIn('::trace::var_iter("it", it, "nums", nums)', code)
        self.assertEqual(trace["steps"][-1]["frames"][-1]["locals"]["it"], {"kind": "iterator", "container": "nums", "index": 1})
        trace, _ = run_source(src, "nums = [1,2], x = 5")
        self.assertEqual(trace["steps"][-1]["frames"][-1]["locals"]["it"], {"kind": "iterator", "container": "nums", "end": True})

    def test_iterator_walks_a_list(self):
        src = """class Solution {
public:
    int total(vector<int>& nums) {
        list<int> lst(nums.begin(), nums.end());
        int sum = 0;
        for (auto it = lst.begin(); it != lst.end(); ++it) {
            sum += *it;
        }
        return sum;
    }
};"""
        trace, _ = run_source(src, "nums = [4,5,6]")
        positions = [s["frames"][-1]["locals"]["it"]["index"] for s in trace["steps"] if s["frames"][-1]["line"] == 7]
        self.assertEqual(positions, [0, 1, 2])
        self.assertEqual(trace["result"], 15)

    def test_map_find_and_reassignment(self):
        src = """class Solution {
public:
    int look(vector<int>& keys, int k) {
        map<int, int> a, b;
        for (int x : keys) { a[x] = 1; b[x * 10] = 2; }
        auto it = a.find(k);
        int found = it != a.end();
        it = b.find(k * 10);
        return found + (it != b.end());
    }
};"""
        trace, _ = run_source(src, "keys = [1,2], k = 2")
        at = {s["frames"][-1]["line"]: s["frames"][-1]["locals"].get("it") for s in trace["steps"]}
        self.assertEqual(at[7], {"kind": "iterator", "container": "a", "key": 2})
        self.assertEqual(at[9], {"kind": "iterator", "container": "b", "key": 20})  # after `it = b.find(...)`
        self.assertEqual(trace["result"], 2)

    def test_lower_bound_and_lookalikes(self):
        src = """class Solution {
public:
    int f(vector<int>& v, int x) {
        auto lo = lower_bound(v.begin(), v.end(), x);
        int first = *v.begin();
        auto r = v.rbegin();
        unordered_map<int, int> seen;
        auto w = seen.find(x);
        return (lo - v.begin()) + first + *r + (w == seen.end());
    }
};"""
        trace, code = run_source(src, "v = [1,3,5], x = 4")
        last = trace["steps"][-1]["frames"][-1]["locals"]
        self.assertEqual(last["lo"], {"kind": "iterator", "container": "v", "index": 2})
        self.assertEqual(last["first"], 1)                     # paired with v by v.begin(), but an int
        self.assertNotIn("r", last)                             # a reverse iterator: no serializer
        self.assertEqual(last["w"], {"kind": "iterator", "container": "seen", "end": True})
        self.assertEqual(trace["result"], 2 + 1 + 5 + 1)

    def test_void_function_returns(self):
        src = """class Solution {
public:
    void sortColors(vector<int>& nums) {
        if (nums.empty()) return;
        sort(nums.begin(), nums.end());
    }
};"""
        trace, _ = run_source(src, "nums = [2,0,1]")
        last = trace["steps"][-1]["frames"][-1]
        self.assertEqual((last["line"], last["return_value"]), (6, None))
        self.assertEqual(last["locals"]["nums"], {"kind": "array", "items": [0, 1, 2]})
        trace, _ = run_source(src, "nums = []")
        self.assertEqual(lines(trace), [4, 4, 4])  # record at the if, record at return;, its return step

    def test_switch_and_several_statements_on_a_line(self):
        src = """class Solution {
public:
    int f(int n) {
        int a = 0; int b = 0;
        switch (n) {
            case 1: a = 10; break;
            case 2: { b = 20; break; }
            default: a = b = 1;
        }
        return a + b;
    }
};"""
        trace, _ = run_source(src, "n = 2")
        self.assertEqual(trace["result"], 20)
        self.assertEqual(lines(trace), [4, 4, 5, 7, 7, 10, 10])

    def test_structured_bindings_and_if_init(self):
        src = """class Solution {
public:
    int f(vector<int>& nums) {
        pair<int, int> p{nums[0], nums[1]};
        auto [lo, hi] = p;
        if (int d = hi - lo; d > 0) {
            return d;
        }
        return 0;
    }
};"""
        trace, _ = run_source(src, "nums = [3,8]")
        at_return = [s for s in trace["steps"] if s["frames"][-1]["line"] == 7][0]["frames"][-1]["locals"]
        self.assertEqual(sorted(at_return), ["d", "hi", "lo", "nums", "p"])
        self.assertEqual(trace["result"], 5)

    def test_do_while_and_nested_unbraced(self):
        src = """class Solution {
public:
    int f(int n) {
        int k = 0;
        do k++; while (k < n);
        if (k > 0) if (k > 1) k *= 10;
        return k;
    }
};"""
        trace, _ = run_source(src, "n = 2")
        self.assertEqual(trace["result"], 20)

    def test_compile_errors_point_at_the_users_line(self):
        src = "class Solution {\npublic:\n    int f(int n) {\n        int x = n;\n        return y;\n    }\n};"
        work = Path(tempfile.mkdtemp())
        path = work / "bad.cpp"
        path.write_text(src, encoding="utf-8")
        program = generate(src, "n = 1")
        (work / "prelude.hpp").write_text(program.prelude, encoding="utf-8")
        r = subprocess.run([str(REWRITER), str(path), "--", "-std=c++20", "-I", str(RUNTIME), "-include", str(work / "prelude.hpp")],
                           capture_output=True, text=True)
        self.assertEqual(r.returncode, 1)
        self.assertIn("bad.cpp:5:", r.stderr)
        self.assertEqual(r.stdout, "")


if __name__ == "__main__":
    unittest.main()
