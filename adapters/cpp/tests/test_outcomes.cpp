// Tests for outcomes: what a line evaluated, added to its step after the line
// ran (trace-format.md, Outcomes): trace::cond, trace::store, trace::stored,
// trace::track, and trace::flush.
//
// Run from the repository root:
//   make -C adapters/cpp test T=outcomes
//
// Each section starts with reset(). The functions are instrumented by hand,
// the way the rewriter does it.

#include "leetcode_types.hpp"

#include <iostream>
#include <map>
#include <string>
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

  using trace::record;
  using trace::var;

  // A store after a call: `int left = depth(n - 1);` on line 50. The callee's
  // steps come between the caller's step for line 50 and the store.
  int depth(int n) {
    trace::Frame frame("depth");
    record(49, var("n", n));
    if (trace::cond(49, "n == 0", n == 0)) {
      record(49, var("n", n));
      return trace::ret<int>(49, 0, var("n", n));
    }
    record(50, var("n", n));
    int left = depth(n - 1);
    trace::store(50, "int left = depth(n - 1)", "left", left);
    record(51, var("n", n), var("left", left));
    return trace::ret<int>(51, left + 1, var("n", n), var("left", left));
  }

} // namespace

int main() {
  using trace::tracer;

  // ------------------------------------------------------------------
  std::cout << "a condition goes on its line's step, and hands its value back\n";
  reset();
  {
    trace::Frame frame("f");
    int x = 4;
    record(3, var("x", x));
    const bool went = trace::cond(3, "x > 3", x > 3);
    check_true("cond returns the condition's value", went);
    check("the step now carries the outcome", steps().back(),
          R"({"step": 0, "frames": [{"id": "f1", "function": "f", "line": 3, "locals": {"x": 4}, "outcomes": [{"kind": "condition", "code": "x > 3", "value": true}]}], "heap": {}})");
    trace::cond(3, "x < 0", x < 0);
    check_true("a second outcome on the line is appended, in order",
               has(steps().back(), R"("outcomes": [{"kind": "condition", "code": "x > 3", "value": true}, {"kind": "condition", "code": "x < 0", "value": false}])"));
  }

  // ------------------------------------------------------------------
  std::cout << "a declaration's store\n";
  reset();
  {
    trace::Frame frame("twoSum");
    std::vector<int> nums{2, 7};
    int target = 9, i = 0;
    record(8, var("nums", nums), var("target", target), var("i", i));
    int complement = target - nums[i];
    trace::store(8, "int complement = target - nums[i]", "complement", complement);
    check_true("is recorded with its code, target, and value",
               has(steps().back(), R"("outcomes": [{"kind": "store", "code": "int complement = target - nums[i]", "target": "complement", "value": 7}])"));
    check_true("and the locals are the step's own (before the line ran)", has(steps().back(), R"("locals": {"nums": {"kind": "array", "items": [2, 7]}, "target": 9, "i": 0})"));
  }

  // ------------------------------------------------------------------
  std::cout << "a tracked target is read after its statement\n";
  reset();
  {
    trace::Frame frame("twoSum");
    std::vector<int> nums{2, 7};
    std::map<int, int> numMap;
    int i = 0;
    record(16, var("nums", nums), var("numMap", numMap), var("i", i));
    trace::track(16, "numMap[nums[i]] = i", "numMap[nums[i]]", numMap[nums[i]]) = 5;
    check_true("nothing is recorded before flush", !has(steps().back(), "outcomes"));
    trace::flush();
    check_true("flush records the value the target holds now",
               has(steps().back(), R"({"kind": "store", "code": "numMap[nums[i]] = i", "target": "numMap[nums[i]]", "value": 5})"));
    check_true("and forgets it", tracer.pending.empty());

    int count = 1;
    record(17, var("count", count));
    trace::track(17, "count++", "count", count)++;
    trace::flush();
    check_true("a postfix ++ records the new value, not the old one", has(steps().back(), R"("target": "count", "value": 2})"));
  }

  // ------------------------------------------------------------------
  std::cout << "a for loop's header\n";
  reset();
  {
    trace::Frame frame("f");
    record(7);
    int sum = 0;
    for (int i = trace::stored<int>(7, "int i = 0", "i", 0); trace::cond(7, "i < 2", i < 2); (record(7, var("i", i)), trace::track(7, "++i", "i", ++i), trace::flush())) {
      trace::Scope scope(7);
      record(8, var("i", i));
      sum += i;
    }
    // Steps: 7 (first pass), 8, 7 (second pass), 8, 7 (last pass).
    check_true("five steps", steps().size() == 5);
    check_true("the first pass: initializer and condition",
               has(steps()[0], R"("outcomes": [{"kind": "store", "code": "int i = 0", "target": "i", "value": 0}, {"kind": "condition", "code": "i < 2", "value": true}])"));
    check_true("a later pass: the increment and the condition, on a step that still shows i before ++",
               has(steps()[2], R"("locals": {"i": 0}, "outcomes": [{"kind": "store", "code": "++i", "target": "i", "value": 1}, {"kind": "condition", "code": "i < 2", "value": true}])"));
    check_true("the last pass ends with false", has(steps()[4], R"({"kind": "condition", "code": "i < 2", "value": false}]})"));
    check_true("a body step has none", !has(steps()[1], "outcomes"));
    check_true("the loop ran as written", sum == 1);
  }

  // ------------------------------------------------------------------
  std::cout << "a store after a call goes on the caller's step for that line\n";
  reset();
  {
    depth(1);
    // Steps: f1 49, f1 50, f2 49 (n == 0), f2 49 (base), f2 return, f1 51, f1 return.
    const std::string &caller50 = steps()[1];
    check_true("the caller's step for line 50 has the store", has(caller50, R"x({"kind": "store", "code": "int left = depth(n - 1)", "target": "left", "value": 0})x"));
    check_true("the callee's return step does not", !has(steps()[4], "store"));
    check_true("each call's condition is on its own step", has(steps()[0], R"("value": false)") && has(steps()[2], R"("value": true)"));
  }

  // ------------------------------------------------------------------
  std::cout << "outcomes that have no step to go on are dropped\n";
  reset();
  {
    trace::Frame frame("f");
    record(3);
    trace::cond(4, "true", true);  // line 4 has no step
    check_true("not put on another line's step", !has(steps().back(), "outcomes"));

    record(5);
    trace::ret<int>(5, 1);
    trace::store(5, "int y = 1", "y", 1);
    check_true("never on a return step", !has(steps().back(), "outcomes"));
  }
  reset();
  {
    trace::cond(1, "true", true);
    check_true("outside any frame, nothing happens", steps().empty());
  }

  // ------------------------------------------------------------------
  std::cout << "a ref in an outcome names an object in its step's heap\n";
  reset();
  {
    trace::Frame frame("f");
    ListNode *head = nullptr;
    record(3, var("head", head));
    head = new ListNode(4);
    trace::track(3, "head = new ListNode(4)", "head", head);
    trace::flush();
    check_true("the store is a ref", has(steps().back(), R"("target": "head", "value": {"kind": "ref", "id": "n1"}})"));
    check_true("and the new node is added to that step's heap", has(steps().back(), R"("heap": {"n1": {"kind": "object", "type": "ListNode", "fields": {"val": 4, "next": null}}})"));
    delete head;
  }

  // ------------------------------------------------------------------
  std::cout << "a value with no serializer records nothing\n";
  reset();
  {
    trace::Frame frame("f");
    std::vector<int> v{1, 2};
    record(3, var("v", v));
    auto it = v.begin();
    trace::store(3, "auto it = v.begin()", "it", it);
    trace::track(3, "it = v.end()", "it", it) = v.end();
    trace::flush();
    check_true("no outcome for an iterator", !has(steps().back(), "outcomes"));
  }

  // ------------------------------------------------------------------
  std::cout << "a deeper frame's tracked store is not recorded by its caller\n";
  reset();
  {
    trace::Frame outer("outer");
    int a = 0;
    record(3, var("a", a));
    {
      trace::Frame inner("inner");
      int b = 0;
      record(9, var("b", b));
      trace::track(9, "b = 1", "b", b) = 1;
      // inner ends without flushing (as if by an exception)
    }
    trace::track(3, "a = 2", "a", a) = 2;
    trace::flush();
    check_true("the caller's own store is recorded", has(steps()[0], R"("target": "a", "value": 2})"));
    check_true("the stale one is dropped", !has(steps()[0], R"("target": "b")") && tracer.pending.empty());
  }

  std::cout << "\n" << passed << " passed, " << failed << " failed\n";
  return failed == 0 ? 0 : 1;
}
