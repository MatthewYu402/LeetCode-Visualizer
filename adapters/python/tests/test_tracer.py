"""The Python adapter end to end: a Solution and an example in, a checked trace out.

    python3 -m unittest discover -s adapters/python/tests

Each test runs run.py with Python 3.12 on a small Solution and checks the trace with
tools/check_trace.py, then looks at the part it is about.
"""

import subprocess
import sys
import unittest

from support import ROOT, python, solution, trace

FIXTURES = ["two-sum", "reverse-list", "preorder-traversal", "clone-graph", "max-depth", "subsets"]
EXAMPLES = {
    "two-sum": "nums = [2,7,11,15], target = 9",
    "reverse-list": "head = [1,2,3,4,5]",
    "preorder-traversal": "root = [1,null,2,3]",
    "clone-graph": "adjList = [[2,4],[1,3],[2,4],[1,3]]",
    "max-depth": "root = [3,9,20,null,null,15,7]",
    "subsets": "nums = [1,2,3]",
}


def ok(test, run):
    test.assertEqual(run.status, 0, run.output)
    status, output = run.check()
    test.assertEqual(status, 0, output)
    return run


class Fixtures(unittest.TestCase):
    """Each Python fixture equals its golden trace and is like the C++ one."""

    def test_fixtures(self):
        for name in FIXTURES:
            with self.subTest(name):
                source = (ROOT / "fixtures" / f"{name.replace('-', '_')}_trace.py").read_text(encoding="utf-8")
                run = ok(self, trace(source, EXAMPLES[name]))
                status, output = run.check("--equals", str(ROOT / "fixtures" / f"{name}.python.trace.json"))
                self.assertEqual(status, 0, output)
                status, output = run.check("--like", str(ROOT / "fixtures" / f"{name}.trace.json"))
                self.assertEqual(status, 0, output)
                # Call by call: every shared local's values, returns, indexes, and members as in C++.
                compare = subprocess.run([sys.executable, "-I", str(ROOT / "tools" / "compare_traces.py"), "--core",
                                          str(ROOT / "fixtures" / f"{name}.trace.json"), str(run.path)],
                                         capture_output=True, text=True)
                self.assertEqual(compare.returncode, 0, compare.stdout + compare.stderr)


class Steps(unittest.TestCase):
    def test_loop_forever_is_truncated(self):
        run = trace(solution("        i = 0\n        while True:\n            i += 1\n"), "nums = [1]")
        self.assertEqual(run.status, 0, run.output)
        status, output = run.check("--expect-truncated")
        self.assertEqual(status, 0, output)

    def test_deep_recursion_is_explained(self):
        source = solution("        return self.f(nums) + 1\n")
        run = trace(source, "nums = [1]")
        self.assertEqual(run.status, 1)
        self.assertIn("RecursionError", run.output)
        self.assertIn("1,000 nested calls", run.output)
        self.assertNotIn("tracer.py", run.output)  # only the user's frames

    def test_user_exception_has_no_result(self):
        run = trace(solution("        return nums[5]\n"), "nums = [1]")
        self.assertEqual(run.status, 1)
        self.assertIn("IndexError", run.output)

    def test_settrace_none_does_not_break_the_trace(self):
        run = trace(solution("        import sys\n        sys.settrace(None)\n        return 1\n"), "nums = [1]")
        self.assertEqual(run.status, 0, run.output)

    def test_a_comprehension_is_one_step(self):
        body = ("        a = [x * 2 for x in nums]\n        b = {x: [y for y in nums]\n             for x in nums}\n"
                "        return max([self.g(x) for x in nums])\n    def g(self, x: int) -> int:\n        return x\n")
        run = ok(self, trace(solution(body), "nums = [1,2,3]"))
        lines = [(run.top(i)["function"], run.top(i)["line"]) for i in range(len(run.steps))]
        self.assertEqual(lines, [("f", 3), ("f", 4), ("f", 6)] + [("g", 8)] * 6 + [("f", 6)])
        self.assertEqual([o["target"] for line, o in run.outcomes("store")], ["a", "b"])
        self.assertNotIn("x", run.steps[1]["frames"][-1]["locals"])

    def test_while_true_has_a_step_per_check(self):
        body = "        i = 0\n        while True:\n            i += 1\n            if i > 1:\n                break\n        return i\n"
        run = ok(self, trace(solution(body), "nums = [1]"))
        self.assertEqual([run.top(i)["line"] for i in range(len(run.steps))], [3, 4, 5, 6, 4, 5, 6, 7, 8, 8])

    def test_return_step_and_result(self):
        run = ok(self, trace(solution("        x = len(nums)\n        return x\n"), "nums = [1,2]"))
        last = run.top(-1)
        self.assertEqual(last["return_value"], 2)
        self.assertEqual(run.trace["result"], 2)
        self.assertNotIn("truncated", run.trace)


class Values(unittest.TestCase):
    def test_kinds(self):
        body = ("        t = (1, 'a')\n        s = {3}\n        d = {1: 2}\n        q = deque([1])\n"
                "        f = 3.0\n        g = 0.5\n        big = 2 ** 60\n        return 0\n")
        run = ok(self, trace(solution(body), "nums = [1]"))
        loc = run.locals_at(10)
        self.assertEqual(loc["t"], {"kind": "tuple", "items": [1, "a"]})
        self.assertEqual(loc["s"], {"kind": "set", "items": [3]})
        self.assertEqual(loc["d"], {"kind": "map", "entries": [[1, 2]]})
        self.assertEqual(loc["q"], {"kind": "deque", "items": [1]})
        self.assertEqual(loc["f"], {"kind": "float", "value": "3.0"})
        self.assertEqual(loc["g"], 0.5)
        self.assertEqual(loc["big"], {"kind": "int", "value": str(2 ** 60)})

    def test_heapq_list_is_a_min_priority_queue(self):
        body = "        h = []\n        heapq.heappush(h, 3)\n        heapq.heappush(h, 1)\n        return h[0]\n"
        run = ok(self, trace(solution(body), "nums = [1]"))
        h = run.locals_at(6)["h"]
        self.assertEqual(h["kind"], "priority-queue")
        self.assertEqual(h["order"], "min")

    def test_sortedcontainers(self):
        if subprocess.run([python(), "-c", "import sortedcontainers"], capture_output=True).returncode != 0:
            self.skipTest("sortedcontainers is not installed (the sandbox image has it)")
        body = "        a = SortedList([3, 1])\n        b = SortedDict({2: 1})\n        c = SortedSet([2])\n        return 0\n"
        run = ok(self, trace(solution(body), "nums = [1]"))
        loc = run.locals_at(6)
        self.assertEqual(loc["a"]["kind"], "multiset")
        self.assertEqual(loc["b"]["kind"], "map")
        self.assertEqual(loc["c"]["kind"], "set")

    def test_self_containing_list_is_an_error(self):
        run = trace(solution("        a = []\n        a.append(a)\n        return 0\n"), "nums = [1]")
        self.assertEqual(run.status, 1)
        self.assertIn("contains itself", run.output)

    def test_unknown_types_are_left_out(self):
        run = ok(self, trace(solution("        it = iter(nums)\n        k = 1\n        return k\n"), "nums = [1]"))
        loc = run.locals_at(5)
        self.assertNotIn("it", loc)
        self.assertIn("k", loc)

    def test_shared_container_ids(self):
        run = ok(self, trace(solution("        a = nums\n        return 0\n"), "nums = [1]"))
        loc = run.locals_at(4)
        self.assertIn("id", loc["a"])
        self.assertEqual(loc["a"]["id"], loc["nums"]["id"])

    def test_members_appear_once_assigned(self):
        source = ("class Solution:\n    def f(self, nums: List[int]) -> int:\n        self.memo = {}\n"
                  "        self.memo[1] = 2\n        return self.memo[1]\n")
        run = ok(self, trace(source, "nums = [1]"))
        self.assertNotIn("members", run.steps[0])
        self.assertEqual(run.steps[1]["members"]["memo"], {"kind": "map", "entries": []})


class Outcomes(unittest.TestCase):
    def test_condition_store_and_read(self):
        body = "        x = nums[0]\n        if x > 0:\n            x += 1\n        return x\n"
        run = ok(self, trace(solution(body), "nums = [5]"))
        kinds = [(line, o["kind"]) for line, o in run.outcomes()]
        self.assertIn((3, "read"), kinds)
        self.assertIn((3, "store"), kinds)
        self.assertIn((4, "condition"), kinds)
        self.assertIn((5, "store"), kinds)
        cond = [o for line, o in run.outcomes("condition")][0]
        self.assertIs(cond["value"], True)

    def test_loop_header_has_a_step_per_check(self):
        body = "        i = 0\n        while i < 2:\n            i += 1\n        return i\n"
        run = ok(self, trace(solution(body), "nums = [5]"))
        values = [o["value"] for line, o in run.outcomes("condition") if line == 4]
        self.assertEqual(values, [True, True, False])

    def test_membership_is_a_key_read(self):
        body = "        seen = {1}\n        if 1 in seen:\n            return 1\n        return 0\n"
        run = ok(self, trace(solution(body), "nums = [5]"))
        reads = [o for line, o in run.outcomes("read") if line == 4]
        self.assertEqual(reads[0]["target"], "seen")
        self.assertIn("key", reads[0])

    def test_indexes(self):
        body = "        i = 0\n        while i + 1 < len(nums):\n            i += 1\n        return nums[i - 1]\n"
        run = ok(self, trace(solution(body), "nums = [1,2,3]"))
        self.assertEqual(run.trace["indexes"], {"f": {"i": ["nums"]}})


if __name__ == "__main__":
    unittest.main()
