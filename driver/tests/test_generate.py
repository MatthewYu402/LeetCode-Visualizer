"""The generated program, compiled and run (driver/cpp/generate.py).

Each test pastes a plain Solution, as a user would, generates the program, and
runs it. The Solution computes something from its inputs, so a right result
proves the inputs were built right. There are no record() calls yet (that is
the rewriter's job), so these traces have no steps: the result is what is
checked, and the problem object.
"""

import unittest

from driver import DriverError
from driver.cpp import generate

from .support import build_and_run, check_trace, needs_compiler


def run(source, example, method=None):
    program = generate(source, example, method)
    trace, path = build_and_run(program, source)
    code, out = check_trace(path)
    if code != 0:
        raise AssertionError(out)
    return program, trace


@needs_compiler
class Primitives(unittest.TestCase):
    def test_strings_and_chars_with_escapes(self):
        src = """class Solution {
public:
    string joinWith(vector<string>& words, char sep) {
        string out;
        for (size_t i = 0; i < words.size(); ++i) {
            if (i) out += sep;
            out += words[i];
        }
        return out;
    }
};"""
        program, trace = run(src, r'words = ["a,b","c\"d","e\\f","tab\there"], sep = "\\"')
        self.assertEqual(trace["result"], 'a,b\\c"d\\e\\f\\tab\there')
        self.assertEqual(program.problem["params"], [{"name": "words", "type": "array<string>"}, {"name": "sep", "type": "char"}])

    def test_char_grid_bool_and_double(self):
        src = """class Solution {
public:
    double score(vector<vector<char>>& board, bool strict, double weight) {
        int dots = 0;
        for (auto& row : board) for (char c : row) if (c == '.') ++dots;
        return strict ? dots * weight : -1.0;
    }
};"""
        program, trace = run(src, 'board = [["5","3","."],[".","7","."]], strict = true, weight = 1.5')
        self.assertEqual(trace["result"], 4.5)
        self.assertEqual([p["type"] for p in program.problem["params"]], ["array<array<char>>", "bool", "float"])

    def test_wide_integers(self):
        src = "class Solution {\npublic:\n    long long twice(long long x) { return 2 * x; }\n};"
        _, trace = run(src, "x = 4000000000")
        self.assertEqual(trace["result"], 8000000000)

    def test_void_method(self):
        src = "class Solution {\npublic:\n    void sortColors(vector<int>& nums) { sort(nums.begin(), nums.end()); }\n};"
        program, trace = run(src, "nums = [2,0,2,1,1,0]")
        self.assertEqual(program.problem["returns"], {"type": "void"})
        self.assertIsNone(trace["result"])
        self.assertEqual(check_trace("--expect-void", build_and_run(program, src)[1])[0], 0)

    def test_empty_array(self):
        src = "class Solution {\npublic:\n    int count(vector<int>& nums) { return nums.size(); }\n};"
        self.assertEqual(run(src, "nums = []")[1]["result"], 0)


@needs_compiler
class Nodes(unittest.TestCase):
    def test_tree_level_order(self):
        src = """class Solution {
public:
    int sum(TreeNode* root) {
        if (!root) return 0;
        return root->val + sum(root->left) + sum(root->right);
    }
};"""
        self.assertEqual(run(src, "root = [3,9,20,null,null,15,7]")[1]["result"], 54)
        self.assertEqual(run(src, "root = []")[1]["result"], 0)
        # [1,null,2,3]: 2 is the right child, 3 is 2's left child. A preorder sum cannot see
        # that, so check the shape through a second method.
        shape = src.replace("int sum(TreeNode* root)", "int shape(TreeNode* root)").replace(
            "return root->val + sum(root->left) + sum(root->right);",
            "return root->val * 100 + (root->right ? root->right->val * 10 : 0) + (root->right && root->right->left ? root->right->left->val : 0);")
        self.assertEqual(run(shape, "root = [1,null,2,3]")[1]["result"], 123)

    def test_linked_list_cycle_with_pos(self):
        src = """class Solution {
public:
    bool hasCycle(ListNode *head) {
        ListNode *slow = head, *fast = head;
        while (fast && fast->next) {
            slow = slow->next;
            fast = fast->next->next;
            if (slow == fast) return true;
        }
        return false;
    }
};"""
        program, trace = run(src, "head = [3,2,0,-4], pos = 1")
        self.assertTrue(trace["result"])
        self.assertEqual(program.problem["input"], {"head": [3, 2, 0, -4]})
        self.assertFalse(run(src, "head = [1,2], pos = -1")[1]["result"])

    def test_array_of_lists(self):
        src = """class Solution {
public:
    int countAll(vector<ListNode*>& lists) {
        int n = 0;
        for (ListNode* l : lists) for (; l; l = l->next) ++n;
        return n;
    }
};"""
        program, trace = run(src, "lists = [[1,4,5],[1,3,4],[],[2,6]]")
        self.assertEqual(trace["result"], 8)
        self.assertEqual(program.problem["params"][0]["type"], "array<ListNode>")

    def test_returned_list_has_result_heap(self):
        src = """class Solution {
public:
    ListNode* middleNode(ListNode* head) {
        ListNode *slow = head, *fast = head;
        while (fast && fast->next) { slow = slow->next; fast = fast->next->next; }
        return slow;
    }
};"""
        program, trace = run(src, "head = [1,2,3,4,5]")
        self.assertEqual(program.problem["returns"], {"type": "ListNode"})
        root = trace["result_heap"][trace["result"]["id"]]
        self.assertEqual(root["fields"]["val"], 3)

    def test_graph_node_from_comment_with_positional_name(self):
        src = """/*
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

class Solution {
public:
    int edges(Node* node) {
        unordered_set<Node*> seen;
        vector<Node*> todo{node};
        int count = 0;
        while (!todo.empty()) {
            Node* n = todo.back();
            todo.pop_back();
            if (!n || seen.count(n)) continue;
            seen.insert(n);
            for (Node* m : n->neighbors) { ++count; todo.push_back(m); }
        }
        return count;
    }
};"""
        program, trace = run(src, "adjList = [[2,4],[1,3],[2,4],[1,3]]")
        self.assertEqual(trace["result"], 8)  # each of 4 edges, seen from both ends
        self.assertEqual(program.problem["input"], {"node": [[2, 4], [1, 3], [2, 4], [1, 3]]})
        self.assertEqual(len(program.warnings), 1)
        self.assertIn("class Node {", program.prelude)
        self.assertIn('trace::Fields<Node>', program.prelude)

    def test_random_list(self):
        src = """/*
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

class Solution {
public:
    int randomSum(Node* head) {
        int s = 0;
        for (Node* p = head; p; p = p->next) if (p->random) s += p->random->val;
        return s;
    }
};"""
        _, trace = run(src, "head = [[7,null],[13,0],[11,4],[10,2],[1,0]]")
        self.assertEqual(trace["result"], 7 + 1 + 11 + 7)

    def test_nary_tree(self):
        src = """/*
// Definition for a Node.
class Node {
public:
    int val;
    vector<Node*> children;

    Node() {}

    Node(int _val) {
        val = _val;
    }

    Node(int _val, vector<Node*> _children) {
        val = _val;
        children = _children;
    }
};
*/

class Solution {
public:
    vector<int> preorder(Node* root) {
        vector<int> out;
        walk(root, out);
        return out;
    }
private:
    void walk(Node* n, vector<int>& out) {
        if (!n) return;
        out.push_back(n->val);
        for (Node* c : n->children) walk(c, out);
    }
};"""
        _, trace = run(src, "root = [1,null,3,2,4,null,5,6]")
        self.assertEqual(trace["result"], {"kind": "array", "items": [1, 3, 5, 6, 2, 4]})

    def test_tree_with_next_pointers(self):
        src = """/*
// Definition for a Node.
class Node {
public:
    int val;
    Node* left;
    Node* right;
    Node* next;

    Node() : val(0), left(NULL), right(NULL), next(NULL) {}

    Node(int _val) : val(_val), left(NULL), right(NULL), next(NULL) {}

    Node(int _val, Node* _left, Node* _right, Node* _next)
        : val(_val), left(_left), right(_right), next(_next) {}
};
*/

class Solution {
public:
    int countNulls(Node* root) {
        if (!root) return 0;
        return (root->next == nullptr) + countNulls(root->left) + countNulls(root->right);
    }
};"""
        self.assertEqual(run(src, "root = [1,2,3,4,5,6,7]")[1]["result"], 7)


class Errors(unittest.TestCase):
    """Every problem is reported before anything is compiled."""

    SRC = "class Solution {\npublic:\n    int f(vector<int>& nums, int k) { return k; }\n};"

    def check(self, source, example, message):
        with self.assertRaisesRegex(DriverError, message):
            generate(source, example)

    def test_wrong_value_types(self):
        self.check(self.SRC, "nums = [1,2], k = true", "k should be an integer")
        self.check(self.SRC, "nums = 5, k = 1", "nums should be an array")
        self.check(self.SRC, 'nums = [1,"x"], k = 1', r"nums\[1\] should be an integer")
        self.check(self.SRC, "nums = [1], k = 99999999999999999999", "does not fit in 64 bits")

    def test_wrong_names(self):
        # One name matches, so the other is a typo: an error, never a silent rename.
        self.check(self.SRC, "nums = [1], kk = 2", r"f takes \(nums, k\).*Missing: k\. Not a parameter: kk\.")

    def test_char_must_be_one_character(self):
        src = "class Solution {\npublic:\n    int f(char c) { return c; }\n};"
        self.check(src, 'c = "ab"', "one character")

    def test_unknown_node_shape(self):
        src = "/*\nclass Node {\npublic:\n    int val;\n    Node* prev;\n    Node* next;\n    Node* child;\n};\n*/\n" \
              "class Solution {\npublic:\n    Node* flatten(Node* head) { return head; }\n};"
        self.check(src, "head = [1,2,3]", "does not know how LeetCode writes a Node")

    def test_input_type_without_a_builder(self):
        src = "class Solution {\npublic:\n    int f(unordered_map<int, int>& m) { return 0; }\n};"
        self.check(src, "m = [[1,2]]", "cannot build an input of type map<int, int>")

    def test_pos_without_a_list(self):
        self.check(self.SRC, "nums = [1], k = 2, pos = 0", "Not a parameter: pos")


if __name__ == "__main__":
    unittest.main()
