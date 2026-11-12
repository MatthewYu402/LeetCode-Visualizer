// Subsets (backtracking), instrumented by hand.
//
// Each line argument is a line in fixtures/subsets_trace.cpp, the user's
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
//   clang++ -std=c++20 -Wall -Wextra -Wpedantic -I adapters/cpp/runtime fixtures/subsets_hand_inst.cpp -o /tmp/subsets
//   TRACE_OUT=/tmp/subsets.json /tmp/subsets
//   python3 -I tools/check_trace.py --equals fixtures/subsets.trace.json /tmp/subsets.json
//
// What it checks: a helper function gets its own frames; `path` and `result`
// are references to the bottom frame's vectors, so every frame shows the same
// live contents as they change; a void helper's return steps
// ("return_value": null) at its closing brace; and the loop variable `i`
// leaving each frame when its loop ends.

// ---- Supplied by LeetCode's harness (later, by our driver) ----
#include "trace.hpp"

#include <vector>

using namespace std;

// ---- The user's Solution, with instrumentation inserted ----
class Solution {
public:
  vector<vector<int>> subsets(vector<int> &nums) {
    ::trace::Frame frame("subsets");
    ::trace::record(4, ::trace::var("nums", nums));
    vector<vector<int>> result;

    ::trace::record(5, ::trace::var("nums", nums), ::trace::var("result", result));
    vector<int> path;

    ::trace::record(6, ::trace::var("nums", nums), ::trace::var("result", result), ::trace::var("path", path));
    backtrack(nums, 0, path, result);

    ::trace::record(7, ::trace::var("nums", nums), ::trace::var("result", result), ::trace::var("path", path));
    return ::trace::ret<vector<vector<int>>>(7, result, ::trace::var("nums", nums), ::trace::var("result", result),
                                             ::trace::var("path", path));
  }

private:
  void backtrack(vector<int> &nums, int start, vector<int> &path, vector<vector<int>> &result) {
    ::trace::Frame frame("backtrack");
    ::trace::record(12, ::trace::var("nums", nums), ::trace::var("start", start), ::trace::var("path", path),
                    ::trace::var("result", result));
    result.push_back(path);

    for (int i = start; i < static_cast<int>(nums.size()); ++i) {
      ::trace::Scope scope(13);
      ::trace::record(14, ::trace::var("nums", nums), ::trace::var("start", start), ::trace::var("path", path),
                      ::trace::var("result", result), ::trace::var("i", i));
      path.push_back(nums[i]);

      ::trace::record(15, ::trace::var("nums", nums), ::trace::var("start", start), ::trace::var("path", path),
                      ::trace::var("result", result), ::trace::var("i", i));
      backtrack(nums, i + 1, path, result);

      ::trace::record(16, ::trace::var("nums", nums), ::trace::var("start", start), ::trace::var("path", path),
                      ::trace::var("result", result), ::trace::var("i", i));
      path.pop_back();
    }

    ::trace::ret_void(18, ::trace::var("nums", nums), ::trace::var("start", start), ::trace::var("path", path),
                      ::trace::var("result", result));
  }
};

// ---- Appended by the driver (hand-written for now) ----
int main() {
  trace::tracer.begin(R"({"method": "subsets", "params": [{"name": "nums", "type": "array<int>"}], "returns": {"type": "array<array<int>>"}, "input": {"nums": [1, 2, 3]}})");

  vector<int> nums{1, 2, 3};
  vector<vector<int>> answer = Solution().subsets(nums);

  trace::write_result(answer);
  return 0;
}
