// Binary Tree Preorder Traversal (iterative), instrumented by hand with
// trace::record.
//
// Each record(...) call sits just before the statement it describes, and its
// first argument is that statement's line in
// fixtures/preorder_traversal_trace.cpp, the user's original source. As in
// fixtures/two_sum_hand_inst.cpp, a loop header gets no record of its own.
//
// Build, run, and compare with the golden trace, from the repository root:
//   clang++ -std=c++20 -Wall -Wextra -Wpedantic -I adapters/cpp/runtime fixtures/preorder_traversal_hand_inst.cpp -o /tmp/preorder_traversal
//   TRACE_OUT=/tmp/preorder-traversal.json /tmp/preorder_traversal
//   python3 -I tools/check_trace.py --equals fixtures/preorder-traversal.trace.json /tmp/preorder-traversal.json
//
// What it checks: a stack of TreeNode pointers is a stack of refs, and a
// result that is a plain array has no result_heap.

// ---- Supplied by LeetCode's harness (later, by our driver) ----
#include "leetcode_types.hpp"

#include <stack>
#include <vector>

using namespace std;

// ---- The user's Solution, with record() calls inserted ----
class Solution {
public:
  vector<int> preorderTraversal(TreeNode *root) {
    ::trace::record(4, ::trace::var("root", root));
    vector<int> result;

    ::trace::record(5, ::trace::var("root", root), ::trace::var("result", result));
    if (root == nullptr) {
      ::trace::record(6, ::trace::var("root", root), ::trace::var("result", result));
      return result;
    }

    ::trace::record(9, ::trace::var("root", root), ::trace::var("result", result));
    stack<TreeNode *> st;

    ::trace::record(10, ::trace::var("root", root), ::trace::var("result", result),
                    ::trace::var("st", st));
    st.push(root);

    while (!st.empty()) {
      ::trace::record(13, ::trace::var("root", root), ::trace::var("result", result),
                      ::trace::var("st", st));
      TreeNode *curr = st.top();

      ::trace::record(14, ::trace::var("root", root), ::trace::var("result", result),
                      ::trace::var("st", st), ::trace::var("curr", curr));
      st.pop();

      ::trace::record(15, ::trace::var("root", root), ::trace::var("result", result),
                      ::trace::var("st", st), ::trace::var("curr", curr));
      result.push_back(curr->val);

      ::trace::record(17, ::trace::var("root", root), ::trace::var("result", result),
                      ::trace::var("st", st), ::trace::var("curr", curr));
      if (curr->right != nullptr) {
        ::trace::record(18, ::trace::var("root", root), ::trace::var("result", result),
                        ::trace::var("st", st), ::trace::var("curr", curr));
        st.push(curr->right);
      }

      ::trace::record(20, ::trace::var("root", root), ::trace::var("result", result),
                      ::trace::var("st", st), ::trace::var("curr", curr));
      if (curr->left != nullptr) {
        ::trace::record(21, ::trace::var("root", root), ::trace::var("result", result),
                        ::trace::var("st", st), ::trace::var("curr", curr));
        st.push(curr->left);
      }
    }

    // curr is out of scope after the loop. st is not: it was declared before
    // the loop, and it is empty here.
    ::trace::record(24, ::trace::var("root", root), ::trace::var("result", result),
                    ::trace::var("st", st));
    return result;
  }
};

// ---- Appended by the driver (hand-written for now) ----
int main() {
  trace::tracer.begin(R"({"method": "preorderTraversal", "params": [{"name": "root", "type": "TreeNode"}], "returns": {"type": "array<int>"}, "input": {"root": [1, null, 2, 3]}})");

  // root = [1, null, 2, 3]: 1 has no left child and right child 2, and 2 has left child 3.
  TreeNode *root = new TreeNode(1, nullptr, new TreeNode(2, new TreeNode(3), nullptr));
  vector<int> answer = Solution().preorderTraversal(root);

  trace::write_result(answer);
  return 0;
}
