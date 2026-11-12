// Tests for trace::record and trace::var.
//
// Run from the repository root:
//   make -C adapters/cpp test T=record
//
// record() appends one finished step to the global trace::tracer, so every
// section starts with reset() and never sees steps left by another.
//
// Expected steps use the same spacing as fixtures/two-sum.trace.json, so the
// Two Sum checks are copied line for line from the fixture:
//   {"step": 0, "frames": [{"id": "f1", "function": "twoSum", "line": 5, "locals": {...}}], "heap": {}}
//
// record() can only run inside a function that has a trace::Frame, so each
// section declares one. Every section starts with reset(), so its frame is f1.
// The call stack itself (several frames, return steps, Scope) is tested in
// test_frames.cpp.

#include "trace.hpp"

#include <climits>
#include <functional>
#include <format>
#include <iostream>
#include <optional>
#include <string>
#include <unordered_map>
#include <vector>

namespace {

  int passed = 0;
  int failed = 0;

  // `expected` is a raw string literal R"(...)", so the text between the
  // parentheses is exactly the JSON, with no C++ escaping on top.
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

  // Empties the global tracer: no steps, no ids, not truncated.
  void reset() { trace::tracer = trace::Tracer{}; }

  // The most recent step, or "" if nothing has been recorded.
  std::string last_step() { return trace::tracer.steps.empty() ? "" : trace::tracer.steps.back(); }

  // A stand-in for a heap object until Goal 4 adds real pointer serializers.
  // Its serializer (below) asks the two questions a pointer serializer will:
  //   id_table: "have I ever seen this address?"   (answer lasts the whole run)
  //   heap:     "have I written it in this step?"  (answer lasts one step)
  // It has no pointer fields, so it does not exercise cycles.
  struct Probe {
    int val;
  };

} // namespace

// Test-only serializer. It uses the address of the live object, which only
// works because Value holds a reference: a copy would have a new address on
// every call, and aliases would get different ids.
template <> struct trace::Serializer<Probe> {
  static Json write(const Probe &p, Ctx &ctx) {
    const std::string &id = ctx.id_table.try_emplace(&p, "n" + std::to_string(ctx.id_table.size() + 1)).first->second;
    if (!ctx.heap.contains(id)) {
      ctx.heap[id] = std::format(R"({{"kind": "object", "type": "Probe", "fields": {{"val": {}}}}})", p.val);
    }
    return std::format(R"({{"kind": "ref", "id": {}}})", quote(id));
  }
};

int main() {
  using trace::record;
  using trace::tracer;
  using trace::var;

  // ------------------------------------------------------------------
  std::cout << "Two Sum: each step equals the fixture's line\n";
  // The state is set by hand between calls, in the order the program reaches
  // each line. This tests record() only. Placing the calls in the real
  // solution is the hand-instrumented fixture's job.
  reset();
  {
    trace::Frame frame("twoSum");
    std::vector<int> nums{2, 7, 11, 15};
    int target = 9;
    std::unordered_map<int, int> numMap;
    int i = 0;
    int complement = 0;

    record(5, var("nums", nums), var("target", target));
    check("step 0, line 5: parameters only", last_step(),
          R"({"step": 0, "frames": [{"id": "f1", "function": "twoSum", "line": 5, "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9}}], "heap": {}})");

    record(8, var("nums", nums), var("target", target), var("numMap", numMap), var("i", i));
    check("step 1, line 8: numMap and i, no complement yet", last_step(),
          R"({"step": 1, "frames": [{"id": "f1", "function": "twoSum", "line": 8, "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9, "numMap": {"kind": "map", "entries": []}, "i": 0}}], "heap": {}})");

    complement = target - nums[i];
    record(9, var("nums", nums), var("target", target), var("numMap", numMap), var("i", i), var("complement", complement));
    check("step 2, line 9: complement appears", last_step(),
          R"({"step": 2, "frames": [{"id": "f1", "function": "twoSum", "line": 9, "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9, "numMap": {"kind": "map", "entries": []}, "i": 0, "complement": 7}}], "heap": {}})");

    record(11, var("nums", nums), var("target", target), var("numMap", numMap), var("i", i), var("complement", complement));
    check("step 3, line 11", last_step(),
          R"({"step": 3, "frames": [{"id": "f1", "function": "twoSum", "line": 11, "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9, "numMap": {"kind": "map", "entries": []}, "i": 0, "complement": 7}}], "heap": {}})");

    record(16, var("nums", nums), var("target", target), var("numMap", numMap), var("i", i), var("complement", complement));
    check("step 4, line 16: map still empty (pre-execution)", last_step(),
          R"({"step": 4, "frames": [{"id": "f1", "function": "twoSum", "line": 16, "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9, "numMap": {"kind": "map", "entries": []}, "i": 0, "complement": 7}}], "heap": {}})");

    numMap[nums[i]] = i;
    ++i;
    record(8, var("nums", nums), var("target", target), var("numMap", numMap), var("i", i));
    check("step 5, line 8: map has [2, 0], complement out of scope", last_step(),
          R"({"step": 5, "frames": [{"id": "f1", "function": "twoSum", "line": 8, "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9, "numMap": {"kind": "map", "entries": [[2, 0]]}, "i": 1}}], "heap": {}})");

    complement = target - nums[i];
    record(9, var("nums", nums), var("target", target), var("numMap", numMap), var("i", i), var("complement", complement));
    check("step 6, line 9", last_step(),
          R"({"step": 6, "frames": [{"id": "f1", "function": "twoSum", "line": 9, "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9, "numMap": {"kind": "map", "entries": [[2, 0]]}, "i": 1, "complement": 2}}], "heap": {}})");

    record(11, var("nums", nums), var("target", target), var("numMap", numMap), var("i", i), var("complement", complement));
    check("step 7, line 11", last_step(),
          R"({"step": 7, "frames": [{"id": "f1", "function": "twoSum", "line": 11, "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9, "numMap": {"kind": "map", "entries": [[2, 0]]}, "i": 1, "complement": 2}}], "heap": {}})");

    record(12, var("nums", nums), var("target", target), var("numMap", numMap), var("i", i), var("complement", complement));
    check("step 8, line 12", last_step(),
          R"({"step": 8, "frames": [{"id": "f1", "function": "twoSum", "line": 12, "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9, "numMap": {"kind": "map", "entries": [[2, 0]]}, "i": 1, "complement": 2}}], "heap": {}})");

    check_true("nine steps in total", tracer.steps.size() == 9);
  }

  // ------------------------------------------------------------------
  std::cout << "locals\n";
  reset();
  {
    trace::Frame frame("f");
    record(1);
    check("no variables gives empty locals", last_step(), R"({"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {}}], "heap": {}})");

    int a = 1;
    int b = 2;
    record(2, var("b", b), var("a", a));
    check("locals keep argument order", last_step(), R"({"step": 1, "frames": [{"id": "f1", "function": "f", "line": 2, "locals": {"b": 2, "a": 1}}], "heap": {}})");

    // These only compile if var() keeps the array type. A decayed int* has
    // no serializer, and a decayed char* would read past an unterminated buffer.
    int arr[3] = {1, 2, 3};
    char buf[8] = "hi";
    record(3, var("arr", arr), var("buf", buf));
    check("C arrays keep their type", last_step(),
          R"({"step": 2, "frames": [{"id": "f1", "function": "f", "line": 3, "locals": {"arr": {"kind": "array", "items": [1, 2, 3]}, "buf": "hi"}}], "heap": {}})");

    long long big = LLONG_MAX;
    std::optional<int> none;
    std::vector<bool> flags{true, false};
    record(4, var("big", big), var("none", none), var("flags", flags));
    check("values use the same serializers as everywhere else", last_step(),
          R"({"step": 3, "frames": [{"id": "f1", "function": "f", "line": 4, "locals": {"big": {"kind": "int", "value": "9223372036854775807"}, "none": null, "flags": {"kind": "array", "items": [true, false]}}}], "heap": {}})");
  }

  // ------------------------------------------------------------------
  std::cout << "snapshot at call time\n";
  reset();
  {
    trace::Frame frame("f");
    std::vector<int> v{1};
    record(1, var("v", v));
    v.push_back(2);
    record(2, var("v", v));
    check("a later change does not alter an earlier step", tracer.steps[0],
          R"({"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {"v": {"kind": "array", "items": [1]}}}], "heap": {}})");
    check("the later step sees the change", tracer.steps[1],
          R"({"step": 1, "frames": [{"id": "f1", "function": "f", "line": 2, "locals": {"v": {"kind": "array", "items": [1, 2]}}}], "heap": {}})");
  }

  // ------------------------------------------------------------------
  std::cout << "heap and ids (with the Probe stand-in)\n";
  reset();
  {
    trace::Frame frame("f");
    Probe a{1};
    Probe b{2};

    record(1, var("a", a), var("b", b));
    check("objects go in the heap, locals hold refs", last_step(),
          R"({"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {"a": {"kind": "ref", "id": "n1"}, "b": {"kind": "ref", "id": "n2"}}}], "heap": {"n1": {"kind": "object", "type": "Probe", "fields": {"val": 1}}, "n2": {"kind": "object", "type": "Probe", "fields": {"val": 2}}}})");

    record(2, var("b", b));
    check("id survives across steps; heap holds only this step's objects", last_step(),
          R"({"step": 1, "frames": [{"id": "f1", "function": "f", "line": 2, "locals": {"b": {"kind": "ref", "id": "n2"}}}], "heap": {"n2": {"kind": "object", "type": "Probe", "fields": {"val": 2}}}})");

    b.val = 5;
    record(3, var("b", b));
    check("heap starts empty each step, so it shows the new value", last_step(),
          R"({"step": 2, "frames": [{"id": "f1", "function": "f", "line": 3, "locals": {"b": {"kind": "ref", "id": "n2"}}}], "heap": {"n2": {"kind": "object", "type": "Probe", "fields": {"val": 5}}}})");

    Probe &alias = a;
    record(4, var("a", a), var("alias", alias));
    check("aliases share one id and one heap entry", last_step(),
          R"({"step": 3, "frames": [{"id": "f1", "function": "f", "line": 4, "locals": {"a": {"kind": "ref", "id": "n1"}, "alias": {"kind": "ref", "id": "n1"}}}], "heap": {"n1": {"kind": "object", "type": "Probe", "fields": {"val": 1}}}})");

    check_true("id table holds two objects for the whole run", tracer.id_table.size() == 2);
  }

  // ------------------------------------------------------------------
  std::cout << "locals with no serializer are left out\n";
  // The rewriter lists every variable in scope. Ones whose type trace.hpp
  // cannot serialize yet (iterators, lambdas, std::function) are dropped from
  // the step instead of stopping the program from compiling.
  static_assert(trace::Serializable<int>);
  static_assert(trace::Serializable<std::vector<std::string>>);
  static_assert(!trace::Serializable<std::unordered_map<int, int>::iterator>);
  static_assert(!trace::Serializable<std::function<int(int)>>);
  reset();
  {
    trace::Frame frame("f");
    std::unordered_map<int, int> m{{7, 1}};
    auto it = m.find(7);
    auto twice = [](int x) { return 2 * x; };
    std::function<int(int)> fn = twice;
    int k = twice(2);
    record(9, var("m", m), var("it", it), var("twice", twice), var("fn", fn), var("k", k));
    check("only m and k are written", tracer.steps.back(),
          R"({"step": 0, "frames": [{"id": "f1", "function": "f", "line": 9, "locals": {"m": {"kind": "map", "entries": [[7, 1]]}, "k": 4}}], "heap": {}})");
    record(10, var("it", it));
    check("a step whose only local is unsupported has empty locals", tracer.steps.back(),
          R"({"step": 1, "frames": [{"id": "f1", "function": "f", "line": 10, "locals": {}}], "heap": {}})");
  }

  std::cout << "step cap (" << trace::Tracer::max_steps << ")\n";
  reset();
  {
    trace::Frame frame("f");
    int k = 0;
    tracer.exit_at_cap = false;
    for (std::size_t n = 0; n < trace::Tracer::max_steps; ++n) record(1, var("k", k));
    check_true("exactly the cap: all steps kept", tracer.steps.size() == trace::Tracer::max_steps);
    check_true("exactly the cap: not truncated", !tracer.truncated);
    check("last step is numbered cap - 1", last_step(), R"({"step": 1999, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {"k": 0}}], "heap": {}})");

    record(2, var("k", k));
    check_true("one past the cap: no step added", tracer.steps.size() == trace::Tracer::max_steps);
    check_true("one past the cap: truncated", tracer.truncated);

    record(3, var("k", k));
    check_true("after truncation: still no step added", tracer.steps.size() == trace::Tracer::max_steps);
  }

  // ------------------------------------------------------------------
  std::cout << "reset\n";
  reset();
  check_true("no steps", tracer.steps.empty());
  check_true("no ids", tracer.id_table.empty());
  check_true("not truncated", !tracer.truncated);
  check_true("no frames, and the call count starts again", tracer.frames.empty() && tracer.calls == 0);

  std::cout << "\n" << passed << " passed, " << failed << " failed\n";
  return failed == 0 ? 0 : 1;
}
