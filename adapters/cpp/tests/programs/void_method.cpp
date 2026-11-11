// A Solution whose method returns void, instrumented by hand with trace::record.
//
// It proves a void method that returned is written as "result": null, next to
// "returns": {"type": "void"} in the problem metadata. An absent result would
// say the method never returned, which is not what happened.
//
// The answer of a void method is the input it changed. Every step is taken
// before its line runs, so the effect of the last statement would never be
// seen. The record() on line 6, the method's closing brace, is the step that
// shows it.
//
// This file is not a tests/test_*.cpp, so `make test` does not build it. It
// is built and run by `make e2e`. Run from the repository root:
//   make -C adapters/cpp e2e
//
// The user's original source, which the record() line numbers refer to:
//   1  class Solution {
//   2  public:
//   3    void swapEnds(vector<int>& nums) {
//   4      int last = static_cast<int>(nums.size()) - 1;
//   5      swap(nums[0], nums[last]);
//   6    }
//   7  };

#include "trace.hpp"

#include <utility>
#include <vector>

using namespace std;

// ---- The user's Solution, with record() calls inserted ----
class Solution {
public:
  void swapEnds(vector<int> &nums) {
    ::trace::record(4, ::trace::var("nums", nums));
    int last = static_cast<int>(nums.size()) - 1;

    ::trace::record(5, ::trace::var("nums", nums), ::trace::var("last", last));
    swap(nums[0], nums[last]);

    ::trace::record(6, ::trace::var("nums", nums), ::trace::var("last", last));
  }
};

// ---- Appended by the driver (hand-written for now) ----
int main() {
  trace::tracer.begin(R"({"method": "swapEnds", "params": [{"name": "nums", "type": "array<int>"}], "returns": {"type": "void"}, "input": {"nums": [1, 2, 3]}})");

  vector<int> nums{1, 2, 3};
  Solution().swapEnds(nums);

  trace::write_void_result();
  return 0;
}
