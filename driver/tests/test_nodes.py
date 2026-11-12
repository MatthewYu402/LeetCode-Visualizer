"""Node types from LeetCode's comments (driver/cpp/nodes.py)."""

import unittest

from driver import DriverError
from driver.cpp.nodes import node_types

GRAPH = """/*
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
class Solution { public: Node* cloneGraph(Node* node) { return node; } };
"""

RANDOM = """/*
// Definition for a Node.
class Node {
public:
    int val;
    Node* next;
    Node* random;

    Node(int _val) {
        val = _val;
        next = NULL;
        random = NULL;
    }
};
*/
class Solution {};
"""

TREE_COMMENT = """/**
 * Definition for a binary tree node.
 * struct TreeNode {
 *     int val;
 *     TreeNode *left;
 *     TreeNode *right;
 *     TreeNode() : val(0), left(nullptr), right(nullptr) {}
 *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
 * };
 */
class Solution {};
"""


class NodeTypes(unittest.TestCase):
    def test_supplied_types_are_always_there(self):
        types = node_types("class Solution {};")
        self.assertEqual({n: t.fields for n, t in types.items()}, {"ListNode": ["val", "next"], "TreeNode": ["val", "left", "right"]})
        self.assertEqual(types["TreeNode"].shape, "binary-tree")

    def test_graph_node_from_comment(self):
        t = node_types(GRAPH)["Node"]
        self.assertEqual(t.fields, ["val", "neighbors"])
        self.assertEqual(t.shape, "graph")
        self.assertTrue(t.int_constructor)
        self.assertTrue(t.definition.startswith("class Node {") and t.definition.endswith("};"))
        self.assertNotIn("//", t.definition)

    def test_random_list_node(self):
        t = node_types(RANDOM)["Node"]
        self.assertEqual((t.fields, t.shape), (["val", "next", "random"], "random-list"))

    def test_star_prefixed_comment_and_two_declarators(self):
        src = "/**\n * struct Node {\n *     int val;\n *     Node *left, *right, *next;\n * };\n */\nclass Solution {};"
        t = node_types(src)["Node"]
        self.assertEqual((t.fields, t.shape), (["val", "left", "right", "next"], "binary-tree-with-next"))
        self.assertFalse(t.int_constructor)

    def test_nary_node(self):
        src = "/*\nclass Node {\npublic:\n    int val;\n    vector<Node*> children;\n    Node() {}\n    Node(int _val) { val = _val; }\n};\n*/\nclass Solution {};"
        self.assertEqual(node_types(src)["Node"].shape, "nary-tree")

    def test_commented_tree_node_matching_ours_is_accepted(self):
        types = node_types(TREE_COMMENT)
        self.assertTrue(types["TreeNode"].supplied)  # ours is used; the comment only had to agree
        self.assertEqual(set(types), {"ListNode", "TreeNode"})

    def test_unknown_shape_has_no_shape(self):
        src = "/*\nclass Node {\npublic:\n    int val;\n    Node* prev;\n    Node* next;\n    Node* child;\n};\n*/\nclass Solution {};"
        self.assertIsNone(node_types(src)["Node"].shape)

    def test_fields_table(self):
        table = node_types(GRAPH)["Node"].fields_table()
        self.assertIn('static constexpr const char *type = "Node";', table)
        self.assertIn('std::pair{"neighbors", &Node::neighbors}', table)

    def test_errors(self):
        with self.assertRaisesRegex(DriverError, "defines ListNode itself"):
            node_types("struct ListNode { int val; ListNode* next; };\nclass Solution {};")
        with self.assertRaisesRegex(DriverError, "commented TreeNode has fields"):
            node_types("/* struct TreeNode { int val; TreeNode* kids; }; */ class Solution {};")


if __name__ == "__main__":
    unittest.main()
