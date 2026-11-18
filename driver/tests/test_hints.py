"""Hints from a parameter's name and its example's shape (driver/hints.py)."""

import unittest

from driver.cpp.generate import generate
from driver.hints import infer_hint

AA = "array<array<int>>"


class InferHint(unittest.TestCase):
    def test_name_and_shape_agree(self):
        self.assertEqual(infer_hint("edges", AA, [[0, 1], [1, 2]]), "edge-list")
        self.assertEqual(infer_hint("times", AA, [[2, 1, 1], [2, 3, 1]]), "edge-list")  # weighted
        self.assertEqual(infer_hint("graph", AA, [[1, 2], [0], [0]]), "adjacency-list")
        self.assertEqual(infer_hint("isConnected", AA, [[1, 1, 0], [1, 1, 0], [0, 0, 1]]), "adjacency-matrix")
        self.assertEqual(infer_hint("intervals", AA, [[1, 3], [2, 6]]), "intervals")
        self.assertEqual(infer_hint("grid", "array<array<char>>", [["1", "0"], ["0", "1"]]), "grid")

    def test_a_name_whose_shape_disagrees_gives_none(self):
        self.assertIsNone(infer_hint("edges", AA, [[0, 1, 2, 3]]))
        self.assertIsNone(infer_hint("graph", AA, [[5], [0]]))          # 5 is not a node of 2
        self.assertIsNone(infer_hint("intervals", AA, [[3, 1]]))        # start after end
        self.assertIsNone(infer_hint("grid", AA, [[1, 2], [3]]))        # ragged

    def test_no_known_name_or_no_2d_type_gives_none(self):
        self.assertIsNone(infer_hint("nums", AA, [[0, 1], [1, 2]]))     # pairs, but the name says nothing
        self.assertIsNone(infer_hint("edges", "array<int>", [0, 1]))
        self.assertIsNone(infer_hint("edges", AA, []))


class InProblem(unittest.TestCase):
    def test_generate_writes_the_hint_on_the_parameter(self):
        source = """class Solution {
public:
    bool canFinish(int numCourses, vector<vector<int>>& prerequisites) { return true; }
};"""
        out = generate(source, "numCourses = 2, prerequisites = [[1,0]]")
        params = out.problem["params"]
        self.assertEqual(params[0], {"name": "numCourses", "type": "int"})
        self.assertEqual(params[1], {"name": "prerequisites", "type": "array<array<int>>", "hint": "edge-list"})


if __name__ == "__main__":
    unittest.main()
