// Tests for trace::build_document.
//
// Run from the repository root:
//   make -C adapters/cpp test T=document
//
// build_document reads the global trace::tracer, so every section starts with
// reset() and sets only the fields it needs. It does no file I/O, so each
// check compares the exact text it returns.
//
// Expected documents use the same spacing as fixtures/two-sum.trace.json:
//   {"version": "0.7", "language": "cpp", "problem": {...}, "steps": [...]}
// followed, only when they say something, by ", "result": ...", then
// ", "result_heap": {...}", and then ", "truncated": true".

#include "trace.hpp"

#include <iostream>
#include <optional>
#include <string>

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

  // Empties the global tracer: no steps, no ids, no problem, not truncated.
  void reset() { trace::tracer = trace::Tracer{}; }

  bool contains(const std::string &text, const std::string &part) { return text.find(part) != std::string::npos; }

  // A short problem used by most sections. Its exact text does not matter here.
  const std::string problem = R"({"method": "f", "params": [], "input": {}})";

  // Two finished steps, as record() would leave them in tracer.steps.
  const std::string step0 = R"({"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {}}], "heap": {}})";
  const std::string step1 = R"({"step": 1, "frames": [{"id": "f1", "function": "f", "line": 2, "locals": {"k": 0}}], "heap": {}})";

} // namespace

int main() {
  using trace::build_document;
  using trace::tracer;

  // ------------------------------------------------------------------
  std::cout << "no steps\n";
  reset();
  {
    tracer.begin(problem);
    check("steps is an empty array", build_document(std::nullopt),
          R"({"version": "0.7", "language": "cpp", "problem": {"method": "f", "params": [], "input": {}}, "steps": []})");
  }

  // ------------------------------------------------------------------
  std::cout << "steps\n";
  reset();
  {
    tracer.begin(problem);
    tracer.steps.push_back(step0);
    check("one step has no separator", build_document(std::nullopt),
          R"({"version": "0.7", "language": "cpp", "problem": {"method": "f", "params": [], "input": {}}, "steps": [{"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {}}], "heap": {}}]})");

    tracer.steps.push_back(step1);
    check("several steps are joined with \", \" in order", build_document(std::nullopt),
          R"({"version": "0.7", "language": "cpp", "problem": {"method": "f", "params": [], "input": {}}, "steps": [{"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {}}], "heap": {}}, {"step": 1, "frames": [{"id": "f1", "function": "f", "line": 2, "locals": {"k": 0}}], "heap": {}}]})");
  }

  reset();
  {
    // Steps written by record() itself, not by hand.
    tracer.begin(problem);
    trace::Frame frame("f"); // record() runs only inside a frame
    int k = 0;
    trace::record(1);
    trace::record(2, trace::var("k", k));
    check("steps from record() are pasted in unchanged", build_document(std::nullopt),
          R"({"version": "0.7", "language": "cpp", "problem": {"method": "f", "params": [], "input": {}}, "steps": [{"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {}}], "heap": {}}, {"step": 1, "frames": [{"id": "f1", "function": "f", "line": 2, "locals": {"k": 0}}], "heap": {}}]})");
  }

  // ------------------------------------------------------------------
  std::cout << "result\n";
  reset();
  {
    tracer.begin(problem);
    tracer.steps.push_back(step0);
    check("a result follows the steps", build_document(R"({"kind": "array", "items": [0, 1]})"),
          R"({"version": "0.7", "language": "cpp", "problem": {"method": "f", "params": [], "input": {}}, "steps": [{"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {}}], "heap": {}}], "result": {"kind": "array", "items": [0, 1]}})");

    check("a bare primitive result", build_document("9"),
          R"({"version": "0.7", "language": "cpp", "problem": {"method": "f", "params": [], "input": {}}, "steps": [{"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {}}], "heap": {}}], "result": 9})");

    // null is a real return value (an empty optional), not a placeholder.
    check("a null result is still written", build_document("null"),
          R"({"version": "0.7", "language": "cpp", "problem": {"method": "f", "params": [], "input": {}}, "steps": [{"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {}}], "heap": {}}], "result": null})");

    const std::string none = build_document(std::nullopt);
    check_true("no result: no \"result\" key at all", !contains(none, "\"result\""));
    check_true("no result: no null placeholder", !contains(none, "null"));
  }

  // ------------------------------------------------------------------
  std::cout << "result_heap\n";
  reset();
  {
    tracer.begin(problem);
    tracer.steps.push_back(step0);

    const trace::Heap two{
      {"n1", R"({"kind": "object", "type": "ListNode", "fields": {"val": 1, "next": {"kind": "ref", "id": "n2"}}})"},
      {"n2", R"({"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": null}})"}};
    check("a ref result is followed by its heap", build_document(R"({"kind": "ref", "id": "n1"})", two),
          R"({"version": "0.7", "language": "cpp", "problem": {"method": "f", "params": [], "input": {}}, "steps": [{"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {}}], "heap": {}}], "result": {"kind": "ref", "id": "n1"}, "result_heap": {"n1": {"kind": "object", "type": "ListNode", "fields": {"val": 1, "next": {"kind": "ref", "id": "n2"}}}, "n2": {"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": null}}}})");

    const std::string plain = build_document("9", trace::Heap{});
    check_true("an empty heap: no \"result_heap\" key at all", !contains(plain, "\"result_heap\""));
    check_true("no heap argument: no \"result_heap\" key at all", !contains(build_document("9"), "\"result_heap\""));

    // A heap describes the result's objects, so without a result it is dropped.
    const std::string unfinished = build_document(std::nullopt, two);
    check_true("no result: the heap is not written either", !contains(unfinished, "\"result_heap\""));

    tracer.truncated = true;
    check("result_heap comes before truncated", build_document(R"({"kind": "ref", "id": "n2"})", trace::Heap{{"n2", R"({"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": null}})"}}),
          R"({"version": "0.7", "language": "cpp", "problem": {"method": "f", "params": [], "input": {}}, "steps": [{"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {}}], "heap": {}}], "result": {"kind": "ref", "id": "n2"}, "result_heap": {"n2": {"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": null}}}, "truncated": true})");
  }

  // ------------------------------------------------------------------
  std::cout << "truncated\n";
  reset();
  {
    tracer.begin(problem);
    tracer.steps.push_back(step0);

    const std::string normal = build_document(std::nullopt);
    check_true("not truncated: no \"truncated\" key at all", !contains(normal, "\"truncated\""));
    check_true("not truncated: never written as false", !contains(normal, "false"));

    tracer.truncated = true;
    check("truncated: written as true, last", build_document(std::nullopt),
          R"({"version": "0.7", "language": "cpp", "problem": {"method": "f", "params": [], "input": {}}, "steps": [{"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {}}], "heap": {}}], "truncated": true})");
  }

  // ------------------------------------------------------------------
  std::cout << "problem\n";
  reset();
  {
    // Odd spacing, nesting, escapes, and UTF-8. None of it may be touched.
    const std::string odd = R"({ "name":"Two  Sum" ,"method": "twoSum","params": [{"name": "nums", "type": "array<int>", "hint": "grid"}],
  "input": {"nums": [2,7], "s": "a\"b\\c\n café café"} })";
    tracer.begin(odd);
    check("the problem JSON is pasted in unchanged", build_document(std::nullopt),
          R"({"version": "0.7", "language": "cpp", "problem": )" + odd + R"(, "steps": []})");
  }

  // ------------------------------------------------------------------
  std::cout << "no side effects\n";
  reset();
  {
    tracer.begin(problem);
    tracer.steps.push_back(step0);
    const std::string first = build_document("1");
    const std::string second = build_document("1");
    check("calling twice gives the same text", second, first);
    check_true("the steps are left as they were", tracer.steps.size() == 1 && tracer.steps[0] == step0);
    check_true("truncated is left as it was", !tracer.truncated);
  }

  std::cout << "\n" << passed << " passed, " << failed << " failed\n";
  return failed == 0 ? 0 : 1;
}
