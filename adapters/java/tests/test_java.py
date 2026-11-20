"""The Java adapter end to end: a Solution and an example in, a checked trace out.

    make -C adapters/java && python3 -m unittest discover -s adapters/java/tests

Each test runs the pipeline on this machine (pipeline.run, language="java": the driver,
lvtrace.Build, then the program) and looks at the part of the trace it is about. The
pipeline validates every trace with tools/check_trace.py before returning it.
"""

import json
import shutil
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT))

from pipeline import EXIT_INPUT, EXIT_RUN, JAVA_CLASSES, PipelineError, run  # noqa: E402

FIXTURES = ROOT / "fixtures"
CASES = {
    "two-sum": ("two_sum", "nums = [2,7,11,15], target = 9"),
    "reverse-list": ("reverse_list", "head = [1,2,3,4,5]"),
    "preorder-traversal": ("preorder_traversal", "root = [1,null,2,3]"),
    "clone-graph": ("clone_graph", "adjList = [[2,4],[1,3],[2,4],[1,3]]"),
    "max-depth": ("max_depth", "root = [3,9,20,null,null,15,7]"),
    "subsets": ("subsets", "nums = [1,2,3]"),
}
needs_java = unittest.skipUnless(shutil.which("java") and (JAVA_CLASSES / "lvtrace" / "Build.class").exists(),
                                 "needs a JDK and the adapter built (make -C adapters/java)")


def solution(body, signature="public int f(int n)", extra=""):
    return f"class Solution {{\n    {signature} {{\n{body}\n    }}\n{extra}}}\n"


def trace(source, example="n = 3", **options):
    return run(source, example, language="java", **options).trace


def top(t, i):
    return t["steps"][i]["frames"][-1]


def locals_at(t, line):
    for s in t["steps"]:
        f = s["frames"][-1]
        if f["line"] == line and "return_value" not in f:
            return f["locals"]
    raise AssertionError(f"no step on line {line}")


def outcomes(t, kind=None):
    return [(s["frames"][-1]["line"], o) for s in t["steps"] for o in s["frames"][-1].get("outcomes", [])
            if kind is None or o["kind"] == kind]


def check(*args):
    r = subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "check_trace.py"), *map(str, args)], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr


@needs_java
class Fixtures(unittest.TestCase):
    """Each Java fixture equals its golden trace, is like the C++ one, and matches it call by call."""

    def test_fixtures(self):
        for name, (stem, example) in CASES.items():
            with self.subTest(name):
                t = trace((FIXTURES / f"{stem}_trace.java").read_text(encoding="utf-8"), example)
                with tempfile.TemporaryDirectory() as work:
                    path = Path(work) / "trace.json"
                    path.write_text(json.dumps(t), encoding="utf-8")
                    status, output = check("--equals", FIXTURES / f"{name}.java.trace.json", path)
                    self.assertEqual(status, 0, output)
                    status, output = check("--like", FIXTURES / f"{name}.trace.json", path)
                    self.assertEqual(status, 0, output)
                    r = subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "compare_traces.py"), "--core",
                                        str(FIXTURES / f"{name}.trace.json"), str(path)], capture_output=True, text=True)
                    self.assertEqual(r.returncode, 0, r.stdout + r.stderr)


@needs_java
class Steps(unittest.TestCase):
    def test_loop_forever_is_truncated(self):
        t = trace(solution("        while (n > 0) {\n            n++;\n        }\n        return n;"))
        self.assertTrue(t.get("truncated"))
        self.assertEqual(t["truncated_by"], "steps")
        self.assertEqual(len(t["steps"]), 2000)
        self.assertNotIn("result", t)

    def test_deep_recursion_is_explained(self):
        # Recursion in a class the rewriter does not trace takes no steps, so the stack runs out first.
        source = solution("        return Helper.down(n);") + "class Helper {\n    static int down(int x) { return down(x + 1) + 1; }\n}\n"
        with self.assertRaises(PipelineError) as caught:
            trace(source)
        self.assertEqual(caught.exception.exit_code, EXIT_RUN)
        self.assertIn("StackOverflowError", str(caught.exception))
        self.assertIn("too deep for recursion", str(caught.exception))

    def test_recursion_that_never_ends_stops_at_the_size_budget(self):
        # Every step holds every call in progress, so the steps reach the size budget a few hundred calls deep.
        t = trace(solution("        return f(n + 1) + 1;"))
        self.assertEqual((t.get("truncated"), t.get("truncated_by")), (True, "size"))
        self.assertNotIn("result", t)
        self.assertGreater(len(t["steps"][-1]["frames"]), 100)

    def test_a_large_input_stops_at_the_size_budget(self):
        # Two Sum on 3,000 numbers: every step repeats nums and the growing map.
        source = (ROOT / "fixtures" / "two_sum_trace.java").read_text(encoding="utf-8")
        nums = ",".join(str(i) for i in range(3000))
        t = run(source, f"nums = [{nums}], target = 5997", language="java", source_name="two_sum_trace.java").trace
        self.assertEqual((t.get("truncated"), t.get("truncated_by")), (True, "size"))
        self.assertGreater(len(t["steps"]), 100)

    def test_an_exception_shows_the_users_frames(self):
        with self.assertRaises(PipelineError) as caught:
            trace(solution('        System.out.println("before");\n        int[] a = new int[2];\n        return a[n];'))
        message = str(caught.exception)
        self.assertIn("ArrayIndexOutOfBoundsException", message)
        self.assertIn("Solution.java:5", message)
        self.assertIn("before", message)
        self.assertNotIn("lvtrace", message)

    def test_a_compile_error_names_the_line(self):
        with self.assertRaises(PipelineError) as caught:
            trace(solution("        int x = n\n        return x;"))
        self.assertEqual((caught.exception.stage, caught.exception.exit_code), ("rewriter", EXIT_INPUT))
        self.assertIn("Solution.java:3: error:", str(caught.exception))
        self.assertNotIn("lvtrace", str(caught.exception))

    def test_return_steps_and_void(self):
        source = solution("        if (n < 0) {\n            return;\n        }\n        count += n;",
                          signature="public void f(int n)", extra="    int count;\n")
        t = trace(source)
        last = top(t, -1)
        self.assertIn("return_value", last)
        self.assertIsNone(last["return_value"])
        self.assertIsNone(t["result"])

    def test_definitely_assigned_locals(self):
        # `x` is declared before it is assigned: it appears only once it may be read.
        t = trace(solution("        int x;\n        if (n > 1) x = 1; else x = 2;\n        return x;"))
        self.assertNotIn("x", locals_at(t, 4))
        self.assertEqual(locals_at(t, 5)["x"], 1)
        self.assertEqual(t["result"], 1)

    def test_while_true_and_unreachable_end(self):
        t = trace(solution("        int i = 0;\n        while (true) {\n            i++;\n            if (i == 2) return i;\n        }"))
        self.assertEqual(t["result"], 2)
        self.assertEqual([top(t, k)["line"] for k in range(len(t["steps"]))], [3, 4, 5, 6, 4, 5, 6, 6, 6])  # the if, the return, the return step

    def test_for_header_steps(self):
        t = trace(solution("        int s = 0;\n        for (int i = 0; i < n; i++) {\n            s += i;\n        }\n        return s;"),
                  "n = 2")
        headers = [s for s in t["steps"] if s["frames"][-1]["line"] == 4]
        self.assertEqual(len(headers), 3)
        self.assertNotIn("i", headers[0]["frames"][-1]["locals"])  # before the initializer, as in C++
        self.assertEqual([o["value"] for line, o in outcomes(t, "condition") if line == 4], [True, True, False])
        self.assertEqual([o["value"] for line, o in outcomes(t, "store") if line == 4], [0, 1, 2])

    def test_labels_switch_do_while_and_ternary(self):
        body = """        int k = 0;
        outer:
        for (int i = 0; i < 3; i++) {
            for (int j = 0; j < 3; j++) {
                if (i + j == 2) break outer;
                k++;
            }
        }
        switch (k) {
            case 2: k = 10; break;
            default: k = 20;
        }
        int r = switch (k) { case 10 -> 1; default -> 2; };
        do {
            r++;
        } while (r < 3);
        return k > 5 ? r : -r;"""
        t = trace(solution(body))
        self.assertEqual(t["result"], 3)
        self.assertTrue(any(o["code"] == "k > 5" for line, o in outcomes(t, "condition")))
        self.assertTrue(any(o["code"] == "r < 3" for line, o in outcomes(t, "condition")))


@needs_java
class Values(unittest.TestCase):
    def test_kinds(self):
        body = """        Deque<Integer> st = new ArrayDeque<>();
        st.push(1); st.push(2);
        Deque<Integer> dq = new ArrayDeque<>();
        dq.offerFirst(1); dq.offerLast(2);
        Queue<Integer> q = new LinkedList<>();
        q.offer(5);
        Stack<Integer> s2 = new Stack<>();
        s2.push(7); s2.push(8);
        PriorityQueue<Integer> mn = new PriorityQueue<>(List.of(3, 1));
        PriorityQueue<Integer> mx = new PriorityQueue<>(Collections.reverseOrder());
        PriorityQueue<int[]> cu = new PriorityQueue<>((a, b) -> a[0] - b[0]);
        TreeMap<String, Integer> tm = new TreeMap<>();
        Set<Character> cs = new HashSet<>(List.of('a'));
        char c = 'z';
        long big = 1L << 60;
        double d = 3.0;
        StringBuilder sb = new StringBuilder("ab");
        List<Integer> ll = new LinkedList<>(List.of(1));
        return 0;"""
        t = trace(solution(body))
        loc = locals_at(t, 21)
        self.assertEqual(loc["st"], {"kind": "stack", "items": [1, 2]})
        self.assertEqual(loc["dq"], {"kind": "deque", "items": [1, 2]})
        self.assertEqual(loc["q"], {"kind": "queue", "items": [5]})
        self.assertEqual(loc["s2"], {"kind": "stack", "items": [7, 8]})
        self.assertEqual((loc["mn"]["kind"], loc["mn"]["order"]), ("priority-queue", "min"))
        self.assertEqual(loc["mx"]["order"], "max")
        self.assertEqual(loc["cu"]["order"], "custom")
        self.assertEqual(loc["tm"], {"kind": "map", "entries": []})
        self.assertEqual(loc["cs"], {"kind": "set", "items": ["a"]})
        self.assertEqual(loc["c"], "z")
        self.assertEqual(loc["big"], {"kind": "int", "value": str(1 << 60)})
        self.assertEqual(loc["d"], {"kind": "float", "value": "3.0"})
        self.assertEqual(loc["sb"], "ab")
        self.assertEqual(loc["ll"], {"kind": "list", "items": [1]})

    def test_unknown_values_are_left_out(self):
        t = trace(solution("        Iterator<Integer> it = List.of(1).iterator();\n        int k = 1;\n        return k;"))
        loc = locals_at(t, 5)
        self.assertNotIn("it", loc)
        self.assertIn("k", loc)

    def test_self_containing_list_is_an_error(self):
        with self.assertRaises(PipelineError) as caught:
            trace(solution("        List<Object> a = new ArrayList<>();\n        a.add(a);\n        return 0;"))
        self.assertIn("contains itself", str(caught.exception))

    def test_shared_container_ids(self):
        t = trace(solution("        int[] a = nums;\n        return 0;", signature="public int f(int[] nums)"), "nums = [1]")
        loc = locals_at(t, 4)
        self.assertEqual(loc["a"]["id"], loc["nums"]["id"])

    def test_members(self):
        source = solution("        memo.put(n, n * 2);\n        return memo.get(n);",
                          extra="    static final int MOD = 7;\n    private final Map<Integer, Integer> memo = new HashMap<>();\n")
        t = trace(source)
        self.assertEqual(t["steps"][0]["members"], {"memo": {"kind": "map", "entries": []}})
        self.assertTrue(any(o["target"] == "memo" for line, o in outcomes(t, "read")))

    def test_a_large_input_is_read_from_text(self):
        nums = list(range(1200))
        t = trace(solution("        return nums.length;", signature="public int f(int[] nums)"), f"nums = {json.dumps(nums)}")
        self.assertEqual(t["result"], 1200)

    def test_a_grid(self):
        t = trace(solution("        return grid[1][0] == '1' ? 1 : 0;", signature="public int f(char[][] grid)"),
                  'grid = [["1","0"],["1","1"]]')
        reads = [o for line, o in outcomes(t, "read")]
        self.assertEqual(reads[0]["at"], [1, 0])
        self.assertEqual(reads[0]["value"], "1")
        self.assertEqual(t["result"], 1)


@needs_java
class Outcomes(unittest.TestCase):
    def test_reads_and_indexes(self):
        body = """        Map<Integer, Integer> m = new HashMap<>();
        m.put(nums[0], 1);
        int i = 1;
        int x = nums[i - 1] + m.get(nums[0]);
        if (m.containsKey(x)) x++;
        String s = "ab";
        char ch = s.charAt(i);
        return x;"""
        t = trace(solution(body, signature="public int f(int[] nums)"), "nums = [4]")
        reads = [(o["target"], o.get("at"), o.get("key")) for line, o in outcomes(t, "read")]
        self.assertIn(("nums", [0], None), reads)
        self.assertIn(("m", None, 4), reads)
        self.assertIn(("s", [1], None), reads)
        self.assertIn(("m[nums[0]]", 1), [(o["target"], o["value"]) for line, o in outcomes(t, "store")])
        self.assertEqual(t["indexes"], {"f": {"i": ["nums", "s"]}})

    def test_only_the_container_named_directly_is_indexed(self):
        # In grid[r][c], r indexes grid; c indexes grid[r], which is not a local (spec §3, Indexes).
        body = """        int[][] dp = new int[m][n];
        for (int r = 1; r < m; r++) {
            for (int c = 1; c < n; c++) dp[r][c] = dp[r - 1][c] + dp[r][c - 1];
        }
        return dp[m - 1][n - 1];"""
        t = trace(solution(body, signature="public int f(int m, int n)"), "m = 2, n = 2")
        self.assertEqual(t["indexes"], {"f": {"r": ["dp"], "m": ["dp"]}})


if __name__ == "__main__":
    unittest.main()
