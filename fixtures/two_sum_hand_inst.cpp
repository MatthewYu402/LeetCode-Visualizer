//
// This is what the LibTooling rewriter will produce automatically (Goal 5).
// Each record(...) call sits just before the statement it describes, and its
// first argument is that statement's line in fixtures/two_sum_trace.cpp, the user's
// original source. The inserted lines shift this file's own line numbers,
// which is why the line is passed explicitly.
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
    // key: a number from the array, value: its index
    ::trace::record(5, ::trace::var("nums", nums), ::trace::var("target", target));
    unordered_map<int, int> numMap;

    for (int i = 0; i < static_cast<int>(nums.size()); ++i) {
      ::trace::record(8, ::trace::var("nums", nums), ::trace::var("target", target),
                      ::trace::var("numMap", numMap), ::trace::var("i", i));
      int complement = target - nums[i];

      ::trace::record(9, ::trace::var("nums", nums), ::trace::var("target", target),
                      ::trace::var("numMap", numMap), ::trace::var("i", i),
                      ::trace::var("complement", complement));
      auto it = numMap.find(complement); // `it` has no serializer, so it is never passed

      ::trace::record(11, ::trace::var("nums", nums), ::trace::var("target", target),
                      ::trace::var("numMap", numMap), ::trace::var("i", i),
                      ::trace::var("complement", complement));
      if (it != numMap.end()) {
        ::trace::record(12, ::trace::var("nums", nums), ::trace::var("target", target),
                        ::trace::var("numMap", numMap), ::trace::var("i", i),
                        ::trace::var("complement", complement));
        return {it->second, i};
      }

      // not found: remember this number and its index
      ::trace::record(16, ::trace::var("nums", nums), ::trace::var("target", target),
                      ::trace::var("numMap", numMap), ::trace::var("i", i),
                      ::trace::var("complement", complement));
      numMap[nums[i]] = i;
    }

    // Never reached for this example, so the fixture has no step for it.
    // i and complement are out of scope after the loop.
    ::trace::record(18, ::trace::var("nums", nums), ::trace::var("target", target),
                    ::trace::var("numMap", numMap));
    return {};
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