// A Solution that never returns, instrumented by hand with trace::record.
//
// It proves the step cap ends a run that would otherwise never end: the
// 2,001st record() call writes a trace with "truncated": true and no
// "result", then exits with code 0 from inside record(). Nothing in main
// after the call to the method should ever run.
//
// This file is not a tests/test_*.cpp, so `make test` does not build it. It
// is built and run by `make e2e`, under a time limit so that a broken cap
// fails the target instead of hanging it. Run from the repository root:
//   make -C adapters/cpp e2e
//
// The user's original source, which the record() line numbers refer to:
//   1  class Solution {
//   2  public:
//   3    int spin(int n) {
//   4      int k = 0;
//   5      while (true) {
//   6        k = (k + 1) % n;
//   7      }
//   8    }
//   9  };

#include "trace.hpp"

// ---- The user's Solution, with record() calls inserted ----
class Solution {
public:
  int spin(int n) {
    ::trace::record(4, ::trace::var("n", n));
    int k = 0;
    while (true) {
      ::trace::record(6, ::trace::var("n", n), ::trace::var("k", k));
      // Stays in [0, n), so the loop has no overflow even if the cap breaks
      // and it runs until the time limit.
      k = (k + 1) % n;
    }
  }
};

// ---- Appended by the driver (hand-written for now) ----
int main() {
  trace::tracer.begin(R"({"method": "spin", "params": [{"name": "n", "type": "int"}], "input": {"n": 3}})");

  Solution().spin(3);

  // Unreachable while the cap works. A nonzero code makes `make e2e` fail
  // if spin() ever returns.
  return 1;
}
