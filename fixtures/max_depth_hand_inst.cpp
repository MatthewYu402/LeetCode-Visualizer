// Maximum Depth of Binary Tree (recursive), instrumented by hand.
//
// Each line argument is a line in fixtures/max_depth_trace.cpp, the user's
// original source.
//
// Instrumentation, as the rewriter will write it:
//  - ::trace::Frame on the first line of each function: pushes a frame for the
//    call and pops it when the call ends.
//  - ::trace::record(line, ...) before each statement. A loop header gets no
//    record of its own: its body's statements do.
//  - ::trace::Scope at the start of each loop body and each block that
//    declares a variable, with the line of the statement that owns the block.
//  - a record() before each return statement, then
//    `return ::trace::ret<T>(line, value, ...)` for its return step
//    (::trace::ret_void(line, ...) in a void function, also at the closing brace).
//
// Build, run, and compare with the golden trace, from the repository root:
//   clang++ -std=c++20 -Wall -Wextra -Wpedantic -I adapters/cpp/runtime fixtures/max_depth_hand_inst.cpp -o /tmp/max_depth
//   TRACE_OUT=/tmp/max-depth.json /tmp/max_depth
//   python3 -I tools/check_trace.py --equals fixtures/max-depth.trace.json /tmp/max-depth.json
//
// What it checks: one frame per call, eleven calls deep and wide; each call's
// return step; and the caller's `left` and `right` taking the returned values.
// During the call on line 7 the caller's frame has no `left` yet: it is being
// initialized by that very call.

// ---- Supplied by LeetCode's harness (later, by our driver) ----
#include "leetcode_types.hpp"

#include <algorithm>

using namespace std;

// ---- The user's Solution, with instrumentation inserted ----
class Solution {
public:
  int maxDepth(TreeNode *root) {
    ::trace::Frame frame("maxDepth");
    ::trace::record(4, ::trace::var("root", root));
    if (root == nullptr) {
      ::trace::record(5, ::trace::var("root", root));
      return ::trace::ret<int>(5, 0, ::trace::var("root", root));
    }

    ::trace::record(7, ::trace::var("root", root));
    int left = maxDepth(root->left);

    ::trace::record(8, ::trace::var("root", root), ::trace::var("left", left));
    int right = maxDepth(root->right);

    ::trace::record(9, ::trace::var("root", root), ::trace::var("left", left), ::trace::var("right", right));
    return ::trace::ret<int>(9, 1 + max(left, right), ::trace::var("root", root), ::trace::var("left", left),
                             ::trace::var("right", right));
  }
};

// ---- Appended by the driver (hand-written for now) ----
int main() {
  trace::tracer.begin(R"({"method": "maxDepth", "params": [{"name": "root", "type": "TreeNode"}], "returns": {"type": "int"}, "input": {"root": [3, 9, 20, null, null, 15, 7]}})");

  // root = [3, 9, 20, null, null, 15, 7]: 3 has children 9 and 20, and 20 has children 15 and 7.
  TreeNode *root = new TreeNode(3, new TreeNode(9), new TreeNode(20, new TreeNode(15), new TreeNode(7)));
  int answer = Solution().maxDepth(root);

  trace::write_result(answer);
  return 0;
}
