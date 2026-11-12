"""LeetCode's notations for linked structures (driver/shapes.py)."""

import unittest

from driver import DriverError
from driver import shapes


def links(decoded, *fields):
    return [tuple(n[f] for f in fields) for n in decoded.nodes]


class LinkedList(unittest.TestCase):
    def test_chain(self):
        d = shapes.linked_list([1, 2, 3], "head")
        self.assertEqual([n["val"] for n in d.nodes], [1, 2, 3])
        self.assertEqual(links(d, "next"), [(1,), (2,), (None,)])
        self.assertEqual(d.root, 0)

    def test_empty_is_null(self):
        self.assertIsNone(shapes.linked_list([], "head").root)

    def test_pos_makes_a_cycle(self):
        d = shapes.linked_list([3, 2, 0, -4], "head", pos=1)
        self.assertEqual(links(d, "next"), [(1,), (2,), (3,), (1,)])

    def test_bad_pos_and_values(self):
        with self.assertRaisesRegex(DriverError, "not an index"):
            shapes.linked_list([1, 2], "head", pos=2)
        with self.assertRaisesRegex(DriverError, "integers"):
            shapes.linked_list([1, "x"], "head")
        with self.assertRaisesRegex(DriverError, "JSON array"):
            shapes.linked_list(5, "head")


class BinaryTree(unittest.TestCase):
    def test_level_order(self):
        d = shapes.binary_tree([3, 9, 20, None, None, 15, 7], "root")
        self.assertEqual([n["val"] for n in d.nodes], [3, 9, 20, 15, 7])
        self.assertEqual(links(d, "left", "right"), [(1, 2), (None, None), (3, 4), (None, None), (None, None)])

    def test_null_children_are_skipped_in_the_queue(self):
        # [1,null,2,3]: 1's right is 2, and 2's left is 3.
        d = shapes.binary_tree([1, None, 2, 3], "root")
        self.assertEqual(links(d, "left", "right"), [(None, 1), (2, None), (None, None)])

    def test_empty_and_null_root(self):
        self.assertIsNone(shapes.binary_tree([], "root").root)
        self.assertIsNone(shapes.binary_tree([None], "root").root)

    def test_trailing_nulls_allowed(self):
        self.assertEqual(len(shapes.binary_tree([1, 2, None, None, None], "root").nodes), 2)

    def test_values_with_no_parent(self):
        with self.assertRaisesRegex(DriverError, "no parent"):
            shapes.binary_tree([1, None, None, 5], "root")

    def test_extra_fields_start_null(self):
        d = shapes.binary_tree([1, 2, 3], "root", extra=("next",))
        self.assertTrue(all(n["next"] is None for n in d.nodes))


class NaryTree(unittest.TestCase):
    def test_level_order_with_separators(self):
        d = shapes.nary_tree([1, None, 3, 2, 4, None, 5, 6], "root")
        self.assertEqual([n["val"] for n in d.nodes], [1, 3, 2, 4, 5, 6])
        self.assertEqual([n["children"] for n in d.nodes], [[1, 2, 3], [4, 5], [], [], [], []])

    def test_root_must_be_followed_by_null(self):
        with self.assertRaisesRegex(DriverError, "followed by null"):
            shapes.nary_tree([1, 2], "root")


class Graph(unittest.TestCase):
    def test_adjacency_list(self):
        d = shapes.graph([[2, 4], [1, 3], [2, 4], [1, 3]], "node")
        self.assertEqual([n["val"] for n in d.nodes], [1, 2, 3, 4])
        self.assertEqual([n["neighbors"] for n in d.nodes], [[1, 3], [0, 2], [1, 3], [0, 2]])

    def test_empty_graph_and_single_node(self):
        self.assertIsNone(shapes.graph([], "node").root)
        self.assertEqual(shapes.graph([[]], "node").nodes, [{"val": 1, "neighbors": []}])

    def test_neighbor_out_of_range(self):
        with self.assertRaisesRegex(DriverError, "not a node"):
            shapes.graph([[2], [3]], "node")


class RandomList(unittest.TestCase):
    def test_pairs(self):
        d = shapes.random_list([[7, None], [13, 0], [11, 4], [10, 2], [1, 0]], "head")
        self.assertEqual(links(d, "next", "random"), [(1, None), (2, 0), (3, 4), (4, 2), (None, 0)])

    def test_bad_pair(self):
        with self.assertRaisesRegex(DriverError, "expected \\[val, random_index\\]"):
            shapes.random_list([[1]], "head")
        with self.assertRaisesRegex(DriverError, "not a node index"):
            shapes.random_list([[1, 3]], "head")


if __name__ == "__main__":
    unittest.main()
