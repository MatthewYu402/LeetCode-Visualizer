"""Every golden fixture, through a generated main instead of its hand-written one.

This is roadmap Phase 3's "done when": the driver replaces each hand-written
main and nothing else changes. For each fixture:

1. The driver reads the plain Solution (fixtures/<name>_trace.cpp) and the
   example, written the way LeetCode's problem page writes it.
2. The program is the hand-instrumented Solution class from
   fixtures/<name>_hand_inst.cpp (the rewriter's job, done by hand for now),
   followed by the generated main, with the generated prelude.
3. The trace must equal fixtures/<name>.trace.json exactly, problem object
   included, and pass every check in tools/check_trace.py.
"""

import re
import unittest

from driver.cpp import generate
from driver.cpp.source import blank_comments_and_literals, matching

from .support import ROOT, build_and_run, check_trace, needs_compiler

FIXTURES = ROOT / "fixtures"

# LeetCode shows Clone Graph's Node definition as this comment. The plain
# fixture source leaves it out so its line numbers stay the golden trace's;
# the comment goes in front here, which changes nothing the driver reads.
CLONE_GRAPH_NODE = """/*
// Definition for a Node.
class Node {
public:
    int val;
    vector<Node*> neighbors;
    Node() {
        val = 0;
        neighbors = vector<Node*>();
    }
    Node(int _val) {
        val = _val;
        neighbors = vector<Node*>();
    }
    Node(int _val, vector<Node*> _neighbors) {
        val = _val;
        neighbors = _neighbors;
    }
};
*/
"""

CASES = {
    # golden name: (source file stem, example as LeetCode writes it, prefix)
    "two-sum": ("two_sum", "Input: nums = [2,7,11,15], target = 9", ""),
    "reverse-list": ("reverse_list", "Input: head = [1,2,3,4,5]", ""),
    "preorder-traversal": ("preorder_traversal", "Input: root = [1,null,2,3]", ""),
    "clone-graph": ("clone_graph", "Input: adjList = [[2,4],[1,3],[2,4],[1,3]]", CLONE_GRAPH_NODE),
    "max-depth": ("max_depth", "Input: root = [3,9,20,null,null,15,7]", ""),
    "subsets": ("subsets", "Input: nums = [1,2,3]", ""),
}


def instrumented_class(path):
    """The `class Solution { ... };` block of a hand-instrumented fixture."""
    text = path.read_text(encoding="utf-8")
    start = re.search(r"^class Solution\b", text, re.M).start()
    open_brace = text.index("{", start)
    close = matching(blank_comments_and_literals(text), open_brace)
    return text[start:close + 1] + ";\n"


@needs_compiler
class GoldenThroughGeneratedDriver(unittest.TestCase):
    def test_every_fixture(self):
        for golden, (stem, example, prefix) in CASES.items():
            with self.subTest(fixture=golden):
                source = prefix + (FIXTURES / f"{stem}_trace.cpp").read_text(encoding="utf-8")
                program = generate(source, example)
                code = instrumented_class(FIXTURES / f"{stem}_hand_inst.cpp")
                _, trace_path = build_and_run(program, code)
                status, output = check_trace("--equals", FIXTURES / f"{golden}.trace.json", trace_path)
                self.assertEqual(status, 0, output)

    def test_every_golden_fixture_is_covered(self):
        goldens = {p.name[:-len(".trace.json")] for p in FIXTURES.glob("*.trace.json")}
        self.assertEqual(goldens, set(CASES))


if __name__ == "__main__":
    unittest.main()
