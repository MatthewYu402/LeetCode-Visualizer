# Native Tracing
> **Status:** Draft v0.1
> **Related:** [`trace-format.md`](trace-format.md) (the output contract), [`dap.md`](dap.md) (the debugger-based alternative), [`adapters/cpp.md`](adapters/cpp.md) (the C++ adapter)

This document describes how an adapter **observes a running solution and produces a trace** using tooling that belongs to the language: its runtime hooks, or source instrumentation. It is one of two strategies for the "tracer" box in the architecture.

```
user's Solution ──► driver ──► TRACER ──► normalizer ──► trace JSON ──► frontend
                                  ▲
                    native tracing (this doc)  or  DAP client (dap.md)
```

`trace-format.md` defines **what** a trace is. This document defines **how** an adapter gets there.

---

## 1. What "native" means here
A tracer is *native* when we write the observation logic for that specific language, either:
- **A. Runtime hooks**: the language runtime calls our code as the program executes (Python `sys.settrace`, JVM debug interfaces, the V8 inspector).
- **B. Source instrumentation**: we rewrite the user's code to call a recording function (`trace::record(...)` in C++) before each statement, then compile and run the rewritten program.

A tracer is *DAP-based* when one generic client drives an external debugger through the Debug Adapter Protocol (see `dap.md`).

> **Key insight 1: the dividing line is who writes the per-language logic.** Native means we write it for each language. DAP means we reuse one client and only write a normalizer per language. The boundary is blurry (the V8 inspector and JDI are debugger protocols too), so treat this as a design choice rather than a strict taxonomy.

## 2. What every tracer must do
Regardless of the mechanism, a tracer does three jobs:

| Job | Language-specific? | Notes |
|---|---|---|
| **Observe** | Yes, completely | Get control before each line of user code runs |
| **Snapshot** | Partly | Copy the current state *at that instant* |
| **Normalize** | Yes, per language | Turn native values into the kinds in `trace-format.md` |

Only *observe* is fundamentally different between languages. Snapshot and normalize have the same shape everywhere but different details.

#### Snapshot at observation time
> **Key insight 2: serialize immediately, never keep live references.** If a step holds a reference to the live `numMap` and the program keeps mutating it, step 2 will silently change after the fact. Each step must be a deep copy of the state at that moment. This is what makes the trace self-contained.

#### Scope filtering
Record only frames in the **user's code** (the `Solution` method and helpers they wrote). Skip the driver, the standard library, and LeetCode helper code. Otherwise, traces will fill with irrelevant steps and burn the step budget.

#### Identity
Objects that need identity (`TreeNode`, `ListNode`, custom classes) get stable ids, assigned in first-seen order (`n1`, `n2`, ...) and reused for the whole run. Raw pointers or `id()` values are used internally for lookup but **never emitted** (`trace-format.md` [Section 8](./trace-format.md#8-rules-for-adapter-authors), rules 2 and 3). Insert the heap entry *before* recursing into its fields so cycles (a doubly linked list, a graph) terminate.

#### Line numbers
`line` must refer to the user's original source (`trace-format.md` Section 6). Two easy ways to get that:

- Keep the user's code at the top of the file and append the driver after it, so nothing shifts
- Use the language's own mapping (Python `compile(source, "<user>", "exec")`, C++ `#line` directives).

#### Limits
Stop at the step cap (default 2,000), set `"truncated": true`, and write the trace at that moment, because the program may never end (`trace-format.md` [Section 6](trace-format.md#limits)). An infinite loop then leaves a truncated trace instead of only a timeout. Also enforce wall-clock and memory limits, for a loop that never reaches the tracer. The C++ runtime ends the program right after writing ([`adapters/cpp.md` §7.4](adapters/cpp.md#74-at-the-step-cap)).

## 3. Strategy A: runtime hooks
The runtime tells us when each line is about to execute and lets us read the frame's variables.

| Language | Mechanism | Notes |
|---|---|---|
| Python | `sys.settrace` (or `sys.monitoring` on 3.12+, lower overhead) | In-process, simplest case. Line events fire *before* the line executes, which matches our pre-execution snapshot rule |
| JavaScript/TypeScript | V8 inspector protocol | Pause on each statement, read scope variables |
| Java | JDI/JVMTI debug interfaces | Heavier setup, rich variable access |

### Illustrative Sketch (Python)
Not production code: it skips `self`, `__slots__`, the `int` and `float` tagging rules (`trace-format.md` [Section 5](trace-format.md#numbers-json-cannot-carry-exactly)), and error handling.

```python
import sys
from collections import deque

class Snapshotter:
    """Turns live Python values into trace values plus a per-step heap."""
    def __init__(self):
        self.ids = {}       # id(obj) -> "n1", "n2", ... stable for the whole run
        self._alive = []    # keep objects alive so id() values are not reused

    def value(self, v, heap):
        if v is None or isinstance(v, (bool, int, float, str)):
            return v
        if isinstance(v, list):
            return {"kind": "array", "items": [self.value(x, heap) for x in v]}
        if isinstance(v, tuple):
            return {"kind": "tuple", "items": [self.value(x, heap) for x in v]}
        if isinstance(v, deque):
            return {"kind": "deque", "items": [self.value(x, heap) for x in v]}
        if isinstance(v, dict):
            return {"kind": "map",
                    "entries": [[self.value(k, heap), self.value(x, heap)]
                                for k, x in v.items()]}
        if isinstance(v, (set, frozenset)):
            return {"kind": "set", "items": [self.value(x, heap) for x in v]}
        # user-defined object (TreeNode, ListNode, ...): heap entry + ref
        if id(v) not in self.ids:
            self.ids[id(v)] = f"n{len(self.ids) + 1}"
            self._alive.append(v)
        oid = self.ids[id(v)]
        if oid not in heap:
            heap[oid] = {"kind": "object", "type": type(v).__name__, "fields": {}}
            fields = heap[oid]["fields"]       # entry exists first: cycles terminate
            for k, x in vars(v).items():
                fields[k] = self.value(x, heap)
        return {"kind": "ref", "id": oid}

def run_traced(fn, args, user_filename, max_steps=2000):
    steps, snap, truncated = [], Snapshotter(), False

    def local_trace(frame, event, arg):
        nonlocal truncated
        if event == "line":
            if len(steps) >= max_steps:
                truncated = True
                sys.settrace(None)
                return None
            heap = {}
            locals_ = {k: snap.value(v, heap)
                       for k, v in frame.f_locals.items() if k != "self"}
            steps.append({"step": len(steps), "line": frame.f_lineno,
                          "locals": locals_, "heap": heap})
        return local_trace

    def global_trace(frame, event, arg):
        # called on every function call; follow only the user's code
        return local_trace if frame.f_code.co_filename == user_filename else None

    sys.settrace(global_trace)
    try:
        result = fn(*args)
    finally:
        sys.settrace(None)
    return steps, result, truncated
```

If the user's source code is compiled with `compile(source, "<user>", "exec")` and `user_filename = "<user>"`, `frame.f_lineno` is already the line in the user's original code.

## 4. Strategy B: source instrumentation
For languages without a convenient runtime hook (C++, and Go, which has no built-in line-event hook), rewrite the code so it reports itself.

Original:
```cpp
for (int i = 0; i < static_cast<int>(nums.size()); ++i) {
    int complement = target - nums[i];
    auto it = numMap.find(complement);
```

Instrumented (Illustrative):
```cpp
for (int i = 0; i < static_cast<int>(nums.size()); ++i) {
    ::trace::record(8, ::trace::var("nums", nums), ::trace::var("target", target),
                    ::trace::var("numMap", numMap), ::trace::var("i", i));
    int complement = target - nums[i];
    ::trace::record(9, ::trace::var("nums", nums), ::trace::var("target", target),
                    ::trace::var("numMap", numMap), ::trace::var("i", i),
                    ::trace::var("complement", complement));
    auto it = numMap.find(complement);
```

- `record` is a variadic function template that serializes each argument into a trace value (`vector` -> `array`, `stack` -> `stack`, `unordered_map` -> `map`, `TreeNode*` -> `ref` + heap object) and stores one finished step. `var` pairs a variable's name with a reference to its live value. The C++ runtime is `adapters/cpp/runtime/trace.hpp`, and [`adapters/cpp.md`](adapters/cpp.md) explains how a step is built.
- The names are string literals written by the rewriter, which reads them from the AST. No macros are needed, and the fully qualified `::trace::` names cannot collide with the user's code.
- Each call lists only the variables **already declared** at that point. `complement` is absent from the line-8 snapshot because it does not exist yet, matching the pre-execution rule. Working out what is in scope at each statement needs a real parser, such as Clang's AST via LibTooling (Go's `go/ast` plays the same role for Go).
- The line number is passed explicitly, because only the rewriter knows the line in the user's original source. Insert the calls so they do not shift the user's lines (for example, on the same line as the statement they precede), or use `#line` directives.

| Language | Typical Approach |
|---|---|
| C++ | Clang LibTooling instrumentation. Gives full control over STL serialization |
| Go | `go/ast` instrumentation (or delve via DAP, see `dap.md`) |
| Rust | Hard to instrument cleanly. Usually better via DAP |

## 5. Native vs. DAP: when to choose which
| | Native tracing | DAP |
|---|---|---|
| Per-language effort | A full tracer per language | One generic client, plus a normalizer |
| Control over output | Complete | Limited to what the debugger exposes |
| STL/container internals | Easy (we serialize them ourselves) | Often raw internals unless pretty-printers exist |
| Changes the user's program | Instrumentation: yes. <br> Runtime hooks: no | No |
| Best for | Python, C++ (instrumented), JS | Go, Rust, Java, and fast breadth |

Planned approach: **Python via `sys.settrace`, C++ via Clang instrumentation**, and DAP for languages added later. Whatever the mechanism, the output must pass the same schema.

## 6. Security
> **Key insight 3: tracer output is untrusted data.** The tracer runs in the same process as the user's code. Code can call `sys.settrace(None)` to turn tracing off, or print a forged trace. Always run the whole thing in a sandbox (separate process, no network, CPU and memory limits, short-lived), and **validate the trace against `schema/trace.schema.json` outside the sandbox** before the frontend sees it.

## 7. Testing
- Every tracer is validated against the schema in CI (`trace-format.md` Section 10).
- Compare each tracer's output for the same example to the golden trace for **structural equivalence** (same kinds and shapes), not byte equality.
- Add adversarial cases: infinite loop (a truncated trace, or a timeout if the loop never reaches the tracer), deep recursion, cyclic structure, huge input (truncation).

## 8. Open questions
These are gaps in `trace-format.md` that native tracers expose. They should be resolved in a minor version.
1. **Call stack.** A step records one frame's `locals`. Recursive solutions (DFS on a tree, backtracking) need a stack of frames, each with its own locals and line. A `stack` field is the likely addition.
2. **Aliasing of containers.** Only `object`s have ids. If two variables refer to the *same* container, the trace shows two separate copies. That is acceptable for most problems, but hides in-place mutation through aliases.
3. **Member variables.** LeetCode solutions often use fields on the `Solution` instance (memo tables, visited sets). The sketch above skips `self`. The tracer should surface these, either as extra locals or in a separate `members` field.
4. **A `ref` result has no heap.** Heaps are per-step, so a returned `TreeNode*` has nothing to resolve against. A top-level result heap is the likely fix.

Resolved in v0.2: tuples, which used to flatten to `list`, now have their own `tuple` kind.

## 9. Design Questions
**Q1. Why is this a separate document from `trace-format.md`?** The trace format is a stable contract that every adapter and frontend depend on. How a tracer observes a program is an implementation choice that differs per language and can change without touching the contract.

**Q2. Why snapshot at observation time instead of recording references and serializing later?** Programs mutate state. A reference captured at step 2 would show step 10's contents when serialized later. Copying at the moment of observation keeps every step self-contained.

**Q3. Why not use DAP for everything?** DAP reuses one client across languages, but you only get what each debugger exposes. For C++ STL containers that is often raw internals, so instrumentation can give cleaner, more predictable output. However, this does mean more work in getting the output you want. DAP wins on breadth, native wins on control.

**Q4. What makes native tracing "language-specific" if the output is language-neutral?** Only the observation mechanism and the value normalizer. Everything downstream of the trace (schema, validation, frontend) is identical for every language.