"""The Python driver (driver/python/): type hints, node classes, describe(), and generate()."""

import ast
import json
import unittest

from driver import DriverError
from driver.python import describe, generate
from driver.python.nodes import node_types
from driver.python.types import neutral

from .test_fixtures import FIXTURES


def hint(text):
    return ast.parse(text, mode="eval").body


class Types(unittest.TestCase):
    def test_hints(self):
        cases = {
            "List[int]": "array<int>", "list[list[str]]": "array<array<string>>", "Optional[TreeNode]": "TreeNode",
            "TreeNode | None": "TreeNode", "Dict[str, int]": "map<string, int>", "Set[int]": "set<int>",
            "Tuple[int, str]": "tuple<int, string>", "Deque[int]": "deque<int>", "'Node'": "Node",
            "Optional['Node']": "Node", "typing.List[float]": "array<float>", "bool": "bool",
        }
        for text, expected in cases.items():
            with self.subTest(text):
                self.assertEqual(neutral(hint(text), ["TreeNode", "ListNode", "Node"], "x"), expected)

    def test_none_is_void_for_returns_only(self):
        self.assertEqual(neutral(hint("None"), [], "x", returns=True), "void")
        with self.assertRaises(DriverError):
            neutral(hint("None"), [], "x")

    def test_unreadable_hint_names_it(self):
        with self.assertRaisesRegex(DriverError, "Callable"):
            neutral(hint("Callable[[int], int]"), [], "parameter 'f'")


NODE_COMMENT = """# Definition for a Node.
# class Node:
#     def __init__(self, val = 0, neighbors = None):
#         self.val = val
#         self.neighbors = neighbors if neighbors is not None else []
"""


class Nodes(unittest.TestCase):
    def test_supplied(self):
        types = node_types("", ast.parse(""))
        self.assertEqual(types["ListNode"].shape, "linked-list")
        self.assertEqual(types["TreeNode"].shape, "binary-tree")
        self.assertTrue(types["TreeNode"].supplied)

    def test_commented_class(self):
        types = node_types(NODE_COMMENT, ast.parse(NODE_COMMENT))
        self.assertEqual(types["Node"].fields, ["val", "neighbors"])
        self.assertEqual(types["Node"].shape, "graph")
        self.assertIn("class Node:", types["Node"].definition)

    def test_class_in_a_string(self):
        source = (FIXTURES / "clone_graph_trace.py").read_text(encoding="utf-8")
        types = node_types(source, ast.parse(source))
        self.assertEqual(types["Node"].shape, "graph")

    def test_prose_that_looks_like_a_class_is_ignored(self):
        source = "# class notes: this is prose\n"
        self.assertNotIn("notes", node_types(source, ast.parse(source)))


class Describe(unittest.TestCase):
    def test_two_sum(self):
        d = describe((FIXTURES / "two_sum_trace.py").read_text(encoding="utf-8"))
        self.assertEqual(d["method"], "twoSum")
        [m] = d["methods"]
        self.assertEqual(m["params"], [{"name": "nums", "type": "array<int>"}, {"name": "target", "type": "int"}])
        self.assertEqual(m["returns"], "array<int>")

    def test_leetcodes_empty_template_is_read(self):
        # The body is not written yet: the form still gets the parameters. A run still needs valid code.
        template = "class Solution:\n    def twoSum(self, nums: List[int], target: int) -> List[int]:\n\n"
        self.assertEqual(describe(template)["method"], "twoSum")
        nested = "class Solution:\n    def f(self, n: int) -> int:\n        def g():\n    def h(self, s: str) -> str:\n"
        self.assertEqual([m["name"] for m in describe(nested)["methods"]], ["f", "h"])
        with self.assertRaisesRegex(DriverError, "not valid Python 3"):
            generate(template, "nums = [1], target = 1")
        with self.assertRaisesRegex(DriverError, "not valid Python 3"):
            describe("class Solution:\n    def f(self, n: int) -> int:\n        return (\n")

    def test_list_node_offers_pos(self):
        d = describe((FIXTURES / "reverse_list_trace.py").read_text(encoding="utf-8"))
        self.assertEqual(d["methods"][0]["extras"], ["pos"])

    def test_unannotated_method_is_listed_but_not_chosen(self):
        d = describe("class Solution:\n    def f(self, x):\n        return x\n")
        self.assertFalse(d["methods"][0]["readable"])
        self.assertIsNone(d["method"])

    def test_private_helpers_are_left_out(self):
        d = describe("class Solution:\n    def _h(self, x: int) -> int: ...\n    def f(self, x: int) -> int: ...\n")
        self.assertEqual([m["name"] for m in d["methods"]], ["f"])


class Generate(unittest.TestCase):
    def test_values_go_in_as_json(self):
        p = generate((FIXTURES / "two_sum_trace.py").read_text(encoding="utf-8"), "nums = [2,7,11,15], target = 9")
        spec = json.loads(p.run_json())
        self.assertEqual(spec["method"], "twoSum")
        self.assertEqual(spec["args"], [{"name": "nums", "type": "array<int>", "value": [2, 7, 11, 15]},
                                        {"name": "target", "type": "int", "value": 9}])
        self.assertEqual(p.problem["returns"], {"type": "array<int>"})

    def test_nodes_are_records(self):
        p = generate((FIXTURES / "reverse_list_trace.py").read_text(encoding="utf-8"), "head = [1,2]")
        [arg] = p.spec["args"]
        self.assertEqual(arg["nodes"]["class"], "ListNode")
        self.assertEqual(len(arg["nodes"]["records"]), 2)

    def test_commented_node_class_travels_with_the_spec(self):
        source = NODE_COMMENT + "class Solution:\n    def f(self, node: 'Node') -> 'Node':\n        return node\n"
        p = generate(source, "adjList = [[2],[1]]")
        self.assertIn("class Node:", p.spec["classes"])

    def test_errors(self):
        two_sum = (FIXTURES / "two_sum_trace.py").read_text(encoding="utf-8")
        cases = [
            ("class Solution:\n    def f(self\n", "x = 1", "not valid Python 3: line"),
            ("class LRUCache:\n    pass\n", "x = 1", "design problem"),
            (two_sum, 'nums = [1,"a"], target = 9', r"nums\[1\] should be an integer"),
            (two_sum, "nums = [1], target = true", "target should be an integer"),
        ]
        for source, example, message in cases:
            with self.subTest(message):
                with self.assertRaisesRegex(DriverError, message):
                    generate(source, example)


if __name__ == "__main__":
    unittest.main()
