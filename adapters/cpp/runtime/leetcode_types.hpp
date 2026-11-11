#pragma once
// leetcode_types.hpp: the node types LeetCode defines for the user, plus the
// field tables that let trace.hpp serialize them.
//
// LeetCode keeps these definitions in its hidden harness, so a pasted Solution
// uses ListNode and TreeNode without defining them. They must be in the global
// namespace, because the user's code names them with no prefix.
//
// `Node` is not here. It is a different struct in different problems (a graph
// node, a list node with `random`, an N-ary tree node), so each problem supplies
// its own definition and its own Fields table.

#include "trace.hpp"

struct ListNode {
  int val;
  ListNode *next;
  ListNode() : val(0), next(nullptr) {}
  ListNode(int x) : val(x), next(nullptr) {}
  ListNode(int x, ListNode *next) : val(x), next(next) {}
};

struct TreeNode {
  int val;
  TreeNode *left;
  TreeNode *right;
  TreeNode() : val(0), left(nullptr), right(nullptr) {}
  TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
  TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}
};

// The tables are specializations of trace::Fields, so they go in namespace trace.
namespace trace {

  template <> struct Fields<::ListNode> {
    static constexpr const char* type = "ListNode";
    static constexpr auto fields = std::make_tuple(
      std::pair{"val", &::ListNode::val},
      std::pair{"next", &::ListNode::next});
  };

  template <> struct Fields<::TreeNode> {
    static constexpr const char* type = "TreeNode";
    static constexpr auto fields = std::make_tuple(
      std::pair{"val", &::TreeNode::val},
      std::pair{"left", &::TreeNode::left},
      std::pair{"right", &::TreeNode::right});
  };

}