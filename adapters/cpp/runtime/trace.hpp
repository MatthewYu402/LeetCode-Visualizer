#pragma once
#include <string>
#include <vector>
#include <map>
#include <unordered_map>
#include <cstdint>
#include <concepts>

namespace trace {
  // Aliases for integer & float types
  using i8  = std::int8_t;
  using i16 = std::int16_t;
  using i32 = std::int32_t;
  using i64 = std::int64_t;
  using u8  = std::uint8_t;
  using u16 = std::uint16_t;
  using u32 = std::uint32_t;
  using u64 = std::uint64_t;

  using f32 = float;
  using f64 = double;

  using Json = std::string;                 // Maybe change, keep for now
  using Heap = std::map<std::string, Json>; // "n1 -> {"kind": object, "type": "TreeNode", ...}"

  struct Tracer {
    std::unordered_map<const void*, std::string> id_table; // address -> "n1"; "have I seen this before?"
    Heap step_heap; // per step: "have I serialized this object in this step?"
    static constexpr i64 max_steps = 2000;
    i64 step = 0;
    bool truncated = false;
  };

  // Helper for character that need escape symbol
  inline std::string escape(const std::string& str) {
    std::string result = "";

    const char *hex_digits = "0123456789abcdef";

    for (char c : str) {
      unsigned char uc = static_cast<unsigned char>(c);
      switch(uc) {
        case '\\': result += "\\\\"; break;
        case '"':  result += "\\\""; break;
        case '\b': result += "\\b";  break;
        case '\f': result += "\\f";  break;
        case '\n': result += "\\n";  break;
        case '\r': result += "\\r";  break;
        case '\t': result += "\\t";  break;
        default:   
          if (uc < 0x20) {
           result += "\\u00";
            result += hex_digits[(uc >> 4) & 0x0F];
            result += hex_digits[uc & 0x0F];
          } else {
           result += c;
          }
          break;
      }
    }
    return result;
  }

  // Helper to add a quote
  inline std::string quote(const std::string &str) { return std::string(1, '"') + escape(str) + '"'; }

  // ---- serialize overloading - compiler will choose ----
  inline Json serialize(bool value) { return value ? "true" : "false"; }
  inline Json serialize(char c) { return quote(std::string(1, c)); }
  inline Json serialize(const char* str) { if (str == nullptr) return "null"; return quote(str); }
  inline Json serialize(const std::string& str) { return quote(str);}

  template <std::integral T>
  Json serialize(T value) { return std::to_string(value); }
}
  






