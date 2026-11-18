// Tests for members: the traced object's member variables, written once per
// step beside the frames (trace-format.md, Members): trace::members.
//
// Run from the repository root:
//   make -C adapters/cpp test T=members
//
// Each section starts with reset(). The functions are instrumented by hand,
// the way the rewriter does it.

#include "leetcode_types.hpp"

#include <iostream>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

  int passed = 0;
  int failed = 0;

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

  // A Solution with a memo table as a member, instrumented as the rewriter would.
  struct Solution {
    std::unordered_map<int, int> memo;
    int calls = 0;
    struct Opaque {} opaque;  // no serializer: left out, like a local

    int fib(int n) {
      ::trace::Frame trace_frame_("fib"); ::trace::members(this, ::trace::var("memo", this->memo), ::trace::var("calls", this->calls), ::trace::var("opaque", this->opaque));
      ::trace::record(1, ::trace::var("n", n));
      ++calls;
      if (n <= 1) return ::trace::ret<int>(2, n, ::trace::var("n", n));
      ::trace::record(3, ::trace::var("n", n));
      if (::trace::rc(3, "memo.count(n)", "memo", this->memo, (n), memo.count(n))) return ::trace::ret<int>(3, memo[n], ::trace::var("n", n));
      ::trace::record(4, ::trace::var("n", n));
      const int r = fib(n - 1) + fib(n - 2);
      memo[n] = r;
      return ::trace::ret<int>(5, r, ::trace::var("n", n), ::trace::var("r", r));
    }
  };

}

int main() {
  // ------------------------------------------------------------------
  std::cout << "members are written beside the frames at every step, and change as they do\n";
  reset();
  {
    Solution s;
    const int got = s.fib(3);
    check_true("the method still returns its value", got == 2);
    check_true("step 0 has the members, between frames and heap",
               has(steps().front(), R"J(}], "members": {"memo": {"kind": "map", "entries": []}, "calls": 0}, "heap": {}})J"));
    check_true("a member with no serializer is left out", !has(steps().front(), "opaque"));
    check_true("the last step sees what the calls stored", has(steps().back(), R"J("members": {"memo": {"kind": "map", "entries": [[2, 1], [3, 2]]})J") ||
                                                               has(steps().back(), R"J("members": {"memo": {"kind": "map", "entries": [[3, 2], [2, 1]]})J"));
    check_true("one members object per step, not one per frame", steps().at(3).find("\"members\"") == steps().at(3).rfind("\"members\""));
  }

  // ------------------------------------------------------------------
  std::cout << "without members(), a step has no members field\n";
  reset();
  {
    ::trace::Frame frame("f");
    int x = 1;
    ::trace::record(1, ::trace::var("x", x));
    check_true("no members", !has(steps().back(), "members"));
  }

  // ------------------------------------------------------------------
  std::cout << "a read of a member is checked against the members\n";
  reset();
  {
    Solution s;
    s.memo[2] = 1;
    s.fib(2);
    check_true("memo.count(2) is a read of the member memo", has(steps().at(1), R"J({"kind": "read", "code": "memo.count(n)", "target": "memo", "key": 2, "value": 1})J"));
  }

  // ------------------------------------------------------------------
  std::cout << "only the first object's members are kept\n";
  reset();
  {
    Solution a, b;
    a.fib(1);
    b.memo[9] = 9;
    b.fib(1);
    check_true("b's calls still show a's members", !has(steps().back(), "[9, 9]"));
  }

  std::cout << "\n" << passed << " passed, " << failed << " failed\n";
  return failed == 0 ? 0 : 1;
}
