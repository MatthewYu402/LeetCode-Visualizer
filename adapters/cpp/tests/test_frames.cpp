// Tests for the call stack: trace::Frame, trace::Scope, trace::ret, and
// trace::ret_void, and how record() writes every frame.
//
// Run from the repository root:
//   make -C adapters/cpp test T=frames
//
// Each section starts with reset(), so the first call in it is f1. The small
// functions below are instrumented by hand, the way the rewriter will do it:
// a Frame on the first line, a record() before each statement, and ret() or
// ret_void() for each return.

#include "leetcode_types.hpp"

#include <iostream>
#include <stdexcept>
#include <string>
#include <utility>
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

  void reset() { trace::tracer = trace::Tracer{}; }

  const std::vector<trace::Json> &steps() { return trace::tracer.steps; }

  using trace::record;
  using trace::var;

  // ---- Instrumented functions ----

  // A leaf call: one step, then a return step.
  int twice(int x) {
    trace::Frame frame("twice");
    record(20, var("x", x));
    return trace::ret<int>(20, 2 * x, var("x", x));
  }

  // Appends to a vector its caller owns, through a reference.
  void append(std::vector<int> &out, int v) {
    trace::Frame frame("append");
    record(30, var("out", out), var("v", v));
    out.push_back(v);
    record(31, var("out", out), var("v", v));
    trace::ret_void(32, var("out", out), var("v", v));
  }

  // Recursion: n! with a return step on every level.
  int fact(int n) {
    trace::Frame frame("fact");
    record(40, var("n", n));
    if (n <= 1) {
      record(41, var("n", n));
      return trace::ret<int>(41, 1, var("n", n));
    }
    record(42, var("n", n));
    return trace::ret<int>(42, n * fact(n - 1), var("n", n));
  }

  // Returns a pointer: return_value is a ref, its object is in the step's heap.
  ListNode *second(ListNode *head) {
    trace::Frame frame("second");
    record(50, var("head", head));
    return trace::ret<ListNode *>(50, head->next, var("head", head));
  }

  // A braced return, as in Two Sum's `return {it->second, i};`.
  std::vector<int> pair_of(int a, int b) {
    trace::Frame frame("pair_of");
    record(60, var("a", a), var("b", b));
    return trace::ret<std::vector<int>>(60, {a, b}, var("a", a), var("b", b));
  }

  // Records, then throws: its frame must still be popped.
  void thrower() {
    trace::Frame frame("thrower");
    record(70);
    throw std::runtime_error("boom");
  }

  // A var() of a temporary must not compile (see var's deleted overload).
  template <typename T>
  concept can_var = requires(T &&t) { trace::var("x", std::forward<T>(t)); };
  static_assert(can_var<int &>, "a variable can be recorded");
  static_assert(can_var<const std::vector<int> &>, "a const variable can be recorded");
  static_assert(!can_var<int>, "a temporary cannot be recorded");
  static_assert(!can_var<std::vector<int>>, "a temporary container cannot be recorded");

} // namespace

int main() {
  // ------------------------------------------------------------------
  std::cout << "one frame\n";
  reset();
  {
    trace::Frame frame("solve");
    int k = 3;
    record(5, var("k", k));
    check("a step has one frame with id, function, line, locals", steps().back(),
          R"({"step": 0, "frames": [{"id": "f1", "function": "solve", "line": 5, "locals": {"k": 3}}], "heap": {}})");
    check_true("the frame is on the stack while the function runs", trace::tracer.frames.size() == 1);
  }
  check_true("and popped when it ends", trace::tracer.frames.empty());

  // ------------------------------------------------------------------
  std::cout << "a call: two frames, a return step, then one frame again\n";
  reset();
  {
    trace::Frame frame("solve");
    int y = 0;
    record(10, var("y", y));
    y = twice(4);
    record(11, var("y", y));

    check_true("four steps: caller, callee, callee returning, caller", steps().size() == 4);
    check("inside the call: bottom to top, the caller on the line of the call", steps()[1],
          R"({"step": 1, "frames": [{"id": "f1", "function": "solve", "line": 10, "locals": {"y": 0}}, {"id": "f2", "function": "twice", "line": 20, "locals": {"x": 4}}], "heap": {}})");
    check("the return step: return_value on the top frame only", steps()[2],
          R"({"step": 2, "frames": [{"id": "f1", "function": "solve", "line": 10, "locals": {"y": 0}}, {"id": "f2", "function": "twice", "line": 20, "locals": {"x": 4}, "return_value": 8}], "heap": {}})");
    check("after it: the callee is gone, and the caller has the value", steps()[3],
          R"({"step": 3, "frames": [{"id": "f1", "function": "solve", "line": 11, "locals": {"y": 8}}], "heap": {}})");
  }

  // ------------------------------------------------------------------
  std::cout << "frame ids\n";
  reset();
  {
    trace::Frame frame("solve");
    record(10);
    int a = twice(1);
    int b = twice(2);
    record(11, var("a", a), var("b", b));
    check_true("the first call is f2", steps()[1].find(R"("id": "f2", "function": "twice")") != std::string::npos);
    check_true("a second call at the same depth gets a new id, f3", steps()[3].find(R"("id": "f3", "function": "twice")") != std::string::npos);
    check_true("and f2 never appears again", steps()[3].find(R"("f2")") == std::string::npos && steps()[4].find(R"("f2")") == std::string::npos);
    check_true("three calls counted", trace::tracer.calls == 3);
  }

  // ------------------------------------------------------------------
  std::cout << "callers are written live\n";
  reset();
  {
    trace::Frame frame("solve");
    std::vector<int> path{1};
    record(10, var("path", path));
    append(path, 2);
    check("the callee changed the caller's vector, and the caller's frame shows it", steps()[2],
          R"({"step": 2, "frames": [{"id": "f1", "function": "solve", "line": 10, "locals": {"path": {"kind": "array", "items": [1, 2]}}}, {"id": "f2", "function": "append", "line": 31, "locals": {"out": {"kind": "array", "items": [1, 2]}, "v": 2}}], "heap": {}})");
    check("ret_void: a return step with return_value null", steps()[3],
          R"({"step": 3, "frames": [{"id": "f1", "function": "solve", "line": 10, "locals": {"path": {"kind": "array", "items": [1, 2]}}}, {"id": "f2", "function": "append", "line": 32, "locals": {"out": {"kind": "array", "items": [1, 2]}, "v": 2}, "return_value": null}], "heap": {}})");
  }

  // ------------------------------------------------------------------
  std::cout << "one heap shared by every frame\n";
  reset();
  {
    trace::Frame frame("solve");
    ListNode b(2), a(1, &b);
    ListNode *head = &a;
    record(10, var("head", head));
    ListNode *got = second(head);
    record(11, var("head", head), var("got", got));
    check("caller and callee refs point into one heap, with one id per node", steps()[1],
          R"({"step": 1, "frames": [{"id": "f1", "function": "solve", "line": 10, "locals": {"head": {"kind": "ref", "id": "n1"}}}, {"id": "f2", "function": "second", "line": 50, "locals": {"head": {"kind": "ref", "id": "n1"}}}], "heap": {"n1": {"kind": "object", "type": "ListNode", "fields": {"val": 1, "next": {"kind": "ref", "id": "n2"}}}, "n2": {"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": null}}}})");
    check_true("a returned pointer is a ref in return_value", steps()[2].find(R"("return_value": {"kind": "ref", "id": "n2"})") != std::string::npos);
    check_true("ret hands the pointer back unchanged", got == &b);
  }

  // ------------------------------------------------------------------
  std::cout << "ret\n";
  reset();
  {
    trace::Frame frame("solve");
    record(10);
    std::vector<int> pair = pair_of(3, 4);
    check_true("a braced return value reaches the caller", pair == std::vector<int>({3, 4}));
    check_true("and is written as the return value", steps()[2].find(R"("return_value": {"kind": "array", "items": [3, 4]})") != std::string::npos);
  }

  // ------------------------------------------------------------------
  std::cout << "recursion\n";
  reset();
  {
    trace::Frame frame("solve");
    record(10);
    int r = fact(3);
    record(11, var("r", r));
    check_true("the result is right", r == 6);

    // Steps: solve 10; fact(3) 40, 42; fact(2) 40, 42; fact(1) 40, 41, return 41;
    // fact(2) return 42; fact(3) return 42; solve 11.
    check_true("eleven steps", steps().size() == 11);
    check("the deepest step: four frames, every caller on its call line", steps()[7],
          R"({"step": 7, "frames": [{"id": "f1", "function": "solve", "line": 10, "locals": {}}, {"id": "f2", "function": "fact", "line": 42, "locals": {"n": 3}}, {"id": "f3", "function": "fact", "line": 42, "locals": {"n": 2}}, {"id": "f4", "function": "fact", "line": 41, "locals": {"n": 1}, "return_value": 1}], "heap": {}})");
    check("unwinding: f3 returns 2 with f4 gone", steps()[8],
          R"({"step": 8, "frames": [{"id": "f1", "function": "solve", "line": 10, "locals": {}}, {"id": "f2", "function": "fact", "line": 42, "locals": {"n": 3}}, {"id": "f3", "function": "fact", "line": 42, "locals": {"n": 2}, "return_value": 2}], "heap": {}})");
    check("then f2 returns 6", steps()[9],
          R"({"step": 9, "frames": [{"id": "f1", "function": "solve", "line": 10, "locals": {}}, {"id": "f2", "function": "fact", "line": 42, "locals": {"n": 3}, "return_value": 6}], "heap": {}})");
    check("and the caller is alone again", steps()[10],
          R"({"step": 10, "frames": [{"id": "f1", "function": "solve", "line": 11, "locals": {"r": 6}}], "heap": {}})");
  }

  // ------------------------------------------------------------------
  std::cout << "Scope\n";
  reset();
  {
    trace::Frame frame("solve");
    int total = 0;
    record(10, var("total", total));
    for (int i = 0; i < 1; ++i) {
      trace::Scope scope(11); // line 11 is the for statement
      int inner = 5;
      record(12, var("total", total), var("i", i), var("inner", inner));
      total += inner;
    }
    // inner and i are gone. A call made now, before the next record (as from a
    // loop condition), must not read them.
    int doubled = twice(total);
    // The restored Values are the ones from line 10, but they refer to the
    // live variable, so total reads 5, its value now.
    check("after the block: only outer variables, read live, on the block's line", steps()[2],
          R"({"step": 2, "frames": [{"id": "f1", "function": "solve", "line": 11, "locals": {"total": 5}}, {"id": "f2", "function": "twice", "line": 20, "locals": {"x": 5}}], "heap": {}})");
    check_true("the call still works", doubled == 10);
  }

  // ------------------------------------------------------------------
  std::cout << "exceptions\n";
  reset();
  {
    trace::Frame frame("solve");
    record(10);
    bool caught = false;
    try {
      thrower();
    } catch (const std::runtime_error &) {
      caught = true;
    }
    check_true("the exception reached the caller", caught);
    check_true("the thrower's frame was popped by its destructor", trace::tracer.frames.size() == 1);
    record(11);
    check_true("the next step has one frame", steps().back().find(R"("thrower")") == std::string::npos);
  }

  // ------------------------------------------------------------------
  std::cout << "step cap\n";
  reset();
  {
    trace::tracer.exit_at_cap = false;
    trace::Frame frame("solve");
    for (std::size_t n = 0; n < trace::Tracer::max_steps; ++n) record(1);
    int y = twice(21);
    check_true("past the cap, ret still returns the value", y == 42);
    check_true("and adds no step", steps().size() == trace::Tracer::max_steps);
    check_true("the trace is truncated", trace::tracer.truncated);
  }

  std::cout << "\n" << passed << " passed, " << failed << " failed\n";
  return failed == 0 ? 0 : 1;
}
