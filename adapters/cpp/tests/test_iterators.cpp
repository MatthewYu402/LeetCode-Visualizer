// Tests for iterators: trace::var_iter, the iterator kind, and positions.
//
// Run from the repository root:
//   make -C adapters/cpp test T=iterators
//
// An iterator is written as the name of its container (a local of the same
// frame) and a position: an index, a key, or end. Each check records one step
// and looks at how the iterator local was written.

#include "trace.hpp"

#include <deque>
#include <forward_list>
#include <iostream>
#include <list>
#include <map>
#include <set>
#include <string>
#include <unordered_map>
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

  using trace::record;
  using trace::var;
  using trace::var_iter;

  // The locals of the last step, as text.
  std::string last_locals() {
    const std::string &step = trace::tracer.steps.back();
    const std::size_t start = step.find(R"("locals": )") + 10;
    const std::size_t end = step.rfind(R"(}], "heap")");
    return step.substr(start, end - start);
  }

  std::string last_heap() {
    const std::string &step = trace::tracer.steps.back();
    return step.substr(step.rfind(R"("heap": )") + 8, std::string::npos);
  }

  // A var_iter of a temporary must not compile, like var.
  template <typename It, typename C>
  concept can_var_iter = requires(It &&it, C &&c) { trace::var_iter("it", std::forward<It>(it), "c", std::forward<C>(c)); };
  static_assert(can_var_iter<std::vector<int>::iterator &, std::vector<int> &>);
  static_assert(!can_var_iter<std::vector<int>::iterator, std::vector<int> &>);
  static_assert(!can_var_iter<std::vector<int>::iterator &, std::vector<int>>);

  static_assert(trace::IteratorOf<std::vector<int>::iterator, std::vector<int>>);
  static_assert(trace::IteratorOf<std::vector<int>::const_iterator, std::vector<int>>);
  static_assert(!trace::IteratorOf<std::vector<int>::reverse_iterator, std::vector<int>>);
  static_assert(!trace::IteratorOf<std::list<int>::iterator, std::vector<int>>);
  static_assert(!trace::IteratorOf<int, std::vector<int>>);

  struct Node {
    int val;
  };

} // namespace

template <> struct trace::Fields<Node> {
  static constexpr const char *type = "Node";
  static constexpr auto fields = std::make_tuple(std::pair{"val", &Node::val});
};

int main() {
  std::cout << "vector: an index, then end\n";
  {
    trace::tracer = trace::Tracer{};
    trace::Frame frame("f");  // record() runs only inside a frame
    std::vector<int> nums{4, 5, 6};
    auto it = nums.begin();
    record(1, var("nums", nums), var_iter("it", it, "nums", nums));
    check("begin() is index 0", last_locals(),
          R"({"nums": {"kind": "array", "items": [4, 5, 6]}, "it": {"kind": "iterator", "container": "nums", "index": 0}})");
    ++it;
    ++it;
    record(2, var_iter("it", it, "nums", nums));
    check("two steps on is index 2", last_locals(), R"({"it": {"kind": "iterator", "container": "nums", "index": 2}})");
    ++it;
    record(3, var_iter("it", it, "nums", nums));
    check("end() is end, not index 3", last_locals(), R"({"it": {"kind": "iterator", "container": "nums", "end": true}})");

    std::vector<int>::const_iterator c = nums.cbegin() + 1;
    record(4, var_iter("c", c, "nums", nums));
    check("a const_iterator works the same", last_locals(), R"({"c": {"kind": "iterator", "container": "nums", "index": 1}})");

    std::vector<int> empty;
    auto e = empty.begin();
    record(5, var_iter("e", e, "empty", empty));
    check("begin() of an empty vector is end", last_locals(), R"({"e": {"kind": "iterator", "container": "empty", "end": true}})");
  }

  std::cout << "maps and sets: a key\n";
  {
    trace::tracer = trace::Tracer{};
    trace::Frame frame("f");  // record() runs only inside a frame
    std::unordered_map<int, int> numMap{{2, 0}, {7, 1}};
    auto hit = numMap.find(7);
    auto miss = numMap.find(3);
    record(10, var_iter("hit", hit, "numMap", numMap), var_iter("miss", miss, "numMap", numMap));
    check("find() that hits gives the key; a miss is end", last_locals(),
          R"({"hit": {"kind": "iterator", "container": "numMap", "key": 7}, "miss": {"kind": "iterator", "container": "numMap", "end": true}})");

    std::map<std::string, int> words{{"a", 1}, {"b", 2}};
    auto w = words.lower_bound("b");
    record(11, var_iter("w", w, "words", words));
    check("a string key", last_locals(), R"({"w": {"kind": "iterator", "container": "words", "key": "b"}})");

    std::set<int> seen{3, 9};
    auto s = seen.find(9);
    record(12, var_iter("s", s, "seen", seen));
    check("a set iterator gives the item", last_locals(), R"({"s": {"kind": "iterator", "container": "seen", "key": 9}})");

    std::multimap<int, char> mm{{1, 'x'}, {1, 'y'}};
    auto m = mm.begin();
    record(13, var_iter("m", m, "mm", mm));
    check("a multimap gives the key", last_locals(), R"({"m": {"kind": "iterator", "container": "mm", "key": 1}})");
  }

  std::cout << "pointer keys go in the heap\n";
  {
    trace::tracer = trace::Tracer{};
    trace::Frame frame("f");  // record() runs only inside a frame
    Node a{1}, b{2};
    std::unordered_map<Node *, Node *> copies{{&a, &b}};
    auto it = copies.find(&a);
    record(20, var_iter("it", it, "copies", copies));
    check("the key is a ref", last_locals(), R"({"it": {"kind": "iterator", "container": "copies", "key": {"kind": "ref", "id": "n1"}}})");
    check("and its object is in the heap", last_heap(), R"({"n1": {"kind": "object", "type": "Node", "fields": {"val": 1}}}})");
  }

  std::cout << "node-based sequences: an index by walking\n";
  {
    trace::tracer = trace::Tracer{};
    trace::Frame frame("f");  // record() runs only inside a frame
    std::list<int> lst{10, 20, 30};
    auto it = lst.begin();
    std::advance(it, 2);
    record(30, var_iter("it", it, "lst", lst));
    check("list: index 2", last_locals(), R"({"it": {"kind": "iterator", "container": "lst", "index": 2}})");
    ++it;
    record(31, var_iter("it", it, "lst", lst));
    check("list: end", last_locals(), R"({"it": {"kind": "iterator", "container": "lst", "end": true}})");

    std::forward_list<int> fl{1, 2};
    auto f = std::next(fl.begin());
    record(32, var_iter("f", f, "fl", fl));
    check("forward_list: index 1", last_locals(), R"({"f": {"kind": "iterator", "container": "fl", "index": 1}})");

    std::deque<int> dq{7, 8, 9};
    auto d = dq.end() - 1;
    record(33, var_iter("d", d, "dq", dq));
    check("deque: index 2", last_locals(), R"({"d": {"kind": "iterator", "container": "dq", "index": 2}})");

    std::string word = "abc";
    auto ch = word.begin() + 1;
    record(34, var_iter("ch", ch, "word", word));
    check("string: index 1", last_locals(), R"({"ch": {"kind": "iterator", "container": "word", "index": 1}})");
  }

  std::cout << "not an iterator into that container: an ordinary local\n";
  {
    trace::tracer = trace::Tracer{};
    trace::Frame frame("f");  // record() runs only inside a frame
    std::unordered_map<int, int> m{{1, 5}};
    int value = m.find(1)->second;  // the rewriter pairs value with m because of m.find
    record(40, var_iter("value", value, "m", m));
    check("an int made from m.find() is just an int", last_locals(), R"({"value": 5})");

    std::vector<int> v{1, 2};
    auto r = v.rbegin();
    record(41, var_iter("r", r, "v", v), var("v", v));
    check("a reverse iterator is left out (no serializer)", last_locals(), R"({"v": {"kind": "array", "items": [1, 2]}})");

    std::list<int> other{1};
    auto wrong = other.begin();
    record(42, var_iter("wrong", wrong, "v", v));
    check("an iterator of a different container type is left out", last_locals(), R"({})");
  }

  std::cout << "a loop, step by step\n";
  {
    trace::tracer = trace::Tracer{};
    trace::Frame loop("walk");  // reset before the frame, so it pops what it pushed
    std::vector<int> nums{3, 1};
    int total = 0;
    for (auto it = nums.begin(); it != nums.end(); ++it) {
      record(50, var("nums", nums), var("total", total), var_iter("it", it, "nums", nums));
      total += *it;
    }
    check_true("two steps", trace::tracer.steps.size() == 2);
    check_true("the first at index 0", trace::tracer.steps[0].find(R"("it": {"kind": "iterator", "container": "nums", "index": 0})") != std::string::npos);
    check_true("the second at index 1", trace::tracer.steps[1].find(R"("it": {"kind": "iterator", "container": "nums", "index": 1})") != std::string::npos);
  }

  std::cout << "returning an iterator\n";
  {
    trace::tracer = trace::Tracer{};
    trace::Frame outer("f");  // reset before the frame, so it pops what it pushed
    std::vector<int> v{1};
    auto it = trace::ret<std::vector<int>::iterator>(60, v.begin(), var("v", v));
    check_true("the value is handed back", it == v.begin());
    check_true("the step is recorded, with no return_value", trace::tracer.steps.size() == 1 && trace::tracer.steps[0].find("return_value") == std::string::npos);
  }

  std::cout << "\n" << passed << " passed, " << failed << " failed\n";
  return failed == 0 ? 0 : 1;
}
