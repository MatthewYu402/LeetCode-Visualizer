# LeetCode-Visualizer

## Goals
I am currently practicing LeetCode style questions, but for most students, including myself, learn much better visually rather than conceptually. Seeing the problem unfold and understanding why one solution may not work while another might as a data structure on the screen feels more tangible. Instead of picturing how a data structure works in a given problem, a visual can help immensely.

I want to help other aspiring software engineers with their goals of getting their dream job, and most of the time they need to go though multiple rounds of technical interviews, which are more often than not a multitude of LeetCode-style questions. With this in mind, those who are also visuals learners should use this tool to understand a given problem.

The rest of the file goes over the project, including the architecture, and decisions made throughout the process.

---

## What it does

You paste a LeetCode `Solution` class, give it an example input, and step through it. At every step the tool shows the line being executed and draws the data structures the solution is using (array, hash map, stack, queue, linked list, tree, graph, ...) as they change.

It works with the `Solution` class exactly as LeetCode gives it to you. No annotations or rewriting by hand are needed. There is no problem catalog: everything the visualizer needs is derived from your code and the example.

## Status

> **Implementation started.** The contract between the two halves of the system is specified and validated. The C++ adapter can serialize every value kind except pointers (`object` and `ref`). The frontend's sandbox page replays the Two Sum fixture. Update this table as pieces land.

| Area | Status |
|---|---|
| Trace format specification | Draft v0.2 |
| JSON Schema + golden fixture (Two Sum) | v0.2, validated |
| Tracing strategy docs (native, DAP) | Draft v0.1 |
| C++ adapter: value serializers | Done for every kind except `object` and `ref`, with tests |
| C++ adapter: recorder, pointers, driver, rewriter | Planned |
| Python adapter | Planned |
| Frontend: sandbox page (loader, player, code panel, `array` / `map` / fallback renderers, diff) | In progress, replays the Two Sum fixture |
| Frontend: home page, real runs, `object` / `ref` and hint renderers, "view as" | Planned |
| API service + sandbox | Planned |

---

## Documentation map

Start with the trace format. Everything else hangs off it.

| Document | Read it to learn | Status |
|---|---|---|
| [`docs/trace-format.md`](docs/trace-format.md) | The contract between backend and frontend: value kinds, steps, rules for adapter authors | Draft v0.2 |
| [`docs/native-tracing.md`](docs/native-tracing.md) | How an adapter observes a program using runtime hooks or source instrumentation | Draft v0.1 |
| [`docs/dap.md`](docs/dap.md) | How an adapter observes a program through a debugger using the Debug Adapter Protocol | Draft v0.1 |
| [`schema/trace.schema.json`](schema/trace.schema.json) | The machine-readable version of the contract. Every adapter's output must validate against it | v0.2 |
| [`fixtures/two-sum.trace.json`](fixtures/two-sum.trace.json) | A golden trace for the Two Sum example | v0.2 |
| [`adapters/cpp/runtime/trace.hpp`](adapters/cpp/runtime/trace.hpp) | The C++ serializers: native values to trace kinds | In progress |
| [`CLAUDE.md`](CLAUDE.md) / [`Skills.md`](Skills.md) | Rules and repeatable procedures for working in this repo | Draft |
| [`docs/driver-generation.md`](docs/driver-generation.md) | Parsing method signatures and example input, LeetCode helper types | Draft |
| [`docs/frontend.md`](docs/frontend.md) | The sandbox page: layout, renderer registry, diffing, playback, theme | Draft v0.1 |
| [`frontend/CLAUDE.md`](frontend/CLAUDE.md) | Frontend commands, structure, theme tokens, and rules | Draft |
| [`docs/sandboxing.md`](docs/sandboxing.md) | Isolation, resource limits, where validation runs | Draft |
| [`docs/adapters/cpp.md`](docs/adapters/cpp.md) | The C++ adapter: instrumentation, STL normalization rules | Draft |
| [`docs/adapters/python.md`](docs/adapters/python.md) | The Python adapter: `sys.settrace`, normalization rules | Draft |
| [`LICENSE`](LICENSE) | MIT license terms | Done |

Planned. This link is a template: create the file, then move it into the table above.

| Document | Will cover | Status |
|---|---|---|
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute, how to add a language | Planned |

**Suggested reading order:** this README, then `trace-format.md`, then `native-tracing.md` or `dap.md` depending on which part you are working on.

---

## Architecture

Getting state out of a running `Solution` class without asking the user to change their code is the hard part, so this is where most of the design effort went.

The key decision: **the backend and the frontend only talk through a trace format.** Each side can be built, tested, and replaced without the other.

> The components below are planned. Names and hosting details are tentative. The data flow and the boundaries between components are the stable part.

### 1. System overview: what is connected to what

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ FRONTEND  (browser)                                                            │
│                                                                                │
│   code editor · example input · step controls                                  │
│   trace player · diff animator · renderer registry                             │
│                                                                                │
│   Knows only the trace format. Never knows which language ran.                 │
└─────────────┬──────────────────────────────────────────────────────────────────┘
              │  ▼ run request: language, source code, example input
              │  ▲ validated trace (JSON), or an error
              ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ API SERVICE                                                                    │
│                                                                                │
│   receives the Solution source and the example (no problem catalog)            │
│   starts one sandboxed job per run                                             │
│   validates every returned trace against schema/trace.schema.json              │
└─────────────┬──────────────────────────────────────────────────────────────────┘
              │  ▼ job: language image + user source + example input
              │  ▲ raw trace  (untrusted: validated before it goes any further)
              ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ SANDBOX  (untrusted code runs here)                                            │
│                                                                                │
│   no network · CPU / memory / time limits · short-lived                        │
│   one container image per language (toolchain + tracer)                        │
│                                                                                │
│   LANGUAGE ADAPTER                                                             │
│     1. driver       wraps the user's Solution, calls it on the example         │
│     2. tracer       observes the run, one snapshot per executed line           │
│     3. normalizer   language values -> trace kinds (array, map, ref ...)       │
│     also derives the problem metadata: neutral types, inferred hints           │
└────────────────────────────────────────────────────────────────────────────────┘
```

| Component | Responsibility | Language-aware? |
|---|---|---|
| **Frontend** | Replays a trace: highlights the current line, draws each structure, animates changes | **No** |
| **API service** | Receives the source and example, orchestrates jobs, **validates every trace** | **No** |
| **Sandbox** | Runs untrusted code with strict limits | Only the image it starts from |
| **Language adapter** | Driver, tracer, normalizer, problem metadata and hints | **Yes. This is the only place language knowledge lives** |

Everything that comes out of the sandbox is treated as **untrusted data**. The user's code runs in the same environment as the tracer, so the trace is checked against the schema outside the sandbox before the frontend ever sees it.

### 2. Inside a language adapter

An adapter turns "the user's code plus an example" into a trace. Four stages:

```
┌────────────────────────────────────────────────────────────────────────────────┐
│ 1. DRIVER                                                                      │
│                                                                                │
│   wraps the user's Solution in a main()                                        │
│   parses the example into the method's argument types                          │
│   supplies LeetCode helpers (ListNode, TreeNode, Node)                         │
│   derives the problem metadata: neutral param types, inferred hints            │
└─────────────┬──────────────────────────────────────────────────────────────────┘
              │  the program runs
              ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ 2. OBSERVE   get control just before each line of user code runs               │
│                                                                                │
│   pick ONE strategy per language:                                              │
│     A. runtime hooks      Python sys.settrace · V8 inspector · JVM debug API   │
│     B. source instrument  rewrite code to call TRACE(line, vars...)  (C++, Go) │
│     C. DAP client         one generic client driving lldb-dap, debugpy, dlv ...│
│                                                                                │
│   details: native-tracing.md (A, B)   dap.md (C)                               │
└─────────────┬──────────────────────────────────────────────────────────────────┘
              │  'about to run line N' + the live variables
              ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ 3. SNAPSHOT                                                                    │
│                                                                                │
│   deep-copy the state at this instant (never keep live references)             │
│   record: step index, line (in the user's original source), locals             │
└─────────────┬──────────────────────────────────────────────────────────────────┘
              │  native values: vector, unordered_map, stack, TreeNode*, dict ...
              ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ 4. NORMALIZE                                                                   │
│                                                                                │
│   native values -> trace kinds: array · list · stack · queue · deque           │
│     priority-queue · tuple · set · map · object · ref · int · float            │
│   pointers / references -> stable ids (n1, n2 ...), never addresses            │
│   unknown type -> fail loudly, never emit raw debugger or runtime text         │
└─────────────┬──────────────────────────────────────────────────────────────────┘
              │  one step of the trace
              ▼
trace JSON:  steps[] + result      (format: docs/trace-format.md)
```

- **Only stage 2 differs fundamentally between languages.** Stages 3 and 4 have the same shape everywhere but different details.
- Native tracers usually do stages 3 and 4 in one pass. A DAP client normalizes what the debugger returned after the fact.
- **Every observation strategy ends in the same normalized kinds and the same schema validation.** The frontend cannot tell which strategy produced a trace.

### 3. Inside the frontend

```
trace JSON  (from the API service)
              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ TRACE LOADER                                                         │
│   checks the version (rejects unsupported versions), indexes steps   │
└─────────────┬────────────────────────────────────────────────────────┘
              ▼
┌──────────────────────────────────────────────────────────────────────┐
│ STEP PLAYER                                                          │
│   holds the current step index · play · pause · step · scrub         │
│   any step draws from its own data, so rewind and jump are free      │
└─────────────┬────────────────────────────────────┬───────────────────┘
              ▼                                    ▼
┌──────────────────────────┐  ┌────────────────────────────────────────┐
│ CODE PANEL               │  │ DIFF  +  RENDERER REGISTRY             │
│   highlights step.line   │  │   diff step N-1 -> N:                  │
│   in the user's own      │  │   added / removed / changed            │
│   source code            │  │   pick a renderer by value             │
│                          │  │   kind + the problem's hint            │
└──────────────────────────┘  └────────────────────┬───────────────────┘
                                                   ▼
┌──────────────────────────────────────────────────────────────────────┐
│ RENDERERS   (one per structure, shared by every language)            │
│   array · grid · list · stack · queue · deque · priority queue       │
│   tuple · map · set · linked list · tree · graph · fallback          │
└──────────────────────────────────────────────────────────────────────┘
```

The frontend picks a renderer in this order: the user's "view as" override, then the inferred hint, then the value `kind`, then the shape of an `object`, then a generic fallback.

| Trace value | Hint | Renderer |
|---|---|---|
| `array` | | Indexed boxes with pointer markers (`i`, `left`, `right`) |
| `array` of `array` | `grid` / `adjacency-matrix` | 2D grid |
| `array` of `array` | `adjacency-list` / `edge-list` / `graph` | Node-link diagram |
| `array` of `array` | `intervals` | Intervals on a number line |
| `list` | | Chain of value nodes |
| `stack` | | Vertical column, top at the top |
| `queue` / `deque` | | Horizontal row, front at the left |
| `priority-queue` | | Array plus tree view, top highlighted |
| `tuple` | | Fixed group of values |
| `map` | | Key-value table |
| `set` | | Set of items |
| `object` + `ref` | `tree`, or shape `val` + `left` + `right` | Tree layout |
| `object` + `ref` | `linked-list`, or shape `val` + `next` | Nodes and arrows |
| `object` + `ref` | `graph`, or shape `val` + `neighbors` | Node-link diagram |
| unknown kind | | Generic fallback |

An `array<array<int>>` could be a grid, an adjacency list, or intervals. The adapter infers a hint, and a user-selectable "view as" override corrects it, so the ambiguity is resolved once instead of once per language.

### 4. Why a trace format sits in the middle

```
WITHOUT a shared format          (L x R)    WITH a shared format             (L + R)

C++    ──► array   map   tree               C++    ─┐               ┌─► array
Python ──► array   map   tree               Python ─┼─► TRACE ──────┼─► map
Java   ──► array   map   tree               Java   ─┘               └─► tree

3 languages x 3 renderers                   3 adapters + 3 renderers
= 9 pieces of glue code                     = 6 pieces of code
```

Adding a language costs one adapter. Adding a renderer works for every language at once. The trace format is the only thing both sides share, so it is the only thing that must stay stable.

### 5. Worked example: Two Sum

Input `nums = [2, 7, 11, 15]`, `target = 9`, using the `Solution` from LeetCode as-is. The full trace is in [`fixtures/two-sum.trace.json`](fixtures/two-sum.trace.json). One step of it:

```json
{
  "step": 5,
  "line": 8,
  "locals": {
    "nums":   {"kind": "array", "items": [2, 7, 11, 15]},
    "target": 9,
    "numMap": {"kind": "map", "entries": [[2, 0]]},
    "i": 1
  },
  "heap": {}
}
```

What the frontend draws for that step:

```
  line 8:   int complement = target - nums[i];      <- highlighted in the code panel

  nums     ┌────┬────┬────┬────┐
           │  2 │  7 │ 11 │ 15 │
           └────┴────┴────┴────┘
              0    1    2    3
                   ▲
                   i

  numMap   ┌─────┬───────┐
           │ key │ value │
           ├─────┼───────┤
           │  2  │   0   │     <- added since the last visit to line 8 (found by the diff)
           └─────┴───────┘
```

The frontend reads `nums` as an `array` and `numMap` as a `map`. It never learns that `numMap` was a C++ `unordered_map`.

---

## The trace format in brief

The full specification is [`docs/trace-format.md`](docs/trace-format.md). The short version: every value is a primitive or a tagged object, and the `kind` field says which renderer applies. The type decides the kind:

```json
{"kind": "array",          "items": [2, 7, 11, 15]}
{"kind": "stack",          "items": [1, 2, 3]}
{"kind": "queue",          "items": [1, 2, 3]}
{"kind": "priority-queue", "items": [5, 4, 3, 1, 1], "order": "max"}
{"kind": "tuple",          "items": [0, "a"]}
{"kind": "set",            "items": [1, 2]}
{"kind": "map",            "entries": [[2, 0]]}
{"kind": "ref",            "id": "n3"}
```

The full list (`array`, `list`, `stack`, `queue`, `deque`, `priority-queue`, `tuple`, `set`, `map`, `object`, `ref`, `int`, `float`) is in the [summary of kinds](docs/trace-format.md#summary-of-kinds). What the type cannot say, such as whether an `array` of `array`s is a grid or a graph, is a **hint** that the adapter infers.

Numbers are plain JSON whenever JavaScript can read them back exactly. Two cases cannot be, so they are tagged, with the exact value kept in a string:

```json
{"kind": "int",   "value": "9007199254740993"}
{"kind": "float", "value": "NaN"}
```

`int` is for integers outside ±(2^53 − 1), which `JSON.parse` would silently round. `float` is for `NaN`, `Infinity`, and `-Infinity`, which JSON has no syntax for. See [numbers JSON cannot carry exactly](docs/trace-format.md#numbers-json-cannot-carry-exactly).

For linked structures (trees, linked lists, graphs) the trace uses Python Tutor's approach: a **heap of objects with ids**, plus **references** between them. A C++ `TreeNode*`, a Python `TreeNode` object, and a Java `TreeNode` reference all become the same thing:

```json
{
  "locals": {"root": {"kind": "ref", "id": "n3"}},
  "heap": {
    "n3": {"kind": "object", "type": "TreeNode",
           "fields": {"val": 5,
                      "left":  {"kind": "ref", "id": "n4"},
                      "right": null}},
    "n4": {"kind": "object", "type": "TreeNode",
           "fields": {"val": 3, "left": null, "right": null}}
  }
}
```

The frontend recognizes a tree by shape (an object with `val`, `left`, and `right`), or from a hint in the problem metadata such as "this parameter is a `TreeNode`". See [value model](docs/trace-format.md#5-the-value-model) and [steps](docs/trace-format.md#6-steps).

---

## Language-agnostic design

**Language-agnostic** means the visualizer never depends on the language a solution was written in. A solution in C++, Python, Java, or any other supported language produces the same visualization for the same problem and input.

It works because the system is split into two halves that communicate only through the shared trace format:

1. **Language adapters (backend).** Each supported language has an adapter with three jobs:
   - **Driver generation:** wrap the user's `Solution` so it can be called with the parsed example. LeetCode signatures differ by language (`vector<int>&` vs `List[int]` vs `int[]`), but every adapter derives the same problem metadata (parameter names, neutral types, inferred hints).
   - **Tracing:** run the code and record a snapshot per step.
   - **Normalization:** convert language-specific values (`std::unordered_map`, `dict`, `HashMap`) into the shared value model.
2. **Visualization engine (frontend).** Reads only the trace. It knows nothing about C++ or Python, chooses a renderer from the normalized kinds, and animates the changes between steps.

```
C++ adapter    ─┐
Python adapter ─┤
Java adapter   ─┼──► common trace format ──► same frontend
Rust adapter   ─┤
JS/TS adapter  ─┘
```

### What this guarantees
- Adding a new language requires only a new adapter. The frontend and trace schema stay unchanged.
- Adding a new data structure renderer works for every language at once.
- Two solutions to the same problem in different languages can be compared side by side, because they emit the same kind of trace.

### What this does not mean
- It does not mean translating code between languages. Each solution runs in its own language.
- It does not mean every language produces identical traces. Different algorithms, iteration orders (for example, hash maps), and value semantics (copy vs. reference) can still change what is shown. The model normalizes *representation*, not *behavior*. See [rules for adapter authors](docs/trace-format.md#8-rules-for-adapter-authors).
- It does not mean all languages are supported on day one. The trace format is the contract, and languages are added incrementally.

---

## Tracing strategies

An adapter observes the running program in one of three ways. All three end in the same normalized trace.

| Strategy | How it works | Good for | Doc |
|---|---|---|---|
| **Runtime hooks** | The runtime calls our code before each line (Python `sys.settrace`, V8 inspector, JVM debug interfaces) | Python, JavaScript, Java | [`native-tracing.md`](docs/native-tracing.md) |
| **Source instrumentation** | Rewrite the code to call `TRACE(...)` before each statement, then run it | C++, Go (full control over STL serialization) | [`native-tracing.md`](docs/native-tracing.md) |
| **DAP client** | One generic client drives an external debugger (`lldb-dap`, `debugpy`, `dlv`) | Breadth: adding languages cheaply | [`dap.md`](docs/dap.md) |

The dividing line is who writes the per-language logic. With native tracing we write a tracer per language. With DAP the stepping logic is written once, and what remains per language is a launch configuration and normalization rules.

Planned order: **C++** (instrumentation, in progress) and **Python** (runtime hooks) first, then others, using DAP where a native tracer would be expensive.

---

## Design decisions

These are the decisions that shaped the project. Each links to where it is explained in full.

| Decision | Why | Details |
|---|---|---|
| **Contract first.** A trace format sits between backend and frontend | Turns an L × R problem into L + R, and lets each half be built and tested alone | [`trace-format.md` §1](docs/trace-format.md#1-why-this-exists) |
| **Snapshots, not an event log** | Any step draws from its own data, so rewind and jump are free. Costs size, which is negligible for small examples with a step cap | [`trace-format.md` §6](docs/trace-format.md#6-steps) |
| **Normalize representation, never hide behavior** | The same concept always looks the same in the trace, but real differences (map ordering, overflow) are not erased | [`trace-format.md` §8](docs/trace-format.md#8-rules-for-adapter-authors) |
| **Deliberately lossy** | Drops addresses, buckets, capacity. A small format is a stable format | [`trace-format.md` §2](docs/trace-format.md#2-design-principles) |
| **Abstract, not primitive** | The trace raises `unordered_map` and `dict` up to one concept (`map`) instead of lowering toward the machine like a compiler IR | [`trace-format.md` §1](docs/trace-format.md#1-why-this-exists) |
| **The type decides the kind, the problem decides the hint** | `stack<int>` is a `stack` from its type alone. Whether an `array` of `array`s is a grid or a graph is only knowable from the problem, so it is a hint | [`trace-format.md` §5](docs/trace-format.md#summary-of-kinds) |
| **Hints are inferred, never asked for** | There is no problem catalog. The adapter infers hints from types, parameter names, and code patterns, and a "view as" override corrects them | [`trace-format.md` §4](docs/trace-format.md#4-problem-metadata) |
| **Bare numbers only when exact** | Integers beyond ±(2^53 − 1) and NaN/±Infinity are tagged so JavaScript never silently rounds or fails to parse | [`trace-format.md` §5](docs/trace-format.md#numbers-json-cannot-carry-exactly) |
| **Tracer output is untrusted** | User code runs next to the tracer, so run it in a sandbox and validate the trace outside it | [`native-tracing.md` §6](docs/native-tracing.md#6-security) |
| **Two observation strategies behind one contract** | Native tracing gives control, DAP gives breadth. The frontend cannot tell them apart | [`dap.md` §8](docs/dap.md#8-native-tracing-vs-dap) |

---

## Open questions

Gaps in the trace format that the tracing work exposed. They are planned for a minor version. Details in [`native-tracing.md` §8](docs/native-tracing.md#8-open-questions).

1. **Call stack.** A step records one frame's `locals`. Recursive solutions (tree DFS, backtracking) need a stack of frames.
2. **Aliasing of containers.** Only objects have ids, so two variables pointing at the same container appear as two copies.
3. **Member variables.** Fields on the `Solution` instance (memo tables, visited sets) have nowhere to go yet.
4. **A `ref` result has no heap.** Heaps are per-step, so a returned `TreeNode*` has nothing to resolve against. A top-level result heap is the likely fix.

Tuples, which v0.1 flattened to `list`, are resolved in v0.2 by the `tuple` kind.

---

## Repository layout

Items marked *(planned)* do not exist yet.

```
.
├── README.md
├── CLAUDE.md                  rules for working in this repo
├── Skills.md                  repeatable procedures
├── LICENSE
├── .clang-format              C++ formatting (attached braces, 2 spaces)
├── docs/
│   ├── trace-format.md        the contract
│   ├── native-tracing.md      runtime hooks and source instrumentation
│   ├── dap.md                 DAP-based tracing
│   ├── driver-generation.md   signatures, example parsing, helper types
│   ├── frontend.md            the sandbox page: registry, diff, playback
│   ├── sandboxing.md          isolation, limits, where validation runs
│   └── adapters/
│       ├── cpp.md             the C++ adapter
│       └── python.md          the Python adapter
├── schema/
│   └── trace.schema.json      machine-readable contract
├── fixtures/
│   ├── two-sum.trace.json     golden trace
│   └── two_sum_trace.cpp      the Two Sum solution the trace records
├── adapters/
│   └── cpp/
│       ├── Makefile           build and run the adapter's tests
│       ├── runtime/
│       │   └── trace.hpp      serializers: C++ values -> trace kinds
│       └── tests/
│           └── test_serialize.cpp
├── frontend/                  sandbox page (React + TypeScript + Vite)
│   ├── CLAUDE.md              commands, structure, rules
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx            the page: layout, language select, shortcuts
│       ├── fixtures.ts        stand-in for the backend (imports fixtures/)
│       ├── trace/             types, loader, value formatting, diff
│       ├── player/            playback reducer and Run timer
│       ├── render/            renderer registry and renderers
│       ├── components/        toolbar, code, visual, state panels
│       ├── editor/            Monaco setup, theme, starter templates
│       └── styles/            theme tokens and layout
└── backend/                   (planned) API service and sandbox runner
```

## Tech stack (proposed)

Tentative. The architecture does not depend on these choices.

| Layer | Choice |
|---|---|
| C++ adapter | C++20, header-only runtime, Clang LibTooling for the rewriter |
| Frontend | React + TypeScript + Vite, Monaco editor for the code panel |
| Renderers | SVG with Framer Motion for arrays and maps, React Flow or Cytoscape for graphs and trees |
| API service | FastAPI (or Go) |
| Sandbox | gVisor, nsjail, or Firecracker, with strict CPU, memory, and time limits |
| Contract | JSON Schema, validated in CI and at runtime |

## Roadmap

- [x] Trace format specification and JSON Schema (v0.2)
- [x] Tracing strategy docs (native, DAP)
- [x] C++ serializers for every value kind except `object` and `ref`
- [ ] C++ recorder (`TRACE`, step cap, trace file), checked on a hand-instrumented Two Sum
- [ ] Frontend: loader, step player, code panel, a renderer per kind, developed against fixtures
- [ ] Pointers: `object` and `ref` for `ListNode`, `TreeNode`, `Node`, with linked list, tree, and graph renderers
- [ ] Any C++ solution: driver generation, LibTooling rewriter, hint inference
- [ ] Resolve the open questions above (call stack first)
- [ ] API service and sandbox
- [ ] Python adapter, proving the schema is truly language-neutral
- [ ] More renderers (union-find, trie), diff animations, "view as" override

## Getting started

There is nothing to run end to end yet. You can run the C++ adapter's tests, validate the fixture, and open the frontend's sandbox page, which replays the Two Sum fixture.

```bash
# Prerequisites: clang++ or g++ with C++20 <format> support, make, Python 3

# Run the C++ serializer tests (clang++ by default)
make -C adapters/cpp
make -C adapters/cpp both          # with clang++ and with g++

# Validate a trace against the schema
pip install jsonschema
# then run the validation command in CLAUDE.md
```

```bash
# Prerequisites: Node.js 20.19+ and npm

cd frontend
npm install
npm run dev        # sandbox page on http://localhost:5173
npm test           # vitest
npm run build      # typecheck + production build
```

## Adding a new language

An adapter needs a driver template, a tracer (or a DAP configuration), a normalizer, helper types, and a container image. The frontend and trace schema do not change. The full checklist is in [`trace-format.md` §11](docs/trace-format.md#11-adding-a-new-language), and the how-to is in [`CONTRIBUTING.md`](CONTRIBUTING.md) *(planned)*.

## License

Released under the [MIT License](LICENSE).

## Acknowledgements

- [Python Tutor](https://pythontutor.com) for the heap-of-objects-plus-references model of program state.
- The [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/) for the idea that one client can drive many language backends.