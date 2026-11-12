// Reverse Linked List, instrumented by hand with trace::record.
//
// Each line argument is a line in fixtures/reverse_list_trace.cpp, the user's
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
//   clang++ -std=c++20 -Wall -Wextra -Wpedantic -I adapters/cpp/runtime fixtures/reverse_list_hand_inst.cpp -o /tmp/reverse_list
//   TRACE_OUT=/tmp/reverse-list.json /tmp/reverse_list
//   python3 -I tools/check_trace.py --equals fixtures/reverse-list.trace.json /tmp/reverse-list.json
//
// What it checks: ids stay fixed while the next pointers flip, and the
// returned pointer comes with its result_heap.

// ---- Supplied by LeetCode's harness (later, by our driver) ----
#include "leetcode_types.hpp"

using namespace std;

// ---- The user's Solution, with record() calls inserted ----
class Solution {
public:
  ListNode *reverseList(ListNode *head) {
    ::trace::Frame frame("reverseList");
    ::trace::record(4, ::trace::var("head", head));
    ListNode *prev = nullptr;

    ::trace::record(5, ::trace::var("head", head), ::trace::var("prev", prev));
    ListNode *curr = head;

    while (curr != nullptr) {
      ::trace::Scope scope(7);
      ::trace::record(8, ::trace::var("head", head), ::trace::var("prev", prev),
                      ::trace::var("curr", curr));
      ListNode *nextTemp = curr->next;

      ::trace::record(9, ::trace::var("head", head), ::trace::var("prev", prev),
                      ::trace::var("curr", curr), ::trace::var("nextTemp", nextTemp));
      curr->next = prev;

      ::trace::record(10, ::trace::var("head", head), ::trace::var("prev", prev),
                      ::trace::var("curr", curr), ::trace::var("nextTemp", nextTemp));
      prev = curr;

      ::trace::record(11, ::trace::var("head", head), ::trace::var("prev", prev),
                      ::trace::var("curr", curr), ::trace::var("nextTemp", nextTemp));
      curr = nextTemp;
    }

    // nextTemp is out of scope after the loop. curr is not: it was declared
    // before the loop, and it is null here.
    ::trace::record(13, ::trace::var("head", head), ::trace::var("prev", prev),
                    ::trace::var("curr", curr));
    return ::trace::ret<ListNode *>(13, prev, ::trace::var("head", head), ::trace::var("prev", prev),
                                    ::trace::var("curr", curr));
  }
};

// ---- Appended by the driver (hand-written for now) ----
int main() {
  trace::tracer.begin(R"({"method": "reverseList", "params": [{"name": "head", "type": "ListNode"}], "returns": {"type": "ListNode"}, "input": {"head": [1, 2, 3, 4, 5]}})");

  // head = [1, 2, 3, 4, 5]
  ListNode *head = new ListNode(1, new ListNode(2, new ListNode(3, new ListNode(4, new ListNode(5)))));
  ListNode *answer = Solution().reverseList(head);

  trace::write_result(answer);
  return 0;
}
