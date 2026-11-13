// Tests for trace::serialize.
//
// Build and run from the repository root:
//   clang++ -std=c++20 -Wall -Wextra -Wpedantic -I adapters/cpp/runtime
//       adapters/cpp/tests/test_serialize.cpp -o /tmp/test_serialize
//   /tmp/test_serialize
//
// Each check compares the exact characters serialize() produces with the
// expected JSON text. On failure it prints both, so escaping mistakes are
// easy to spot. The exit code is nonzero if any check fails.
//
// Spacing convention the expected strings assume (trace format v0.2):
//   {"kind": "array", "items": [1, 2]}        ", " between items
//   {"kind": "map", "entries": [[2, 0]]}      entries are raw [key, value]
//   {"kind": "int", "value": "9007199254740992"}
//   {"kind": "float", "value": "NaN"}

#include "trace.hpp"

#include <climits>
#include <cstdint>
#include <iostream>
#include <limits>
#include <map>
#include <string>
#include <unordered_map>
#include <utility>
#include <vector>
#include <deque>
#include <functional>
#include <map>
#include <queue>
#include <set>
#include <stack>
#include <tuple>
#include <unordered_set>

namespace
{

      int passed = 0;
      int failed = 0;

      // `expected` is written as a C++ raw string literal R"(...)" in the checks
      // below, so what you see between the parentheses is exactly the JSON text,
      // with no C++ escaping layered on top.
      void check(const std::string &name, const std::string &actual, const std::string &expected)
      {
            if (actual == expected)
            {
                  ++passed;
                  std::cout << "  PASS  " << name << "\n";
            }
            else
            {
                  ++failed;
                  std::cout << "  FAIL  " << name << "\n"
                            << "          expected: " << expected << "\n"
                            << "          actual:   " << actual << "\n";
            }
      }

      // For output whose order is unspecified (unordered_map with several
      // entries): passes if `needle` appears somewhere in `actual`.
      void check_contains(const std::string &name, const std::string &actual, const std::string &needle)
      {
            if (actual.find(needle) != std::string::npos)
            {
                  ++passed;
                  std::cout << "  PASS  " << name << "\n";
            }
            else
            {
                  ++failed;
                  std::cout << "  FAIL  " << name << "\n"
                            << "          expected to contain: " << needle << "\n"
                            << "          actual:              " << actual << "\n";
            }
      }

} // namespace

// Custom hash for pair keys, as used in grid problems.
struct PairHash {
      std::size_t operator()(const std::pair<int, int> &p) const {
      return std::hash<int>{}(p.first) * 31 + std::hash<int>{}(p.second);
    }
};

int main()
{
      using namespace trace;

      // One context for the whole run, the way TRACE will borrow the tracer's
      // id table and a per-step heap. Primitives and containers of primitives
      // never touch it.
      std::unordered_map<const void *, std::string> ids;
      Heap heap;
      Ctx ctx{ids, heap};

      const double inf = std::numeric_limits<double>::infinity();
      const double nan = std::numeric_limits<double>::quiet_NaN();

      // ---- BOOL TESTS ---- //
      std::cout << "bool\n";
      check("true", serialize(true, ctx), R"(true)");
      check("false", serialize(false, ctx), R"(false)");

      // ---- INTEGRAL TESTS ---- //
      std::cout << "integers\n";
      check("int", serialize(42, ctx), R"(42)");
      check("negative int", serialize(-7, ctx), R"(-7)");
      check("short", serialize(short{3}, ctx), R"(3)");
      check("long long", serialize(5LL, ctx), R"(5)");
      check("unsigned", serialize(5u, ctx), R"(5)");
      check("i8 is a number", serialize(i8{65}, ctx), R"(65)"); // signed char, not char
      check("u8 is a number", serialize(u8{200}, ctx), R"(200)");
      check("i8 min", serialize(i8{-128}, ctx), R"(-128)");
      check("i32 max", serialize(i32{INT_MAX}, ctx), R"(2147483647)");
      check("i32 min", serialize(i32{INT_MIN}, ctx), R"(-2147483648)");

      std::cout << "integers at the JavaScript safe limit (2^53 - 1)\n";
      check("max safe stays bare", serialize(9007199254740991LL, ctx), R"(9007199254740991)");
      check("max safe + 1 is tagged", serialize(9007199254740992LL, ctx), R"({"kind": "int", "value": "9007199254740992"})");
      check("min safe stays bare", serialize(-9007199254740991LL, ctx), R"(-9007199254740991)");
      check("min safe - 1 is tagged", serialize(-9007199254740992LL, ctx), R"({"kind": "int", "value": "-9007199254740992"})");
      check("i64 min is tagged", serialize(i64{LLONG_MIN}, ctx), R"({"kind": "int", "value": "-9223372036854775808"})");
      check("i64 max is tagged", serialize(i64{LLONG_MAX}, ctx), R"({"kind": "int", "value": "9223372036854775807"})");
      check("u64 small stays bare", serialize(u64{5}, ctx), R"(5)"); // catches signed/unsigned mixing
      check("u64 zero stays bare", serialize(u64{0}, ctx), R"(0)");
      check("u64 max safe stays bare", serialize(u64{9007199254740991ULL}, ctx), R"(9007199254740991)");
      check("u64 max is tagged", serialize(u64{ULLONG_MAX}, ctx), R"({"kind": "int", "value": "18446744073709551615"})");

      // ---- FLOATING POINT TESTS ---- //
      std::cout << "floating point\n";
      check("2.5", serialize(2.5, ctx), R"(2.5)");
      check("-2.5", serialize(-2.5, ctx), R"(-2.5)");
      check("whole double", serialize(2.0, ctx), R"(2)");
      check("0.1 shortest", serialize(0.1, ctx), R"(0.1)");      // not 0.100000
      check("0.1f stays float", serialize(0.1f, ctx), R"(0.1)"); // not 0.10000000149011612
      check("tiny", serialize(1e-7, ctx), R"(1e-07)");           // not 0.000000
      check("huge stays bare", serialize(1e300, ctx), R"(1e+300)");
      check("negative zero", serialize(-0.0, ctx), R"(-0)");
      check("NaN is tagged", serialize(nan, ctx), R"({"kind": "float", "value": "NaN"})");
      check("+inf is tagged", serialize(inf, ctx), R"({"kind": "float", "value": "Infinity"})");
      check("-inf is tagged", serialize(-inf, ctx), R"({"kind": "float", "value": "-Infinity"})");
      check("float inf is tagged", serialize(std::numeric_limits<float>::infinity(), ctx),
            R"({"kind": "float", "value": "Infinity"})");

      // ---- CHAR TESTS ---- //
      std::cout << "char\n";
      check("letter", serialize('a', ctx), R"("a")");
      check("double quote", serialize('"', ctx), R"("\"")");
      check("backslash", serialize('\\', ctx), R"("\\")");
      check("newline", serialize('\n', ctx), R"("\n")");

      // ---- VOLATILE TESTS ---- //
      // A volatile scalar gets the plain type's kind. Before the fix, none of
      // these compiled with libc++ (std::format refuses volatile arguments),
      // and volatile bool and char compiled nowhere (they fell into the
      // integral case, whose std::cmp_less rejects bool and char).
      std::cout << "volatile scalars\n";
      {
            volatile int v_int = 42;
            const volatile int cv_int = -7;
            volatile long long v_big = 9007199254740992LL;
            volatile bool v_bool = true;
            volatile char v_char = 'a';
            volatile double v_nan = nan;
            volatile double v_half = 0.5;
            check("volatile int", serialize(v_int, ctx), R"(42)");
            check("const volatile int", serialize(cv_int, ctx), R"(-7)");
            check("volatile big int is tagged", serialize(v_big, ctx), R"({"kind": "int", "value": "9007199254740992"})");
            check("volatile bool is a bool", serialize(v_bool, ctx), R"(true)");
            check("volatile char is text", serialize(v_char, ctx), R"("a")");
            check("volatile NaN is tagged", serialize(v_nan, ctx), R"({"kind": "float", "value": "NaN"})");
            check("volatile double", serialize(v_half, ctx), R"(0.5)");
      }
      static_assert(Serializable<volatile int> && Serializable<const volatile bool>);
      static_assert(!Serializable<volatile std::nullptr_t>, "a volatile type with no plain serializer stays unserializable");

      // ---- C-STRING TESTS ---- //
      std::cout << "C strings\n";
      check("literal", serialize("abc", ctx), R"("abc")"); // must not become true
      check("empty literal", serialize("", ctx), R"("")");
      const char *str_ptr = "xyz";
      check("const char*", serialize(str_ptr, ctx), R"("xyz")");
      const char *null_str = nullptr;
      check("null pointer", serialize(null_str, ctx), R"(null)");
      char buffer[8] = "hi"; // spare capacity: stops at the first NUL
      check("char array buffer", serialize(buffer, ctx), R"("hi")");

      // ---- STRING TESTS ---- //
      std::cout << "std::string\n";
      check("plain", serialize(std::string("abc"), ctx), R"("abc")");
      check("empty", serialize(std::string(""), ctx), R"("")");
      check("embedded quotes", serialize(std::string("say \"hi\""), ctx), R"("say \"hi\"")");
      check("backslash", serialize(std::string("a\\b"), ctx), R"("a\\b")");
      check("newline", serialize(std::string("a\nb"), ctx), R"("a\nb")");
      check("tab", serialize(std::string("a\tb"), ctx), R"("a\tb")");
      check("short escapes", serialize(std::string("\b\f\r"), ctx), R"("\b\f\r")");
      check("vertical tab", serialize(std::string("a\vb"), ctx), R"("a\u000bb")");
      check("bell", serialize(std::string("\a"), ctx), R"("\u0007")");
      check("escape (0x1b)", serialize(std::string("\x1b"), ctx), R"("\u001b")");
      check("unit sep (0x1f)", serialize(std::string("\x1f"), ctx), R"("\u001f")");
      check("embedded NUL", serialize(std::string("a\0b", 3), ctx), R"("a\u0000b")");
      check("space (0x20) as-is", serialize(std::string(" "), ctx), R"(" ")");
      check("UTF-8 passes through", serialize(std::string("caf\xc3\xa9"), ctx), "\"caf\xc3\xa9\"");
        
      std::string_view sv_part = std::string_view("hello world").substr(0, 5); // not NUL-terminated
      check("string_view stops at its length", serialize(sv_part, ctx), R"("hello")");

      // ---- VECTOR TESTS ---- //
      std::cout << "vector -> array\n";
      check("empty", serialize(std::vector<int>{}, ctx), R"({"kind": "array", "items": []})");
      check("one item", serialize(std::vector<int>{7}, ctx), R"({"kind": "array", "items": [7]})");
      check("several (no trailing comma)", serialize(std::vector<int>{2, 7, 11, 15}, ctx),
            R"({"kind": "array", "items": [2, 7, 11, 15]})");
      check("strings are quoted", serialize(std::vector<std::string>{"a", "b"}, ctx),
            R"({"kind": "array", "items": ["a", "b"]})");
      check("chars are strings", serialize(std::vector<char>{'x', 'y'}, ctx),
            R"({"kind": "array", "items": ["x", "y"]})");
      check("vector<bool>", serialize(std::vector<bool>{true, false}, ctx),
            R"({"kind": "array", "items": [true, false]})");
      check("doubles keep fractions", serialize(std::vector<double>{0.5, 2.5}, ctx),
            R"({"kind": "array", "items": [0.5, 2.5]})");
      check("mixed bare and tagged int", serialize(std::vector<long long>{3, 9007199254740993LL, -1}, ctx),
            R"({"kind": "array", "items": [3, {"kind": "int", "value": "9007199254740993"}, -1]})");
      check("NaN inside an array", serialize(std::vector<double>{0.5, nan}, ctx),
            R"({"kind": "array", "items": [0.5, {"kind": "float", "value": "NaN"}]})");
      check("nested (grid)", serialize(std::vector<std::vector<int>>{{1, 0}, {0, 1}}, ctx),
            R"({"kind": "array", "items": [{"kind": "array", "items": [1, 0]}, {"kind": "array", "items": [0, 1]}]})");
      check("nested empty", serialize(std::vector<std::vector<int>>{{}}, ctx),
            R"({"kind": "array", "items": [{"kind": "array", "items": []}]})");

      // ---- PAIR TESTS ---- //
      std::cout << "pair -> tuple\n";
      check("int pair", serialize(std::pair<int, int>{1, 2}, ctx),
            R"({"kind": "tuple", "items": [1, 2]})");
      check("string member quoted", serialize(std::pair<int, std::string>{1, "a"}, ctx),
            R"({"kind": "tuple", "items": [1, "a"]})");
      check("vector of pairs (intervals)", serialize(std::vector<std::pair<int, int>>{{1, 3}, {2, 6}}, ctx),
            R"({"kind": "array", "items": [{"kind": "tuple", "items": [1, 3]}, {"kind": "tuple", "items": [2, 6]}]})");

      // ---- MAP TESTS ---- //
      std::cout << "unordered_map -> map\n";
      check("empty", serialize(std::unordered_map<int, int>{}, ctx),
            R"({"kind": "map", "entries": []})");
      check("one entry is a raw [key, value]", serialize(std::unordered_map<int, int>{{2, 0}}, ctx),
            R"({"kind": "map", "entries": [[2, 0]]})");
      check("string key quoted", serialize(std::unordered_map<std::string, int>{{"a", 1}}, ctx),
            R"({"kind": "map", "entries": [["a", 1]]})");
      check("array value", serialize(std::unordered_map<std::string, std::vector<std::string>>{{"eat", {"eat", "tea"}}}, ctx),
            R"({"kind": "map", "entries": [["eat", {"kind": "array", "items": ["eat", "tea"]}]]})");
      check("tagged int key", serialize(std::unordered_map<long long, int>{{9007199254740993LL, 1}}, ctx),
            R"({"kind": "map", "entries": [[{"kind": "int", "value": "9007199254740993"}, 1]]})");

      // Order is unspecified for several entries, so check each piece instead.
      const std::string two = serialize(std::unordered_map<int, int>{{2, 0}, {7, 1}}, ctx);
      check_contains("two entries: opening", two, R"({"kind": "map", "entries": [[)");
      check_contains("two entries: [2, 0]", two, R"([2, 0])");
      check_contains("two entries: [7, 1]", two, R"([7, 1])");
      check_contains("two entries: separator", two, R"(], [)");
      check("two entries: no trailing comma", two.substr(two.size() - 3), R"(]]})");

      // ---- TUPLE TESTS TESTS ---- //
      std::cout << "tuple\n";
      check("empty tuple", serialize(std::tuple<>{}, ctx), R"({"kind": "tuple", "items": []})");
      check("mixed types", serialize(std::tuple<int, std::string, bool>{1, "a", true}, ctx),
            R"({"kind": "tuple", "items": [1, "a", true]})");
      check("NaN inside", serialize(std::tuple<int, double>{1, nan}, ctx),
            R"({"kind": "tuple", "items": [1, {"kind": "float", "value": "NaN"}]})");
      check("array of tuples", serialize(std::vector<std::tuple<int, int>>{{1, 2}}, ctx),
            R"({"kind": "array", "items": [{"kind": "tuple", "items": [1, 2]}]})");

      // ---- SET TESTS ---- //
      std::cout << "set\n";
      check("empty set", serialize(std::set<int>{}, ctx), R"({"kind": "set", "items": []})");
      check("std::set is sorted", serialize(std::set<int>{3, 1, 2}, ctx), R"({"kind": "set", "items": [1, 2, 3]})");
      check("duplicates collapse", serialize(std::set<int>{2, 2}, ctx), R"({"kind": "set", "items": [2]})");
      check("string set", serialize(std::set<std::string>{"b", "a"}, ctx), R"({"kind": "set", "items": ["a", "b"]})");
      check("unordered_set one item", serialize(std::unordered_set<int>{5}, ctx), R"({"kind": "set", "items": [5]})");
      const std::string uset = serialize(std::unordered_set<int>{4, 9}, ctx);
      check_contains("unordered_set: opening", uset, R"({"kind": "set", "items": [)");
      check_contains("unordered_set: 4", uset, "4");
      check_contains("unordered_set: 9", uset, "9");
      check_contains("unordered_set: separator", uset, ", ");

      // ---- MAP TESTS ---- //
      std::cout << "std::map -> map\n";
      check("empty map", serialize(std::map<int, int>{}, ctx), R"({"kind": "map", "entries": []})");
      check("std::map is key-sorted", serialize(std::map<int, int>{{2, 0}, {1, 5}}, ctx),
            R"({"kind": "map", "entries": [[1, 5], [2, 0]]})");
      check("map of arrays", serialize(std::map<std::string, std::vector<int>>{{"a", {1}}}, ctx),
            R"({"kind": "map", "entries": [["a", {"kind": "array", "items": [1]}]]})");

      std::cout << "custom comparators and hashes\n";
      check("set with greater<int> keeps its order", serialize(std::set<int, std::greater<int>>{1, 2, 3}, ctx), R"({"kind": "set", "items": [3, 2, 1]})");
      check("set with transparent less<>", serialize(std::set<int, std::less<>>{2, 1}, ctx), R"({"kind": "set", "items": [1, 2]})");
      check("map with greater<int> keeps its order", serialize(std::map<int, int, std::greater<int>>{{1, 0}, {2, 5}}, ctx), R"({"kind": "map", "entries": [[2, 5], [1, 0]]})");

      std::unordered_set<std::pair<int, int>, PairHash> seen;
      seen.insert({1, 2});
      check("unordered_set with a custom hash", serialize(seen, ctx), R"({"kind": "set", "items": [{"kind": "tuple", "items": [1, 2]}]})");

      std::unordered_map<std::pair<int, int>, int, PairHash> dist;
      dist[{0, 1}] = 5;
      check("unordered_map with a custom hash", serialize(dist, ctx), R"({"kind": "map", "entries": [[{"kind": "tuple", "items": [0, 1]}, 5]]})");

      // ---- DEQUE TESTS ---- //
      std::cout << "deque\n";
      check("empty deque", serialize(std::deque<int>{}, ctx), R"({"kind": "deque", "items": []})");
      check("front to back", serialize(std::deque<int>{1, 2, 3}, ctx), R"({"kind": "deque", "items": [1, 2, 3]})");

      // ---- STACK TESTS ---- //
      std::cout << "stack (bottom to top)\n";
      check("empty stack", serialize(std::stack<int>{}, ctx), R"({"kind": "stack", "items": []})");
      std::stack<int> st;
      st.push(1); st.push(2); st.push(3);
      check("pushes 1 2 3", serialize(st, ctx), R"({"kind": "stack", "items": [1, 2, 3]})");
      st.pop();
      check("after pop", serialize(st, ctx), R"({"kind": "stack", "items": [1, 2]})");
      std::stack<int, std::vector<int>> vst;
      vst.push(7); vst.push(8);
      check("vector-backed stack", serialize(vst, ctx), R"({"kind": "stack", "items": [7, 8]})");

      // ---- QUEUE TESTS ---- //
      std::cout << "queue (front to back)\n";
      check("empty queue", serialize(std::queue<int>{}, ctx), R"({"kind": "queue", "items": []})");
      std::queue<int> q;
      q.push(1); q.push(2); q.push(3);
      check("pushes 1 2 3", serialize(q, ctx), R"({"kind": "queue", "items": [1, 2, 3]})");
      q.pop();
      check("after pop", serialize(q, ctx), R"({"kind": "queue", "items": [2, 3]})");
      std::queue<int, std::list<int>> lq;
      lq.push(4);
      check("list-backed queue", serialize(lq, ctx), R"({"kind": "queue", "items": [4]})");
      std::queue<std::pair<int, int>> bfs; // BFS shape: (row, col)
      bfs.push({0, 1});
      check("queue of pairs", serialize(bfs, ctx),
            R"({"kind": "queue", "items": [{"kind": "tuple", "items": [0, 1]}]})");

      // ---- PRIORITY QUEUE TESTS ---- //
      std::cout << "priority-queue (only items[0] and order are fixed)\n";
      check("empty", serialize(std::priority_queue<int>{}, ctx),
            R"({"kind": "priority-queue", "items": [], "order": "max"})");
      std::priority_queue<int> one;
      one.push(7);
      check("one item", serialize(one, ctx), R"({"kind": "priority-queue", "items": [7], "order": "max"})");

      std::priority_queue<int> maxq;
      for (int x : {3, 1, 4, 1, 5}) maxq.push(x);
      const std::string maxj = serialize(maxq, ctx);
      check_contains("max: top first", maxj, R"({"kind": "priority-queue", "items": [5, )");
      check_contains("max: order", maxj, R"(], "order": "max"})");

      std::priority_queue<int, std::vector<int>, std::greater<int>> minq;
      for (int x : {3, 1, 4}) minq.push(x);
      const std::string minj = serialize(minq, ctx);
      check_contains("min: top first", minj, R"({"kind": "priority-queue", "items": [1, )");
      check_contains("min: order", minj, R"(], "order": "min"})");

      std::priority_queue<int, std::vector<int>, std::greater<>> tminq;
      tminq.push(2);
      check("std::greater<> is min", serialize(tminq, ctx),
            R"({"kind": "priority-queue", "items": [2], "order": "min"})");

      std::cout << "optional (value or null)\n";
      check("holds an int", serialize(std::optional<int>{5}, ctx), R"(5)");
      check("empty is bare null", serialize(std::optional<int>{}, ctx), R"(null)");
      check("holds a string", serialize(std::optional<std::string>{"hi"}, ctx), R"("hi")");
      check("holds a vector", serialize(std::optional<std::vector<int>>(std::vector<int>{1, 2}), ctx),
            R"({"kind": "array", "items": [1, 2]})");
      check("array of optionals", serialize(std::vector<std::optional<int>>{1, std::nullopt}, ctx),
            R"({"kind": "array", "items": [1, null]})");

      std::cout << "multiset and multimap\n";
      check("multiset keeps repeats in order", serialize(std::multiset<int>{3, 1, 1}, ctx),
            R"({"kind": "multiset", "items": [1, 1, 3]})");
      check("multiset with greater<int>", serialize(std::multiset<int, std::greater<int>>{1, 3, 1}, ctx),
            R"({"kind": "multiset", "items": [3, 1, 1]})");
      check("empty multiset", serialize(std::multiset<int>{}, ctx), R"({"kind": "multiset", "items": []})");
      check("multimap keeps repeated keys", serialize(std::multimap<int, char>{{2, 'x'}, {1, 'a'}, {1, 'b'}}, ctx),
            R"({"kind": "multimap", "entries": [[1, "a"], [1, "b"], [2, "x"]]})");
      check("unordered_multiset with one value", serialize(std::unordered_multiset<int>{4, 4}, ctx),
            R"({"kind": "multiset", "items": [4, 4]})");
      const std::string umm = serialize(std::unordered_multimap<int, char>{{1, 'a'}, {1, 'b'}}, ctx);
      check_contains("unordered_multimap: kind", umm, R"({"kind": "multimap", "entries": [)");
      check_contains("unordered_multimap: [1, a]", umm, R"([1, "a"])");
      check_contains("unordered_multimap: [1, b]", umm, R"([1, "b"])");

      // ---- BITSET TESTS ---- //
      std::cout << "bitset -> array of bools (index order)\n";
      std::bitset<4> bits;
      bits[1] = true;
      check("bit 1 set: index order, not to_string order", serialize(bits, ctx),
            R"({"kind": "array", "items": [false, true, false, false]})");
      check("all clear", serialize(std::bitset<3>{}, ctx), R"({"kind": "array", "items": [false, false, false]})");
      check("from a string", serialize(std::bitset<3>("110"), ctx), R"({"kind": "array", "items": [false, true, true]})");
      check("empty bitset", serialize(std::bitset<0>{}, ctx), R"({"kind": "array", "items": []})");

      auto by_desc = [](int a, int b) { return a > b; };
      std::priority_queue<int, std::vector<int>, decltype(by_desc)> lamq(by_desc);
      lamq.push(2);
      check("lambda is custom", serialize(lamq, ctx),
            R"({"kind": "priority-queue", "items": [2], "order": "custom"})");

      std::cout << "\n"
                << passed << " passed, " << failed << " failed\n";
      return failed == 0 ? 0 : 1;
}