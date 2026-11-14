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
        # n = 5: the else branch (7); on line 8 the for header three times (i = 0, 1, 2)
        # and its body twice; the while header once (false), so its body never runs
        self.assertEqual(lines(trace), [4, 5, 6, 7, 8, 8, 8, 8, 8, 9, 10, 10])
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

    def test_empty_bodies(self):
        # An empty block gets only its Scope: `{}` becomes `{ ::trace::Scope trace_scope_(LINE);}`,
        # on the same line. No step comes from inside it.
        src = """class Solution {
public:
    int f(int n) {
        int k = 0;
        for (int i = 0; i < n; i++) {}
        while (k > n) {}
        do {} while (k > n);
        if (n > 0) {} else {}
        if (n < 0) {}
        {}
        return k + n;
    }
};"""
        trace, code = run_source(src, "n = 2")
        self.assertEqual(trace["result"], 2)
        # A loop's header gets a step each time it is checked (the for three times, the
        # while and the do once each); a bare block gets none, and the empty bodies none inside them.
        self.assertEqual(lines(trace), [4, 5, 5, 5, 6, 7, 8, 9, 11, 11])
        self.assertEqual(len(code.splitlines()), len(src.splitlines()))
        # for, while, do, then, else, the second then, and the bare block: one Scope each.
        self.assertEqual(code.count("{ ::trace::Scope trace_scope_("), 7, code)
        self.assertNotIn("{}", code, code)

    def test_volatile_locals(self):
        # A volatile local is shown as its plain type: before the fix in trace.hpp,
        # a volatile int did not compile with libc++ and a volatile bool nowhere.
        src = """class Solution {
public:
    int f(int n) {
        volatile int v = n;
        volatile bool b = n > 0;
        volatile double d = 0.5;
        return v + n;
    }
};"""
        trace, _ = run_source(src, "n = 3")
        self.assertEqual(trace["result"], 6)
        last = trace["steps"][-1]["frames"][-1]["locals"]
        self.assertEqual((last["v"], last["b"], last["d"]), (3, True, 0.5))

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


def outcomes(trace):
    """Each step's outcomes as short strings: 'cond: true' or 'x = 3', by line, in step order."""
    out = []
    for step in trace["steps"]:
        top = step["frames"][-1]
        for o in top.get("outcomes", []):
            text = f"{o['code']}: {json.dumps(o['value'])}" if o["kind"] == "condition" else f"{o['target']} = {json.dumps(o['value'])}"
            out.append((top["line"], text))
    return out


@needs_rewriter
@needs_compiler
class Outcomes(unittest.TestCase):
    """What each line evaluated (trace-format.md, Outcomes), at statement level."""

    def test_conditions_stores_and_loop_headers(self):
        src = """class Solution {
public:
    int f(vector<int>& nums) {
        int sum = 0;
        for (int i = 0; i < 2; i++) {
            sum += nums[i];
        }
        int j = 3;
        while (j > 1) j--;
        do { j += 5; } while (j < 4);
        if (sum > 100) sum = 0;
        int sign = sum > 0 ? 1 : -1;
        return sum * sign;
    }
};"""
        trace, _ = run_source(src, "nums = [4,5]")
        self.assertEqual(trace["result"], 9)
        self.assertEqual(outcomes(trace), [
            (4, "sum = 0"),
            (5, "i = 0"), (5, "i < 2: true"),
            (6, "sum = 4"),
            (5, "i = 1"), (5, "i < 2: true"),
            (6, "sum = 9"),
            (5, "i = 2"), (5, "i < 2: false"),
            (8, "j = 3"),
            (9, "j > 1: true"), (9, "j = 2"),
            (9, "j > 1: true"), (9, "j = 1"),
            (9, "j > 1: false"),
            (10, "j = 6"), (10, "j < 4: false"),
            (11, "sum > 100: false"),
            (12, "sum > 0: true"), (12, "sign = 1"),
        ])

    def test_a_store_after_a_call_goes_on_the_callers_step(self):
        src = """class Solution {
public:
    int fact(int n) {
        if (n <= 1) return 1;
        int rest = fact(n - 1);
        return n * rest;
    }
};"""
        trace, _ = run_source(src, "n = 3")
        first_rest = next(s for s in trace["steps"] if s["frames"][-1]["line"] == 5)
        self.assertEqual(len(first_rest["frames"]), 1)
        self.assertEqual(first_rest["frames"][-1]["outcomes"], [{"kind": "store", "code": "int rest = fact(n - 1)", "target": "rest", "value": 2}])
        for step in trace["steps"]:
            self.assertNotIn("outcomes", step["frames"][-1] if "return_value" in step["frames"][-1] else {}, "no outcomes on a return step")

    def test_targets_are_read_after_the_statement(self):
        src = """class Solution {
public:
    int count(string s) {
        unordered_map<char, int> freq;
        for (char c : s) freq[c]++;
        string t = "a";
        t += "b";
        vector<bool> seen(2);
        seen[0] = true;
        return freq['x'] + (int)t.size();
    }
};"""
        trace, _ = run_source(src, 's = "xyx"')
        self.assertEqual(trace["result"], 4)
        got = outcomes(trace)
        # the range-for's header step each iteration, with the loop variable's store
        self.assertEqual([t for line, t in got if line == 5], ['c = "x"', "freq[c] = 1", 'c = "y"', "freq[c] = 1", 'c = "x"', "freq[c] = 2"])
        self.assertIn((7, 't = "ab"'), got)
        # vector<bool>'s element is a proxy, not a reference: nothing is tracked, and it still compiles
        self.assertFalse(any(line == 9 for line, _ in got))

    def test_for_initializers_with_auto_and_without_a_condition(self):
        src = """class Solution {
public:
    int f(vector<int>& nums) {
        int total = 0;
        for (auto it = nums.begin(); it != nums.end(); ++it) total += *it;
        for (long long k = 2;; k++) { if (k > 3) break; }
        return total;
    }
};"""
        trace, _ = run_source(src, "nums = [1,2]")
        self.assertEqual(trace["result"], 3)
        got = outcomes(trace)
        self.assertIn((5, "it != nums.end(): true"), got)  # an iterator's own store is left out
        self.assertEqual([t for line, t in got if line == 6], ["k = 2", "k > 3: false", "k = 3", "k > 3: false", "k = 4", "k > 3: true"])
        # With no condition, every pass still gets a header step (k = 2, 3, 4). Line 6 also
        # holds the body: its if on each pass (3 steps) and the break (1): 7 in all.
        self.assertEqual(lines(trace).count(6), 7)

    def test_code_with_quotes_and_constant_conditions(self):
        src = r"""class Solution {
public:
    string f(int n) {
        string s = n > 0 ? "say \"hi\"" : "c";
        if constexpr (sizeof(int) == 4) n++;
        int a[sizeof(int) > 2 ? 2 : 3] = {};
        return s + to_string(a[0] + n);
    }
};"""
        trace, _ = run_source(src, "n = 1")
        step = next(s for s in trace["steps"] if s["frames"][-1]["line"] == 4)
        stored = step["frames"][-1]["outcomes"][1]
        # The code is the user's text exactly, quotes and backslashes included.
        self.assertEqual(stored["code"], r'string s = n > 0 ? "say \"hi\"" : "c"')
        self.assertEqual(stored["value"], 'say "hi"')
        got = outcomes(trace)
        self.assertEqual(got[0], (4, "n > 0: true"))
        # if constexpr and a constant ?: are left alone (they would not compile wrapped)
        self.assertFalse(any("sizeof" in t for _, t in got))
