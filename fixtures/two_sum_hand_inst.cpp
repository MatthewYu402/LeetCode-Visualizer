// Two Sum, instrumented by hand with trace::record.
//
// This is what the LibTooling rewriter will produce automatically (Goal 5).
// Each line argument is a line in fixtures/two_sum_trace.cpp, the user's
// original source. The inserted lines shift this file's own line numbers,
// which is why the line is passed explicitly.
//
// Instrumentation, as the rewriter will write it:
//  - ::trace::Frame on the first line of each function: pushes a frame for the
//    call and pops it when the call ends.
//  - ::trace::record(line, ...) before each statement. A for loop's header
//    gets one before the loop (first pass) and one at the start of its
//    increment (each later pass), so every check of the condition has a step.
//  - outcomes: what a line evaluated, added to that line's step once it ran.
//    ::trace::cond wraps a condition, ::trace::store follows a declaration,
//    ::trace::track wraps an assignment's target (then ::trace::flush), and
//    ::trace::stored<T> wraps a for loop's initializer.
//  - ::trace::Scope at the start of each loop body and each block that
//    declares a variable, with the line of the statement that owns the block.
//  - a record() before each return statement, then
//    `return ::trace::ret<T>(line, value, ...)` for its return step
//    (::trace::ret_void(line, ...) in a void function, also at the closing brace).
//
// Build and run from the repository root:
//   clang++ -std=c++20 -Wall -Wextra -Wpedantic -I adapters/cpp/runtime fixtures/two_sum_hand_inst.cpp -o /tmp/two_sum
//   TRACE_OUT=/tmp/two-sum.json /tmp/two_sum
//
// The trace it writes should equal fixtures/two-sum.trace.json
// (`make -C adapters/cpp e2e` checks this).

// ---- Supplied by LeetCode's harness (later, by our driver) ----
#include "trace.hpp"

#include <iostream>
#include <unordered_map>
#include <vector>

using namespace std;

// ---- The user's Solution, with record() calls inserted ----
class Solution {
public:
  vector<int> twoSum(vector<int> &nums, int target) {
    ::trace::Frame frame("twoSum");
    // key: a number from the array, value: its index
    ::trace::record(5, ::trace::var("nums", nums), ::trace::var("target", target));
    unordered_map<int, int> numMap;

    // The loop header's first step; the later ones are in the increment.
    ::trace::record(7, ::trace::var("nums", nums), ::trace::var("target", target), ::trace::var("numMap", numMap));
    for (int i = ::trace::stored<int>(7, "int i = 0", "i", 0);
         ::trace::cond(7, "i < static_cast<int>(nums.size())", i < static_cast<int>(nums.size()));
         (::trace::record(7, ::trace::var("nums", nums), ::trace::var("target", target), ::trace::var("numMap", numMap),
                          ::trace::var("i", i)),
          ++::trace::track(7, "++i", "i", i), ::trace::flush())) {
      ::trace::Scope scope(7);
      ::trace::record(8, ::trace::var("nums", nums), ::trace::var("target", target),
                      ::trace::var("numMap", numMap), ::trace::var("i", i));
      int complement = target - nums[i];
      ::trace::store(8, "int complement = target - nums[i]", "complement", complement);

      ::trace::record(9, ::trace::var("nums", nums), ::trace::var("target", target),
                      ::trace::var("numMap", numMap), ::trace::var("i", i),
                      ::trace::var("complement", complement));
      auto it = numMap.find(complement); // from here on, `it` is a position in numMap

      ::trace::record(11, ::trace::var("nums", nums), ::trace::var("target", target),
                      ::trace::var("numMap", numMap), ::trace::var("i", i),
                      ::trace::var("complement", complement),
                      ::trace::var_iter("it", it, "numMap", numMap));
      if (::trace::cond(11, "it != numMap.end()", it != numMap.end())) {
        ::trace::record(12, ::trace::var("nums", nums), ::trace::var("target", target),
                        ::trace::var("numMap", numMap), ::trace::var("i", i),
                        ::trace::var("complement", complement),
                      ::trace::var_iter("it", it, "numMap", numMap));
        return ::trace::ret<vector<int>>(12, {it->second, i}, ::trace::var("nums", nums), ::trace::var("target", target),
                                         ::trace::var("numMap", numMap), ::trace::var("i", i),
                                         ::trace::var("complement", complement),
                      ::trace::var_iter("it", it, "numMap", numMap));
      }

      // not found: remember this number and its index
      ::trace::record(16, ::trace::var("nums", nums), ::trace::var("target", target),
                      ::trace::var("numMap", numMap), ::trace::var("i", i),
                      ::trace::var("complement", complement),
                      ::trace::var_iter("it", it, "numMap", numMap));
      ::trace::track(16, "numMap[nums[i]] = i", "numMap[nums[i]]", numMap[nums[i]]) = i;
      ::trace::flush();
    }

    // Never reached for this example, so the fixture has no step for it.
    // i and complement are out of scope after the loop.
    ::trace::record(18, ::trace::var("nums", nums), ::trace::var("target", target),
                    ::trace::var("numMap", numMap));
    return ::trace::ret<vector<int>>(18, {}, ::trace::var("nums", nums), ::trace::var("target", target),
                                     ::trace::var("numMap", numMap));
  }
};

// ---- Appended by the driver (hand-written for now) ----
// Describes the problem, builds the example input, calls the method, and
// writes the trace, with the return value as its result.
int main() {
  trace::tracer.begin(R"({"method": "twoSum", "params": [{"name": "nums", "type": "array<int>"}, {"name": "target", "type": "int"}], "returns": {"type": "array<int>"}, "input": {"nums": [2, 7, 11, 15], "target": 9}})");

  vector<int> nums{2, 7, 11, 15};
  vector<int> answer = Solution().twoSum(nums, 9);

  trace::write_result(answer);
  return 0;
}