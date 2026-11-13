"""What an input form needs (driver/cpp/describe.py): methods, fields, and the example text they make."""

import unittest

from driver import DriverError
from driver.cpp import describe, example_fields, example_text, generate

from .test_fixtures import CLONE_GRAPH_NODE, FIXTURES


class Describe(unittest.TestCase):
    def test_two_sum(self):
        d = describe((FIXTURES / "two_sum_trace.cpp").read_text(encoding="utf-8"))
        self.assertEqual(d["method"], "twoSum")
        [m] = d["methods"]
        self.assertEqual(m["params"], [{"name": "nums", "type": "array<int>"}, {"name": "target", "type": "int"}])
        self.assertEqual((m["returns"], m["extras"], m["readable"]), ("array<int>", [], True))

    def test_node_types_from_comments(self):
        source = (FIXTURES / "clone_graph_trace.cpp").read_text(encoding="utf-8")
        d = describe(CLONE_GRAPH_NODE + source)
        self.assertEqual(d["methods"][0]["params"], [{"name": "node", "type": "Node"}])
        self.assertEqual(d["methods"][0]["returns"], "Node")
        # Without LeetCode's commented Node, the type is unknown: listed, with the reason, but not preselected.
        bare = describe(source)
        self.assertFalse(bare["methods"][0]["readable"])
        self.assertIn("Node", bare["methods"][0]["note"])
        self.assertIsNone(bare["method"])

    def test_first_public_method_is_preselected_and_private_helpers_are_left_out(self):
        src = """class Solution {
public:
    int maxDepth(TreeNode* root) { return depth(root); }
    int helper(int a, int b) { return a + b; }
private:
    int depth(TreeNode* n) { return n ? 1 + max(depth(n->left), depth(n->right)) : 0; }
};"""
        d = describe(src)
        self.assertEqual(d["method"], "maxDepth")
        self.assertEqual([m["name"] for m in d["methods"]], ["maxDepth", "helper"])
        self.assertEqual(d["methods"][0]["params"], [{"name": "root", "type": "TreeNode"}])

    def test_a_list_parameter_offers_pos(self):
        src = "class Solution {\npublic:\n    bool hasCycle(ListNode *head) { return false; }\n};"
        [m] = describe(src)["methods"]
        self.assertEqual((m["params"], m["extras"]), ([{"name": "head", "type": "ListNode"}], ["pos"]))

    def test_a_method_it_cannot_read_is_listed_but_not_preselected(self):
        src = """class Solution {
public:
    template <typename T> T odd(T x) { return x; }
    int f(int n) { return n; }
};"""
        d = describe(src)
        unreadable = [m for m in d["methods"] if not m["readable"]]
        self.assertTrue(all(m["note"] for m in unreadable))
        self.assertEqual(d["method"], "f")

    def test_no_solution(self):
        with self.assertRaises(DriverError):
            describe("int main() {}")

    def test_a_design_problem_says_it_is_not_supported_yet(self):
        with self.assertRaises(DriverError) as caught:
            describe("class LRUCache {\npublic:\n    LRUCache(int capacity) {}\n    int get(int key) { return -1; }\n};")
        self.assertIn("LRUCache", str(caught.exception))
        self.assertIn("not supported yet", str(caught.exception))


class Fields(unittest.TestCase):
    def test_example_to_fields(self):
        self.assertEqual(example_fields('Input: nums = [2, 7, 11, 15], s = "a, b", t = null\nOutput: [0,1]'),
                         {"nums": "[2,7,11,15]", "s": '"a, b"', "t": "null"})

    def test_fields_to_example(self):
        self.assertEqual(example_text({"nums": " [2,7,11,15] ", "target": "9", "pos": ""}), "nums = [2,7,11,15], target = 9")

    def test_round_trip_gives_the_same_problem(self):
        source = (FIXTURES / "two_sum_trace.cpp").read_text(encoding="utf-8")
        example = "nums = [2,7,11,15], target = 9"
        self.assertEqual(generate(source, example_text(example_fields(example))).problem, generate(source, example).problem)

    def test_a_bad_value_names_its_field(self):
        with self.assertRaises(DriverError) as caught:
            example_text({"nums": "[1,2", "target": "9"})
        self.assertIn("'nums'", str(caught.exception))

    def test_a_field_cannot_hold_two_values(self):
        with self.assertRaises(DriverError):
            example_text({"nums": "[1], target = 5"})
        with self.assertRaises(DriverError):
            example_text({"x": "NaN"})

    def test_names_must_be_names(self):
        with self.assertRaises(DriverError):
            example_text({"nums = [1], target": "5"})

    def test_all_empty(self):
        with self.assertRaises(DriverError):
            example_text({"nums": "", "target": "  "})


if __name__ == "__main__":
    unittest.main()
