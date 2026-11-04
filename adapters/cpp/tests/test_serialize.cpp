// Tests for trace::serialize on primitive types.
//
// Build and run from the repository root:
//   clang++ -std=c++20 -Wall -Wextra -Wpedantic -I adapters/cpp/runtime
//       adapters/cpp/tests/test_serialize.cpp -o /tmp/test_serialize
//   /tmp/test_serialize
//
// Each check compares the exact characters serialize() produces with the
// expected JSON text. On failure it prints both, so escaping mistakes are
// easy to spot. The exit code is nonzero if any check fails.

#include "trace.hpp"

#include <climits>
#include <cstdint>
#include <iostream>
#include <string>

namespace {

int passed = 0;
int failed = 0;

// `expected` is written as a C++ raw string literal R"(...)" in the checks
// below, so what you see between the parentheses is exactly the JSON text,
// with no C++ escaping layered on top.
void check(const std::string& name, const std::string& actual, const std::string& expected) {
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

}  // namespace

int main() {
  using namespace trace;

  std::cout << "bool\n";
  check("true",  serialize(true),  R"(true)");
  check("false", serialize(false), R"(false)");

  std::cout << "integers\n";
  check("int",                serialize(42),           R"(42)");
  check("negative int",       serialize(-7),           R"(-7)");
  check("short (promotes)",   serialize(short{3}),     R"(3)");
  check("long long",          serialize(5LL),          R"(5)");
  check("unsigned",           serialize(5u),           R"(5)");
  check("i8 is a number",     serialize(i8{65}),       R"(65)");  // signed char, not char
  check("u8 is a number",     serialize(u8{200}),      R"(200)");
  check("i64 min",            serialize(i64{LLONG_MIN}), R"(-9223372036854775808)");
  check("u64 max",            serialize(u64{ULLONG_MAX}), R"(18446744073709551615)");

  std::cout << "char\n";
  check("letter",             serialize('a'),  R"("a")");
  check("double quote",       serialize('"'),  R"("\"")");
  check("backslash",          serialize('\\'), R"("\\")");
  check("newline",            serialize('\n'), R"("\n")");

  std::cout << "C strings\n";
  check("literal",            serialize("abc"),  R"("abc")");  // must not become true
  check("empty literal",      serialize(""),     R"("")");
  const char* null_str = nullptr;
  check("null pointer",       serialize(null_str), R"(null)");

  std::cout << "std::string\n";
  check("plain",              serialize(std::string("abc")),          R"("abc")");
  check("empty",              serialize(std::string("")),             R"("")");
  check("embedded quotes",    serialize(std::string("say \"hi\"")),   R"("say \"hi\"")");
  check("backslash",          serialize(std::string("a\\b")),         R"("a\\b")");
  check("newline",            serialize(std::string("a\nb")),         R"("a\nb")");
  check("tab",                serialize(std::string("a\tb")),         R"("a\tb")");
  check("short escapes",      serialize(std::string("\b\f\r")),       R"("\b\f\r")");
  check("vertical tab",       serialize(std::string("a\vb")),         R"("a\u000bb")");
  check("bell",               serialize(std::string("\a")),           R"("\u0007")");
  check("escape (0x1b)",      serialize(std::string("\x1b")),         R"("\u001b")");
  check("unit sep (0x1f)",    serialize(std::string("\x1f")),         R"("\u001f")");
  check("embedded NUL",       serialize(std::string("a\0b", 3)),      R"("a\u0000b")");
  check("space (0x20) as-is", serialize(std::string(" ")),            R"(" ")");
  check("UTF-8 passes through", serialize(std::string("caf\xc3\xa9")), "\"caf\xc3\xa9\"");

  std::cout << "\n" << passed << " passed, " << failed << " failed\n";
  return failed == 0 ? 0 : 1;
}