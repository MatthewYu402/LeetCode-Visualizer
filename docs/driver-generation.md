# Driver Generation

> **Status:** Draft v0.1. Nothing in this document is implemented yet. Today the driver for Two Sum is written by hand in `fixtures/two_sum_hand_inst.cpp`.
> **Related:** [`trace-format.md`](trace-format.md) (the output contract), [`native-tracing.md`](native-tracing.md) (how the run is observed), [`hint-inference.md`](hint-inference.md) (choosing hints), [`sandboxing.md`](sandboxing.md) (where the program runs), [`adapters/cpp.md`](adapters/cpp.md) (the C++ runtime the driver calls)

A LeetCode `Solution` class cannot run on its own. It has no `main`, it does not define `ListNode` or `TreeNode`, and nothing turns the text `nums = [2,7,11,15], target = 9` into real arguments. On LeetCode a hidden harness does all of that. This document describes how we rebuild that harness. We call it the **driver**.

```
Solution source ─┐
                 ├──► DRIVER GENERATION ──► runnable program ──► run ──► trace JSON
example text ────┘     (this doc)             (user code + helper types + main)
```

The system has **no problem catalog**. The only inputs are the `Solution` source and the example text. Everything else in the trace's `problem` object is derived from those two.

Sections 1 to 6 describe the design. Each part is marked **Decided** or **Proposed**. Section 8 lists what is still open.

---

## 1. What the driver does

| Job | Input | Output | Language-specific? |
|---|---|---|---|
| **Read the signature** | The `Solution` source | The `problem` object: `method`, `params` with neutral types | Yes |
| **Parse the example** | The example text | Neutral JSON, one value per parameter | **No** |
| **Supply helper types** | The parameter and return types | `ListNode`, `TreeNode`, `Node`, and their field tables | Yes |
| **Generate `main`** | All of the above | Code that builds the arguments, calls the method, and writes the trace | Yes |

> **Key insight 1: the example is parsed once, into neutral JSON, and every language starts from that.** Understanding LeetCode's text notation (level-order trees, the `pos` trick for cycles) is the hard part, and it has nothing to do with C++ or Python. Only the last step, turning neutral JSON into native values, is written per language.

The driver is **not** the tracer. It never observes the run and never decides what a step contains. In C++ the rewriter inserts the `record` calls ([`native-tracing.md`](native-tracing.md) Section 4), and the driver only makes the program runnable around them.

---

## 2. Reading the signature

**Decided:** the `problem` object comes from the method's signature: `method`, `params`, and `returns`. Adapters never write `problem.name`.

For Two Sum the signature

```cpp
vector<int> twoSum(vector<int>& nums, int target)
```

becomes

```json
{
  "method": "twoSum",
  "params": [
    {"name": "nums",   "type": "array<int>"},
    {"name": "target", "type": "int"}
  ],
  "returns": {"type": "array<int>"},
  "input": {"nums": [2, 7, 11, 15], "target": 9}
}
```

`hint` is left out here on purpose. Choosing hints is a separate problem, covered in [`hint-inference.md`](hint-inference.md).

### Type mapping (C++)

References, `const`, and `std::` are removed first, because they are language details and the schema rejects them.

| C++ type | Neutral type |
|---|---|
| `int`, `long`, `long long`, and the unsigned forms | `int` |
| `vector<T>` | `array<T>` |
| `vector<vector<T>>` | `array<array<T>>` |
| `void` (return type only) | `void` |
| `unordered_map<K, V>`, `map<K, V>` | `map<K, V>` |
| `ListNode*` | `ListNode` |
| `TreeNode*` | `TreeNode` |
| `Node*` | `Node` |
| `double`, `bool`, `string`, `char` | **Open**, see Section 8 |

The neutral names mirror the trace kinds ([`trace-format.md`](trace-format.md) Section 4). If this table and the spec ever disagree, the spec wins.

### How the signature is read

**Proposed:** the C++ adapter reads the signature from the same Clang AST the rewriter already builds (roadmap Phase 4). Until the rewriter exists, the `problem` JSON is written by hand, as it is for Two Sum today. The return type is read the same way and written as `returns`. A regular expression over the source is not enough, because templates, default arguments, and comments all break it.

### Which method is called

A `Solution` class often has private helpers next to the method LeetCode calls. **Proposed rule:** call the only `public` method that is not a constructor. If there are several public methods, generation stops with an error that lists them, and the user picks one. Guessing is worse than asking, because a wrong guess produces a valid trace of the wrong function. This is still open (Section 8).

---

## 3. Parsing the example

Parsing happens in two stages.

```
example text ──► STAGE 1: neutral JSON ──► STAGE 2: native values
                 (shared by every language)   (one small builder per language)
```

### Stage 1: text to neutral JSON

The text `nums = [2,7,11,15], target = 9` is split into named arguments, and each value is parsed as JSON. The result is the `problem.input` object. It records the example **as the user wrote it**, so a tree stays a level-order array here.

Parameter names in the example are matched against the signature. A missing name, an extra name, or a value whose shape cannot fit the parameter's type is an error, reported before anything is compiled.

### Stage 2: neutral JSON to native values

The parameter's neutral type decides how the JSON is read. The same JSON array means different things for different types:

| Parameter type | Example text | Built as |
|---|---|---|
| `int`, `bool`, `string` | `9`, `true`, `"abc"` | The value itself |
| `array<int>` | `[2,7,11,15]` | A sequence |
| `array<array<int>>` | `[[1,2],[3,4]]` | A nested sequence |
| `ListNode` | `[1,2,3]` | A linked list `1 -> 2 -> 3`, one node per item |
| `ListNode` with a cycle | `head = [3,2,0,-4], pos = 1` | A list whose last node points back to index `pos`. `pos` is not a parameter of the method |
| `TreeNode` | `[5,3,null,1]` | A binary tree in level order, where `null` marks a missing child |
| `Node` (graph) | `[[2,4],[1,3],[2,4],[1,3]]` | An adjacency list: item `i` lists the neighbors of node `i + 1` |

> **Key insight 2: the type chooses the parser, not the text.** `[1,2,3]` is an array, a linked list, or a tree depending only on the parameter's type. That is why the signature is read first.

> **Verify against real LeetCode pages.** The notations in this table are written from memory. Before a parser for a row is written, compare that row with a real problem page: in particular the exact rule for trailing `null`s in trees, how `pos` appears, and the graph format. Do not build on a guess.

Nodes that the driver builds are ordinary objects on the heap. They get their ids (`n1`, `n2`, ...) the first time a `record` call sees them, not when the driver creates them.

---

## 4. Helper types and field tables

**Decided:** `ListNode` and `TreeNode` live in `adapters/cpp/runtime/leetcode_types.hpp`, in the global namespace, each with a `trace::Fields` table. The table is what lets the one generic pointer serializer write them as `object` plus `ref` ([`adapters/cpp.md`](adapters/cpp.md)).

**Decided:** `Node` is **not** in that header. It is a different struct in different problems (a graph node, a list node with `random`, an N-ary tree node), so each problem supplies its own.

**Proposed:** LeetCode shows the definition of `Node` as a comment above the `Solution` class. The driver reads the fields from that comment and generates both the struct and its `Fields` table. If the comment is missing, generation stops and asks for it.

User-defined structs inside the solution are the rewriter's job, not the driver's. Their tables are generated from the AST (roadmap Phase 4).

---

## 5. The generated program

### Layout and line numbers

`line` in a trace must refer to the user's original source ([`trace-format.md`](trace-format.md) Section 6). So the user's code stays at the **top** of the file, and `main` is appended after it. Nothing above the user's code may add a line.

That creates one problem: the user's code needs `trace.hpp`, the helper types, and the standard headers, and an `#include` at the top would shift every line by one.

**Proposed:** a prelude header that is added by the compiler flag `-include`, not by a line in the file:

```bash
clang++ -std=c++20 -I adapters/cpp/runtime -include prelude.hpp program.cpp -o program
```

`prelude.hpp` would include `leetcode_types.hpp` (which includes `trace.hpp`) and the standard headers a solution may use. It lists them one by one, because `<bits/stdc++.h>` does not exist in libc++. A pasted solution usually writes `vector` with no `std::` and no `#include`, so the prelude most likely also needs `using namespace std;`. **Verify this against a real LeetCode page before relying on it.**

### `main`

A sketch for Two Sum, using the recorder API as it exists today:

```cpp
// ---- generated driver, appended after the user's code ----
int main() {
  // 1. Problem metadata, as one finished JSON string.
  trace::tracer.begin(R"json({"method": "twoSum", "params": [{"name": "nums", "type": "array<int>"}, {"name": "target", "type": "int"}], "returns": {"type": "array<int>"}, "input": {"nums": [2, 7, 11, 15], "target": 9}})json");

  // 2. Build the arguments from the parsed example.
  std::vector<int> nums{2, 7, 11, 15};
  int target = 9;

  // 3. Call the user's method. Every record() call happens inside here.
  Solution solution;
  auto answer = solution.twoSum(nums, target);

  // 4. Serialize the return value and write the whole document.
  trace::write_result(answer);
  return 0;
}
```

Step 4 depends on the return type, which the driver knows from the signature:

| Return type | Step 4 | In the trace |
|---|---|---|
| A value (`vector<int>`, `int`, `bool`) | `trace::write_result(answer);` | `result` |
| A pointer (`ListNode*`, `TreeNode*`) | `trace::write_result(answer);` | `result` is a `ref`, and the objects it reaches are in `result_heap` |
| `void` | `trace::write_void_result();` | `"result": null`, with `"returns": {"type": "void"}` |

The driver's `main` is not a frame: the user's method gets its frame from the `::trace::Frame` guard the rewriter puts on its first line, and is the bottom frame of every step ([`adapters/cpp.md` §4](adapters/cpp.md#4-the-recording-api)).

**Decided (spec v0.5):** both special cases are part of the contract ([`trace-format.md` Section 3, The return value](trace-format.md#the-return-value)).

How a run can end:

| What happens | Trace file |
|---|---|
| The method returns | Written by `main`, with `result` |
| The step cap is reached | Written by `record`, with `"truncated": true` and no `result`. `main` never reaches step 4 |
| The program crashes or is killed | **No trace.** Known gap |

---

## 6. Errors

> **Key insight 3: every driver error is reported before the user's code runs.** A bad example, an unsupported parameter type, or an ambiguous method stops generation with a message that names the parameter. Nothing is compiled and no trace is written.

| Problem | Caught |
|---|---|
| Example does not parse, or a parameter is missing | Stage 1 |
| Value does not fit the parameter type (`[1,2]` for an `int`) | Stage 2 |
| Parameter or return type has no neutral name | Reading the signature |
| Type has no serializer | Compile time, by the `static_assert` in `trace.hpp` |
| Several public methods, or `Node` used with no definition | Generation |

The driver runs **outside** the sandbox, because it only reads text and writes text. The generated program is what runs inside it ([`sandboxing.md`](sandboxing.md)).

---

## 7. Testing

- **Stage 1** is tested with pairs of example text and expected neutral JSON. It needs no compiler.
- **Stage 2** is tested per language: build the value, serialize it, and compare with the expected trace value. For C++ this fits the existing `tests/test_<name>.cpp` pattern.
- **End to end:** Two Sum through a generated driver must equal `fixtures/two-sum.trace.json`, the same check `make e2e` runs today against the hand-written driver. That is the "Done when" line of roadmap Phase 3.
- **Bad input:** each row of the table in Section 6 has a test that expects an error and no trace file.

---

## 8. Open decisions

| # | Question | Leaning |
|---|---|---|
| 1 | Neutral names for `double`, `bool`, `string`, `char` in `params[].type` | `float`, `bool`, `string`, `char`. Needs spec text |
| 2 | Which method to call when several are public | Stop and ask |
| 3 | What language the generator is written in | Undecided. Stage 1 must not depend on any one adapter |
| 4 | Design-class problems (LRU Cache, Min Stack), where the example is a list of calls | Later. Probably one trace covering the whole call sequence, which needs a spec change |
| 5 | Several examples for one problem | One run and one trace per example |
| 6 | Which parameter a `void` method changes, so the frontend can point at it | Undecided. The step at the closing brace already shows the final state |

Item 1 changes the contract, so it follows the procedure in [`Skills.md`](../Skills.md) Section 3. It is a proposal until the spec changes.

Decided in spec v0.5: a returned pointer's objects go in `result_heap`, and a `void` method's result is `null` with `"returns": {"type": "void"}`.

---

## 9. Design questions

**Q1. Why is driver generation separate from tracing?**
They answer different questions. The driver answers "how does this class get called at all?". The tracer answers "what was the state before each line?". A language can change its tracing strategy (instrumentation, runtime hooks, DAP) and keep the same driver, and the example parser is shared by all of them.

**Q2. Why parse the example into neutral JSON instead of straight into C++ values?**
Because the notation belongs to LeetCode, not to a language. If the C++ adapter parsed level-order trees itself, the Python adapter would need a second copy of the same rules, and the two would drift apart. With a neutral middle form the rules exist once, and each language writes only a small builder.

**Q3. Why keep the user's code at the top of the file?**
So `line` needs no mapping. The line the user sees in the editor is the line in the trace. The alternative, `#line` directives, also works, but an unshifted file is simpler to reason about and to debug.

**Q4. Why does the driver, not the tracer, produce `result`?**
The tracer sees state before each line, so it never sees the value a `return` statement produces. The driver is the caller, so it is the only code that holds the return value. The DAP path has the same rule for the same reason ([`dap.md`](dap.md) Section 3).

**Q5. Why stop with an error instead of guessing the method or the type?**
A wrong guess still produces a trace that validates, and the user would be shown a correct-looking visualization of the wrong thing. An error before the run is cheap and clear.

**Q6. Why is there no problem catalog?**
A catalog would have to be collected from LeetCode and kept current, and the tool would work only for problems in it. Deriving everything from the source and the example means any problem works, including ones the project has never seen. The cost is that hints must be inferred ([`hint-inference.md`](hint-inference.md)).
