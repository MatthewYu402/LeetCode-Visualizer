# Trace Format Specification
> **Status:** Draft v0.2
> **Related:** [`native-tracing.md`](native-tracing.md) and [`dap.md`](dap.md) (how adapters produce traces), [`schema/trace.schema.json`](../schema/trace.schema.json) (the machine-readable contract), [`fixtures/two-sum.trace.json`](../fixtures/two-sum.trace.json) (golden trace)

Suppose we built the visualizer without a trace format. The C++ backend sends the frontend whatever is easiest to produce, say a raw dump of `std::unordered_map` internals.

The frontend learns to parse that. Later you add Python, whose `dict` looks nothing like it, so you need to add Python specific parsing to the frontend. Then Java.

Now:
- The frontend contains `if language == "cpp"` branches everywhere.
- Every new renderer (say, a priority-queue view) has to be taught about every language.
- Every new language has to be taught about every renderer.

The trace format is the **only contract** between the language-specific backend (adapters) and the visualization frontend. Adapters produce traces and the frontend consumes them. Neither side knows anything about the other.

A contract is only useful if both sides can rely on it.

## 1. Why this exists
Without a shared format, every language would need to be taught to every renderer. With $L$ languages and $R$ renderers, that's $L\times R$ pieces of glue code, and it grows with every feature.

With a shared format in the middle:

```
C++ adapter    ─┐
Python adapter ─┼──► trace (JSON) ──► frontend renderers
Go adapter     ─┘
```

the cost drops to $L + R$. Adding Go means writing one adapter. Adding a priority-queue renderer means writing one component. Neither touches the other side.

> **Key Insight 1: the trace is the only thing both sides share, so it is the only thing that must stay stable.**

#### An Analogy, with a caveat
The trace plays a similar role to an intermediate representation (IR) in a compiler: it decouples many frontends from many backends. But there is an important difference:
- A compiler IR represents what a program **does** (instructions) and gets transformed and optimized.
- A trace represents what a program's data **looks like** at each moment. Nothing is compiled, translated, or optimized. The user's code always runs in its original language, and the trace is a recording of that run.

A closer precedent is the Debug Adapter Protocol: one UI, many language backends, and one shared message format.



## 2. Design Principles

| Principle | Meaning | Why |
|---|---|---|
| **Language-neutral** | Describes concepts (`map`, `array`, `ref`), not implementations (`std::unordered_map`, `dict`) | If language details leak in, the frontend becomes language-aware again and the whole benefit is lost |
| **Self-contained** | Each step has everything needed to draw the moment | Any step can be rendered alone, so rewind and jump are trivial |
| **Declarative** | States what *is* ("the map contains [2, 0]"), not what *happened* ("insert [2, 0]") | Robust and simple to render. The frontend computes diffs itself |
| **Deliberately lossy** | Drops memory addresses, hash buckets, capacity, allocator details | A small format is a stable format, with less for languages to disagree about |
| **Bare numbers only when exact** | JSON is parsed into JavaScript doubles, so large integers would silently round and NaN or Infinity would not parse at all. Those values are tagged instead of approximated | [Section 5](#numbers-json-cannot-carry-exactly) |

> **Key Insight 2: the trace is more *abstract* than the source language, not more primitive.** A compiler lowers toward the machine (registers, loads, stores). The trace raises `std::unordered_map` and Python `dict` up to one standard concept: `map`.

## 3. Trace structure
A trace is one JSON object:

```json
{
  "version": "0.2",
  "language": "cpp",
  "problem": { ... },
  "steps": [ ... ],
  "result": ...
}
```

| Field | Description |
|---|---|
| `version` | Trace format version (see [Section 9](#9-versioning)) |
| `language` | Informational only. The frontend must **not** branch on this. |
| `problem` | Metadata about the problem and input ([Section 4](#4-problem-metadata)) |
| `steps` | Ordered list of snapshots ([Section 6](#6-steps)) |
| `result` | Final return value, as a normalized value |
| `truncated` | Optional. `true` if recording stopped at the step limit ([Section 6](#limits)) |

## 4. Problem metadata
This describes what was run. It also gives the frontend hints so it can pick a renderer (for example, "this `array` of `array`s is a grid").

There is no problem catalog. The system knows only the user's `Solution` source and the example input, so the **adapter derives** this whole object: parameter names and neutral types from the method signature, and hints by inference.

```json
{
  "name": "Two Sum",
  "method": "twoSum",
  "params": [
    {"name": "nums",   "type": "array<int>"},
    {"name": "target", "type": "int"}
  ],
  "input": {"nums": [2, 7, 11, 15], "target": 9}
}
```

`name` is optional, since the adapter may not know it.

`type` uses neutral names that mirror the kinds in [Section 5](#5-the-value-model) (`array<int>`, `list<int>`, `map<int, int>`, `stack<int>`, `TreeNode`, `ListNode`), never language types like `vector<int>&`.

`hint` is optional and resolves ambiguity. An `array<array<int>>` could be a grid, an adjacency matrix, an edge list, or intervals, and the data alone cannot say which. Allowed hints: `grid`, `adjacency-matrix`, `adjacency-list`, `edge-list`, `intervals`, `tree`, `linked-list`, `graph`, `priority-queue`, `stack`, `queue`.

The last three cover languages where those structures are plain arrays: a Python list used through `heapq` is an `array` with the `priority-queue` hint, and a list used with `append`/`pop` is an `array` with the `stack` hint.

Hints are **inferred by the adapter**, never supplied by the user. Sources, from most to least certain:
1. **Signature types**: a `TreeNode` parameter is a tree.
2. **LeetCode parameter names**: `edges`, `grid`, `intervals`, ...
3. **How the code uses the value**: for example, elements used as indices into another array.
4. **The shape of the example value**: a language-neutral baseline every adapter can share.

> **Key Insight 3: type ambiguity is resolved once, by inference in the adapter and an override in the frontend, never by asking the user.**

## 5. The value model
Every value in a trace is either a **primitive** or a **tagged object**. The `kind` field tells the frontend which renderer applies.

#### Primitives
Plain JSON: `5`, `3.14`, `"abc"`, `true`, `null`. `null` means a null pointer or `None`, and nothing else.

#### Containers
```json
{"kind": "array",          "items": [2, 7, 11, 15]}
{"kind": "list",           "items": [1, 2, 3]}
{"kind": "stack",          "items": [1, 2, 3]}
{"kind": "queue",          "items": [1, 2, 3]}
{"kind": "deque",          "items": [1, 2, 3]}
{"kind": "priority-queue", "items": [5, 4, 3, 1, 1], "order": "max"}
{"kind": "tuple",          "items": [0, "a"]}
{"kind": "set",            "items": [1, 2, 3]}
{"kind": "map",            "entries": [[2, 0], [7, 1]]}
```

- `array` is an indexed sequence: the next item is reached by offset (`a[i]`).
- `list` is a node-based sequence traversed by iterator, front to back. It carries values only, with no identity. A user's `ListNode` chain is not a `list`. It is `object` + `ref` (below).
- `stack` items run bottom to top: the last item is the top.
- `queue` and `deque` items run front to back: the first item is the front.
- `priority-queue` `items` are the underlying array **in storage order**, so they are not sorted. Only `items[0]` is guaranteed to be the top. `order` describes the comparator: `"max"` (the top is the largest), `"min"` (the top is the smallest), or `"custom"` (any other comparator, such as a lambda).
- `tuple` is a fixed-size group that may mix types (`pair`, `tuple`).
- Maps use an array of `[key, value]` pairs instead of a JSON object, because JSON object keys must be strings and map keys can be ints or other types. The pairs are raw JSON arrays, never a tagged kind.

#### Numbers JSON cannot carry exactly
The frontend parses traces in JavaScript, where every number is an IEEE 754 double. Two kinds of value do not survive that:

- **Integers outside ±(2^53 − 1)** (`Number.MAX_SAFE_INTEGER`). `JSON.parse` rounds them to the nearest double without any error.
- **NaN, +Infinity, and −Infinity.** JSON has no syntax for them, so a bare `NaN` makes the whole trace unparseable.

These are tagged, with the exact value in a string:

```json
{"kind": "int",   "value": "9007199254740993"}
{"kind": "float", "value": "-Infinity"}
```

- `int.value` is decimal digits with an optional leading `-` and no leading zeros. Adapters **must** use it for integers outside the safe range and **must not** use it inside the range.
- `float.value` is exactly `"NaN"`, `"Infinity"`, or `"-Infinity"`. Every finite float is a bare number, including large ones such as `1e300`, because JavaScript numbers are doubles too.
- Finite floats are written as the shortest text that round-trips to the same value in their own type (C++ `std::to_chars`).
- `null` never stands for NaN or infinity. It means a null pointer or `None`.

> **Key Insight 4: emit a bare JSON number when JSON carries the value exactly, and a tagged value otherwise.** It is the same reasoning as maps using `entries`: when plain JSON would lose information, the trace tags the value instead of approximating it.

#### Structure and identity: heap and references
Trees, linked lists, and graphs need **identity**: two pointers can refer to the same node, and cycles can exist.

These are represented as objects stored in a per-step `heap`, referenced by ID:

```json
{
  "locals": {"root": {"kind": "ref", "id": "n1"}},
  "heap": {
    "n1": {"kind": "object", "type": "TreeNode",
           "fields": {"val": 5,
                      "left":  {"kind": "ref", "id": "n2"},
                      "right": null}},
    "n2": {"kind": "object", "type": "TreeNode",
           "fields": {"val": 3, "left": null, "right": null}}
  }
}
```

This is how C++ `TreeNode*`, a Python `TreeNode` instance, and a Go `*TreeNode` all become the same thing. The frontend recognizes a tree from the object's shape (`val`, `left`, `right`) or from the problem hint.

The step's `heap` field (the store of objects) is unrelated to the `priority-queue` kind. That is why the kind is not called `heap` ([Q6](#12-design-questions)).

### Summary of kinds

Bare JSON primitives: numbers, strings, `true`/`false`, `null`. Everything else is tagged:

| Kind | Fields | Typical source types | Notes |
|---|---|---|---|
| `int` | `value` (string) | `long long`, `uint64_t`, Python `int`, Java `long` | Only outside ±(2^53 − 1) |
| `float` | `value` (string) | any floating-point type | Only `NaN`, `Infinity`, `-Infinity` |
| `array` | `items` | `vector`, `std::array`, C arrays, Python `list`, Java arrays, `ArrayList` | Indexed sequence |
| `list` | `items` | `std::list`, `std::forward_list` | Traversed via iterators, front to back. Values only, no identity |
| `stack` | `items` | `std::stack`, Java `Stack` | Bottom to top: the last item is the top |
| `queue` | `items` | `std::queue`, Java `Queue` | Front to back: the first item is the front |
| `deque` | `items` | `std::deque`, Python `collections.deque` | Front to back, both ends open |
| `priority-queue` | `items`, `order` | `priority_queue`, Java `PriorityQueue` | `items` in storage order. `order` is `"max"`, `"min"`, or `"custom"` |
| `tuple` | `items` | `pair`, `tuple`, Python `tuple` | Fixed size, may mix types |
| `set` | `items` | `set`, `unordered_set`, `HashSet` | |
| `map` | `entries` | `map`, `unordered_map`, `dict`, `HashMap` | Entries are raw `[key, value]` pairs |
| `object` | `type`, `fields` | structs and classes (`TreeNode`, `ListNode`, `Node`) | Stored in the heap |
| `ref` | `id` | pointers, references, object handles | Points into the heap |

> **Key Insight 5: a kind is for what the type tells the adapter. A hint is for what only the problem knows.** `stack<int>` is a stack from its type alone, so it has a kind. A `vector<vector<int>>` could be a grid, an adjacency matrix, or an edge list, and nothing in the data says which, so that is a hint.

## 6. Steps
A step is one snapshot of program state

```json
{
  "step": 4,
  "line": 12,
  "locals": { "i": 1, "complement": 2 },
  "heap": {}
}
```

| Field | Description |
|---|---|
| `step` | Zero-based index |
| `line` | Line number in the **user's original source** about to execute (pre-execution snapshot) |
| `locals` | Variables in scope, name to value. Includes parameters |
| `heap` | Objects referenced by `ref`s in this step (may be empty) |

### Snapshots, not events
Each step is the **full state**, not a description of what happened.

An event log (`insert(2, 0)`, `i=1`, ...) forces the frontend to replay events 1 through $N$ to draw step $N$. Jumping or rewinding means replaying again, and one missing or wrong event corrupts everything after it. A snapshot is drawn directly from its own data.

The diff between two adjacent snapshots is used only to **animate** what changes (what was added, removed, or modified). It is not needed to render a step.

> **Key Insight 6: snapshots give random access and trivial rewind, at the cost of size.** Snapshots repeat unchanged data. For LeetCode-sized examples with a capped step count, the cost is negligible.

### Limits
Adapters must stop recording at a configured maximum (default: 2,000 steps) and set `"truncated": true` at the top level. Traces are intended for small example inputs.

## 7. Full Example: Two Sum
Input: `nums = [2, 7, 11, 15]`, `target = 9`. Source line numbers refer to the user's `Solution` class as pasted. Each snapshot is taken **before** its line executes.

This is an excerpt of [`fixtures/two-sum.trace.json`](../fixtures/two-sum.trace.json): steps 3 to 7 are left out.

```json
{
  "version": "0.2",
  "language": "cpp",
  "problem": {
    "name": "Two Sum",
    "method": "twoSum",
    "params": [
      {"name": "nums",   "type": "array<int>"},
      {"name": "target", "type": "int"}
    ],
    "input": {"nums": [2, 7, 11, 15], "target": 9}
  },
  "steps": [
    {"step": 0, "line": 5, "heap": {},
     "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9}},
    {"step": 1, "line": 8, "heap": {},
     "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9,
                "numMap": {"kind": "map", "entries": []}, "i": 0}},
    {"step": 2, "line": 9, "heap": {},
     "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9,
                "numMap": {"kind": "map", "entries": []}, "i": 0, "complement": 7}},
    {"step": 8, "line": 12, "heap": {},
     "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9,
                "numMap": {"kind": "map", "entries": [[2, 0]]}, "i": 1, "complement": 2}}
  ],
  "result": {"kind": "array", "items": [0, 1]}
}
```

The frontend reads `nums` as an `array` (array renderer, with `i` as a pointer) and `numMap` as a `map` (key-value table). It never learns that `numMap` was an `unordered_map`.



## 8. Rules for adapter authors
> **Key Insight 7: normalize *representation*, never hide *behavior***

Adapters must:
1. Map every native type to a kind from [Section 5](#5-the-value-model). Never emit raw debugger or language output. An unrecognized type is an error, never a pass-through.
2. Never emit memory addresses, capacities, bucket counts, or other implementation details.
3. Assign `id`s so that **distinct objects get distinct IDs and aliases share one**.
4. Report line numbers relative to the user's original code, not the generated driver.
5. Treat `map` and `set` ordering as **unspecified**. The frontend must not assume insertion order.
6. Stop at the step limit and flag truncation
7. Pass schema validation ([Section 10](#10-validation-and-testing)) before being considered correct.
8. Emit a bare JSON number only when JavaScript reads it back exactly. Otherwise use the `int` or `float` kind ([Section 5](#numbers-json-cannot-carry-exactly)). Never emit the bare tokens `NaN` or `Infinity`, which are not JSON.
9. Use the kind the type determines. A `std::stack` is a `stack`, never an `array` with a hint. Hints are only for what the type cannot say.

### What is a bug and what is not
Two adapters running the same algorithm may legitimately produce different traces

| Difference | Bug? |
|---|---|
| Same hash map is `kind: map` in one trace and something else in another | **Yes**: representation bug |
| A pointer appears as a raw address | **Yes**: language detail leaked |
| Same concept uses different field names across adapters | **Yes**: contract violation |
| A `std::stack` appears as an `array` | **Yes**: the type determined the kind |
| An integer above 2^53 appears as a bare number | **Yes**: the frontend silently shows a different value |
| Map entries appear in different order | No: iteration order is real language behavior |
| `priority-queue` items differ after `items[0]` | No: heap layout is real standard-library behavior |
| Different step counts or line numbers | No: different source files |
| Integer overflow happens in C++ but not in Python | No: genuine semantic difference |

**The rule**: The same concept must always look the same in the trace, but the program's actual behavior is allowed to differ.



## 9. Versioning
- `version` follows `MAJOR.MINOR`
- **Minor** bumps add optional fields or new kinds. Older frontends ignore what they do not understand, and draw an unknown kind with a generic fallback.
- **Major** bumps may break compatibility. The frontend rejects traces with an unsupported major version, with a clear error.
- **While the major version is 0**, any minor bump may break compatibility, so the frontend accepts only the `0.x` versions it was built for.

History:
- **v0.2** (breaking):
  - Renames v0.1's `list` kind to `array`. `list` now means a node-based list (`std::list`).
  - Adds the `stack`, `queue`, `deque`, `priority-queue`, and `tuple` kinds, and the `int` and `float` kinds for numbers JSON cannot carry exactly.
  - Hints are inferred by the adapter, and `problem.name` is optional.
  - The `array` hint is removed, and the `edge-list`, `priority-queue`, `stack`, and `queue` hints are added.
  - A v0.1 trace is rejected, because its `list` would be misread.
- **v0.1**: initial draft.

## 10. Validation and testing
- A JSON Schema for this format lives in `schema/trace.schema.json`. Every adapter's output is validated against it in CI (CI is not set up yet).
- The validator must reject the bare tokens `NaN` and `Infinity`. Python's `json` module accepts them by default, so load traces with `json.load(..., parse_constant=...)` set to raise.
- **Golden traces**: for each problem example, a reference trace is stored as a fixture. Adapters are checked against it for **structural equivalence** (same kinds, same shapes), not byte-for-byte equality
- The frontend can be developed against hand-written traces with no backend at all.



## 11. Adding a new language
Checklist (Example: Go):
- [ ] Driver template: parse the example input and call method
- [ ] Tracer, or DAP configuration (for example `delve`)
- [ ] Normalizer: native values to kinds in [Section 5](#5-the-value-model)
- [ ] Problem metadata: neutral parameter types from the signature, inferred hints
- [ ] Helper types (`ListNode`, `TreeNode`) matching the problem metadata
- [ ] Container image with language toolchain
- [ ] Passes schema validation and golden-trace checks

Unchanged: the frontend and this specification.



## 12. Design Questions
These are mainly notes for me, to help me understand these concepts.

> **Q1. If we added a Go adapter, what changes and what doesn't?** Only the backend changes: a new driver, tracer, normalizer, and image. The frontend and trace schema are untouched. That is the point of the contract.

> **Q2. Why store `{"kind": "map"}` instead of what the debugger returned for `unordered_map`?** Raw debugger output is language-specific. If it reaches the frontend, every renderer has to understand every language. Normalizing erases memory layout, registers, pointer details, and container internals, leaving the concept the renderer needs.

> **Q3. Why are snapshots better than a log of operations, and what do they cost?** A snapshot can be drawn directly, so jumping and rewinding is free and errors do not compound. A log needs to replay from the start and reconstruct at any step. The cost is size, since unchanged data is repeated, which is negligible for small examples with a step cap.

> **Q4. If two adapters run the same algorithm and produce different traces, is that a bug?** Not necessarily. Differences in *behavior* (map ordering, overflow, line numbers) are legitimate. Differences in *representation* (a different kind for the same concept, leaked addresses) are bugs. Traces must match in structure and may differ in content.

> **Q5. Why not emit NaN as `null`, or big integers as plain strings?** `null` already means a null pointer, so a NaN would be indistinguishable from one, and NaN, +Infinity, and −Infinity would collapse into one value. A plain string `"9007199254740993"` is indistinguishable from a real string. Tagging keeps each value unambiguous, and only the rare values pay the cost.

> **Q6. Why is the kind called `priority-queue` and not `heap`?** Every step already has a `heap` field, the store of objects that `ref`s point into. A `heap` kind and a `heap` hint next to it would make every mention ambiguous. `priority-queue` also names the concept rather than the usual implementation, the same way `stack`, `queue`, and `deque` do.

> **Q7. Why are `array` and `list` separate kinds?** They are drawn differently. An array is a row of indexed boxes that pointers like `i` and `j` move along. A list is a chain of nodes reached one after another. The type tells the adapter which one it has, so by Key Insight 5 it is a kind, not a hint.