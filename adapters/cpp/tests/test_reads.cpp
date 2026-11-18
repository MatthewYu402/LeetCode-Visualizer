// Tests for read outcomes: which cell or entry a line read, added to its step
// after the line ran (trace-format.md, Outcomes): trace::rd, trace::rk,
// trace::rf, and trace::rc.
//
// Run from the repository root:
//   make -C adapters/cpp test T=reads
//
// Each section starts with reset(). The functions are instrumented by hand,
// the way the rewriter does it.

#include "leetcode_types.hpp"

#include <iostream>
#include <map>
#include <set>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>

namespace {

  int passed = 0;
  int failed = 0;

  void check(const std::string &name, const std::string &actual, const std::string &expected) {
    if (actual == expected) {
      ++passed;
      std::cout << "  PASS  " << name << "\n";
    } else {
      ++failed;
      std::cout << "  FAIL  " << name << "\n"
                << "          expected: " << expected << "\n"
                << "          actual:   " << actual << "\n";
    }
  }

  void check_true(const std::string &name, bool condition) {
    if (condition) {
      ++passed;
      std::cout << "  PASS  " << name << "\n";
    } else {
      ++failed;
      std::cout << "  FAIL  " << name << "\n";
    }
  }

  void reset() {
    trace::tracer = trace::Tracer{};
    trace::tracer.exit_at_cap = false;
  }

  const std::vector<trace::Json> &steps() { return trace::tracer.steps; }

  bool has(const std::string &text, const std::string &part) { return text.find(part) != std::string::npos; }

  std::size_t count(const std::string &text, const std::string &part) {
    std::size_t n = 0;
    for (std::size_t at = text.find(part); at != std::string::npos; at = text.find(part, at + 1)) ++n;
    return n;
  }

  using trace::record;
  using trace::var;

  // A read inside a callee's argument list, after the call: `int a = f(n) + nums[0];`
  int f(int n) {
    trace::Frame frame("f");
    record(40, var("n", n));
    return trace::ret<int>(40, n, var("n", n));
  }

} // namespace

int main() {
  using trace::tracer;

  // ------------------------------------------------------------------
  std::cout << "an array element: its position, from its address, and its value\n";
  reset();
  {
    trace::Frame frame("f");
    std::vector<int> nums{4, 7, 2};
    int i = 1;
    record(5, var("nums", nums), var("i", i));
    const int got = trace::rd(5, "nums[i]", "nums", nums, nums[i]) + 1;
    check_true("hands the element back", got == 8);
    check_true("records where and what it read",
               has(steps().back(), R"J("outcomes": [{"kind": "read", "code": "nums[i]", "target": "nums", "at": [1], "value": 7}])J"));
    trace::rd(5, "nums[i]", "nums", nums, nums[i]) = 9;
    check_true("hands back the element itself, not a copy", nums[1] == 9);
  }

  // ------------------------------------------------------------------
  std::cout << "a 2D table: one index per level\n";
  reset();
  {
    trace::Frame frame("lcs");
    std::vector<std::vector<int>> dp{{0, 0, 0}, {0, 1, 0}};
    int i = 1, j = 2;
    record(9, var("dp", dp), var("i", i), var("j", j));
    trace::rd(9, "dp[i][j - 1]", "dp", dp, dp[i][j - 1]);
    check_true("records [row, column]", has(steps().back(), R"J({"kind": "read", "code": "dp[i][j - 1]", "target": "dp", "at": [1, 1], "value": 1})J"));
    trace::rd(9, "dp[i - 1]", "dp", dp, dp[i - 1]);
    check_true("a whole row is one index, its value the row",
               has(steps().back(), R"J({"kind": "read", "code": "dp[i - 1]", "target": "dp", "at": [0], "value": {"kind": "array", "items": [0, 0, 0]}})J"));
  }

  // ------------------------------------------------------------------
  std::cout << "vector<bool> has no addresses: its indexes come from the rewriter\n";
  reset();
  {
    trace::Frame frame("build");
    std::vector<bool> used{false, true};
    int i = 1;
    record(14, var("used", used), var("i", i));
    const bool u = trace::rd(14, "used[i]", "used", used, used[i], i);
    check_true("hands the bit back", u);
    check_true("records it as a bool", has(steps().back(), R"J({"kind": "read", "code": "used[i]", "target": "used", "at": [1], "value": true})J"));
    trace::rd(14, "used[i]", "used", used, used[i]);
    check_true("without indexes nothing is recorded", count(steps().back(), R"J("kind": "read")J") == 1);
  }

  // ------------------------------------------------------------------
  std::cout << "maps and sets: the entry a lookup found\n";
  reset();
  {
    trace::Frame frame("twoSum");
    std::unordered_map<int, int> numMap{{2, 0}};
    std::set<int> seen{3};
    int c = 2, d = 5;
    record(7, var("numMap", numMap), var("seen", seen), var("c", c), var("d", d));
    check_true("count() hands back its count", trace::rc(7, "numMap.count(c)", "numMap", numMap, c, numMap.count(c)) == 1);
    check_true("and records the entry", has(steps().back(), R"J({"kind": "read", "code": "numMap.count(c)", "target": "numMap", "key": 2, "value": 0})J"));
    trace::rc(7, "numMap.count(d)", "numMap", numMap, d, numMap.count(d));
    check_true("a miss records nothing", !has(steps().back(), "numMap.count(d)"));
    auto it = trace::rf(7, "numMap.find(c)", "numMap", numMap, numMap.find(c));
    check_true("find() hands back the iterator", it != numMap.end() && it->second == 0);
    check_true("and records the entry", has(steps().back(), R"J({"kind": "read", "code": "numMap.find(c)", "target": "numMap", "key": 2, "value": 0})J"));
    trace::rc(7, "seen.count(3)", "seen", seen, 3, seen.count(3));
    check_true("a set's member is its key and its value", has(steps().back(), R"J({"kind": "read", "code": "seen.count(3)", "target": "seen", "key": 3, "value": 3})J"));
    const int v = trace::rk(7, "numMap[c]", "numMap", numMap, numMap[c]);
    check_true("[] hands the value back", v == 0);
    check_true("and records its key, found from the value's address", has(steps().back(), R"J({"kind": "read", "code": "numMap[c]", "target": "numMap", "key": 2, "value": 0})J"));
  }

  // ------------------------------------------------------------------
  std::cout << "where a read goes\n";
  reset();
  {
    trace::Frame frame("g");
    std::vector<int> nums{1, 2};
    record(3, var("nums", nums));
    trace::rd(4, "nums[0]", "nums", nums, nums[0]);
    check_true("a read on another line than the step's is dropped", !has(steps().back(), "outcomes"));
    for (int k = 0; k < 20; ++k) trace::rd(3, "nums[0]", "nums", nums, nums[0]);
    check_true("at most 16 reads go on one step", count(steps().back(), R"J("kind": "read")J") == 16);
    trace::cond(3, "true", true);
    check_true("other outcomes are not capped", has(steps().back(), R"J("kind": "condition")J"));
  }
  reset();
  {
    trace::Frame frame("g");
    std::vector<int> nums{5, 6};
    record(41, var("nums", nums));
    int a = f(1) + trace::rd(41, "nums[1]", "nums", nums, nums[1]);
    check_true("a read after a call goes on the caller's step for the line",
               has(steps()[0], R"J({"kind": "read", "code": "nums[1]", "target": "nums", "at": [1], "value": 6})J") && a == 7);
  }

  std::cout << "\n" << passed << " passed, " << failed << " failed\n";
  return failed == 0 ? 0 : 1;
}
