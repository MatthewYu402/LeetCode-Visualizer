# Python Adapter

> **Status:** Draft v0.14
> **Related:** [`trace-format.md`](../trace-format.md) (the contract), [`native-tracing.md`](../native-tracing.md) §3 (runtime hooks), [`cpp.md`](cpp.md) (the C++ adapter, which this one matches step for step), [`adapters/python/`](../../adapters/python/) (the tracer), [`driver/python/`](../../driver/python/) (the driver), [`sandboxing.md`](../sandboxing.md) (where it runs)

This document describes how the Python adapter turns a running `Solution` into a trace: where the steps come from, how Python values become the trace's kinds, how the outcomes of a line are found, and what the driver gives the tracer. Everything here is implemented, except what is marked as a limitation in §9.

---

## 1. Where the adapter sits

Python has the hook C++ lacks: `sys.settrace` calls a function of ours before each line of a traced function, when the function is called, when it returns, and when an exception passes through it ([`native-tracing.md` §3](../native-tracing.md)). The steps come from that hook, with no change to the user's code.

The hook does not say what a line *evaluated*: which way a condition went, what a store left, which cells were read. For those, the Solution's syntax tree is rewritten before it runs, with calls to the tracer placed where the C++ rewriter places its own (§4). The user's code is never edited as text; the rewritten tree is compiled under the original line numbers.

| File | Role |
|---|---|
| [`adapters/python/run.py`](../../adapters/python/run.py) | The program: reads `run.json` and `solution.py`, builds the arguments, runs the method under the tracer, writes the trace |
| [`adapters/python/tracer.py`](../../adapters/python/tracer.py) | `Tracer`: the settrace hook, steps, the call stack, the value normalizer, the outcome calls, the document writer |
| [`adapters/python/instrument.py`](../../adapters/python/instrument.py) | The rewriter: inserts the outcome calls, and reads `indexes` and the heapq lists from the syntax tree |
| [`driver/python/`](../../driver/python/) | The driver: reads the Solution's signature and node classes, and turns an example into `run.json` (§6) |

The driver runs outside the sandbox, as for C++. `run.py`, the tracer, and the user's code run inside it, in the Python image (§7).

> **Key insight 1: the trace does not know it came from Python.** The six Python golden traces are drawn by the same frontend code as the C++ ones, and `tools/check_trace.py --like` checks that each one has the same structure as its C++ twin (§8). Where the two differ (step counts, `map` order), the difference is the language's, as the spec allows.

## 2. What one step looks like

The same as in C++ ([`cpp.md` §2](cpp.md)): the whole call stack, bottom to top, each frame with its `id`, `function`, `line`, and `locals`; the Solution's `members`; and one `heap`. The settrace events map onto the spec's step model:

| Event | Step |
|---|---|
| `call` of a followed function | A new frame with a fresh id (`f1`, `f2`, ...). No step of its own: its first line gives one |
| `line` | A step before the line runs, with the running frame's `line` and every caller's line of the call in progress |
| `return` | A return step, with `return_value`, on the line of the `return` |
| `exception` passing out of a frame | The frame ends with no return step (spec §6): a call that ends by an exception returns nothing |

A followed function is a method of `class Solution`, a function defined at the top of the file, or a function nested in either. The driver's code, the tracer, the standard library, lambdas, and generators (generator expressions too) are not followed, so their lines take no steps (C++ lambdas are not instrumented either).

**Comprehensions.** Python 3.12 runs a list, set, or dict comprehension inside its function (PEP 709) and reports its line again for every item. The tracer takes one step for the statement, as for a generator expression, and a comprehension that spans lines is reported on its statement's first line; the rewriter finds those lines (`Info.comprehensions`). A comprehension in a loop's header is the exception: the header keeps a step per check.

**Loop headers.** Python reports a `for` or `while` header each time it is checked, including the last check that ends the loop, so a header has a step per check, as the C++ rewriter gives it.

**The step cap.** At 2,000 steps the tracer writes the trace with `"truncated": true` and no `result`, and ends the program at once (`os._exit(0)`), so a program that never ends still has its trace. A line that never ends (`sum(range(10 ** 12))`) takes no further steps, so only the time limit stops it.

## 3. Normalization: Python types to kinds

`_Snapshot.value` in `tracer.py` writes every value once, by its type:

| Python | Kind | Notes |
|---|---|---|
| `int`, `float`, `bool`, `str`, `None` | bare JSON | The tagged `int` beyond ±(2⁵³ − 1); the tagged `float` for NaN, ±Infinity, and whole floats (`3.0`) |
| `list` | `array` | |
| a `list` the code passes to `heapq` | `priority-queue`, `order: "min"` | Found by the rewriter (§4.4) |
| `tuple` | `tuple` | Never carries an `id` |
| `dict`, `defaultdict`, `Counter`, `OrderedDict` | `map` | In iteration order, which the spec leaves unspecified |
| `set`, `frozenset` | `set` | |
| `collections.deque` | `deque` | |
| `SortedList` | `multiset` | From `sortedcontainers` (in the image, §7) |
| `SortedSet`, `SortedDict` | `set`, `map` | |
| an instance of a class from the user's file or LeetCode's comment (`ListNode`, `TreeNode`, `Node`) | `object` in the heap, written as a `ref` | Its fields are its instance attributes, in order of assignment |

- **Python has no `char`.** A one-letter string is a `string`, and so is the neutral type of a `str` parameter.
- **Anything else is not data.** A local holding a function, a module, an iterator, a `range`, or an instance of a library class is left out of the step, never written as text (CLAUDE.md invariant 5). A container holding one is left out whole.
- **Shared containers.** A container reached from two or more places in a step carries the same `id` at each place (spec, Shared containers). Python's `is` decides, so `a = nums` gives both locals one `id`.
- **A container that contains itself** (`a.append(a)`) cannot be written as a value. The run stops with an error that says so.
- **`self`** is not written as a local when it is the Solution; its state is the step's `members` (§5).

## 4. The rewriter: outcomes and indexes

`instrument.py` rewrites the Solution's syntax tree before it is compiled. Every inserted call takes the location of the node it stands for, so line numbers are unchanged and no inserted call starts a line of its own (which would make settrace report an extra line). An outcome is added to the step its frame recorded for that line, and only while the frame is still on it, so a value computed on line 7 is never shown on line 8.

### 4.1 Conditions

The test of an `if`, `elif`, `while`, and a conditional expression is wrapped in `__trace__.cond(line, code, value)`, which records a `condition` outcome with the value as a bool and returns it. A `while` header gets one per check, the last one `false`.

### 4.2 Stores

After an assignment, an augmented assignment, an annotated assignment with a value, or at the start of a `for` body, `__trace__.store(...)` records the target's new value as a `store` outcome. A `for` loop's store is written with its header as the code (`i in range(n)`), as C++ writes `int x : nums`. The target is read again to get the value, so only a *pure* target is recorded: names, attributes, subscripts, and arithmetic of those (`dp[i - 1]`, `self.count`), which can be evaluated twice with no effect. A target like `a[f()]` is left out rather than run twice.

### 4.3 Reads

| Code | Becomes | Outcome |
|---|---|---|
| `dp[i - 1][j]`, `s[k]` | `__trace__.rd(...)` | `read` with `at` (positions), or `key` for a map |
| `x in seen`, `x not in seen` | `__trace__.has(...)` | `read` with `key`, when the map or set has `x` |
| `memo.get(n)`, `memo.get(n, 0)` | `__trace__.get(...)` | `read` with `key`, when the map has `n` |

The container must be named directly, as a local (`seen`) or a member (`self.memo`), since a read's `target` is a name. A slice, a call result, or a container reached through another expression is not recorded. At most 16 reads are kept per step (spec, Reads), and a read whose target the step left out, or whose member a local of the same name hides, is skipped. Each inserted call evaluates its subscript exactly as Python would and returns the same value.

### 4.4 `indexes` and heapq lists

The same pass reads two things from the source:

- **`indexes`.** For each function, which locals subscript which containers, written as `container[local]` or `container[local ± constant]` (`nums[i]`, `dp[j - 1]`). At the end of the run they are filtered to the pairs where the local held an integer and the container was positional (an array, a deque, or a string), in a function that ran. A member container (`self.dp[i]`) is named by its member name.
- **heapq lists.** A name passed as the first argument to `heappush`, `heappop`, `heapify`, `heappushpop`, or `heapreplace` (through `heapq.` or imported bare) is drawn as a `priority-queue` with `order: "min"`, in the function that passes it. The same holds for a member (`heappush(self.heap, x)`). Elsewhere a list is an `array`.

> **Key insight 2: heapq is the one place a type does not decide the kind.** A heapq heap is a plain `list` whose order is a binary heap, so by type alone it is an `array` in an order that means nothing to a reader. The code that calls `heapq` says what it is, and the priority-queue card shows what the reader expects: the smallest item on top.

This is a deliberate exception to "the type decides the kind" (CLAUDE.md invariant 11), shared with the Java adapter's `Deque` used as a stack. It does not show the list as Python holds it, which C++ never has to choose between. The spec records both ([`trace-format.md`](../trace-format.md), Where use decides the kind) as an open question to revisit.

## 5. Members

A step's `members` hold the Solution's instance attributes (`self.memo`, `self.visited`), written once per step beside the frames, as the spec describes (Members). Two things are Python's own:

- **A member appears once it is assigned.** C++ declares members in the class, so they exist before any line runs. A Python attribute exists from its first assignment (`self.memo = {}`), so the steps before it have no `members`, and `members` holds only the attributes that exist at that step.
- **No constants are told apart.** Python has no `const`. Every instance attribute is written; a constant kept on the class itself (`MOD = 10**9 + 7` in the class body) is not an instance attribute and is not written.

## 6. The driver

`driver/python/` mirrors `driver/cpp/` and shares its rules for choosing the method, reading LeetCode's example text, decoding linked structures (`driver/shapes.py`), and inferring hints (`driver/hints.py`).

- **Signature.** LeetCode's Python 3 stubs annotate every method (`def twoSum(self, nums: List[int], target: int) -> List[int]:`), so each parameter's neutral type comes from its type hint (`types.py`): `List[int]` and `list[int]` are `array<int>`, `Optional[TreeNode]` is `TreeNode`, `Dict[str, int]` is `map<string, int>`, `'Node'` is `Node`, and a `-> None` return is `void`. A method without hints is listed but cannot be run. For the input form only, a method with no body yet (LeetCode's empty template) reads as if its body were `pass`.
- **Node classes.** `ListNode` and `TreeNode` are supplied. Any other class is read from LeetCode's comment above the Solution, in `#` lines or inside a triple-quoted string, as LeetCode shows `Node`: its fields are the `self.x = ...` assignments in `__init__`, which also give its shape (graph, n-ary tree, random list, ...) by the C++ driver's table. A commented "class" with no fields is prose and is ignored.
- **`run.json`.** The driver writes no code. It writes the method, the problem object, each argument as a JSON value (or, for a linked structure, its node records and root), and the node classes from the comments. `run.py` builds the arguments from it, so no value is ever pasted into a program's text.

**Names a Solution can use without importing them** (`PRELUDE` in `run.py`): everything in `typing`; the modules `collections`, `heapq`, `bisect`, `math`, `itertools`, `functools`, `operator`, `string`, `re`, and `random`; every name in `collections`, `heapq`, `bisect`, `itertools`, and `functools`; `SortedList`, `SortedSet`, and `SortedDict`; and `ListNode` and `TreeNode`. LeetCode does not publish its own list, so this one is ours, chosen to cover what Solutions use.

## 7. Running it

```
python3 -I run.py WORK          # WORK holds run.json and solution.py; TRACE_OUT names the trace file
```

| Exit status | Meaning | The pipeline says |
|---|---|---|
| 0 | The trace was written (finished, or truncated at the cap) | The trace, validated |
| 1 | The user's code raised, or holds a value the trace cannot show. The traceback, with the user's frames only, is on stderr | `run`: "The code stopped with an error before it returned", with the traceback |
| 3 | A bug in the adapter | `adapter`: a bug in the adapter, not in your code |

- **Python 3.12.** The sandbox image runs Python 3.12, which is what the line events above were checked against. On this machine, the pipeline uses `TRACE_PYTHON`, else `python3.12`, else its own interpreter when that is 3.12 or later.
- **The recursion limit is Python's.** It stays at the default (about 1,000 nested calls). A run that reaches it stops with `RecursionError` and a note that the example may be too deep for recursion or the recursion may not reach its base case. The tracer's own calls run on the same stack, so the limit is reached a few calls earlier than without it; the message is the same.
- **The image** (`sandbox/python.Dockerfile`, `leetcode-visualizer-sandbox-python`) holds Python 3.12, `sortedcontainers` 2.4.0, and the three adapter files, and nothing else. It is locked down exactly as the C++ image is ([`sandboxing.md`](../sandboxing.md)), and the user's code runs as the same unprivileged user.

## 8. Testing

```bash
python3 -m unittest discover -s adapters/python/tests      # the adapter: fixtures, kinds, outcomes, limits
python3 -m unittest driver.tests.test_python               # the driver: hints, node classes, describe, generate
python3 -m unittest pipeline.tests.test_python             # the pipeline on this machine (Python 3.12)
python3 -I tools/check_trace.py --like fixtures/two-sum.trace.json fixtures/two-sum.python.trace.json
```

Each of the six golden fixtures has a Python twin: `fixtures/<name>_trace.py` (the Solution) and `fixtures/<name>.python.trace.json` (its golden trace). The adapter's tests check each trace twice: exactly against its Python golden (`--equals`), and structurally against the C++ golden (`--like`). `--like` compares what must agree across languages: the problem, the result, whether the run finished, which functions ran, which object types the heap holds, and that each local present in both has a compatible kind (`stack` or `array`, `queue` or `deque` or `array`). It ignores step counts, line numbers, container ids, and the order of unordered kinds.

The pipeline's sandbox tests (`pipeline/tests/test_sandbox.py`, `PythonIsolation`) prove the same limits for the Python image as for the C++ one: no network, not root, a read-only image, the memory and time limits, and a forged trace rejected outside.

## 9. Known limitations

- **`@cache` and `@lru_cache` memo tables are not shown.** The cache lives inside `functools`, not in a local or a member, so it has no name in the trace. A Solution that keeps its memo in a dict (`self.memo` or a local) is drawn in full.
- **Lambdas, comprehensions, and generators take no steps of their own.** A comprehension is one step of the statement that holds it, and its result is visible in the next step (or in the statement's store outcome).
- **Reads of containers reached through expressions** (`self.graph[u][v]` is recorded; `get_graph()[u]` is not), and slices, are not recorded (§4.3).
- **Design problems** (LRU Cache, Min Stack) are not supported, as for C++.

## 10. Design questions

> **Q1. Why rewrite the syntax tree, when settrace already gives every line?**
> settrace gives *where* the program is, not what a line decided. Reading a condition's value back from the frame after the line ran is impossible in general (`if stack.pop() > x:` changed the stack), and guessing from the next line is wrong for `elif` chains. The rewriter is the same answer the C++ adapter gives, with the same rules: no extra lines, the user's code evaluated exactly once, and the outcome attached to the line that computed it. It is limited to outcomes: the steps themselves come from settrace, so a construct the rewriter does not understand loses an outcome, never a step.

> **Q2. Why a min priority-queue for heapq lists, and not an `array` with a `priority-queue` hint?**
> A hint says how to draw a value whose kind is right but not specific enough (a 2D array that is a grid). A heapq list is not an array in any sense a reader cares about: its order is the heap's, and its first item is the smallest. The kind is what the value *is*, so the adapter writes the kind, found from the code that treats it as a heap. Decided with the author (Python adapter issue).

> **Q3. Why a separate image per language?**
> A C++ run needs Clang, the rewriter, and a precompiled header; a Python run needs only Python. One image with both would be larger, and a change to one language's toolchain would rebuild the other's. Separate images keep each small, each container still runs one run, and the pipeline picks the image from the language. Java will follow the same pattern. Each language keeps one container warm by default (`TRACE_POOL`, with `TRACE_POOL_PYTHON` to set Python's alone; [`backend.md`](../backend.md) §5).

> **Q4. Why leave `@cache` out instead of drawing the cache?**
> The cache is `functools`' private state, reached only through `cache_info()`, which gives counts, not entries. Reading its entries would depend on CPython internals that change between versions. Leaving it out is honest: the trace shows the recursion card, which already makes the repeated calls visible, and the limitation is listed here.

> **Q5. Why `--like` instead of comparing Python traces with the C++ goldens exactly?**
> The two languages take different numbers of steps for the same algorithm (Python has no separate declaration lines; C++ loops have increment steps), and hash map order differs. Exact equality would fail for reasons the spec allows. `--like` checks what must be the same, so a Python trace that draws a different structure, or answers differently, still fails.
