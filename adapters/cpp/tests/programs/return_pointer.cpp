// A Solution that returns a pointer, instrumented by hand with trace::record.
//
// It proves two things end to end:
//  - an object held by value (`ListNode dummy`) and a pointer to it (`tail`)
//    are written as refs to one heap object
//  - the returned pointer's objects are written to "result_heap", so the ref
//    in "result" has something to point at
//
// This file is not a tests/test_*.cpp, so `make test` does not build it. It
// is built and run by `make e2e`, which checks the trace against the schema
// and checks that every ref names an object. Run from the repository root:
//   make -C adapters/cpp e2e
//
// The user's original source, which the record() line numbers refer to:
//   1  class Solution {
//   2  public:
//   3    ListNode* dropFirst(ListNode* head) {
//   4      ListNode dummy(0, head);
//   5      ListNode* tail = &dummy;
//   6      tail->next = head->next;
//   7      return dummy.next;
//   8    }
//   9  };

#include "leetcode_types.hpp"

// ---- The user's Solution, with record() calls inserted ----
class Solution {
public:
  ListNode *dropFirst(ListNode *head) {
    ::trace::record(4, ::trace::var("head", head));
    ListNode dummy(0, head);

    ::trace::record(5, ::trace::var("head", head), ::trace::var("dummy", dummy));
    ListNode *tail = &dummy;

    ::trace::record(6, ::trace::var("head", head), ::trace::var("dummy", dummy), ::trace::var("tail", tail));
    tail->next = head->next;

    ::trace::record(7, ::trace::var("head", head), ::trace::var("dummy", dummy), ::trace::var("tail", tail));
    return dummy.next;
  }
};

// ---- Appended by the driver (hand-written for now) ----
int main() {
  trace::tracer.begin(R"({"method": "dropFirst", "params": [{"name": "head", "type": "ListNode", "hint": "linked-list"}], "returns": {"type": "ListNode", "hint": "linked-list"}, "input": {"head": [1, 2, 3]}})");

  // head = [1, 2, 3]
  ListNode third(3), second(2, &third), first(1, &second);

  ListNode *answer = Solution().dropFirst(&first);

  trace::write_result(answer);
  return 0;
}
