"""The Java driver (driver/java/): types, signatures, node classes, describe(), and generate()."""

import unittest

from driver import DriverError
from driver.java import describe, generate
from driver.java.nodes import node_types
from driver.java.types import neutral

from .test_fixtures import FIXTURES


class Types(unittest.TestCase):
    def test_types(self):
        cases = {
            "int": "int", "long": "int", "Integer": "int", "double": "float", "boolean": "bool", "char": "char",
            "String": "string", "int[]": "array<int>", "char[][]": "array<array<char>>", "List<Integer>": "array<int>",
            "List<List<Integer>>": "array<array<int>>", "LinkedList<Integer>": "list<int>", "Set<Character>": "set<char>",
            "Map<String, Integer>": "map<string, int>", "Deque<Integer>": "deque<int>", "Queue<int[]>": "queue<array<int>>",
            "PriorityQueue<Integer>": "priority-queue<int>", "ListNode": "ListNode", "ListNode[]": "array<ListNode>",
        }
        for text, expected in cases.items():
            with self.subTest(text):
                self.assertEqual(neutral(text, ["ListNode", "TreeNode"], "x"), expected)
        self.assertEqual(neutral("void", [], "x", returns=True), "void")
        with self.assertRaisesRegex(DriverError, "Function"):
            neutral("Function<Integer, Integer>", [], "parameter 'f'")


class Signatures(unittest.TestCase):
    def test_public_and_helpers(self):
        source = """class Solution {
    public int f(int[] nums, int k) { return 0; }
    private void helper(int x) { }
    int g(String s) { return 0; }
    public static long h(List<List<Integer>> grid) { return 0; }
}"""
        d = describe(source)
        self.assertEqual([m["name"] for m in d["methods"]], ["f", "g", "h"])
        self.assertEqual(d["methods"][2]["params"], [{"name": "grid", "type": "array<array<int>>"}])

    def test_lambdas_and_anonymous_classes_are_not_methods(self):
        source = """class Solution {
    public int f(int[] nums) {
        Comparator<Integer> c = new Comparator<>() { public int compare(Integer a, Integer b) { return a - b; } };
        Runnable r = () -> { };
        return 0;
    }
}"""
        self.assertEqual([m["name"] for m in describe(source)["methods"]], ["f"])

    def test_list_node_offers_pos(self):
        d = describe((FIXTURES / "reverse_list_trace.java").read_text(encoding="utf-8"))
        self.assertEqual(d["methods"][0]["extras"], ["pos"])


class Nodes(unittest.TestCase):
    def test_node_from_a_block_comment(self):
        source = (FIXTURES / "clone_graph_trace.java").read_text(encoding="utf-8")
        t = node_types(source)["Node"]
        self.assertEqual(t.fields, ["val", "neighbors"])
        self.assertEqual(t.shape, "graph")
        self.assertTrue(t.no_arg_constructor)

    def test_javadoc_margins_are_removed(self):
        types = node_types((FIXTURES / "max_depth_trace.java").read_text(encoding="utf-8"))
        self.assertTrue(types["TreeNode"].supplied)
        self.assertEqual(types["TreeNode"].shape, "binary-tree")


class Generate(unittest.TestCase):
    def test_literals(self):
        p = generate((FIXTURES / "two_sum_trace.java").read_text(encoding="utf-8"), "nums = [2,7,11,15], target = 9")
        self.assertIn("int[] nums = new int[]{2, 7, 11, 15};", p.main)
        self.assertIn("int target = 9;", p.main)
        self.assertIn("class ListNode", p.nodes)

    def test_lists_chars_and_longs(self):
        source = "class Solution {\n    public long f(List<List<Integer>> g, char c, long n, String s) { return n; }\n}\n"
        p = generate(source, 'g = [[1],[]], c = "a", n = 5, s = "x\\"y"')
        self.assertIn("new ArrayList<List<Integer>>(Arrays.asList(new ArrayList<Integer>(Arrays.asList(1)), new ArrayList<Integer>()))", p.main)
        self.assertIn("char c = 'a';", p.main)
        self.assertIn("long n = 5L;", p.main)
        self.assertIn('String s = "x\\"y";', p.main)

    def test_a_large_array_is_text(self):
        p = generate("class Solution {\n    public int f(int[] nums) { return 0; }\n}\n", f"nums = [{','.join('1' * 1 for _ in range(600))}]")
        self.assertIn("lvtrace.Args.int1(", p.main)

    def test_the_node_class_from_the_comment_goes_into_nodes(self):
        p = generate((FIXTURES / "clone_graph_trace.java").read_text(encoding="utf-8"), "adjList = [[2],[1]]")
        self.assertIn("class Node {", p.nodes)
        self.assertIn("node_n0.neighbors = new ArrayList<>(Arrays.asList(node_n1));", p.main)

    def test_errors(self):
        two_sum = (FIXTURES / "two_sum_trace.java").read_text(encoding="utf-8")
        for source, example, message in [
            ("class LRUCache {\n}\n", "x = 1", "design problem"),
            (two_sum, 'nums = [1,"a"], target = 9', r"nums\[1\] should be an integer"),
            (two_sum, "nums = [1], target = 3000000000", "does not fit in a Java int"),
        ]:
            with self.subTest(message):
                with self.assertRaisesRegex(DriverError, message):
                    generate(source, example)


if __name__ == "__main__":
    unittest.main()
