# LeetCode-Visualizer

## Goals
I am currently practicing LeetCode style questions, but for most students, including myself, learn much better visually rather than conceptually. Seeing the problem unfold and understanding why one solution may not work while another might as a data structure on the screen feels more tangible. Instead of picturing how a data structure works in a given problem, a visual can help immensely.

I want to help other aspiring software engineers with their goals of getting their dream job, and most of the time they need to go though multiple rounds of technical interviews, which are more often than not a multitude of LeetCode-style questions. With this in mind, those who are also visuals learners should use this tool to understand a given problem.

The rest of the file goes over the project, including the architecture, and decisions made throughout the process.

---

## What it does

You paste a LeetCode `Solution` class, pick an example, and step through it. At every step the tool shows the line being executed and draws the data structures the solution is using (array, hash map, linked list, tree, graph, ...) as they change.

It works with the `Solution` class exactly as LeetCode gives it to you. No annotations or rewriting by hand are needed.

## Status

> **Design phase.** The contract between the two halves of the system is specified and validated. Implementation is next. Update this table as pieces land.

| Area | Status |
|---|---|
| Trace format specification | Draft v0.1 |
| JSON Schema + golden fixture (Two Sum) | Done, validated |
| Tracing strategy docs (native, DAP) | Draft v0.1 |
| Language adapters (C++, Python) | Planned |
| Frontend and renderers | Planned |
| API service + sandbox | Planned |

---

## Documentation map

Start with the trace format. Everything else hangs off it.

| Document | Read it to learn | Status |
|---|---|---|
| [`trace-format.md`](trace-format.md) | The contract between backend and frontend: value kinds, steps, rules for adapter authors | Draft v0.1 |
| [`native-tracing.md`](native-tracing.md) | How an adapter observes a program using runtime hooks or source instrumentation | Draft v0.1 |
| [`dap.md`](dap.md) | How an adapter observes a program through a debugger using the Debug Adapter Protocol | Draft v0.1 |
| [`schema/trace.schema.json`](schema/trace.schema.json) | The machine-readable version of the contract. Every adapter's output must validate against it | v0.1 |
| [`fixtures/two-sum.trace.json`](fixtures/two-sum.trace.json) | A golden trace for the Two Sum example | v0.1 |

Planned. These links are templates: create the file, then update its status.
<!-- TODO: create each file below, then change "Planned" to its real status. -->

| Document | Will cover | Status |
|---|---|---|
| [`docs/driver-generation.md`](docs/driver-generation.md) | Parsing method signatures and example input, LeetCode helper types | Planned |
| [`docs/frontend.md`](docs/frontend.md) | Renderer registry, diffing, animation, the "view as" override | Planned |
| [`docs/sandboxing.md`](docs/sandboxing.md) | Isolation, resource limits, where validation runs | Planned |
| [`docs/adapters/cpp.md`](docs/adapters/cpp.md) | The C++ adapter: instrumentation, STL normalization rules | Planned |
| [`docs/adapters/python.md`](docs/adapters/python.md) | The Python adapter: `sys.settrace`, normalization rules | Planned |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute, how to add a language | Planned |
| [`LICENSE`](LICENSE) | License | TODO |

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
│   problem picker · code panel · step controls                                  │
│   trace player · diff animator · renderer registry                             │
│                                                                                │
│   Knows only the trace format. Never knows which language ran.                 │
└─────────────┬──────────────────────────────────────────────────────────────────┘
              │  ▼ run request: problem id, language, source code
              │  ▲ validated trace (JSON), or an error
              ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ API SERVICE                                                                    │
│                                                                                │
│   loads problem metadata: param names, neutral types, hints, examples          │
│   starts one sandboxed job per run                                             │
│   validates every returned trace against schema/trace.schema.json              │
└─────────────┬──────────────────────────────────────────────────────────────────┘
              │  ▼ job: language image + user source + parsed example input
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
│     3. normalizer   language values -> trace kinds (list, map, ref ...)        │
└────────────────────────────────────────────────────────────────────────────────┘
```

| Component | Responsibility | Language-aware? |
|---|---|---|
| **Frontend** | Replays a trace: highlights the current line, draws each structure, animates changes | **No** |
| **API service** | Looks up problem metadata, orchestrates jobs, **validates every trace** | **No** |
| **Sandbox** | Runs untrusted code with strict limits | Only the image it starts from |
| **Language adapter** | Driver, tracer, normalizer | **Yes. This is the only place language knowledge lives** |

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
              │  native values: vector, unordered_map, TreeNode*, dict ...
              ▼
┌────────────────────────────────────────────────────────────────────────────────┐
│ 4. NORMALIZE                                                                   │
│                                                                                │
│   native values -> trace kinds: list · set · map · object · ref                │
│   pointers / references -> stable ids (n1, n2 ...), never addresses            │
│   unknown type -> fail loudly, never emit raw debugger or runtime text         │
└─────────────┬──────────────────────────────────────────────────────────────────┘
              │  one step of the trace
              ▼
trace JSON:  steps[] + result      (format: trace-format.md)
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
│   checks the version (rejects unsupported majors), indexes steps     │
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
│   array · grid · hash map · set · linked list · tree · graph · heap  │
└──────────────────────────────────────────────────────────────────────┘
```

The frontend picks a renderer from the value `kind`, plus the problem's `hint` when the data alone is ambiguous:

| Trace value | Hint | Renderer |
|---|---|---|
| `list` | `array` | Indexed boxes with pointer markers (`i`, `left`, `right`) |
| `list` of `list` | `grid` | 2D grid |
| `list` of `list` | `adjacency-list` / `graph` | Node-link diagram |
| `list` | `heap` | Array plus tree view |
| `map` | | Key-value table |
| `set` | | Set of items |
| `object` + `ref` | `tree` | Tree layout |
| `object` + `ref` | `linked-list` | Nodes and arrows |

A `list<list<int>>` could be a grid, an adjacency list, or intervals. The metadata hint plus a user-selectable "view as" override resolves that once, in the frontend, instead of once per language.

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
  "step": 2,
  "line": 8,
  "locals": {
    "nums":   {"kind": "list", "items": [2, 7, 11, 15]},
    "target": 9,
    "numMap": {"kind": "map", "entries": [[2, 0]]},
    "i": 1
  },
  "heap": {}
}
```

What the frontend draws for that step:

```
  line 8:   int compliment = target - nums[i];      <- highlighted in the code panel

  nums     ┌────┬────┬────┬────┐
           │  2 │  7 │ 11 │ 15 │
           └────┴────┴────┴────┘
              0    1    2    3
                   ▲
                   i

  numMap   ┌─────┬───────┐
           │ key │ value │
           ├─────┼───────┤
           │  2  │   0   │     <- added this step (found by the diff)
           └─────┴───────┘
```

The frontend reads `nums` as a `list` and `numMap` as a `map`. It never learns that `numMap` was a C++ `unordered_map`.

---

## The trace format in brief

The full specification is [`trace-format.md`](trace-format.md). The short version: every value is a primitive or a tagged object, and the `kind` field says which renderer applies.

```json
{"kind": "list", "items": [2, 7, 11, 15]}
{"kind": "set",  "items": [1, 2]}
{"kind": "map",  "entries": [[2, 0]]}
{"kind": "ref",  "id": "n3"}
```

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

The frontend recognizes a tree by shape (an object with `val`, `left`, and `right`), or from a hint in the problem metadata such as "this parameter is a `TreeNode`". See [value model](trace-format.md#5-the-value-model) and [steps](trace-format.md#6-steps).

---

## Language-agnostic design

**Language-agnostic** means the visualizer never depends on the language a solution was written in. A solution in C++, Python, Java, or any other supported language produces the same visualization for the same problem and input.

It works because the system is split into two halves that communicate only through the shared trace format:

1. **Language adapters (backend).** Each supported language has an adapter with three jobs:
   - **Driver generation:** wrap the user's `Solution` so it can be called with the parsed example. LeetCode signatures differ by language (`vector<int>&` vs `List[int]` vs `int[]`), but the problem metadata (parameter names, neutral types, examples) is the same.
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
- It does not mean every language produces identical traces. Different algorithms, iteration orders (for example, hash maps), and value semantics (copy vs. reference) can still change what is shown. The model normalizes *representation*, not *behavior*. See [rules for adapter authors](trace-format.md#8-rules-for-adapter-authors).
- It does not mean all languages are supported on day one. The trace format is the contract, and languages are added incrementally.

---

## Tracing strategies

An adapter observes the running program in one of three ways. All three end in the same normalized trace.

| Strategy | How it works | Good for | Doc |
|---|---|---|---|
| **Runtime hooks** | The runtime calls our code before each line (Python `sys.settrace`, V8 inspector, JVM debug interfaces) | Python, JavaScript, Java | [`native-tracing.md`](native-tracing.md) |
| **Source instrumentation** | Rewrite the code to call `TRACE(...)` before each statement, then run it | C++, Go (full control over STL serialization) | [`native-tracing.md`](native-tracing.md) |
| **DAP client** | One generic client drives an external debugger (`lldb-dap`, `debugpy`, `dlv`) | Breadth: adding languages cheaply | [`dap.md`](dap.md) |

The dividing line is who writes the per-language logic. With native tracing we write a tracer per language. With DAP the stepping logic is written once, and what remains per language is a launch configuration and normalization rules.

Planned order: **Python** (runtime hooks) and **C++** (instrumentation) first, then others, using DAP where a native tracer would be expensive.

---

## Design decisions

These are the decisions that shaped the project. Each links to where it is explained in full.

| Decision | Why | Details |
|---|---|---|
| **Contract first.** A trace format sits between backend and frontend | Turns an L × R problem into L + R, and lets each half be built and tested alone | [`trace-format.md` §1](trace-format.md#1-why-this-exists) |
| **Snapshots, not an event log** | Any step draws from its own data, so rewind and jump are free. Costs size, which is negligible for small examples with a step cap | [`trace-format.md` §6](trace-format.md#6-steps) |
| **Normalize representation, never hide behavior** | The same concept always looks the same in the trace, but real differences (map ordering, overflow) are not erased | [`trace-format.md` §8](trace-format.md#8-rules-for-adapter-authors) |
| **Deliberately lossy** | Drops addresses, buckets, capacity. A small format is a stable format | [`trace-format.md` §2](trace-format.md#2-design-principles) |
| **Abstract, not primitive** | The trace raises `unordered_map` and `dict` up to one concept (`map`) instead of lowering toward the machine like a compiler IR | [`trace-format.md` §1](trace-format.md#1-why-this-exists) |
| **Type ambiguity is solved once, with hints** | Problem metadata plus a "view as" override, instead of per-language heuristics | [`trace-format.md` §4](trace-format.md#4-problem-metadata) |
| **Tracer output is untrusted** | User code runs next to the tracer, so run it in a sandbox and validate the trace outside it | [`native-tracing.md` §6](native-tracing.md#6-security) |
| **Two observation strategies behind one contract** | Native tracing gives control, DAP gives breadth. The frontend cannot tell them apart | [`dap.md` §8](dap.md#8-native-tracing-vs-dap) |

---

## Open questions

Gaps in trace format v0.1 that the tracing work exposed. They are planned for a minor version. Details in [`native-tracing.md` §8](native-tracing.md#8-open-questions).

1. **Call stack.** A step records one frame's `locals`. Recursive solutions (tree DFS, backtracking) need a stack of frames.
2. **Aliasing of containers.** Only objects have ids, so two variables pointing at the same list appear as two copies.
3. **Member variables.** Fields on the `Solution` instance (memo tables, visited sets) have nowhere to go yet.
4. **Tuples and other immutables.** They currently flatten to `list`.

---

## Repository layout

Items marked *(planned)* do not exist yet.

```
.
├── README.md
├── trace-format.md            the contract
├── native-tracing.md          runtime hooks and source instrumentation
├── dap.md                     DAP-based tracing
├── schema/
│   └── trace.schema.json      machine-readable contract
├── fixtures/
│   └── two-sum.trace.json     golden trace
├── docs/                      (planned) driver generation, frontend, sandboxing, per-language adapters
├── adapters/                  (planned) one folder per language
├── frontend/                  (planned)
└── backend/                   (planned) API service and sandbox runner
```

## Tech stack (proposed)

Tentative. The architecture does not depend on these choices.

| Layer | Choice |
|---|---|
| Frontend | React + TypeScript + Vite, Monaco editor for the code panel |
| Renderers | SVG with Framer Motion for arrays and maps, React Flow or Cytoscape for graphs and trees |
| API service | FastAPI (or Go) |
| Sandbox | gVisor, nsjail, or Firecracker, with strict CPU, memory, and time limits |
| Contract | JSON Schema, validated in CI and at runtime |

## Roadmap

- [x] Trace format specification and JSON Schema
- [x] Tracing strategy docs (native, DAP)
- [ ] Resolve the open questions above (call stack first)
- [ ] First adapter, plus frontend renderers (array, map, linked list, tree, graph) developed against golden fixtures
- [ ] Second language adapter, proving the schema is truly language-neutral
- [ ] API service and sandbox
- [ ] More renderers (heap, union-find, trie), diff animations, "view as" override

## Getting started

<!-- TODO: fill in once there is something to run. -->

```bash
# Prerequisites: TODO
# Install:       TODO
# Run:           TODO
```

## Adding a new language

An adapter needs a driver template, a tracer (or a DAP configuration), a normalizer, helper types, and a container image. The frontend and trace schema do not change. The full checklist is in [`trace-format.md` §11](trace-format.md#11-adding-a-new-language), and the how-to is in [`CONTRIBUTING.md`](CONTRIBUTING.md) *(planned)*.

## License

<!-- TODO: choose a license and add a LICENSE file. -->

## Acknowledgements

- [Python Tutor](https://pythontutor.com) for the heap-of-objects-plus-references model of program state.
- The [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/) for the idea that one client can drive many language backends.