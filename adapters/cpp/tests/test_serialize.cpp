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
//   {"kind": "list", "items": [1, 2]}         ", " between items
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

  std::cout << "bool\n";
  check("true", serialize(true, ctx), R"(true)");
  check("false", serialize(false, ctx), R"(false)");

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

  std::cout << "char\n";
  check("letter", serialize('a', ctx), R"("a")");
  check("double quote", serialize('"', ctx), R"("\"")");
  check("backslash", serialize('\\', ctx), R"("\\")");
  check("newline", serialize('\n', ctx), R"("\n")");

  std::cout << "C strings\n";
  check("literal", serialize("abc", ctx), R"("abc")"); // must not become true
  check("empty literal", serialize("", ctx), R"("")");
  const char *str_ptr = "xyz";
  check("const char*", serialize(str_ptr, ctx), R"("xyz")");
  const char *null_str = nullptr;
  check("null pointer", serialize(null_str, ctx), R"(null)");
  char buffer[8] = "hi"; // spare capacity: stops at the first NUL
  check("char array buffer", serialize(buffer, ctx), R"("hi")");

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

  std::cout << "vector -> list\n";
  check("empty", serialize(std::vector<int>{}, ctx), R"({"kind": "list", "items": []})");
  check("one item", serialize(std::vector<int>{7}, ctx), R"({"kind": "list", "items": [7]})");
  check("several (no trailing comma)", serialize(std::vector<int>{2, 7, 11, 15}, ctx),
        R"({"kind": "list", "items": [2, 7, 11, 15]})");
  check("strings are quoted", serialize(std::vector<std::string>{"a", "b"}, ctx),
        R"({"kind": "list", "items": ["a", "b"]})");
  check("chars are strings", serialize(std::vector<char>{'x', 'y'}, ctx),
        R"({"kind": "list", "items": ["x", "y"]})");
  check("vector<bool>", serialize(std::vector<bool>{true, false}, ctx),
        R"({"kind": "list", "items": [true, false]})");
  check("doubles keep fractions", serialize(std::vector<double>{0.5, 2.5}, ctx),
        R"({"kind": "list", "items": [0.5, 2.5]})");
  check("mixed bare and tagged int", serialize(std::vector<long long>{3, 9007199254740993LL, -1}, ctx),
        R"({"kind": "list", "items": [3, {"kind": "int", "value": "9007199254740993"}, -1]})");
  check("NaN inside a list", serialize(std::vector<double>{0.5, nan}, ctx),
        R"({"kind": "list", "items": [0.5, {"kind": "float", "value": "NaN"}]})");
  check("nested (grid)", serialize(std::vector<std::vector<int>>{{1, 0}, {0, 1}}, ctx),
        R"({"kind": "list", "items": [{"kind": "list", "items": [1, 0]}, {"kind": "list", "items": [0, 1]}]})");
  check("nested empty", serialize(std::vector<std::vector<int>>{{}}, ctx),
        R"({"kind": "list", "items": [{"kind": "list", "items": []}]})");

  std::cout << "pair -> list\n";
  check("int pair", serialize(std::pair<int, int>{1, 2}, ctx),
        R"({"kind": "list", "items": [1, 2]})");
  check("string member quoted", serialize(std::pair<int, std::string>{1, "a"}, ctx),
        R"({"kind": "list", "items": [1, "a"]})");

  std::cout << "unordered_map -> map\n";
  check("empty", serialize(std::unordered_map<int, int>{}, ctx),
        R"({"kind": "map", "entries": []})");
  check("one entry is a raw [key, value]", serialize(std::unordered_map<int, int>{{2, 0}}, ctx),
        R"({"kind": "map", "entries": [[2, 0]]})");
  check("string key quoted", serialize(std::unordered_map<std::string, int>{{"a", 1}}, ctx),
        R"({"kind": "map", "entries": [["a", 1]]})");
  check("list value", serialize(std::unordered_map<std::string, std::vector<std::string>>{{"eat", {"eat", "tea"}}}, ctx),
        R"({"kind": "map", "entries": [["eat", {"kind": "list", "items": ["eat", "tea"]}]]})");
  check("tagged int key", serialize(std::unordered_map<long long, int>{{9007199254740993LL, 1}}, ctx),
        R"({"kind": "map", "entries": [[{"kind": "int", "value": "9007199254740993"}, 1]]})");

  // Order is unspecified for several entries, so check each piece instead.
  const std::string two = serialize(std::unordered_map<int, int>{{2, 0}, {7, 1}}, ctx);
  check_contains("two entries: opening", two, R"({"kind": "map", "entries": [[)");
  check_contains("two entries: [2, 0]", two, R"([2, 0])");
  check_contains("two entries: [7, 1]", two, R"([7, 1])");
  check_contains("two entries: separator", two, R"(], [)");
  check("two entries: no trailing comma", two.substr(two.size() - 3), R"(]]})");

  std::cout << "\n"
            << passed << " passed, " << failed << " failed\n";
  return failed == 0 ? 0 : 1;
}