"""Reading the Solution class and naming its types (driver/cpp/signature.py, types.py, source.py)."""

import unittest

from driver import DriverError
from driver.cpp.signature import choose_method, read_methods
from driver.cpp.source import blank_comments_and_literals, comments
from driver.cpp.types import declared_type, neutral

NODES = ["ListNode", "TreeNode"]


def signature(source):
    return [(m.name, m.return_ctype, [(p.name, p.ctype) for p in m.params], m.public) for m in read_methods(source)]


class Source(unittest.TestCase):
    def test_blanking_keeps_positions(self):
        text = 'int a; // x { y\nstring s = "{ }"; char c = \'{\'; /* class B { }; */ int b;'
        blank = blank_comments_and_literals(text)
        self.assertEqual(len(blank), len(text))
        self.assertNotIn("{", blank)
        self.assertEqual(blank.index("int b"), text.index("int b"))

    def test_digit_separator_is_not_a_char(self):
        self.assertIn("{", blank_comments_and_literals("int n = 1'000'000; void f() {}"))

    def test_raw_string(self):
        self.assertNotIn("}", blank_comments_and_literals('auto s = R"x(})x"; int k;'))

    def test_comments(self):
        self.assertEqual(comments("a // one\n/* two */ b"), [" one", " two "])


class ReadMethods(unittest.TestCase):
    def test_leetcode_stub(self):
        src = "class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n        return {};\n    }\n};"
        self.assertEqual(signature(src), [("twoSum", "vector<int>", [("nums", "vector<int>&"), ("target", "int")], True)])

    def test_access_sections(self):
        src = """class Solution {
            int memo[10];
            void hidden(int a) {}
        public:
            int solve(int n) { return go(n); }
        private:
            int go(int n) { return n; }
        };"""
        self.assertEqual([(m.name, m.public) for m in read_methods(src)], [("hidden", False), ("solve", True), ("go", False)])

    def test_struct_defaults_to_public(self):
        self.assertTrue(read_methods("struct Solution { int f(int x) { return x; } };")[0].public)

    def test_things_that_are_not_methods(self):
        src = """class Solution {
        public:
            Solution() : count(0) {}
            ~Solution() {}
            struct Cmp { bool operator()(int a, int b) const { return a > b; } };
            using Pair = pair<int, int>;
            unordered_map<int, int> cache = {{1, 2}};
            vector<int> v{1, 2};
            int count;
            static const int LIMIT = 5;
            bool operator<(const Solution& o) const { return false; }
            int answer(const vector<vector<int>>& grid, int k = 3) const { return k; }
        };"""
        methods = read_methods(src)
        self.assertEqual([m.name for m in methods], ["answer"])
        self.assertEqual([(p.name, p.ctype) for p in methods[0].params], [("grid", "const vector<vector<int>>&"), ("k", "int")])

    def test_comments_and_strings_do_not_confuse_it(self):
        src = """class Solution {
        public:
            // int fake(int x) {
            string braces(string s) { string t = "}{"; return t + s; }
            /* void alsoFake() {} */
        };"""
        self.assertEqual([m.name for m in read_methods(src)], ["braces"])

    def test_pointers_and_specifiers(self):
        src = "class Solution { public: static inline ListNode *reverse(ListNode* head) { return head; } };"
        self.assertEqual(signature(src), [("reverse", "ListNode *", [("head", "ListNode*")], True)])

    def test_template_member_is_unreadable(self):
        m = read_methods("class Solution { public: template <class T> T id(T x) { return x; } };")[0]
        self.assertFalse(m.readable)

    def test_no_solution_class(self):
        with self.assertRaisesRegex(DriverError, "No `class Solution"):
            read_methods("int main() {}")


class ChooseMethod(unittest.TestCase):
    no_list = staticmethod(lambda m: False)
    has_list = staticmethod(lambda m: any("ListNode" in p.ctype for p in m.params))

    def choose(self, src, names, method=None, lists=False):
        m, mapping = choose_method(read_methods(src), names, self.has_list if lists else self.no_list, method)
        return m.name, mapping

    def test_by_parameter_names_skips_public_helpers(self):
        src = """class Solution { public:
            vector<vector<int>> subsets(vector<int>& nums) { return {}; }
            void backtrack(vector<int>& nums, int start) {}
        };"""
        self.assertEqual(self.choose(src, ["nums"]), ("subsets", {"nums": "nums"}))

    def test_ambiguous_names_need_method(self):
        src = "class Solution { public: int maxDepth(TreeNode* root) { return 0; } int dfs(TreeNode* root) { return 0; } };"
        with self.assertRaisesRegex(DriverError, "Several public methods.*--method"):
            self.choose(src, ["root"])
        self.assertEqual(self.choose(src, ["root"], method="dfs")[0], "dfs")

    def test_positional_when_names_differ(self):
        # Clone Graph: the example says adjList, the parameter is node.
        src = "class Solution { public: Node* cloneGraph(Node* node) { return node; } };"
        self.assertEqual(self.choose(src, ["adjList"]), ("cloneGraph", {"adjList": "node"}))

    def test_pos_is_allowed_with_a_list_parameter(self):
        src = "class Solution { public: bool hasCycle(ListNode *head) { return false; } };"
        self.assertEqual(self.choose(src, ["head", "pos"], lists=True), ("hasCycle", {"head": "head"}))

    def test_private_methods_are_never_called(self):
        src = "class Solution { int secret(int n) { return n; } public: int other(int a, int b) { return a; } };"
        # secret(n) matches by name, but it is private, so the only public method is reported.
        with self.assertRaisesRegex(DriverError, r"other takes \(a, b\), but the example gives \(n\)"):
            self.choose(src, ["n"])

    def test_missing_parameter(self):
        src = "class Solution { public: int f(int a, int b) { return a; } int g(int a, int b, int c) { return a; } };"
        with self.assertRaisesRegex(DriverError, "No public method"):
            self.choose(src, ["a"])

    def test_partial_match_is_a_typo_not_a_rename(self):
        src = "class Solution { public: int f(int a, int b) { return a; } };"
        with self.assertRaisesRegex(DriverError, "Missing: b. Not a parameter: c."):
            self.choose(src, ["a", "c"])

    def test_unknown_method_name(self):
        with self.assertRaisesRegex(DriverError, "no public method named 'nope'"):
            self.choose("class Solution { public: int f(int a) { return a; } };", ["a"], method="nope")


class NeutralTypes(unittest.TestCase):
    def test_table(self):
        cases = {
            "int": "int", "long long": "int", "unsigned int": "int", "size_t": "int", "int64_t": "int",
            "double": "float", "float": "float", "bool": "bool", "char": "char", "string": "string",
            "const string&": "string", "std::string": "string", "void": "void",
            "vector<int>&": "array<int>", "const vector<vector<char>>&": "array<array<char>>",
            "vector<string>": "array<string>", "array<int, 26>": "array<int>", "list<int>": "list<int>",
            "unordered_map<int,int>": "map<int, int>", "map<string, vector<int>>": "map<string, array<int>>",
            "unordered_set<int>": "set<int>", "multiset<int>": "multiset<int>",
            "pair<int,int>": "tuple<int, int>", "tuple<int, string, bool>": "tuple<int, string, bool>",
            "priority_queue<int, vector<int>, greater<int>>": "priority-queue<int>",
            "stack<char>": "stack<char>", "queue<TreeNode*>": "queue<TreeNode>", "deque<int>": "deque<int>",
            "ListNode*": "ListNode", "TreeNode *": "TreeNode", "vector<ListNode*>&": "array<ListNode>",
            "bitset<8>": "array<bool>", "unsigned char": "int",
        }
        for ctype, expected in cases.items():
            with self.subTest(ctype=ctype):
                self.assertEqual(neutral(ctype, NODES, "x"), expected)

    def test_unsupported(self):
        for ctype, message in {"Node*": "no definition", "ListNode": "by value", "Foo": "no neutral name",
                               "optional<int>": "no neutral name"}.items():
            with self.subTest(ctype=ctype):
                with self.assertRaisesRegex(DriverError, message):
                    neutral(ctype, NODES, "x")

    def test_declared_type(self):
        self.assertEqual(declared_type("const vector<int>&"), "vector<int>")
        self.assertEqual(declared_type("vector<vector<int>> &"), "vector<vector<int>>")
        self.assertEqual(declared_type("ListNode*"), "ListNode*")


if __name__ == "__main__":
    unittest.main()
