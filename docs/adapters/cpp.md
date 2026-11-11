# C++ Adapter

> **Status:** Draft v0.2
> **Related:** [`trace-format.md`](../trace-format.md) (the contract), [`native-tracing.md`](../native-tracing.md) §4 (source instrumentation), [`adapters/cpp/runtime/trace.hpp`](../../adapters/cpp/runtime/trace.hpp) (the runtime), [`fixtures/two-sum.trace.json`](../../fixtures/two-sum.trace.json) (golden trace)

This document describes how the C++ adapter turns a running `Solution` into a trace: what one recorded step contains, how the runtime builds it, and why its state is split the way it is. It covers the runtime that exists today (the serializers, the recorder, and the document writer) and marks what is still planned.

---

## 1. Where the runtime sits

The C++ adapter uses source instrumentation ([`native-tracing.md` §4](../native-tracing.md#4-strategy-b-source-instrumentation)). C++ has no built-in hook that calls our code before each line, so we rewrite the user's code to call a recording function ourselves.

```
PREPARE   rewriter (planned)   inserts ::trace::record(...) before each statement
          driver   (planned)   appends main(): parse the example, call the Solution
          clang++ -std=c++20   compiles it with the header-only trace.hpp
RUN       each record(...)     serializes the locals into one finished step
          document writer      writes the whole trace to a file
AFTER     schema validation    outside the sandbox, then the frontend replays it
```

The runtime is one header, `adapters/cpp/runtime/trace.hpp`. Until the rewriter exists, the `record` calls are placed by hand.

## 2. What one step looks like

Every call to `record` produces exactly one step:

```json
{"step": 1, "line": 8, "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9, "numMap": {"kind": "map", "entries": []}, "i": 0}, "heap": {}}
```

| Field | Where it comes from |
|---|---|
| `step` | The number of steps already recorded, so steps count up from 0 with no gaps |
| `line` | The first argument of `record`: the line in the user's original source about to run |
| `locals` | One entry per `var(...)` argument |
| `heap` | Every object the locals point to, filled while the locals were serialized |

### 2.1 `locals`

`locals` maps variable names to values.

- **Keys** are the variable names exactly as written in the source. The rewriter copies them from the AST as string literals.
- **Values** are any value kind from the spec. An object (`TreeNode`, `ListNode`) never appears inline here. A local that points to one holds a `ref`, and the object itself goes in the heap.
- **Only variables already declared** before the line appear. Before line 9 of Two Sum (`int complement = ...`), `complement` does not exist yet, so it is absent. This is the pre-execution rule.
- **Parameters are locals too.** `nums` is a `vector<int>&`, and it is written as its value, not as a reference.
- **Order** follows the order of the `var(...)` arguments. Consumers must not depend on it, because JSON object order carries no meaning.
- **Variables with no serializer are left out** for now. Two Sum's `auto it` is an iterator, which has no kind yet, so the calls for lines 11, 16, and 12 do not pass it.

### 2.2 `heap`

`heap` maps ids to objects.

- **Keys** are ids: `"n1"`, `"n2"`, and so on. They are never addresses.
- **Values** are always `object` values: `{"kind": "object", "type": ..., "fields": {...}}`. Fields may hold `ref`s to other entries in the same heap.
- **It contains exactly the objects reachable from this step's locals**, each written once, with its contents at this moment.
- **It is empty (`{}`)** when no local points to an object, as in every Two Sum step.
- **Key order carries no meaning.** The runtime keeps the heap in a `std::map`, which sorts ids as strings (`n1`, `n10`, `n2`).

An illustrative step from a linked-list solution, where `head` points to the first node and `cur` to the second (pointer serializers are planned, Goal 4):

```json
{
  "step": 4,
  "line": 7,
  "locals": {
    "head": {"kind": "ref", "id": "n1"},
    "cur":  {"kind": "ref", "id": "n2"},
    "count": 1
  },
  "heap": {
    "n1": {"kind": "object", "type": "ListNode", "fields": {"val": 1, "next": {"kind": "ref", "id": "n2"}}},
    "n2": {"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": {"kind": "ref", "id": "n3"}}},
    "n3": {"kind": "object", "type": "ListNode", "fields": {"val": 3, "next": null}}
  }
}
```

Node `n2` is reached twice, through `cur` and through `n1.next`, but it appears in the heap once. Both places hold the same `ref`, so the frontend draws two arrows to one box.

## 3. Three lifetimes

Every piece of recorder state lives for exactly one of three lengths of time. Most design choices in the runtime follow from this table.

| Lifetime | What lives there | Why |
|---|---|---|
| **The whole run** | `Tracer`: the finished steps, the `truncated` flag, the `id_table`, the problem metadata | These facts must stay true from the first step to the last |
| **One step** | The `Heap`, and the `Ctx` that points to it | A step describes one moment, so its contents describe only that moment |
| **One `record` call** | Each `Value` returned by `var(...)` | It only needs to exist until it has been serialized |

> **Key insight 1: identity lasts the whole run, contents last one step.** The `id_table` records *who* an object is, which never changes. The heap records *what it looks like now*, which changes between steps. That is why they are two maps with two lifetimes.

### 3.1 `Tracer`: the whole run

One global instance, `trace::tracer`, declared `inline` so there is exactly one even if the header is included in several files. The code the rewriter inserts has to reach it from anywhere in the user's code.

- `steps` holds every finished step as JSON text. `steps.size()` is the next step's number, so the count and the steps cannot disagree.
- `truncated` records whether the step cap was hit.
- `id_table` maps address to id.
- `problem` holds the problem metadata as finished JSON. The driver sets it with `tracer.begin(...)` before the Solution runs (§7.1).
- `exit_at_cap` (default `true`) decides what `record` does at the step cap (§7.4). Only tests turn it off.

**Why `id_table` must outlive every step.** An id is a promise to the frontend that `n2` at step 3 and `n2` at step 40 are the same object. Take a list `a → b` with `head` pointing to `a`. At step 3, `a` is met first and becomes `n1`, and `b` becomes `n2`. The program runs `head = head->next`. If the table were reset, step 4 would meet `b` first and call it `n1`, and the frontend would conclude that node `n1` changed its value. With the table kept, `b` stays `n2`, and the frontend correctly sees `head` move from `n1` to `n2`.

### 3.2 `Heap`: one step

**Why the heap starts empty every step.** A pointer serializer asks "have I already written this object?" so that cycles terminate and shared objects are written once. That question is answered by looking in the heap. If the heap carried over, an object written at step 3 would be skipped at step 4, and a change such as `head->val = 5` would never show. An empty heap means "already written" really means "already written in this step", and it also keeps every step self-contained.

### 3.3 `Ctx`: two references in one parameter

`Ctx` is not a third table. Both of its members are references:

```cpp
struct Ctx {
  IdTable &id_table; // the Tracer's table
  Heap &heap;        // this step's heap
};
```

Serialization is recursive (a `vector<ListNode*>` serializes pointers, which serialize nodes, which serialize more pointers), and every level needs both maps. Passing one `Ctx` gives every serializer both without reading global state. That is why `test_serialize.cpp` can build its own `Ctx` and test every serializer with no `Tracer` at all.

### 3.4 Two questions per pointer (planned, Goal 4)

When pointer serializers arrive, each pointer goes through two lookups:

1. **`id_table`:** "Have I ever seen this address?" If not, assign the next id. The answer holds for the whole run.
2. **`heap`:** "Have I already written this object in this step?" If not, insert its entry **before** serializing its fields, then fill it in. The answer holds for this step only.

Inserting before recursing is what makes a cycle such as `a → b → a` terminate: the second visit to `a` finds it in the heap and returns a `ref`.

## 4. The recording API

The rewriter emits one call before each statement:

```cpp
::trace::record(9, ::trace::var("nums", nums), ::trace::var("target", target),
                ::trace::var("numMap", numMap), ::trace::var("i", i),
                ::trace::var("complement", complement));
```

| Piece | What it is |
|---|---|
| `var(name, value)` | Returns a `Value<T>`: the name (a `const char*` literal) and a `const T&` to the live variable |
| `record(line, vars...)` | A variadic function template that accepts only `Value`s and records one step |

### 4.1 What `record` does, in order

1. **Check the cap.** If already truncated, return. If `steps.size()` has reached 2,000, set `truncated`, write the trace, and end the program (§7.4).
2. **Start this step's state.** Create an empty `Heap`, and wrap it with `tracer.id_table` in a `Ctx`.
3. **Serialize the locals.** For each `Value`, write `"name": <serialize(value, ctx)>`. This is the only moment the live variables are read, and it is what fills the heap.
4. **Serialize the heap.** Write `"id": <json>` for each entry. This must come after step 3, because step 3 fills it.
5. **Store the step.** Push `{"step": N, "line": L, "locals": {...}, "heap": {...}}` onto `tracer.steps`.

When `record` returns, the `Value`s, the `Ctx`, and the heap are gone. Only the finished step and any new `id_table` entries remain.

> **Key insight 2: serialize at the call, store text.** A step holds finished JSON, never a reference to program state. A later mutation cannot reach back and change an earlier step.

### 4.2 Why `Value` holds a reference

- **No copies.** Each variable is serialized once and thrown away, so copying every container on every step would be wasted work.
- **Arrays keep their type.** A by-value parameter turns `int arr[5]` into `int*`, which has no serializer, and turns `char buf[8]` into `char*`, which loses the bounded read.
- **Addresses stay real.** Identity is taken from the address of the live object. A copy would have a new address on every call, and aliases would get different ids.

The reference is safe because the temporaries created by `var(...)` live until the end of the full expression, which is the whole `record(...)` call, and `record` serializes them before returning.

### 4.3 Why there are no macros

A function cannot learn the name of the variable passed to it. A macro (`V(x)` with `#x`) could, but the rewriter already knows every name from the AST, so it writes the names as string literals itself. This avoids two macro problems: macros ignore namespaces, and a short name like `V` collides with user code (graph solutions often name the vertex count `V`). The rewriter emits fully qualified names (`::trace::record`), so nothing in the user's code can shadow them.

The line number is passed explicitly rather than taken from `std::source_location`, because only the rewriter knows the line in the user's original source. `source_location` would report the line in the rewritten file.

## 5. Normalization: C++ types to kinds

| C++ type | Kind |
|---|---|
| `bool` | bare `true` / `false` |
| `char` | one-character string |
| integers (including `int8_t`, `uint8_t`) | bare number, or `int` outside ±(2^53 − 1) |
| `float`, `double`, `long double` | bare number, or `float` for NaN and ±Infinity |
| `std::string`, `std::string_view`, `const char*`, `char[N]` | string (a null `const char*` is `null`) |
| `T[N]`, `std::array`, `std::vector`, `std::bitset` | `array` (bitset: booleans in index order) |
| `std::list`, `std::forward_list` | `list` |
| `std::pair`, `std::tuple` | `tuple` |
| `std::set`, `std::unordered_set` | `set` |
| `std::multiset`, `std::unordered_multiset` | `multiset` |
| `std::map`, `std::unordered_map` | `map` |
| `std::multimap`, `std::unordered_multimap` | `multimap` |
| `std::stack` | `stack`, bottom to top |
| `std::queue` | `queue`, front to back |
| `std::deque` | `deque` |
| `std::priority_queue` | `priority-queue`, storage order, with `order` |
| `std::optional<T>` | `null` when empty, otherwise the value |
| `TreeNode*`, `ListNode*`, `Node*` | `ref`, plus an `object` in the heap (planned, Goal 4) |

Any other type fails to compile at the primary `Serializer` template's `static_assert`, so an unknown type is an error, never a pass-through.

## 6. Layout of `trace.hpp`

Each section uses only what is above it, so no part depends on something declared later.

| Section | Contents |
|---|---|
| 1. Aliases and constants | `i8`…`f64`, the ±(2^53 − 1) limits |
| 2. Core types | `Json`, `Heap`, `IdTable`, `Ctx` |
| 3. Dispatch | The primary `Serializer` and `serialize()`, declared before any use |
| 4. JSON text helpers | `escape`, `quote` |
| 5. Writing helpers | `write_items`, `write_entries`, `write_tuple`, `get_container`, `comparator_name` |
| 6. Serializers | Grouped by the kind they produce |
| 7. The recorder | `Tracer`, `tracer`, `Value`, `var`, then the document writer (`output_path`, `write_file`, `build_document`, `write_document`), then `record` |

The recorder comes last because it uses everything else. Nothing above it touches the global `tracer`. Inside it, the document writer sits above `record`, because `record` calls it at the step cap.

## 7. Writing the trace

The steps stay in memory until the trace is written to a file as one JSON document. Four functions do this, and each one uses the ones above it:

| Function | What it does |
|---|---|
| `build_document(result)` | Returns the whole trace as text. It does no file I/O, so it is easy to test |
| `output_path()` | Returns the value of the `TRACE_OUT` environment variable, or `trace.json` when it is unset or empty |
| `write_file(path, text)` | Writes text to a path atomically. Returns 0 on success and 1 on failure |
| `write_document(result)` | Calls the three above. Ends the program with exit code 1 if the file cannot be written |

### 7.1 What the driver does

Until driver generation exists, `main` is written by hand. This is the one in `fixtures/two_sum_hand_inst.cpp`:

```cpp
trace::tracer.begin(R"({"method": "twoSum", "params": [...], "input": {...}})");

vector<int> nums{2, 7, 11, 15};
vector<int> answer = Solution().twoSum(nums, 9);

trace::Heap heap;
trace::Ctx ctx{trace::tracer.id_table, heap};
trace::write_document(trace::serialize(answer, ctx));
```

- **`begin` stores the problem metadata** as finished JSON, before the Solution runs. The runtime never looks inside it. It has to be stored up front because `record` may need to write a whole document from inside the Solution (§7.4).
- **The result is serialized with its own heap.** `serialize` is a template, so the return type is deduced from the call and the driver never names it.
- **`write_document` is called once**, after the method returns.

### 7.2 What the document contains

| Field | Written | Source |
|---|---|---|
| `version` | Always | The `VERSION` constant (`"0.4"`) |
| `language` | Always | The `LANGUAGE` constant (`"cpp"`) |
| `problem` | Always | The JSON passed to `begin`, pasted in unchanged |
| `steps` | Always | `tracer.steps`, joined with `", "` |
| `result` | Only when the caller passes one | The serialized return value |
| `truncated` | Only as `true` | `tracer.truncated` |

A document written at the step cap has no `result`, and a normal one has no `truncated`. Both rules come from the spec ([`trace-format.md` §3, Unfinished runs](../trace-format.md#unfinished-runs)).

### 7.3 Where it goes

- **A file, not stdout.** The user's own `cout` lines share stdout, so a stray debug print would corrupt the trace and a deliberate one could forge it.
- **The path comes from `TRACE_OUT`**, because the injected code never sees `main`'s arguments. The runner sets it. The default is `trace.json` in the working directory.
- **The write is atomic.** `write_file` writes to `<path>.tmp`, closes it, checks that the write succeeded, and then renames it onto the real path. A process killed halfway leaves the old file or the new one, never half of one. On failure it removes the `.tmp` file and leaves the real file untouched.

### 7.4 At the step cap

The 2,001st call to `record` does not add a step. It sets `truncated`, calls `write_document()` with no result, and ends the program with `std::exit(0)`.

- **Why write here.** A solution stuck in an infinite loop never returns to `main`, so a write in `main` would never happen. Writing at the cap is what gives the user 2,000 steps to look at instead of a timeout error.
- **Why exit.** Nothing after the cap is recorded, so letting the program run on only burns time until the sandbox kills it. Exiting also means the document is written exactly once.
- **Why exit code 0.** The run did what the recorder is meant to do, and `"truncated": true` in the trace already says what happened. A nonzero code is kept for a trace that could not be written.
- **Why `std::exit` and not `std::_Exit`.** `std::exit` flushes the user's buffered `cout` output first.

`Tracer::exit_at_cap` (default `true`) turns the write and the exit off. With it off, `record` only sets `truncated`, and later calls return early. Only tests use it, so that a test program can reach the cap and keep running.

The sandbox's time limit is still needed for a loop that never calls `record`, for example one inside library code. That run ends in a timeout, not a trace.

> **Key insight 3: the trace is written exactly once, by whichever comes first: the method returning, or the step cap.**

## 8. Testing

```bash
make -C adapters/cpp both               # every test, with clang++ and g++
make -C adapters/cpp test T=record      # one test file
```

The test programs are built into `adapters/cpp/build/<compiler>/`.

- `tests/test_serialize.cpp` checks the exact JSON text of every serializer, with its own `Ctx` and no `Tracer`.
- `tests/test_record.cpp` checks that `record` reproduces the nine Two Sum steps character for character, the rules for `locals`, snapshot-at-call, the step cap, and the heap and id rules. The heap tests use a test-only `Probe` type as a stand-in until pointer serializers exist. It sets `exit_at_cap` to `false` so it can reach the cap and keep running.
- `tests/test_write_file.cpp` checks `output_path` and `write_file`: a successful write, a failed open, a failed write, and a failed rename. After every failure the old file must be unchanged and the `.tmp` file gone. Its files go in a private folder in the system's temp directory, which it removes at the end. It is POSIX only (`setenv`, `setrlimit`).

The end-to-end check is the hand-instrumented Two Sum. Build and run it, then compare its trace with the golden one after parsing:

```bash
clang++ -std=c++20 -I adapters/cpp/runtime fixtures/two_sum_hand_inst.cpp -o /tmp/two_sum
TRACE_OUT=/tmp/two-sum.json /tmp/two_sum
```

Still planned: tests for `build_document`, a looping program that proves the cap writes a truncated trace and exits, and a script and Makefile target that run the end-to-end check in one command.

## 9. Known limitations

- **Shadowed names.** Two variables named `i` in scope at once produce a duplicate key in `locals`. The fix belongs with the call-stack design ([`native-tracing.md` §8](../native-tracing.md#8-open-questions)).
- **Iterators** have no kind, so they are left out of `record` calls.
- **Container aliasing.** Two references to the same `vector` appear as two copies. Only objects have identity.
- **Wide character types** (`wchar_t`, `char8_t`, `char16_t`, `char32_t`) are rejected by the integer serializer's comparisons.
- **A crash writes no trace.** A solution that crashes before the cap (a segfault, an uncaught exception) never reaches `write_document`, so the steps recorded so far are lost. The spec allows a trace with no `result` and no `truncated` for this case, but the runtime does not produce one yet.

## 10. Design questions

**Q1. Why does the heap start empty every step when the `id_table` does not?** They answer different questions. The `id_table` says who an object is, and that must be the same at every step or the frontend cannot follow an object. The heap says what the object looks like now, and reusing it would make the runtime skip objects it wrote in an earlier step, so their changes would never show.

**Q2. Why does `Ctx` exist if it owns nothing?** Every serializer needs both maps, at every level of recursion. Bundling two references into one parameter keeps the signatures short and keeps serializers independent of global state, which is what lets the serializer tests run without a `Tracer`.

**Q3. Why is the heap a map of strings instead of objects?** Each entry is written as JSON at the moment it is reached, while the serializer still knows the real type (`TreeNode*`). By the time `record` writes the heap, there is nothing left to compute, only text to join. An address alone could not be serialized later anyway, because a `const void*` has lost its type.

**Q4. Why are the locals serialized before the heap?** Serializing the locals is what fills the heap. Writing the heap first would always produce `{}`.

**Q5. Why no `V(x)` macro?** The rewriter already knows each name, so a macro adds nothing, and a macro would ignore namespaces and could collide with user code. See §4.3.

**Q6. Why does `record` end the program at the step cap instead of only stopping the recording?** A solution that reaches the cap is usually in an infinite loop, so it would never return to `main` and no trace would be written. Writing inside `record` saves the 2,000 steps, and exiting right after means the document is written once and no time is spent on a run nobody is recording. See §7.4.

**Q7. Why is the problem metadata one JSON string and not a struct?** The runtime never reads the method name, the parameters, or the input. It only pastes them into the document. Whoever calls `begin` already has them as text: a person today, the driver generator later. A struct would add types and a serializer for data that is never used as data.