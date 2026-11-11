#pragma once
// trace.hpp: the C++ adapter's runtime. Header only
//
// Layout (each section only uses what is above it):
//  1. Basic Aliases and constants
//  2. Core types: Json, Heap, IdTable, Ctx
//  3. Dispatch: the primary Serializer and serialize(), declared before any use
//  4. Json  text helpers: escape, quote
//  5. Writing helpers shared by several serializers
//  6. Serializers, grouped by kind
//  7. The recorder: Tracer, Value, var, record (uses everything above)

// Strings and text
#include <format>
#include <charconv>
#include <string>
#include <string_view>

// Containers
#include <array>
#include <bitset>
#include <deque>
#include <forward_list>
#include <list>
#include <map>
#include <optional>
#include <queue>
#include <set>
#include <stack>
#include <tuple>
#include <unordered_set>
#include <unordered_map>
#include <vector>

// Language support
#include <concepts>
#include <cmath>
#include <cstddef>
#include <cstdint>
#include <functional>
#include <ranges>
#include <utility>
#include <stdexcept>

// IO
#include <iostream>
#include <fstream>
#include <cstdio>
#include <cstdlib>

namespace trace {

  // ======================================================================
  // 1. Basic aliases and constants
  // ======================================================================
  
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

  // Version and Language
  inline constexpr const char* LANGUAGE {"cpp"} ;
  inline constexpr const char* VERSION  {"0.4"} ;

  // The largest integers a JavaScript number exactly holds: +-(2^53 - 1)
  inline constexpr i64 POS_BIG_INT = 9007199254740991;
  inline constexpr i64 NEG_BIG_INT = -9007199254740991;

  // ======================================================================
  // 2. Core types
  // ======================================================================

  using Json = std::string; 
  
  // id -> finished JSON of the object at this step, e.g. "n1" -> {"kind": object, "type": TreeNode, ...}.
  // One per step
  using Heap = std::map<std::string, Json>;

  // address -> id ("n1"). Answers "have I seen this object before?" for the whole run.
  // The address is only a lookup key. It is never dereferenced and never emitted.
  using IdTable = std::unordered_map<const void*, std::string>;

  // What every serializer received: the run-liong id table and this step's heap.
  // Owns nothing: both members are references
  struct Ctx {
    IdTable& id_table;
    Heap &heap;
  };

  // ======================================================================
  // 3. Dispatch
  // ======================================================================
  // Declared before the helpers and serializers, so every serialize() call
  // below finds it by ordinary lookup instead of relying on ADL

  template <typename> inline constexpr bool always_false = false;

  // Primary template: any type without a specialization fails to compile here
  template <typename T> struct Serializer {
    static_assert(always_false<T>, "trace: no Serializer for this type");
  };

  // The front foor. Every serializer recurses through this, never through Serializer<T> directly.
  template <typename T> Json serialize(const T& v, Ctx& ctx) { return Serializer<T>::write(v, ctx); } 

  // ======================================================================
  // 4. JSON text helpers
  // ======================================================================
  
  // Escapes a string for use inside JSON quotes
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

  // Escapes and adds surrounding quotes
  inline std::string quote(const std::string& str) { return std::string(1, '"') + escape(str) + '"'; }

  // ======================================================================
  // 5. Writing helpers
  // ======================================================================
  
  // {"kind": <kind> "items": [...]} for anything you can range-for over
  template <typename Range> 
  Json write_items(const std::string& kind, const Range& container, Ctx& ctx) {
    std::string result = std::format(R"({{"kind": {}, "items": [)", quote(kind));

    bool first = true;
    for (const auto &item : container) {
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

  // {"kind": <kind>, "entries": [[key, value], ...]} for map-like entries
  template<typename Map> 
  Json write_entries(const std::string& kind, const Map& container, Ctx& ctx) {
    std::string result = std::format(R"({{"kind": {}, "entries": [)", quote(kind));
    // For every pair, build the [p1, p2], entries
    bool first = true;
    for (const auto& elem : container) {
      if (!first) {
        result += ", ";
      }
      first = false;
      result += std::format(R"([{}, {}])", serialize(elem.first, ctx), serialize(elem.second, ctx));
    }

    result += "]}";
    return result;
  }
  
  // {"kind": "tuple", "items": [...]}. Tuples have no iteratrs, so unpack with std:;apply
  template<typename... Args>
  Json write_tuple(const std::tuple<Args...>& t, Ctx& ctx) {
    std::string result = R"({"kind": "tuple", "items": [)";

    bool first = true;
    // unpack the tuple into lambda's parameters (args...)
    std::apply([&ctx, &result, &first](const auto&... args) {
      // Fold expressions using comma operator to append each serialized item from a comma separator
      ((result += (first ? "" : ", "), result += serialize(args, ctx), first = false), ...);
    }, t);

    result += "]}";
    return result;
  }

  // Reads the protected container 'c' inside stack, queue, and priority_queue.
  // A local subclass may name the protected membet; resing it though
  // a pointer-to-member needs no case.
  template<typename Adapter>
  const typename Adapter::container_type& get_container(const Adapter& adapter) {
    struct accessor : Adapter {
      static const auto& get(const Adapter& a) {
        return a.*(&accessor::c);
      }
    };
    return accessor::get(adapter);
  }

  // A priority_queue comparator's "order" field.
  template<typename Compare>
  struct comparator_name {
    static constexpr std::string_view get() { return "custom"; }
  };
  // Specialization for std::less (max-heap)
  template<typename T>
  struct comparator_name<std::less<T>> {
    static constexpr std::string_view get() { return "max"; }
  };
  // Specialization for std::greater (min-heap)
  template<typename T>
  struct comparator_name<std::greater<T>> {
    static constexpr std::string_view get() { return "min"; }
  };

  // ======================================================================
  // 6. Serializers
  // ======================================================================

  // ---- 6a. Primitives ----
  
  template <> struct Serializer<bool> {
    static Json write(const bool& value, Ctx&) { return value ? "true" : "false"; }
  };

  // Plain char is text. signed char and unsigned char (i8, u8) are numbers via the integral case.
  template <> struct Serializer<char> {
    static Json write(const char& c, Ctx&) { return quote(std::string(1, c)); }
  };

  // Integers: bare when JavaScript reads them exactly, tagged otherwise.
  // bool and char are integral too, but their explicit specializations above win.
  template <std::integral T> struct Serializer<T> {
    static Json write(const T& value, Ctx&) {
      if (std::cmp_greater(value, POS_BIG_INT) || std::cmp_less(value, NEG_BIG_INT)) {
        return std::format(R"({{"kind": "int", "value": "{}"}})", value);
      }
      return std::to_string(value);
    }
  };

  // Floats: NaN and infinities are tagged; finite values use the shortest round-trip text.
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

  // ---- 6b. Strings ----

  template <> struct Serializer<std::string> {
    static Json write(const std::string& str, Ctx &) { return quote(str); }
  };

  template<> struct Serializer<std::string_view> {
    static Json write(const std::string_view sv, Ctx&) { return quote(std::string{sv}); }
  };

  // C strings. A null pointer is "no value" so it is bare null.  
  template <> struct Serializer<const char *> {
    static Json write(const char* str, Ctx&) { if (str == nullptr) return "null"; return quote(str); }
  };

  template <> struct Serializer<char *> {
    static Json write(const char* str, Ctx&) { if (str == nullptr) return "null"; return quote(str); }
  };

  // Undefined Behavior: quote builds std::string from pointer using strlen.
  // E.g. char raw[3] = {'a', 'b', 'c'} there's no null terminating character
  // Solution: bound it by N
  template <std::size_t N> struct Serializer<char[N]> {
    static Json write(const char (&str)[N], Ctx &) {
      std::string result;
      for (std::size_t i = 0; i < N; ++i) {
        if (str[i] == '\0') break;
        result += str[i];
      }
      return quote(result);
    }
  };

  // ---- 6c. Indexed Sequences -> array ----
  
  // C-style array
  template <typename T, std::size_t N> struct Serializer<T[N]> {
    static Json write(const T(&arr)[N], Ctx& ctx) { return write_items("array", arr, ctx); }
  };

  template <typename T, std::size_t N> struct Serializer<std::array<T, N>> {
    static Json write(const std::array<T, N>& arr, Ctx& ctx) { return write_items("array", arr, ctx); }
  };

  template <typename T, typename Allocator> struct Serializer<std::vector<T, Allocator>> {
    static Json write(const std::vector<T, Allocator>& vec, Ctx& ctx) { return write_items("array", vec, ctx); }
  };

  template<std::size_t Size> struct Serializer<std::bitset<Size>> {
    static Json write(const std::bitset<Size>& bs, Ctx&) {
      std::string json_object = R"({"kind": "array", "items": [)";

      bool first = true;
      for (std::size_t i = 0; i < bs.size(); ++i) {
        if (!first) {
          json_object += ", ";
        }
        first = false;
        json_object += bs[i] ? "true" : "false";
      }

      json_object += "]}";
      return json_object;
    }
  };

  // ---- 6d. Node-based sequences -> list ----
  template <typename T, typename Allocator> struct Serializer<std::list<T, Allocator>> {
    static Json write(const std::list<T, Allocator>& li, Ctx& ctx) {
      return write_items("list", li, ctx);
    }
  };

  // std::forward_list
  template <typename T, typename Allocator> struct Serializer<std::forward_list<T, Allocator>> {
    static Json write(const std::forward_list<T, Allocator>& li, Ctx& ctx) {
      return write_items("list", li, ctx);
    }
  };

  // ---- 6e. Tuples ----
  template <typename K, typename V> struct Serializer<std::pair<K, V>> {
    static Json write(const std::pair<K, V>& val_pair, Ctx& ctx) {
      return std::format(R"({{"kind": "tuple", "items": [{}, {}]}})", serialize(val_pair.first, ctx), serialize(val_pair.second, ctx));
    }
  };

  template<typename... Ts> struct Serializer<std::tuple<Ts...>> {
    static Json write(const std::tuple<Ts...>& tuple, Ctx& ctx) {
      return write_tuple(tuple, ctx);
    }
  };

  // ---- 6f. Sets ----
  // Comparators and hashes only affect order, which is unspecified for set kinds.

  template<typename T, typename Compare, typename Allocator> 
  struct Serializer<std::set<T, Compare, Allocator>>{
    static Json write(const std::set<T, Compare, Allocator>& set, Ctx& ctx) {
      return write_items("set", set, ctx);
    }
  };

  template<typename T, typename Hash, typename KeyEqual, typename Allocator> 
  struct Serializer<std::unordered_set<T, Hash, KeyEqual, Allocator>>{
    static Json write(const std::unordered_set<T, Hash, KeyEqual, Allocator>& set, Ctx& ctx) {
      return write_items("set", set, ctx);
    }
  };

  template <typename T, typename Compare, typename Allocator>
  struct Serializer<std::multiset<T, Compare, Allocator>>{
    static Json write(const std::multiset<T, Compare, Allocator>& set, Ctx& ctx) {
      return write_items("multiset", set, ctx);
    }
  };

  template<typename T, typename Hash, typename KeyEqual, typename Allocator> 
  struct Serializer<std::unordered_multiset<T, Hash, KeyEqual, Allocator>>{
    static Json write(const std::unordered_multiset<T, Hash, KeyEqual, Allocator>& set, Ctx& ctx) {
      return write_items("multiset", set, ctx);
    }
  };

  // ---- 6g. Maps ----
  
  template <typename K, typename V, typename Compare, typename Allocator> 
  struct Serializer<std::map<K, V, Compare, Allocator>> {
    static Json write(const std::map<K, V, Compare, Allocator>& map, Ctx& ctx) {
      return write_entries("map", map, ctx);
    }
  };

  template <typename K, typename V, typename Hash, typename KeyEqual, typename Allocator> 
  struct Serializer<std::unordered_map<K, V, Hash, KeyEqual, Allocator>> {
    static Json write(const std::unordered_map<K, V, Hash, KeyEqual, Allocator>& map, Ctx& ctx) {
      return write_entries("map", map, ctx);
    }
  };

  template <typename K, typename V, typename Compare, typename Allocator> 
  struct Serializer<std::multimap<K, V, Compare, Allocator>> {
    static Json write(const std::multimap<K, V, Compare, Allocator>& map, Ctx& ctx) {
      return write_entries("multimap", map, ctx);
    }
  };

  template <typename K, typename V, typename Hash, typename KeyEqual, typename Allocator> 
  struct Serializer<std::unordered_multimap<K, V, Hash, KeyEqual, Allocator>> {
    static Json write(const std::unordered_multimap<K, V, Hash, KeyEqual, Allocator>& map, Ctx& ctx) {
      return write_entries("multimap", map, ctx);
    }
  };
  
  // ---- 6h. Containers adapters and deque ----

  template<typename T, typename Container> struct Serializer<std::stack<T, Container>> {
    static Json write(const std::stack<T, Container>& st, Ctx& ctx) {
      return write_items("stack", get_container(st), ctx);
    }
  };
  
  template<typename T, typename Container> struct Serializer<std::queue<T, Container>> {
    static Json write(const std::queue<T, Container>& q, Ctx& ctx) {
      return write_items("queue", get_container(q), ctx);
    }
  };

  template<typename T, typename Allocator> struct Serializer<std::deque<T, Allocator>> {
    static Json write(const std::deque<T, Allocator>& dq, Ctx& ctx) {
      return write_items("deque", dq, ctx);
    }
  };

  template<typename T, typename Container, typename Compare>
  struct Serializer<std::priority_queue<T, Container, Compare>> {
    static Json write(const std::priority_queue<T, Container, Compare>& pq, Ctx& ctx) {
      auto items_json = write_items("priority-queue", get_container(pq), ctx);
        
      // Inject order/comparator in the Json object
      std::string comp_str{comparator_name<Compare>::get()};
      items_json.pop_back(); // remove trailing '}'
      items_json += std::format(R"(, "order": {})", quote(comp_str));
      items_json += "}";

      return items_json;
    }
  };

  // ---- 6i. Wrappers

  // An empty optional is "no value", so bare null. A present one is written as its value.
  template<typename T>struct Serializer<std::optional<T>> {
    static Json write(const std::optional<T>& option, Ctx& ctx) {
      if (option == std::nullopt) return "null";
      return serialize(*option, ctx);
    }
  };

  // ======================================================================
  // 7. The Recorder
  // ======================================================================
  // Everything above is independent of the global state below, so the
  // serializer tests can build their own Ctx without a Tracer.

  // State for the whole run. One global instance
  struct Tracer {
    IdTable id_table;        // lives for the whole run, so ids stay stable across steps 
    std::vector<Json> steps; // finished step JSON; steps.size() is the next step index
    static constexpr std::size_t max_steps = 2000;
    bool truncated = false;
    std::string version {VERSION};
    std::string language {LANGUAGE};
    std::string problem;
    bool exit_at_cap = true;
    void begin(std::string problem_json) { problem = std::move(problem_json); }
  };

  inline Tracer tracer; // inline variable: exactly one instance, even across files
  
  // A variable's name plus a reference to its live value, for one record() call.
  // Holds a reference, not a copy: nothing is copied, and arrays keep their type.
  // Safe because the Value dies at the end of the record(...) call after serializing.
  template<typename T>
  struct Value {
    const char* name;
    const T& value;
  };

  template<typename T> Value<T> var(const char* name, const T& value) {
    return {name, value};
  } 
  
  // Where the trace goes: the TRACE_OUT environment variable, or trace.json
  // when it is unset or empty.
  inline std::string output_path() {
    const char* env_path = std::getenv("TRACE_OUT");
    if (env_path != nullptr && env_path[0] != '\0') return env_path;
    return "trace.json";
  }

  // Writes text to path atomically: write path + ".tmp", then rename it onto
  // path. A run killed mid-write leaves the old file or the new one, never
  // half of one. Returns 0 on success and 1 on failure.
  inline int write_file(const std::string& path, const Json& text) {
    const std::string tmp_path = path + ".tmp";

    std::ofstream out(tmp_path, std::ios::binary | std::ios::trunc);
    if (!out.is_open()) {
      std::cerr << "trace: cannot open " << tmp_path << " for writing\n";
      return 1;
    }

    // operator<< only fills a buffer. close() does the real write, so the
    // check comes after it and covers both.
    out << text;
    out.close();
    if (!out) {
      std::cerr << "trace: writing " << tmp_path << " failed\n";
      std::remove(tmp_path.c_str());
      return 1;
    }

    if (std::rename(tmp_path.c_str(), path.c_str()) != 0) {
      std::perror("trace: rename failed");
      std::remove(tmp_path.c_str());
      return 1;
    }

    return 0;
  }
  
  // Build the whole trace as a Json
  inline Json build_document(std::optional<Json> result) {
    // Append all of the steps joined with ", "
    std::string steps_trace = "[";
    bool first = true;
    for (const auto& step : tracer.steps) {
      if (!first) {
        steps_trace += ", ";
      }
      first = false;
      steps_trace += step;
    }
    steps_trace += "]";

    std::string full_trace = std::format(R"({{"version": {}, "language": {}, "problem": {}, "steps": {})",
      quote(tracer.version), quote(tracer.language), tracer.problem, steps_trace);

    if (result) {
      full_trace += R"(, "result": )" + (*result);
    }

    if (tracer.truncated) {
      full_trace += std::format(R"(, "truncated": {})", tracer.truncated);
    }

    full_trace += "}";

    return full_trace;
  }

  // Builds the document and writes it to the output path.
  //
  // Ends the program with exit code 1, and writes no file, in two cases:
  //  - begin() was never called, so there is no problem metadata. The document
  //    would contain `"problem": ,` which is not JSON, and a missing trace with
  //    a clear message is better than a broken one.
  //  - the file cannot be written.
  inline void write_document(const std::optional<Json>& result = std::nullopt) {
    if (tracer.problem.empty()) {
      std::cerr << "trace: no problem metadata. Call trace::tracer.begin(...) before the Solution runs.\n";
      std::exit(1);
    }

    if (write_file(output_path(), build_document(result)) != 0) {
      std::exit(1);
    }
  }

  // Records one pre-execution snapshot: the line about to run and the locals in scope.
  template<typename... Ts>
  void record(int line, const Value<Ts>&... vars) {
    if (tracer.truncated) return;
    if (tracer.steps.size() >= tracer.max_steps) {
      tracer.truncated = true;
      if (tracer.exit_at_cap) {
        write_document();
        std::exit(0);
      }
      return;
    }

    // This step's state: an empty heap, plus the run-long id table
    Heap heap{};
    Ctx ctx { .id_table = tracer.id_table, .heap = heap };

    // Locals: {"nums": ..., "target": ...}. Serializing is what fills the heap
    std::string locals = "{";
    bool first = true;
    ((
      locals += (first ? "" : ", ") + std::format(R"({}: {})", quote(vars.name), serialize(vars.value, ctx)),
      first = false
    ), ...);
    locals += "}";
    
    // Heap: {"n1": {...}, "n2": {...}}. The entires are already finished JSON
    std::string step_heap = "{";
    first = true;
    for (const auto &[id, json] : heap) {
      if (!first) {
        step_heap += ", ";
      }
      first = false;
      step_heap += quote(id) + ": " + json;
      
      // Query the heap instance directly using the address
    }
    step_heap += "}";

    tracer.steps.push_back(std::format(R"({{"step": {}, "line": {}, "locals": {}, "heap": {}}})",
      tracer.steps.size(), line, locals, step_heap));
  }
}