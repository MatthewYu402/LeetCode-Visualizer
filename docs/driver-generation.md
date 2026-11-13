# Driver Generation

> **Status:** Draft v0.2. The C++ driver is implemented in [`driver/`](../driver/) (Python), with tests. Every golden fixture produces its golden trace through a generated `main`.
> **Related:** [`trace-format.md`](trace-format.md) (the output contract), [`native-tracing.md`](native-tracing.md) (how the run is observed), [`hint-inference.md`](hint-inference.md) (choosing hints), [`sandboxing.md`](sandboxing.md) (where the program runs), [`adapters/cpp.md`](adapters/cpp.md) (the C++ runtime the driver calls)

A LeetCode `Solution` class cannot run on its own. It has no `main`, it does not define `ListNode` or `TreeNode`, and nothing turns the text `nums = [2,7,11,15], target = 9` into real arguments. On LeetCode a hidden harness does all of that. This document describes how we rebuild that harness. We call it the **driver**.

```
Solution source ─┐
                 ├──► DRIVER ──► problem.json + prelude.hpp + main ──► compile ──► run ──► trace JSON
example text ────┘
```

The system has **no problem catalog**. The only inputs are the `Solution` source and the example text. Everything in the trace's `problem` object is derived from those two.

The driver does not produce the trace. It produces a program that, when run, writes the trace. The steps inside it come from the `record` calls the rewriter inserts ([`adapters/cpp.md` §8](adapters/cpp.md#8-the-rewriter)); `--rewrite` runs it.

---

## 1. What the driver does

| Job | Input | Output | Where | Language-specific? |
|---|---|---|---|---|
| **Parse the example** (Stage 1) | The example text | `{name: value}` in neutral JSON | `driver/example.py` | **No** |
| **Decode linked structures** | A value in LeetCode's notation | Node records with links | `driver/shapes.py` | **No** |
| **Read the signature** | The `Solution` source | The method to call, its parameters and return type, neutral types | `driver/cpp/signature.py`, `types.py` | Yes |
| **Read node definitions** | Comments in the source | Node classes and their `Fields` tables | `driver/cpp/nodes.py` | Yes |
| **Generate** (Stage 2) | All of the above | `problem`, the prelude, and `main` | `driver/cpp/generate.py` | Yes |

> **Key insight 1: the example is parsed once, into neutral JSON, and every language starts from that.** Understanding LeetCode's notation (level-order trees, the `pos` trick for cycles) is the hard part, and it has nothing to do with C++. `example.py` and `shapes.py` will be shared by the Python adapter. Only turning neutral data into native code is written per language.

**Decided:** the driver is written in Python. Stage 1 must be shared by every language, so it cannot live inside one adapter, and `tools/check_trace.py` already makes Python a project dependency. No package outside the standard library is used.

---

## 2. Reading the signature

The `problem` object comes from the method's signature:

```cpp
vector<int> twoSum(vector<int>& nums, int target)
```

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

Adapters never write `problem.name`. `hint` is left out: choosing hints is [`hint-inference.md`](hint-inference.md)'s job.

### How the declarations are read

`signature.py` reads the `Solution` class's **declarations only**, never statements. First it replaces every comment and string literal with spaces (keeping each character's position), so a `{` inside a string or a method in a comment cannot fool it. Then it walks the class body: access sections, method heads, and parameter lists, balancing `<>`, `()`, and `{}`.

This is enough because **LeetCode writes the signature itself**: the method the harness calls always has the plain shape `ReturnType name(Type a, Type& b)`. Helper methods can be anything. One that cannot be read (a member template, a parameter with no name) is kept as unreadable and only causes an error if it is the one to call.

**Possible later:** the rewriter parses the file with Clang anyway, so it could produce the same method list from the AST, and `signature.py` would become a fallback. The rest of the driver only sees `Method` and `Param` objects, so the swap touches one file.

### Neutral type names

References, `const`, and `std::` are removed first. The table, decided for every language, is in [`trace-format.md` Section 4](trace-format.md#4-problem-metadata). For C++:

| C++ type | Neutral type |
|---|---|
| `int`, `long long`, `unsigned`, `size_t`, `int64_t`, `signed char`, ... | `int` |
| `float`, `double` | `float` |
| `bool`, `char`, `string` | `bool`, `char`, `string` |
| `vector<T>`, `array<T, N>` | `array<T>` |
| `list<T>`, `deque<T>`, `stack<T>`, `queue<T>`, `priority_queue<T, ...>` | `list<T>`, `deque<T>`, `stack<T>`, `queue<T>`, `priority-queue<T>` |
| `set` / `unordered_set`, `multiset` | `set<T>`, `multiset<T>` |
| `map` / `unordered_map<K, V>`, `multimap` | `map<K, V>`, `multimap<K, V>` |
| `pair<A, B>`, `tuple<...>` | `tuple<A, B>` |
| `ListNode*`, `TreeNode*`, `Node*` | `ListNode`, `TreeNode`, `Node` |
| `void` (return type only) | `void` |

Arguments inside a type name are separated by `", "`. A type with no neutral name (`optional<int>`, a struct the driver does not know) is an error that names the parameter.

### Which method is called

**Decided.** LeetCode's harness knows which method to call because it knows the problem. We do not, and LeetCode allows any number of public methods, so the driver decides from the example:

1. `--method NAME`, when given, picks the public method of that name.
2. Otherwise, the public method whose **parameter names are exactly the example's names**. A public helper such as `backtrack(nums, start, path, result)` next to `subsets(nums)` is skipped, because its names do not match.
3. Otherwise, if exactly one public method has as many parameters as the example has values, and **none** of the example's names is one of its parameter names, the values are passed in order, with a warning. Clone Graph needs this: its example says `adjList = ...`, its parameter is `node`.
4. Anything else is an error that lists the public methods and their parameters. When some names match and others do not, the others are a typo, and the error names them (`Missing: k. Not a parameter: kk.`). A private method is never called.

`pos` is accepted as an extra name when the method has a `ListNode` parameter (Linked List Cycle): it describes the input list and is not passed.

---

### 2.1 For an input form: `describe()`

The page builds one input field per parameter before anything runs, so it needs the signature on its own. `driver.cpp.describe(source)` returns every public method with its parameters' names and neutral types, its neutral return type, and `extras` (`pos` when a method takes a `ListNode*`), plus the method to preselect: the first public one the driver can read. A method it cannot read is listed with the reason. `example_fields(text)` splits a pasted example into `{name: value text}` to fill the fields, and `example_text(fields)` joins the fields back into `name = value, ...` for `generate()`, checking that each value is valid JSON and each name is a name. The API serves these at `/api/signature` ([`backend.md`](backend.md) §2.2).

A Solution with no `class Solution` but another class (`class LRUCache`) is answered with an error that names the class and says design problems are not supported yet (§8).

## 3. Parsing the example

### Stage 1: text to neutral JSON

`nums = [2,7,11,15], target = 9` is split at commas outside brackets and strings, each part is `name = value`, and each value is read as JSON. LeetCode's values are JSON literals (`null`, `true`, `"abc"`). A pasted block works too: text before `Input:` and from `Output:` onward is ignored.

The result keeps the example **as written**: a tree is still a level-order array. It becomes `problem.input`, keyed by parameter name.

### Stage 2: neutral JSON to native values

The parameter's type decides how a value is read. The same array means different things:

| Parameter type | Example text | Built as |
|---|---|---|
| `int`, `float`, `bool`, `string`, `char` | `9`, `2.5`, `true`, `"abc"`, `"a"` | A literal. A `char` is written as a one-character string |
| `array<...>` | `[[1,2],[3,4]]` | A brace list, nested as deep as the type |
| `ListNode` | `[1,2,3]` | `1 -> 2 -> 3` |
| `ListNode`, with `pos` | `head = [3,2,0,-4], pos = 1` | The last node points back to index `pos`. `-1` means no cycle |
| `TreeNode` | `[1,null,2,3]` | Level order: each node takes the next two values as its children; `null` is a missing child and gets no children of its own. Trailing nulls may be left out |
| `array<ListNode>` | `[[1,4,5],[1,3,4]]` | One list per item (Merge k Sorted Lists) |
| `Node` with `neighbors` | `[[2,4],[1,3],[2,4],[1,3]]` | A graph: item `i` lists the neighbors of node `i + 1`; values are 1 to n |
| `Node` with `next`, `random` | `[[7,null],[13,0]]` | Each item is `[val, index of random]` |
| `Node` with `children` | `[1,null,3,2,4,null,5,6]` | N-ary level order: the root, `null`, then each node's children followed by `null` |
| `Node` with `left`, `right`, `next` | `[1,2,3,4,5,6,7]` | Level order like `TreeNode`; every `next` starts as null |

> **Key insight 2: the type chooses the parser, not the text.** `[1,2,3]` is an array, a linked list, or a tree depending only on the parameter's type. That is why the signature is read first.

The decoding rules are in `shapes.py`, written once. Each language's generator only writes out the decoded nodes. For C++ that is one `new` per node, then one assignment per link field, including the null ones, so a constructor that leaves a field uninitialized cannot matter.

> **Verify against real LeetCode pages.** These notations are written from LeetCode problem pages as remembered, not checked against them in this repo. Before relying on a row for a new problem, compare it with that problem's page.

Nodes the driver builds get their ids (`n1`, `n2`, ...) the first time a step sees them, not when they are created. So a golden trace does not depend on the order the driver builds nodes in.

---

## 4. Node types

**Decided:** `ListNode` and `TreeNode` are supplied by `adapters/cpp/runtime/leetcode_types.hpp`. A commented definition of either is checked to have the same fields, and an uncommented one is an error ("LeetCode supplies ListNode"), since the program would define it twice.

**Decided:** every other node type comes from its comment. LeetCode shows a problem's `Node` as a comment above the `Solution`:

```cpp
/*
// Definition for a Node.
class Node {
public:
    int val;
    vector<Node*> neighbors;
    Node(int _val) { ... }
};
*/
```

`nodes.py` takes each `class` or `struct` inside a comment (after removing LeetCode's leading ` * ` and inner `//` comments), compiles it as written, and generates its `Fields` table from its data members (declarations with no parentheses; `Node *left, *right;` declares two). The node's **shape**, which notation its example values use, follows from its link fields:

| Link fields (besides `val`) | Shape | Problems |
|---|---|---|
| `next` | linked list | |
| `left`, `right` | binary tree | |
| `left`, `right`, `next` | binary tree, `next` null | Populating Next Right Pointers |
| `neighbors` | graph | Clone Graph |
| `next`, `random` | list with random pointers | Copy List with Random Pointer |
| `children` | N-ary tree | N-ary Tree traversals |

A node with other fields (Flatten a Multilevel Doubly Linked List has `prev`, `next`, `child`) still compiles and serializes. Only building it from an example is an error, until its notation is added.

User-defined structs inside the solution are the rewriter's job: their tables are generated from the AST (roadmap Phase 4).

---

## 5. The generated program

### Three outputs

| Output | What it is |
|---|---|
| `problem` | The trace's problem object, passed to `begin()` |
| `prelude.hpp` | Passed to the compiler with `-include`: `prelude_common.hpp` (the standard headers and `leetcode_types.hpp`), `using namespace std;`, and each node class from a comment with its `Fields` table |
| `main` | Appended after the user's code: `begin()`, one declaration per argument, the call, and `write_result()` or `write_void_result()` |

### Line numbers and the prelude

`line` in a trace refers to the user's original source ([`trace-format.md` §6](trace-format.md#6-steps)). So the user's code stays at the **top** of the program file, and nothing is written above it. Everything the code needs before it comes from the prelude, which the compiler includes with a flag:

```bash
clang++ -std=c++20 -I adapters/cpp/runtime -include prelude.hpp program.cpp -o program
TRACE_OUT=trace.json ./program
```

The prelude's fixed part is one file, `adapters/cpp/runtime/prelude_common.hpp`, which names each standard header, because `<bits/stdc++.h>` does not exist in libc++ (macOS). It is a file, not a list in the driver, so the sandbox image can precompile exactly what every prelude includes ([`sandboxing.md`](sandboxing.md) §4.1). It says `using namespace std;` because LeetCode's own C++ stubs write `vector<int>` with no `std::`, so names from `std` must be in scope.

### `main`

What the driver generates for Two Sum:

```cpp
// ---- Generated by the driver (docs/driver-generation.md). Not part of the user's code. ----
int main() {
  ::trace::tracer.begin(R"__trace__({"method": "twoSum", "params": [...], "returns": {"type": "array<int>"}, "input": {...}})__trace__");

  // nums = [2,7,11,15]
  vector<int> nums = {2, 7, 11, 15};

  // target = 9
  int target = 9;

  Solution solution;
  auto answer = solution.twoSum(nums, target);
  ::trace::write_result(answer);
  return 0;
}
```

- **Each argument is declared with the parameter's type**, minus `&` and a top-level `const`, so it can be passed to a `vector<int>&`.
- **Linked structures** are built before their declaration: `ListNode *head_n0 = new ListNode(1);`, then the links, then `ListNode* head = head_n0;`.
- **The return type decides the last line:** `write_result(answer)` for a value or a pointer (whose objects go to `result_heap`), `write_void_result()` for `void`.
- **`main` is not a frame.** The method's frame comes from the `::trace::Frame` guard the rewriter puts on its first line, so the method is the bottom frame of every step ([`adapters/cpp.md` §4](adapters/cpp.md#4-the-recording-api)).

How a run can end:

| What happens | Trace file |
|---|---|
| The method returns | Written by `main`, with `result` |
| The step cap is reached | Written by `record`, with `"truncated": true` and no `result` |
| The program crashes or is killed | **No trace.** Known gap |

### Command line

```bash
python3 -m driver SOLUTION --example "nums = [2,7,11,15], target = 9" --out DIR [--method NAME] [--rewrite | --code FILE]
```

It writes `DIR/problem.json`, `DIR/prelude.hpp`, and `DIR/program.cpp`, and prints the build and run commands. The code in `program.cpp` is the Solution instrumented by the rewriter with `--rewrite` (it must be built: `make -C adapters/cpp/rewriter`), another file's code with `--code` (such as a hand-instrumented copy), or otherwise the plain Solution, whose trace has a result but no steps. It exits with status 2 and a message when the input cannot be used.

---

## 6. Errors

> **Key insight 3: every driver error is reported before the user's code runs.** A bad example, an unsupported type, or an ambiguous method stops generation with a message that names the parameter. Nothing is compiled and no trace is written.

| Problem | Caught by | Example message |
|---|---|---|
| Example does not parse | Stage 1 | `The value of 'nums' is not valid: '[1,,2]'` |
| A name is missing or misspelled | Choosing the method | `f takes (nums, k), but the example gives (nums, kk). Missing: k. Not a parameter: kk.` |
| Several methods fit | Choosing the method | `Several public methods take the example's parameters (root): ... Choose one with --method.` |
| A value does not fit its type | Stage 2 | `nums[1] should be an integer, found 'x'.` |
| A type has no neutral name | Reading the signature | `parameter 'm': the type 'optional<int>' has no neutral name yet.` |
| A node has no known notation | Stage 2 | `the driver does not know how LeetCode writes a Node with fields [...]` |
| A type has no serializer | Compiling, by the `static_assert` in `trace.hpp` | |

The driver runs **outside** the sandbox: it only reads text and writes text. The generated program is what runs inside it ([`sandboxing.md`](sandboxing.md)).

---

## 7. Testing

`python3 -m unittest discover -s driver/tests -t .` runs four layers:

| File | What it checks |
|---|---|
| `test_example.py` | Stage 1: names, nesting, strings with commas and brackets, pasted `Input:`/`Output:` blocks, every error |
| `test_shapes.py` | Each notation, including empty structures, trailing nulls, cycles, and out-of-range indices |
| `test_signature.py`, `test_nodes.py` | Reading declarations past comments, strings, nested types, and initializers; the method rule; the type table; node classes from comments |
| `test_describe.py` | `describe()`: methods, neutral types, `pos`, the preselected method, unreadable methods, the design-problem error; `example_fields` and `example_text`, each way a field can be wrong, and a round trip that gives the same `problem` |
| `test_generate.py` | Compiles and runs a plain Solution for each input kind (strings and chars with escapes, a char grid, bools and doubles, 64-bit integers, `void`, trees, a cycle with `pos`, an array of lists, a graph, a random list, an N-ary tree, a tree with `next`). Each Solution computes something from its input, so a right result proves the input was built right |
| `test_fixtures.py` | Every golden fixture, with its hand-written `main` replaced by a generated one, equals its golden trace, problem object included |

The tests that compile use `$CXX`, else `clang++`, else `g++`, and are skipped when there is none. CI runs them with GCC, Clang, and Apple Clang with libc++.

---

## 8. Open decisions

| # | Question | Leaning |
|---|---|---|
| 1 | Design-class problems (LRU Cache, Min Stack), where the example is a list of calls | Decided: not supported yet; only algorithmic problems. The driver says so when it finds another class and no `Solution`. Later: one trace covering the whole call sequence, which needs a spec change |
| 2 | Several examples for one problem | One run and one trace per example |
| 3 | Notations not covered yet: Intersection of Two Linked Lists (`intersectVal`, `skipA`, ...), multilevel lists (`prev`, `child`) | Add each when a problem needs it, verified against its page |
| 4 | Input types with no notation yet (`map`, `set`) | LeetCode inputs are arrays, strings, numbers, and nodes; add only if a problem needs it |
| 5 | Which parameter a `void` method changes, so the frontend can point at it | Undecided. The return step already shows the final state |

Decided in this version: primitive neutral names and the `", "` spelling (spec §4), Python for the driver, the method rule (Section 2), and LLVM as a dependency for the rewriter.

---

## 9. Design questions

**Q1. Why is driver generation separate from tracing?**
They answer different questions. The driver answers "how does this class get called at all?". The tracer answers "what was the state before each line?". A language can change its tracing strategy (instrumentation, runtime hooks, DAP) and keep the same driver, and the example parser is shared by all of them.

**Q2. Why parse the example into neutral JSON instead of straight into C++ values?**
Because the notation belongs to LeetCode, not to a language. If the C++ adapter parsed level-order trees itself, the Python adapter would need a second copy of the same rules, and the two would drift apart. With a neutral middle form the rules exist once, and each language writes only a small generator.

**Q3. Why keep the user's code at the top of the file?**
So `line` needs no mapping. The line the user sees in the editor is the line in the trace. `#line` directives would also work, but an unshifted file is simpler to reason about and to debug.

**Q4. Why does the driver, not the tracer, produce `result`?**
The driver is the caller, so it is the code that holds the return value at the end. The tracer does see each return value too, in the return step, but `result` is the run's answer in one place, and a truncated run has none.

**Q5. Why stop with an error instead of guessing the method or the type?**
A wrong guess still produces a trace that validates, and the user would be shown a correct-looking visualization of the wrong thing. An error before the run is cheap and clear. The one place the driver passes values by position (Clone Graph's `adjList`) is when no name matches at all and only one method fits, and it says so in a warning.

**Q6. Why is there no problem catalog?**
A catalog would have to be collected from LeetCode and kept current, and the tool would work only for problems in it. Deriving everything from the source and the example means any problem works, including ones the project has never seen. The cost is that hints must be inferred ([`hint-inference.md`](hint-inference.md)).

**Q7. Why read the signature in Python instead of with Clang first?**
LeetCode writes the signature the driver needs, so it always has the same plain shape, and reading declarations (never statements) is a small, testable job. A Clang tool needs LLVM installed everywhere the driver runs, and it is the start of the rewriter, which is written separately. When the rewriter exists, its AST can supply the same `Method` objects (Section 2).

**Q8. Why does the generator assign every link field, even the null ones?**
LeetCode's node classes are compiled as written, and some constructors leave fields uninitialized (an N-ary `Node()` that never sets `val`). Assigning every link after construction makes the built structure depend only on the example, not on what a particular constructor happens to do.
