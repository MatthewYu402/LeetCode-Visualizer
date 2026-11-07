#pragma once
#include <string>
#include <vector>
#include <array>
#include <list>
#include <forward_list>
#include <map>
#include <unordered_map>
#include <cstdint>
#include <concepts>
#include <set>
#include <cmath>
#include <format>
#include <charconv>
#include <utility>
#include <stdexcept>
#include <ranges>

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

  // The biggest integer that JS can handle: 2^53 - 1
  inline constexpr i64 POS_BIG_INT = 9007199254740991;
  inline constexpr i64 NEG_BIG_INT = -9007199254740991;

  using Json = std::string;                 // Maybe change, keep for now
  using Heap = std::map<std::string, Json>; // "n1 -> {"kind": object, "type": "TreeNode", ...}"

  struct Tracer {
    std::unordered_map<const void *, std::string> id_table; // address -> "n1"; "have I seen this before?"
    static constexpr i64 max_steps = 2000;
    i64 step = 0;
    bool truncated = false;
  };

  struct Ctx {
    std::unordered_map<const void *, std::string> &id_table;
    Heap &heap;
  };

  // --- Helper functions for printing trace format --- //
  // Characters that need escape symbol
  inline std::string escape(const std::string &str) {
    std::string result = "";

    const char *hex_digits = "0123456789abcdef";

    for (char c : str) {
      unsigned char uc = static_cast<unsigned char>(c);
      switch (uc) {
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

  // Add surrounding quotes
  inline std::string quote(const std::string& str) { return std::string(1, '"') + escape(str) + '"'; }

  // For array-style printing
  template <typename Range> Json write_items(const std::string& kind, const Range& range, Ctx& ctx) {
    std::string result = std::format(R"({{"kind": {}, "items": [)", quote(kind));

    bool first = true;
    for (const auto &item : range) {
      if (!first) {
        result += ", ";
      }
      const std::ranges::range_value_t<Range>& value = item;
      first = false;
      result += serialize(value, ctx);
    }

    result += "]}";
    return result;
  }

  template <typename> inline constexpr bool always_false = false;

  // ---- Struct dispatch: find which type to serialize and write to Json ----
  template <typename T> struct Serializer {
    static_assert(always_false<T>, "trace: no Serializer for this type");
  }; // Primary

  // Calls the corresponding write function for a given type to serialize to Json
  template <typename T> Json serialize(const T& v, Ctx& ctx) { return Serializer<T>::write(v, ctx); } // the only function

  // bool
  template <> struct Serializer<bool> {
    static Json write(const bool& value, Ctx&) {
      return value ? "true" : "false";
    }
  };

  // char
  template <> struct Serializer<char> {
    static Json write(const char& c, Ctx&) {
      return quote(std::string(1, c));
    }
  };

  // const char* - for string literals
  template <> struct Serializer<const char *> {
    static Json write(const char* str, Ctx&) {
      if (str == nullptr) return "null";
      return quote(str);
    }
  };

  // char* - for mutable character arrays/buffers
  template <> struct Serializer<char *> {
    static Json write(const char* str, Ctx&) {
      if (str == nullptr) return "null";
      return quote(str);
    }
  };

  // char[N]
  template <std::size_t N> struct Serializer<char[N]> {
    static Json write(const char (&str)[N], Ctx &) {
      // Undefined Behavior: quote builds std::string from pointer using strlen.
      // E.g. char raw[3] = {'a', 'b', 'c'} there's no null terminating character
      // Solution: bound it by N
      std::string result;
      for (std::size_t i = 0; i < N; ++i) {
        if (str[i] == '\0') break;
        result += str[i];
      }
      return quote(result);
    }
  };

  // std::string
  template <> struct Serializer<std::string> {
    static Json write(const std::string& str, Ctx &) {
      return quote(str);
    }
  };

  // integral types - int, long, long long, etc
  template <std::integral T> struct Serializer<T> {
    static Json write(const T& value, Ctx&) {
      if (std::cmp_greater(value, POS_BIG_INT) || std::cmp_less(value, NEG_BIG_INT)) {
        return std::format(R"({{"kind": "int", "value": "{}"}})", value);
      }
      return std::to_string(value);
    }
  };

  // floating point types - float, double, long double, etc.
  template <std::floating_point T> struct Serializer<T> {
    static Json write(const T& value, Ctx&) {
      if (std::isnan(value)) {
        return R"({"kind": "float", "value": "NaN"})";
      }

      if (std::isinf(value) && value > 0.0) {
        return R"({"kind": "float", "value": "Infinity"})";
      } else if (std::isinf(value) && value < 0.0) {
        return R"({"kind": "float", "value": "-Infinity"})";
      }

      // 1. Initialize the buffer
      char buffer[64];

      // 2. Compute the shortest round-trip representation (best for JSON).
      auto [ptr, ec] = std::to_chars(buffer, buffer + sizeof(buffer), value);

      // 3. Return the string segment on success.
      if (ec == std::errc()) {
        return Json(buffer, ptr - buffer);
      }

      // If std::to_chars fails
      throw std::runtime_error("Failed to serialize floating point value via std::to_chars");
    }
  };

  // T[N] - C-type arrays
  template <typename T, std::size_t N> struct Serializer<T[N]> {
    static Json write(const T(&arr)[N], Ctx& ctx) {
      std::string kind = "array";
      return write_items(kind, arr, ctx);
    }
  };

  // std::array
  template <typename T, std::size_t N> struct Serializer<std::array<T, N>> {
    static Json write(const std::array<T, N>& arr, Ctx& ctx) {
      std::string kind = "array";
      return write_items(kind, arr, ctx);
    }
  };

  // std::vector<T>
  template <typename T> struct Serializer<std::vector<T>> {
    static Json write(const std::vector<T>& vec, Ctx& ctx) {
      std::string kind = "array";
      return write_items(kind, vec, ctx);
    }
  };

  // std::list
  template <typename T> struct Serializer<std::list<T>> {
    static Json write(const std::list<T>& li, Ctx& ctx) {
      std::string kind = "list";
      return write_items(kind, li, ctx);
    }
  };

  // std::forward_list
  template <typename T> struct Serializer<std::forward_list<T>> {
    static Json write(const std::forward_list<T>& li, Ctx& ctx) {
      std::string kind = "list";
      return write_items(kind, li, ctx);
    }
  };

  // std::pair<K, V>
  template <typename K, typename V> struct Serializer<std::pair<K, V>> {
    static Json write(const std::pair<K, V>& val_pair, Ctx &ctx) {
      return std::format(R"({{"kind": "tuple", "items": [{}, {}]}})", serialize(val_pair.first, ctx), serialize(val_pair.second, ctx));
    }
  };

  // unordered_map <K, V>
  template <typename K, typename V> struct Serializer<std::unordered_map<K, V>> {
    static Json write(const std::unordered_map<K, V>& umap, Ctx& ctx) {
      std::string result = R"({"kind": "map", "entries": [)";

      // For every pair, build the [p1, p2], entries
      bool first = true;
      for (const auto& elem : umap) {
        if (!first) {
          result += ", ";
        }
        first = false;
        result += std::format(R"([{}, {}])", serialize(elem.first, ctx), serialize(elem.second, ctx));
      }

      result += "]}";
      return result;
    }
  };

}