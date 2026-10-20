# DAP-Based Tracing

> **Status:** Draft v0.1
> **Related:** [`trace-format.md`](trace-format.md) (the output contract), [`native-tracing.md`](native-tracing.md) (the per-language alternative)

This document describes how an adapter **observes a running solution through an existing debugger**, using the Debug Adapter Protocol (DAP), and turns what the debugger reports into a trace. It is the second of two strategies for the "observe" stage of the pipeline.

```
user code
   │
   ▼
OBSERVE ──► SNAPSHOT ──► NORMALIZE ──► trace JSON ──► SCHEMA VALIDATION ──► frontend
(DAP client                                            (outside the sandbox)
 driving a debugger)
```

`trace-format.md` defines **what** a trace is. `native-tracing.md` covers observation logic we write per language. This document covers the case where we reuse **one generic client** across many languages.

---

## 1. What DAP is

The Debug Adapter Protocol is a JSON message protocol between a **client** (originally an editor such as VS Code) and a **debug adapter**, a process that wraps a language's debugger and speaks DAP. Because the protocol is shared, one client can debug any language that has an adapter.

| Language | Typical adapter |
|---|---|
| Python | `debugpy` |
| C / C++ / Rust | `lldb-dap` (recent GDB versions also include a DAP mode) |
| Go | `dlv dap` (Delve) |
| JavaScript / TypeScript | `js-debug` |
| Java | `java-debug` (runs as a plugin of the Java language server, so it is heavier to host) |

In this project, **our tracer is the DAP client.** It starts the adapter, launches the user's program under it, steps line by line, and reads variables at each stop.

> **Key insight 1: DAP moves the per-language work from the observer to the normalizer.** With native tracing we write a tracer per language. With DAP the stepping logic is written once, and what remains per language is a launch configuration and a set of normalization rules.

---

## 2. Message anatomy

Messages are JSON, framed with a `Content-Length` header (the same framing as the Language Server Protocol), usually over the adapter's stdin/stdout. There are three kinds: **requests** (client to adapter), **responses**, and **events** (adapter to client, such as `stopped`).

A request for the top stack frame:

```json
{"seq": 12, "type": "request", "command": "stackTrace",
 "arguments": {"threadId": 1, "startFrame": 0, "levels": 1}}
```

The response (abridged):

```json
{"type": "response", "request_seq": 12, "success": true, "command": "stackTrace",
 "body": {"stackFrames": [
   {"id": 1000, "name": "twoSum", "line": 8,
    "source": {"path": "/work/solution.cpp"}}]}}
```

A `variables` response (abridged; exact `value` text depends on the debugger):

```json
{"body": {"variables": [
  {"name": "i",    "value": "0",      "type": "int",              "variablesReference": 0},
  {"name": "nums", "value": "size=4", "type": "std::vector<int>", "variablesReference": 1002}
]}}
```

Two things to notice:

- **`value` is a string**, for every type. `"0"` is text, not a number.
- **`variablesReference`** is a handle. If it is nonzero the variable has children, and a follow-up `variables` request with that handle returns them. Nested data is fetched on demand.

---

## 3. The stepping loop

One-time setup:

1. `initialize` (declare client capabilities, including 1-based lines)
2. `launch` the driver under the adapter
3. `setBreakpoints` on the first line of the user's method, then `configurationDone`
4. Wait for the first `stopped` event

Then, for each step (pseudocode):

```
loop:
    frame = stackTrace(thread, levels=1)[0]
    if frame.source.path is not the user's file:
        stepOut(thread); wait for stopped; continue     # wandered into library code
    scopes = scopes(frame.id)
    vars   = variables(scopes["Locals"].variablesReference)    # expand nested children as needed
    step   = {line: frame.line, locals: normalize(vars), heap: ...}
    record(step)
    if len(steps) >= cap: stop and set "truncated": true
    stepIn(thread)            # or next(thread) to step over calls
    wait for `stopped` or `terminated`
```

Notes:

- A debugger stops **before** a line executes, which matches the pre-execution snapshot rule in `trace-format.md` Section 6.
- `next` steps over function calls and `stepIn` steps into them. Many debuggers skip code without debug info when stepping in; where they do not, `stepOut` returns to the user's code.
- **The return value comes from the driver**, not the debugger. DAP has no uniform way to read a function's return value, so the driver writes the result to stdout or a file, and the client reads it and normalizes it into `result`.

---

## 4. Normalization: where the work is

> **Key insight 2: DAP gives you strings and type names, so normalization is parsing.** The quality of the trace depends on how well the debugger formats values. A debugger with good formatters presents a `vector` as `[0]`, `[1]`, ... children. One without them shows internal fields such as hash-table buckets.

The normalizer dispatches on the debugger-reported `type`:

| Debugger `type` | Rule |
|---|---|
| `int`, `long`, `size_t`, ... | Parse `value` as a number |
| `bool` | Parse `value` as a boolean |
| `std::vector<T>`, `std::array<T,N>`, Python `list` | Expand children into a `list` |
| `std::unordered_map<K,V>`, Python `dict` | Expand children into `map` entries |
| `std::string`, Python `str` | Parse the quoted string |
| Pointer to a user struct (`TreeNode*`) | Assign a stable id, `ref`, and expand the pointee into the heap |
| null pointer (`0x0`, `nullptr`, `None`) | `null` |

Illustrative sketch:

```python
RULES = [  # (regex on the debugger-reported type, handler)
    (r"^(unsigned |signed )?(int|long|short|size_t|int\d+_t)$", parse_int),
    (r"^bool$",                                                 parse_bool),
    (r"^(std::)?(__1::)?vector<",                               as_list),
    (r"^(std::)?(__1::)?unordered_map<",                        as_map),
    (r"^(TreeNode|ListNode) ?\*$",                              as_ref),
]

def normalize(var, ctx):
    for pattern, handler in RULES:
        if re.match(pattern, var["type"]):
            return handler(var, ctx)
    raise UnsupportedType(var["type"])   # fail loudly; never emit raw debugger text
```

The `__1::` is not a typo. libc++ places its types in an inline namespace, so the *same* container can have a different type string under a different standard library. Rules should be tested against the exact toolchain used in the container image.

### Identity

Objects need stable ids (`n1`, `n2`, ...) that are never raw addresses (`trace-format.md` Section 8, rules 2 and 3). The identity source varies:

- native languages: the pointer value in the `value` string, or `memoryReference` where the adapter provides it
- Python: an `evaluate` request such as `id(x)`

Use it as an internal lookup key only, and insert the heap entry before expanding children so cycles terminate.

### Limits on expansion

Expanding children costs one request each, so cap:

- **depth**, to stop runaway expansion of cyclic structures
- **children per container**, using `start` / `count` paging (`indexedVariables` reports the size)
- **total requests per step**

---

## 5. Per-language setup

Each language contributes configuration, not new stepping code:

```yaml
cpp:
  adapter: ["lldb-dap"]
  build:   "clang++ -g -O0 -std=c++17 driver.cpp -o driver"
  launch:  { program: "./driver" }
  rules:   rules/cpp.py
```

Practical requirements:

- **Build with debug info and without optimization** (`-g -O0` for C/C++). Optimized builds discard or merge locals, so variables vanish from the debugger's view.
- **Keep the user's code in its own file** and have the driver include it. Frames report `source.path` and `line` for that file, so line numbers match the user's original source with no mapping step. This is a real advantage over instrumentation, which rewrites the source.
- **Match the debugger to the standard library** in the image so its formatters recognize the container types.

---

## 6. Practical constraints

| Concern | Detail |
|---|---|
| **Speed** | Each step costs several round trips (`stackTrace`, `scopes`, `variables`, plus expansion). This can dominate run time. Measure early and tune the caps |
| **Sandboxing** | Debuggers for native languages rely on `ptrace`, which hardened sandboxes often restrict. Verify that the debugger runs inside the chosen sandbox before committing to this path |
| **Return values** | Not available through DAP. The driver must emit them |
| **Stepping into library code** | Depends on the debugger. Plan on `stepOut` as a fallback |
| **Raw internals** | If a debugger exposes container internals, either add formatters or fall back to native instrumentation for that language |

---

## 7. Security

> **Key insight 3: DAP observes from outside the process, which is harder to tamper with, but the output is still untrusted.** The user's code cannot call `settrace(None)` on a debugger running in a separate process. That is a real improvement over in-process tracers. But the debuggee still controls its own memory and output, and the whole setup runs in a sandbox. As with native tracing, **validate the final trace against `schema/trace.schema.json` outside the sandbox.**

---

## 8. Native tracing vs. DAP

| | DAP | Native tracing |
|---|---|---|
| Stepping logic | Written once | Written per language |
| Per-language effort | Config plus normalizer rules | Full tracer plus normalizer |
| Control over output | Limited to what the debugger exposes | Complete |
| STL / container internals | Depends on debugger formatters | We serialize them ourselves |
| Modifies the user's source | No | Instrumentation: yes. Runtime hooks: no |
| Tamper resistance | Observation is out-of-process | In-process, so easier to subvert |
| Speed | Slower (many round trips) | Faster |
| Best for | Breadth: Go, Rust, Java, and fast new languages | Python, instrumented C++ |

Both must produce traces that pass the same schema.

---

## 9. Testing

- Validate every DAP tracer's output against the schema in CI (`trace-format.md` Section 10).
- Compare against the golden traces for **structural equivalence**, not byte equality.
- Cross-check: for a language supported both ways (for example C++), the DAP trace and the native trace for the same example should agree structurally. Differences point to normalizer bugs.
- Add adversarial cases: infinite loop (timeout), cyclic structure (expansion caps), a type with no normalizer rule (must fail loudly), deep recursion.

---

## 10. Relationship to the open questions

`native-tracing.md` Section 8 lists gaps in `trace-format.md` v0.1. DAP handles two of them naturally:

- **Call stack:** `stackTrace` returns every frame, so a future `stack` field costs little here.
- **Member variables:** `this` / `self` appears in the `Locals` scope with expandable children.

So the trace format should be extended with these in mind, since both strategies can supply them.

---

## 11. Design questions

**Q1. Why speak DAP instead of driving `gdb` or `lldb` directly?**
Each debugger has its own command language and output format, so a client per debugger would repeat the L × R problem one layer down. DAP is the shared protocol that makes one client enough.

**Q2. What if the debugger returns raw internals for a container?**
Do not pass them through. Either install formatters so the debugger presents the container cleanly, or raise an error for that type. If a language cannot be made clean, use native instrumentation for it. The rule is that raw debugger text never reaches the trace.

**Q3. Why is the trace identical in structure whether it came from DAP or native tracing?**
Because the schema is the contract. Both strategies end in the same normalized kinds and the same validation, so the frontend cannot tell them apart.

**Q4. Why not use DAP for Python too?**
It would work, but `sys.settrace` is simpler, faster, and needs no external process. DAP earns its place where writing a native tracer is expensive.