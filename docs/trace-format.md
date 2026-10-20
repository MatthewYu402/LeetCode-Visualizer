# Trace Format Specification
>Status: v0.1

Suppose we built the visualizer without a trace format. The C++ backend sends the frontend whatever is easiest to produce, say a raw dump of `std::unordered_map` internals.

The frontend learns to parse that. Later you add Python, whose `dict` looks nothing like it, so you need to add Python specific parsing to the frontend. Then Java.

Now:
- The frontend contains `if language == "cpp"` branches everywhere.
- Every new renderer (say, a heap view) has to be taught about every language.
- Every new language has to be taught about every renderer

The trace format is the **only contract** between the language-specific backend (adapters) and the visualization frontend. Adapters produce traces and the frontend consumes them. Neither sides knows anything about the other.

A contract is only useful if both sides can rely on it.

## 1. Why this exists
Without a shared format, every language would need to be taught to every renderer. With $L$ languages and $R$ renderes, that's $L\times R$ pieces of glue code, and it grows with every feature.

With a shared format in the middle:

```
C++ adapter    ─┐
Python adapter ─┼──► trace (JSON) ──► frontend renderers
Go adapter     ─┘
```

the cost drops to $L + R$. Adding GO means writing one adapter. Adding a heap renderer means writing one component. Neither touches the other side.

> Key Insight 1: the trace is the only thing both sides share, so it is the only thing that must stay stable.

#### An Analogy, with a caveat
The trace plays a similar role to an intermediate representation (IR) in a compiler: it decouples many frontends from many backends. But there is an important difference:
- A compiler IR represents what a programe **does** (instructions) and gets transformed and optimized.
- A traces represents what a program's data **looks like** at each moment. Nothing is compiled, translated, or optimized. The user's code always runs in its original language, and the trace is a recording of that run.

A closer precedent is the Debug Adapter Protocol: one UI, many language backends, and one shared message format.

---

## 2. Design Principles

| Principle | Meaning | Why |
|---|---|---|
| **Language-neutral** | Describes concepts (`map`, `list`, `ref`), not implementations (`std::unordered_map`, `dict`) | If language details leak in, the frontend becomes language-aware again and the whole benefit is lost |
| **Self-contained** | Each step has everything needed to draw the moment | Any step can be rendered alone, so rewind and jump are trivial |
| **Declarative** | States what *is* ("the map contains [2, 0]"), not what *happened* ("insert "[2, 0]") | Robust and simple to render. The frontend computes diffs itself |
| **Deliberately lossy** | Drops memory addresses, hash buckets, capacity, allocator details | A small format is a stable format, with less for languages to disagree about |

> **Key Insight 2: the trace is more *abstract* than the source language, not more primitive.** A compiler lowers towared the machine (regisers, loads, stores). The trace raises `std::unordered_map` and Python `dict` up to one standard concept: `map`.

## 3. Trace structure
A trace is one one JSON object:

```json
{
  "version": "0.1",
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
| `result` | Final return valuem as a normalized value |

## 4. Problem metadata
This describes what was run. It also give the frontend hints so it can pick a renderer (for example, "this `list` of `list`s is a grid").

```json
{
  "name": "Two Sum",
  "method": "twoSum",
  "params": [
    {"name": "nums",   "type": "list<int>", "hint": "array"},
    {"name": "target", "type": "int"}
  ],
  "input": {"nums": [2, 7, 11, 15], "target": 9}
}
```

`type` uses neutral names (`list<int>`, `map<int, int>`, `TreeNode`, `ListNode`), never language types like `vector<int>&`.

`hint` is optional and resolves ambiguity. A `list<list<int>>` could be a grid, an adjacency list, or intervals, and the data alone cannot say which. Allowed hints (initial set): `array`, `grid`, `adjacency list`, `adjacency matrix`, `intervals`, `tree`, `linked-list`, `graph`, `heap`.

> **Key Insight 3: type ambiguity is solved once, in the frontend and metadata, not once per language.**

## 5. The value model
Every value in a trace is either a **primitive** or a **tagged object**. The `kind` field tells the frontend which renderer applies.

#### Primitices
Plain JSON: `5`, `3.14`, `"abc"`, `true`, `null`.

#### Containers
```json
{"kind": "list", "items": [2, 7, 11, 15]}
{"kind": "set",  "items": [1, 2, 3]}
{"kind": "map",  "entries": [[2, 0], [7, 1]]}
```

Maps use a list of `[key, value]` pairs instead of a JSON object, because JSON object keys must be strings and map keys can be ints or other types.

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

## Summary of kinds

| Kind | Fields | Typical source types |
|---|---|---|
| `list` | `items` | `vector`, `list`, array, slice, `ArrayList` |
| `set` | `items` | `unordered_set`,  `set`, `HashSet` |
| `map` | `entries`| `unordered_map`, `dict`, `HashMap`, `map`| 
| `object` | `type`, `fields` | structs, classes (`TreeNode`, `ListNode`) | 
| `ref` | `id` | pointers, references, object handles |

Stacks, queues, dequests, and heaps are **lists with a hint** in v0.1. If dedicated kinds become necessary, they will be added in a minor version ([Section 9](#9-versioning))

---

## 6. Steps
A step is one snapshot of program state

```json
{
  "step": 4,
  "line": 12,
  "locals": { "i": 1, "compliment": 2 },
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

An event log (`insert(2, 0)`, `i=1`, ...) forces the frontend to replay events 1 through $N$ to draw step $N$. Jumping or rewinding means replaying again, and one missing or wront event corrupts everything after it. A snapshot is drawn directly from its own data.

The diff between two adjacent snaptions is used only to **animate** what changes (what was added, not removed, or modified). It is not needed to render a step.

> **Key Insight 4: snapshots give random access and trivial rewind, as the cost of size.** Snapshots repeat unchanged data. For LeetCode-sized examples with a capped step count, the cost is negligible.

### Limits
Adaptors must stop recording at a configued maximum (default: 2,000 steps) and set `"truncated" : true` at the top level. Traces are intended for small example inputs.

## 7. Full Example: Two Sum
Input: `nums = [2, 7, 11, 15]`, `target = 9`. Source line numbers refer to the user's `Solution` class. Each snapshot is taken **before** its line executes

```json
{
  "version": "0.1",
  "language": "cpp",
  "problem": {
    "name": "Two Sum",
    "method": "twoSum",
    "params": [
      {"name": "nums",   "type": "list<int>", "hint": "array"},
      {"name": "target", "type": "int"}
    ],
    "input": {"nums": [2, 7, 11, 15], "target": 9}
  },
  "steps": [
    {"step": 0, "line": 8, "heap": {},
     "locals": {"nums": {"kind": "list", "items": [2, 7, 11, 15]}, "target": 9,
                "numMap": {"kind": "map", "entries": []}, "i": 0}},
    {"step": 1, "line": 16, "heap": {},
     "locals": {"nums": {"kind": "list", "items": [2, 7, 11, 15]}, "target": 9,
                "numMap": {"kind": "map", "entries": []}, "i": 0, "compliment": 7}},
    {"step": 2, "line": 8, "heap": {},
     "locals": {"nums": {"kind": "list", "items": [2, 7, 11, 15]}, "target": 9,
                "numMap": {"kind": "map", "entries": [[2, 0]]}, "i": 1}},
    {"step": 3, "line": 12, "heap": {},
     "locals": {"nums": {"kind": "list", "items": [2, 7, 11, 15]}, "target": 9,
                "numMap": {"kind": "map", "entries": [[2, 0]]}, "i": 1, "compliment": 2}}
  ],
  "result": {"kind": "list", "items": [0, 1]}
}
```

The frontend reads `nums` as a `list` (array renderer, with `i` as a pointer) and `numMap` as a `map` (key-value table). It never learns that `numMap` was an `unordered_map`.

---

## 8. Rules for adapter authors
> **Key Insight 5: normalize *representation*, never hide *behavior***

Adapters must:
1. Map every native type to a kind from [Section 5](#5-the-value-model). Never emit raw debigger or language output.
2. Never emit memory addresses, capacities, bucket counrs, or other implementation details.
3. Assign `id`s so that **distinct objects get distinct IDs and aliases share one`.
4. Report line numbers relative to the user's original code, not the generated driver.
5. Treat `map` and `set` ordering as **unspecified**. The frontend must not assume insertion order.
6. Stop at step limit and flag truncation
7. Pass schema validation ([Section 10](#10-validation-and-testing)) before being considered correct.

### What is a bug and what is not
Two adapters running the same algorithm may legitimately produce different traces

| Difference | Bug? |
| Same hash map is `kind: map` in one trace and something else in another | **Yes**: representation bug |  
| A pointer appears as a raw address | **Yes**: language detail leaked | 
| Same concept uses different field names across adaptors | **Yes**: contract violation | 
| Map entries appear in different order | No: iteration order is real language behavior | 
| Different step counts or line numbers | No: different source files | 
| Integer overflow happens in C++ but not in Python | No: genuine semantic different |

The rule: ** the same concept must always look the same in the trace, but the program's actual behavior is allowed to differ.

---

## 9. Versioning
- `version` follows `MAJOR.MINOR`
- **Minor** bumps add optional fields or new kinds. Older frontends ignore what they do not understand
- **Major** bumps may break compatibility. The frontend rejects traces with an unsupported major version, with a clear error.

## 10. Validation and testing
- A JSON Schema for this format lives in `schema/trace.schema.json` (to be written). Every adapter's output is validated against it in CI.
- **Golden traces**: for each problem example, a reference trace is stored as a fixture. Adapters are checked against it for **structural equivalence** (same kinds, same shapes), not byte-for-byte equality
- The frontend can be developed against hand-written traces with no backend at all.

--- 

## 11. Adding a new language
Checklist (Example: Go):
- [ ] Driver template: parse the example input and call method
- [ ] Tracer, or DAP configuration (for example `delve`)
- [ ] Normalizer: native values to kidns in [Section 5](#5-the-value-model)
- [ ] Helper types (`ListNode`, `TreeNode`) matching the problem metadata
- [ ] Container image with language toolchain
- [ ] Passes schema validation and golden-trace checks

Unchanged: the frontend and this specification.

---

## 12. Design Questions
These are more for me and to understand/study these concepts

> **Q1. If we added a Go adapter, what changes and what doesn't?** Only the backend changes: a new driver, tracer, normalizer, and image. The frontend and trace schema are untouched. That is the point of the contract.

> **Q2. Why store `{"kind": "map"}` instead of what the debugger returned for `unordered_map`?** Raw debugger output is language-specific. If it reaches the frontend, every renderer has to understand every language. Normalizing erases memory layout, registers, pointer details, and container internals, leaving the concept the renderer needs.

> **Q3. Why are snapshots better than a log of operations, and what do they cost?** A snapshot can be drawn directly, so jumping and rewinding is free and errors do not compound. A log needs to replay from the start and reconstruct at any step. The cost is size, since unchanged data is repeated, which is negligible for small examples with a step cap.

> **Q4. If two adapters run the same algorithm and produce different traces, is that a bug?** Not necessarily. Differences in *behavior* (map ordering, overflow, line numbers) are legitimate. Differences in *representation* (a different kind for the same concept, leaked addresses) are bugs. Traces must match in structure and may differ in content.
