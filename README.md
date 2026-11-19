# LeetCode-Visualizer

## Goals
I am currently practicing LeetCode style questions, but for most students, including myself, learn much better visually rather than conceptually. Seeing the problem unfold and understanding why one solution may not work while another might as a data structure on the screen feels more tangible. Instead of picturing how a data structure works in a given problem, a visual can help immensely.

I want to help other aspiring software engineers with their goals of getting their dream job, and most of the time they need to go though multiple rounds of technical interviews, which are more often than not a multitude of LeetCode-style questions. With this in mind, those who are also visuals learners should use this tool to understand a given problem.

The rest of the file goes over the project, including the architecture, and decisions made throughout the process.

---

## What it does

You paste a LeetCode `Solution` class, give it an example input, and step through it. At every step the tool shows the line being executed and draws the data structures the solution is using (array, hash map, stack, queue, linked list, tree, graph, ...) as they change.

It works with the `Solution` class exactly as LeetCode gives it to you. No annotations or rewriting by hand are needed. There is no problem catalog: everything the visualizer needs is derived from your code and the example.

**Supported problems: algorithmic ones**, where you call one method of `Solution` with arguments (Two Sum, Reverse Linked List, Maximum Depth of Binary Tree, Clone Graph, Subsets, ...). The page shows one input field per parameter of that method. **Design problems are not supported yet**: LRU Cache, Min Stack, and the like, where the example is a sequence of calls on an object you construct (`["LRUCache","put","get"]` with `[[2],[1,1],[1]]`). One trace covering a whole call sequence needs a change to the trace format; it is planned for later ([`docs/driver-generation.md` §8](docs/driver-generation.md)).

## Status

> **Implementation started.** The contract between the two halves of the system is specified and validated. The C++ adapter can serialize every value kind, including pointers (`ref` and `object`), record steps, and write a trace file: a hand-instrumented Two Sum reproduces the golden trace. The frontend's sandbox page traces the user's Solution through the API and replays it. Update this table as pieces land.

| Area | Status |
|---|---|
| Trace format specification | Draft v0.14 |
| JSON Schema + golden fixtures | v0.14, validated: Two Sum, Reverse Linked List, iterative preorder, Clone Graph, Maximum Depth (recursive), Subsets (backtracking), each in C++, Python, and Java, and each language's trace matching the C++ one call by call (`tools/compare_traces.py`) |
| Tracing strategy docs (native, DAP) | Draft v0.1 |
| C++ adapter: value serializers | Done for every kind, with tests. Pointers to `ListNode`, `TreeNode`, and any struct with a field table become `ref` + `object`, and so do those objects held by value |
| C++ adapter: recorder and trace file | Done, with tests. `make e2e` checks that a hand-instrumented Two Sum equals the golden trace, that a looping program stops at the step cap with a truncated trace, that a returned pointer comes with its `result_heap`, and that a `void` method's result is `null` |
| C++ adapter: iterators | Done, with tests. An iterator into a local container becomes an `iterator` value (`index`, `key`, or `end`); the rewriter pairs each iterator variable with its container and the runtime checks the type |
| C++ adapter: call stack | Done, with tests. A `Frame` guard per call, `ret` for return steps, a `Scope` guard per block, and every frame re-serialized live at each step. Recursive golden traces (Maximum Depth, Subsets) match on GCC and Clang |
| CI (GitHub Actions) | Set up: fixtures against the schema, C++ tests with libstdc++ and libc++, `make e2e`, the Python and Java adapters' tests and the call-by-call comparison of every fixture's twins, the rewriter and pipeline on Linux and macOS, the three sandbox images under Docker and gVisor, frontend tests and build |
| C++ adapter: driver | Done, with tests (`driver/`, Python). Reads the Solution's signature and LeetCode's commented node definitions, parses the example, and generates a prelude and `main`. Every golden fixture produces its golden trace through a generated `main` |
| C++ adapter: rewriter | Done, with tests (`adapters/cpp/rewriter/`, Clang LibTooling; needs LLVM, `brew install llvm`). Inserts the runtime's calls into a plain Solution without adding lines, including the outcomes of each line (conditions, statement-level stores, and the cells of local containers it read) and a step for each check of a loop's header. Every golden fixture is reproduced from its plain source |
| CLI (`pipeline/`) | Done, with tests. `python3 -m pipeline` runs driver, rewriter, compiler, program, and checker in one command, for C++, Python, or Java (`--language`, or from the file's extension). Without `--sandbox` it runs the code directly with a time limit |
| Sandbox (`sandbox/`, `--sandbox docker` or `gvisor`) | Done, with tests. One image per language (C++, Python, Java). One locked-down container per run (no network, capped memory, CPU, processes, and disk, read-only, not root) runs the rewriter, compiler, and program; gVisor underneath, also on macOS through Colima. Driver and validation stay outside. A run takes about 2 s under Docker (a precompiled header, one `docker exec` per step, containers started ahead of time) |
| Python adapter | Done, with tests (`adapters/python/`, `driver/python/`). `sys.settrace` gives the steps, and a rewrite of the Solution's syntax tree gives the outcomes (conditions, stores, reads) and `indexes`; heapq lists are min priority queues, and `sortedcontainers` is available. Runs on Python 3.12 in its own sandbox image. Every Python fixture equals its golden trace, is like the C++ one (`check_trace.py --like`), and matches it call by call |
| Java adapter | Done, with tests (`adapters/java/`, `driver/java/`). Source instrumentation like C++, with the JDK's own parser: the rewriter inserts steps, outcomes, and return steps on the user's lines and compiles with javac in the same JVM; a `Deque` used only through push, pop, and peek is a stack. Runs on JDK 21 in its own sandbox image. Every Java fixture equals its golden trace, is like the C++ one, and matches it call by call |
| Frontend: sandbox page (loader, player, code panel, renderers, diff) | In progress, reads trace v0.14: a dark and a light theme, a canvas that shows the sandbox at work during a run, an Output tab for what the program printed, a renderer for every container kind, pointer markers under an array for the locals the code indexes it with (v0.9 `indexes`), linked lists, trees, and graphs drawn from the heap with pointer tags and highlights, a dashed outline on the cells and entries the running line read (`read` outcomes), strings as strips of characters with their pointers, the `Solution`'s members as cards tagged `member`, a recursion card (tree or stack view) that folds large runs, a call-stack card for void recursion, a state panel with the running statement and what it produced (from v0.8 outcomes), and motion throughout |
| Frontend: input form and real runs | Done, redesigned, for C++, Python, and Java (the language select, and an Examples menu of eight problems in each). The page opens on the bare Two Sum Solution; one field per parameter of the chosen method, read from the pasted Solution; pasting a LeetCode example fills them; Run code (top bar, Cmd/Ctrl + Enter) sends them to the API, and a playback bar with Restart replays the trace that comes back |
| Frontend: hint renderers and "view as" | Done: a 2D array as a graph (adjacency list, edge list, adjacency matrix) or as intervals, from the parameter's hint or the card's View menu |
| Frontend: home page | First version. The default route (`#/`, a hash route; the sandbox is `#/sandbox`): the pitch, a live preview that replays the Reverse Linked List golden trace through the real canvas, six example problems that open the sandbox with their Solution and inputs filled in, how a run works, and the languages. The sandbox is loaded only when opened |
| API service (`backend/`, FastAPI) | Done, with tests. `/api/signature` reads a Solution's methods and parameters; `/api/run` runs the pipeline under gVisor and returns the validated trace or the stage that failed. Size caps, slots and a capped line that answers "Busy" at once, one run per visitor, and the visitor's address taken only from a trusted proxy. A load test of 60 runs at once keeps `/api/signature` under 10 ms |

---

## Documentation map

Start with the trace format. Everything else hangs off it.

| Document | Read it to learn | Status |
|---|---|---|
| [`docs/trace-format.md`](docs/trace-format.md) | The contract between backend and frontend: value kinds, steps, rules for adapter authors | Draft v0.14 |
| [`docs/native-tracing.md`](docs/native-tracing.md) | How an adapter observes a program using runtime hooks or source instrumentation | Draft v0.1 |
| [`docs/dap.md`](docs/dap.md) | How an adapter observes a program through a debugger using the Debug Adapter Protocol | Draft v0.1 |
| [`schema/trace.schema.json`](schema/trace.schema.json) | The machine-readable version of the contract. Every adapter's output must validate against it | v0.14 |
| [`fixtures/two-sum.trace.json`](fixtures/two-sum.trace.json) | A golden trace for the Two Sum example. The other golden traces sit next to it | v0.14 |
| [`adapters/cpp/runtime/trace.hpp`](adapters/cpp/runtime/trace.hpp) | The C++ runtime: serializers, recorder, and document writer | In progress |
| [`CLAUDE.md`](CLAUDE.md) / [`Skills.md`](Skills.md) | Rules and repeatable procedures for working in this repo | Draft |
| [`docs/driver-generation.md`](docs/driver-generation.md) | Parsing method signatures and example input, LeetCode helper types | Draft v0.2, implemented for C++ |
| [`docs/frontend.md`](docs/frontend.md) | The sandbox page: layout, renderer registry, linked structures, calls cards, diffing, motion, playback, dark and light themes; and the home page and its routes | Draft v0.17 |
| [`frontend/CLAUDE.md`](frontend/CLAUDE.md) | Frontend commands, structure, theme tokens, and rules | Draft |
| [`docs/sandboxing.md`](docs/sandboxing.md) | The sandbox: isolation, resource limits, how files get in and out, where validation runs, how a run can end, gVisor on macOS | Draft v0.2, implemented |
| [`docs/backend.md`](docs/backend.md) | The API service: endpoints, errors and status codes, limits, settings, running it with the frontend | Draft v0.1, implemented |
| [`docs/hint-inference.md`](docs/hint-inference.md) | How an adapter will work out which structure a value is when its type does not say | Proposal, not started |
| [`docs/adapters/cpp.md`](docs/adapters/cpp.md) | The C++ adapter: instrumentation, STL normalization rules | Draft |
| [`docs/adapters/python.md`](docs/adapters/python.md) | The Python adapter: `sys.settrace`, the syntax-tree rewrite for outcomes, normalization rules, the driver | Draft v0.14 |
| [`docs/adapters/java.md`](docs/adapters/java.md) | The Java adapter: the rewriter on the JDK's parser, the runtime, normalization rules, the driver | Draft v0.14 |
| [`LICENSE`](LICENSE), [`NOTICE`](NOTICE) | Apache License 2.0 terms, and the copyright notice that must travel with copies | Done |

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
│     B. source instrument  rewrite code to call record(line, vars...) (C++, Go) │
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
│     iterator (a position in a local container)                                 │
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
  "frames": [
    {"id": "f1", "function": "twoSum", "line": 8,
     "locals": {
       "nums":   {"kind": "array", "items": [2, 7, 11, 15]},
       "target": 9,
       "numMap": {"kind": "map", "entries": [[2, 0]]},
       "i": 1
     }}
  ],
  "heap": {}
}
```

`frames` is the call stack, bottom to top. Two Sum calls no function of its own, so it always has one frame. A recursive solution has one frame per call level, each with its own `line` and `locals`, and every call ends with a **return step** whose top frame carries `return_value`, so you can watch the answer travel back up the stack. See [steps](docs/trace-format.md#6-steps).

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

The full list (`array`, `list`, `stack`, `queue`, `deque`, `priority-queue`, `tuple`, `set`, `map`, `object`, `ref`, `int`, `float`, and `iterator` for a position in a container) is in the [summary of kinds](docs/trace-format.md#summary-of-kinds). A container reached from more than one place, such as two names for one list, carries the same `id` at every place, so the frontend can show they are one ([shared containers](docs/trace-format.md#shared-containers)). What the type cannot say, such as whether an `array` of `array`s is a grid or a graph, is a **hint** that the adapter infers.

Numbers are plain JSON whenever JavaScript can read them back exactly, as the kind they are. Three cases cannot be, so they are tagged, with the exact value kept in a string:

```json
{"kind": "int",   "value": "9007199254740993"}
{"kind": "float", "value": "NaN"}
{"kind": "float", "value": "3.0"}
```

`int` is for integers outside ±(2^53 − 1), which `JSON.parse` would silently round. `float` is for `NaN`, `Infinity`, and `-Infinity`, which JSON has no syntax for, and for whole floats like `3.0`, which a bare `3` would turn into an int. See [numbers JSON cannot carry exactly](docs/trace-format.md#numbers-json-cannot-carry-exactly).

A trace also says how the run ended. `result` is present only when the method returned, and `"truncated": true` appears only when recording stopped at the 2,000-step limit. At the limit the adapter writes the trace straight away, so a solution stuck in an infinite loop still gives you a trace to step through instead of only a timeout. See [unfinished runs](docs/trace-format.md#unfinished-runs).

When the method returns a pointer, `result` is a `ref`, and the objects it points to come in a top-level `result_heap` with the same shape as a step's `heap` and the same ids. A `void` method that returned has `"result": null`, and the problem metadata says `"returns": {"type": "void"}`, which tells it apart from a returned null pointer. See [the return value](docs/trace-format.md#the-return-value).

For linked structures (trees, linked lists, graphs) the trace uses Python Tutor's approach: a **heap of objects with ids**, plus **references** between them. A C++ `TreeNode*`, a Python `TreeNode` object, and a Java `TreeNode` reference all become the same thing:

```json
{
  "frames": [{"id": "f1", "function": "maxDepth", "line": 4,
              "locals": {"root": {"kind": "ref", "id": "n3"}}}],
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

A step is taken before its line runs, so the top frame can also carry `outcomes`: what its line evaluated once it ran, such as a condition that was false, the value a store left, or the cell a read used (`dp[i - 1][j]`). The frontend shows them next to the line instead of guessing. See [outcomes](docs/trace-format.md#outcomes).

```json
"outcomes": [{"kind": "condition", "code": "numMap.count(complement)", "value": false}]
```

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
| **Source instrumentation** | Rewrite the code to call a recording function (`trace::record(...)` in C++) before each statement, then run it | C++, Go (full control over STL serialization) | [`native-tracing.md`](docs/native-tracing.md) |
| **DAP client** | One generic client drives an external debugger (`lldb-dap`, `debugpy`, `dlv`) | Breadth: adding languages cheaply | [`dap.md`](docs/dap.md) |

The dividing line is who writes the per-language logic. With native tracing we write a tracer per language. With DAP the stepping logic is written once, and what remains per language is a launch configuration and normalization rules.

Order: **C++** and **Java** (instrumentation) and **Python** (runtime hooks) are implemented; others follow, using DAP where a native tracer would be expensive.

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
| **Bare numbers only when exact** | Integers beyond ±(2^53 − 1), NaN/±Infinity, and whole floats are tagged so JavaScript never silently rounds, fails to parse, or turns 3.0 into an int | [`trace-format.md` §5](docs/trace-format.md#numbers-json-cannot-carry-exactly) |
| **Tracer output is untrusted** | User code runs next to the tracer, so run it in a sandbox and validate the trace outside it | [`native-tracing.md` §6](docs/native-tracing.md#6-security) |
| **Two observation strategies behind one contract** | Native tracing gives control, DAP gives breadth. The frontend cannot tell them apart | [`dap.md` §8](docs/dap.md#8-native-tracing-vs-dap) |

---

## Open questions

Gaps in the trace format that the tracing work exposed. They are planned for a minor version. Details in [`native-tracing.md` §8](docs/native-tracing.md#8-open-questions).

1. **Pointers that do not point at a live object.** A dangling or uninitialized C++ pointer is followed as if it were valid, and the trace has no way to say "this points at nothing". A documented limit for now ([`docs/adapters/cpp.md` §3.7](docs/adapters/cpp.md#37-limits-of-address-identity)).

Resolved: tuples, which v0.1 flattened to `list`, have the `tuple` kind since v0.2. A `ref` result, which had no heap to point into, has `result_heap` since v0.5. The call stack, which recursive solutions need, is `frames` with return steps since v0.6. Iterators, which had no kind and were left out, are `iterator` values naming a local container since v0.7. What a line evaluated, a condition's result or the value a store left, is the top frame's `outcomes` since v0.8. Which locals index which array, which a list of conventional names guessed at, is `indexes` since v0.9. Which cells a line read, which nothing recorded, is the `read` outcome since v0.10. Member variables of the `Solution` (memo tables, visited sets), which had nowhere to go, are a step's `members` since v0.12. A whole float, which a bare `3` made look like an int, is a tagged `float` since v0.13. Two names for one container, which looked like two copies, share an `id` since v0.14.

---

## Repository layout

Items marked *(planned)* do not exist yet.

```
.
├── README.md
├── CLAUDE.md                  rules for working in this repo
├── Skills.md                  repeatable procedures
├── LICENSE                    Apache License 2.0
├── NOTICE                     the copyright notice to keep with copies
├── .clang-format              C++ formatting (attached braces, 2 spaces)
├── .github/
│   └── workflows/
│       └── ci.yml             CI: fixtures, C++ and Python adapters, sandbox, frontend
├── docs/
│   ├── trace-format.md        the contract
│   ├── native-tracing.md      runtime hooks and source instrumentation
│   ├── dap.md                 DAP-based tracing
│   ├── driver-generation.md   signatures, example parsing, helper types
│   ├── frontend.md            the sandbox and home pages: registry, diff, playback, routes
│   ├── sandboxing.md          isolation, limits, where validation runs
│   ├── backend.md             the API service: endpoints, errors, limits
│   ├── hint-inference.md      (proposal) inferring hints
│   └── adapters/
│       ├── cpp.md             the C++ adapter
│       ├── python.md          the Python adapter
│       └── java.md            the Java adapter
├── schema/
│   └── trace.schema.json      machine-readable contract
├── fixtures/
│   ├── <name>.trace.json      golden traces: two-sum, reverse-list,
│   │                          preorder-traversal, clone-graph,
│   │                          max-depth, subsets
│   ├── <name>_trace.cpp       the solution each golden trace records
│   ├── <name>_hand_inst.cpp   the same solution, instrumented by hand
│   ├── <name>_trace.py        the same solution in Python
│   ├── <name>.python.trace.json  its golden trace (like the C++ one: check_trace.py --like)
│   ├── <name>_trace.java      the same solution in Java
│   └── <name>.java.trace.json its golden trace
├── tools/
│   ├── check_trace.py         validate a trace; compare with a fixture, or with another language's (--like)
│   └── compare_traces.py      two languages' traces of one Solution, call by call (--all: every fixture's twins)
├── pipeline/                  the CLI: python3 -m pipeline SOLUTION --example TEXT
│   ├── __init__.py            run(): driver, rewriter, compile, run, validate (C++ or Python)
│   ├── __main__.py            the command line and its exit codes
│   ├── runners.py             where stages 2 to 4 run: this machine, or a container (one image per language)
│   └── tests/                 every fixture end to end, each failure, each sandbox limit
├── sandbox/                   the sandbox (docs/sandboxing.md)
│   ├── cpp.Dockerfile         the C++ image: rewriter, clang++, runtime headers
│   ├── cpp.Dockerfile.dockerignore  its build context
│   ├── python.Dockerfile      the Python image: Python 3.12, sortedcontainers, the adapter
│   ├── python.Dockerfile.dockerignore  its build context
│   ├── java.Dockerfile        the Java image: JDK 21, the adapter compiled
│   ├── java.Dockerfile.dockerignore  its build context
│   └── colima-gvisor.yaml     gVisor on macOS: a Colima profile's runsc setup
├── driver/                    LeetCode's harness, rebuilt (Python): python3 -m driver
│   ├── example.py             example text -> neutral JSON (every language)
│   ├── shapes.py              LeetCode's notations for lists, trees, graphs (every language)
│   ├── hints.py               a 2D-array parameter's hint, from its name and the example's shape (every language)
│   ├── cpp/                   signature, node comments, prelude and main for C++
│   ├── python/                signature (type hints), node comments, run.json for Python
│   ├── java/                  signature, node comments, LvMain.java and Nodes.java for Java
│   └── tests/                 unit tests, compile-and-run tests, golden fixtures
├── adapters/
│   ├── python/
│   │   ├── run.py             the program: run.json in, the method run under the tracer, the trace out
│   │   ├── tracer.py          sys.settrace steps, normalization, outcomes, the document writer
│   │   ├── instrument.py      the syntax-tree rewrite: outcome calls, indexes, heapq lists
│   │   └── tests/             every fixture, kinds, outcomes, limits (Python 3.12)
│   ├── java/
│   │   ├── Makefile           compiles the adapter to build/classes
│   │   ├── src/lvtrace/       Build (rewrite + javac), Rewriter, Trace (the runtime), Snapshot, Args, ...
│   │   └── tests/             every fixture, kinds, outcomes, limits (JDK 21)
│   └── cpp/
│       ├── Makefile           the adapter's tests and end-to-end check
│       ├── rewriter/          trace-rewrite: inserts record() etc. (Clang LibTooling)
│       │   ├── instrumenter.hpp / .cpp   the AST visitor
│       │   ├── main.cpp       the tool
│       │   └── Makefile       builds with llvm-config; make test
│       ├── runtime/
│       │   ├── trace.hpp      serializers, recorder, document writer
│       │   ├── leetcode_types.hpp  ListNode, TreeNode, and their field tables
│       │   └── prelude_common.hpp  the standard headers every prelude includes (precompiled in the sandbox)
│       └── tests/
│           ├── test_serialize.cpp
│           ├── test_record.cpp
│           ├── test_write_file.cpp
│           ├── test_pointers.cpp
│           ├── test_frames.cpp
│           ├── test_document.cpp
│           ├── test_iterators.cpp
│           └── programs/
│               ├── loop_forever.cpp    never returns; proves the step cap
│               ├── return_pointer.cpp  returns a ListNode*; proves result_heap
│               └── void_method.cpp     returns void; proves the null result
├── frontend/                  home page and sandbox page (React + TypeScript + Vite)
│   ├── CLAUDE.md              commands, structure, rules
│   ├── package.json
│   ├── vite.config.ts
│   └── src/
│       ├── App.tsx            the switch between the pages; loads the sandbox lazily
│       ├── Sandbox.tsx        the sandbox page: layout, language select, shortcuts
│       ├── route.ts           the hash route: #/ home, #/sandbox, #/sandbox/<example>
│       ├── theme.ts           the page's theme: dark or light, the system's setting, the toggle
│       ├── home/              the home page, its live preview, and its example problems
│       ├── assets/            the logo, one file per theme
│       ├── api/               API client, input form logic, useInputs hook
│       ├── trace/             types, loader, value formatting, diff, heap edges, call tree
│       ├── player/            playback reducer and Run timer
│       ├── render/            renderer registry, renderers, heap layout and drawing
│       ├── components/        toolbar, code, inputs, visual, state panels, calls cards, the running canvas
│       ├── editor/            Monaco setup, theme, starter templates
│       └── styles/            theme tokens and layout
└── backend/                   the API service (FastAPI): python3 -m backend
    ├── app.py                 /api/health, /api/signature, /api/run
    ├── __main__.py            serves it with Uvicorn on 127.0.0.1:8000
    ├── requirements.txt       fastapi, uvicorn (and httpx for the tests)
    └── tests/                 every endpoint and error, and a real run in the sandbox
```

## Tech stack (proposed)

Tentative. The architecture does not depend on these choices.

| Layer | Choice |
|---|---|
| C++ adapter | C++20, header-only runtime, Clang LibTooling for the rewriter |
| Python adapter | Python 3.12, `sys.settrace` and the `ast` module, standard library only (plus `sortedcontainers` for Solutions to use) |
| Java adapter | JDK 21, the JDK's own parser and compiler (`com.sun.source`, `javax.tools`), no third-party libraries |
| Frontend | React + TypeScript + Vite, Monaco editor for the code panel |
| Renderers | HTML and SVG with Framer Motion, for containers and for linked lists, trees, and graphs (decided, [`docs/frontend.md`](docs/frontend.md) §6) |
| API service | FastAPI on Uvicorn (decided, [`docs/backend.md`](docs/backend.md)) |
| Sandbox | Docker with gVisor (`runsc`), one container per run, strict CPU, memory, process, disk, and time limits (decided, [`docs/sandboxing.md`](docs/sandboxing.md)) |
| Contract | JSON Schema, validated in CI and at runtime |

## Roadmap

- [x] Trace format specification and JSON Schema (v0.14)
- [x] Tracing strategy docs (native, DAP)
- [x] C++ serializers for every value kind, including pointers and by-value objects as `ref` and `object`
- [x] C++ recorder (`record`, step cap, trace file), checked on a hand-instrumented Two Sum
- [ ] Frontend: loader, step player, code panel, a renderer per kind, developed against fixtures
- [x] Pointers: `object` and `ref` for `ListNode`, `TreeNode`, `Node`, with linked list, tree, and graph renderers
- [x] Driver generation for C++
- [x] LibTooling rewriter
- [x] Iterators: the `iterator` kind, paired with their container by the rewriter
- [x] Outcomes: conditions and stores recorded by the rewriter and runtime, shown in the state panel
- [x] CLI: one command from a Solution and an example to a validated trace
- [x] Member variables of the `Solution`: a step's `members` (v0.12)
- [ ] Any C++ solution: lambdas, hint inference
- [x] The call stack: frames and return steps, with recursive golden traces
- [ ] Resolve the open questions above
- [x] Sandbox: Docker and gVisor, one container per run
- [x] API service
- [x] Input page: one field per parameter, Run code, replay (functional; visual design later)
- [ ] Design problems (LRU Cache, Min Stack): a trace over a sequence of calls
- [x] Python adapter, proving the schema is truly language-neutral
- [x] Java adapter, and a call-by-call comparison of the three languages' traces
- [x] "View as": graphs from an adjacency list, an edge list, or a matrix, and intervals
- [ ] More renderers (union-find, trie)

## Getting started

`python3 -m pipeline` takes a pasted Solution and an example to a validated trace in one command (it needs the rewriter built). You can also run the C++ adapter's tests and its end-to-end check, run the hand-instrumented Two Sum to write a real trace, check a trace, and open the frontend's page, which opens on the Two Sum example and, with the API service running, traces your own Solution on your inputs. CI runs the same commands on every push and pull request to `main`.

```bash
# Prerequisites: clang++ or g++ with C++20 <format> support, make, Python 3

# Run the C++ adapter's tests (clang++ by default)
make -C adapters/cpp
make -C adapters/cpp both          # with clang++ and with g++

# The checks below need the jsonschema package
pip install jsonschema

# End-to-end: Two Sum must equal the golden trace, and a program that never
# returns must stop at the step cap. Traces go to adapters/cpp/build/traces/
make -C adapters/cpp e2e

# Run the hand-instrumented Two Sum yourself. The trace goes to the path in TRACE_OUT
clang++ -std=c++20 -I adapters/cpp/runtime fixtures/two_sum_hand_inst.cpp -o /tmp/two_sum
TRACE_OUT=/tmp/two-sum.json /tmp/two_sum

# Check traces: schema always, plus equality with a fixture if asked
python3 -I tools/check_trace.py fixtures/*.trace.json
python3 -I tools/check_trace.py --equals fixtures/two-sum.trace.json /tmp/two-sum.json

# The driver: a Solution and an example in, a runnable program out
python3 -m driver fixtures/two_sum_trace.cpp --example "nums = [2,7,11,15], target = 9" --out /tmp/two-sum
python3 -m unittest discover -s driver/tests -t .    # its tests (they compile with $CXX, clang++, or g++)

# The rewriter (needs LLVM: brew install llvm), then a plain Solution end to end
make -C adapters/cpp/rewriter LLVM_CONFIG=$(brew --prefix llvm)/bin/llvm-config
python3 -m driver fixtures/max_depth_trace.cpp --example "root = [3,9,20,null,null,15,7]" --out /tmp/md --rewrite

# The whole pipeline in one command: driver, rewriter, compile, run, check.
# Without --sandbox it runs your code directly, with a 10-second limit.
python3 -m pipeline fixtures/two_sum_trace.cpp --example "nums = [2,7,11,15], target = 9" -o /tmp/two-sum.json
python3 -m unittest discover -s pipeline/tests -t .  # its tests (need the rewriter)

# The same run in the sandbox (needs Docker; gVisor on macOS: sandbox/colima-gvisor.yaml)
docker build -f sandbox/cpp.Dockerfile -t leetcode-visualizer-sandbox-cpp .
python3 -m pipeline fixtures/two_sum_trace.cpp --example "nums = [2,7,11,15], target = 9" --sandbox gvisor
TRACE_SANDBOX=gvisor python3 -m unittest pipeline.tests.test_sandbox -v

# Python: the same command on a .py file (Python 3.12 on this machine, or its own image)
python3 -m pipeline fixtures/two_sum_trace.py --example "nums = [2,7,11,15], target = 9" -o /tmp/two-sum-py.json
docker build -f sandbox/python.Dockerfile -t leetcode-visualizer-sandbox-python .
python3 -m pipeline fixtures/two_sum_trace.py --example "nums = [2,7,11,15], target = 9" --sandbox gvisor
python3 -m unittest discover -s adapters/python/tests   # the adapter's tests (pip install sortedcontainers==2.4.0 too)

# Java: the same on a .java file (JDK 21; build the adapter first), and every fixture's twins compared
make -C adapters/java
python3 -m pipeline fixtures/two_sum_trace.java --example "nums = [2,7,11,15], target = 9" -o /tmp/two-sum-java.json
docker build -f sandbox/java.Dockerfile -t leetcode-visualizer-sandbox-java .
python3 -m unittest discover -s adapters/java/tests
python3 tools/compare_traces.py --all --core
```

```bash
# The API service (needs the sandbox images above). From the repository root,
# in a virtual environment (Homebrew's Python refuses system-wide pip installs):
python3 -m venv .venv && source .venv/bin/activate
python3 -m pip install jsonschema -r backend/requirements.txt
python3 -m backend                                   # http://127.0.0.1:8000, under gVisor by default
TRACE_SANDBOX=docker python3 -m backend              # without gVisor (Linux without runsc)
python3 -m unittest discover -s backend/tests -t .   # its tests
```

```bash
# Prerequisites: Node.js 20.19+ and npm

cd frontend
npm install
npm run dev        # the page on http://localhost:5173; /api is proxied to the API service on :8000
npm test           # vitest
npm run build      # typecheck + production build
```

## Adding a new language

An adapter needs a driver template, a tracer (or a DAP configuration), a normalizer, helper types, and a container image. The frontend and trace schema do not change. The full checklist is in [`trace-format.md` §11](docs/trace-format.md#11-adding-a-new-language), and the how-to is in [`CONTRIBUTING.md`](CONTRIBUTING.md) *(planned)*.

## License

Released under the [Apache License 2.0](LICENSE). See [`NOTICE`](NOTICE) for the copyright notice to keep with copies and derived works.

## Acknowledgements

- [Python Tutor](https://pythontutor.com) for the heap-of-objects-plus-references model of program state.
- The [Debug Adapter Protocol](https://microsoft.github.io/debug-adapter-protocol/) for the idea that one client can drive many language backends.