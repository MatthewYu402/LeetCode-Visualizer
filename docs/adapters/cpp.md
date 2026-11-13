# C++ Adapter

> **Status:** Draft v0.5
> **Related:** [`trace-format.md`](../trace-format.md) (the contract), [`native-tracing.md`](../native-tracing.md) §4 (source instrumentation), [`adapters/cpp/runtime/trace.hpp`](../../adapters/cpp/runtime/trace.hpp) (the runtime), [`fixtures/two-sum.trace.json`](../../fixtures/two-sum.trace.json) (golden trace)

This document describes how the C++ adapter turns a running `Solution` into a trace: what one recorded step contains, how the runtime builds it, and why its state is split the way it is. It covers the runtime that exists today (the serializers, the recorder, and the document writer) and marks what is still planned.

---

## 1. Where the runtime sits

The C++ adapter uses source instrumentation ([`native-tracing.md` §4](../native-tracing.md#4-strategy-b-source-instrumentation)). C++ has no built-in hook that calls our code before each line, so we rewrite the user's code to call a recording function ourselves.

```
PREPARE   rewriter             inserts ::trace::record(...) before each statement (§8)
          driver               appends main(): parse the example, call the Solution
          clang++ -std=c++20   compiles it with the header-only trace.hpp
RUN       each record(...)     serializes the locals into one finished step
          document writer      writes the whole trace to a file
AFTER     schema validation    outside the sandbox, then the frontend replays it
```

The runtime is one header, `adapters/cpp/runtime/trace.hpp`. The rewriter (§8) places the `record` calls; the fixtures' `_hand_inst.cpp` files show the same calls placed by hand.

## 2. What one step looks like

Every call to `record` (or `ret`, §4.4) produces exactly one step. A step is the whole call stack plus one heap:

```json
{"step": 1, "frames": [{"id": "f1", "function": "twoSum", "line": 8, "locals": {"nums": {"kind": "array", "items": [2, 7, 11, 15]}, "target": 9, "numMap": {"kind": "map", "entries": []}, "i": 0}}], "heap": {}}
```

| Field | Where it comes from |
|---|---|
| `step` | The number of steps already recorded, so steps count up from 0 with no gaps |
| `frames` | One frame per instrumented call in progress, bottom to top, from `tracer.frames` (§4) |
| `heap` | Every object any frame's locals point to, filled while the frames were serialized |

Each frame:

| Field | Where it comes from |
|---|---|
| `id` | `"f<n>"`, where n counts calls for the whole run. Set when the `Frame` guard is created |
| `function` | The string passed to the `Frame` guard: the function's name in the user's source |
| `line` | The first argument of the frame's latest `record` or `ret`. In the top frame, the line about to run; in a caller, the line whose call is in progress |
| `locals` | One entry per `var(...)` argument of the frame's latest `record` or `ret`, read **now** |
| `return_value` | Only in a return step, on the top frame: the value `ret` was given |

Two Sum calls no function of its own, so every one of its steps has one frame. A recursive solution has one frame per call level.

### 2.1 `locals`

`locals` maps variable names to values, separately for each frame.

- **Keys** are the variable names exactly as written in the source. The rewriter copies them from the AST as string literals.
- **Values** are any value kind from the spec. An object (`TreeNode`, `ListNode`) never appears inline here. A local that points to one holds a `ref`, and the object itself goes in the heap.
- **Only variables already declared** before the line appear. Before line 9 of Two Sum (`int complement = ...`), `complement` does not exist yet, so it is absent. This is the pre-execution rule. In `int left = maxDepth(root->left);`, the caller's frame has no `left` during the call, because `left` is being initialized by it.
- **Parameters are locals too.** `nums` is a `vector<int>&`, and it is written as its value, not as a reference.
- **Callers are read live.** A caller's locals are serialized at every step from its variables as they are at that step, so a vector the callee changes through a reference shows the change in every frame that can see it.
- **Order** follows the order of the `var(...)` arguments. Consumers must not depend on it, because JSON object order carries no meaning.
- **Variables with no serializer are left out.** The rewriter passes every variable in scope, because it cannot know which types `trace.hpp` supports. The concept `Serializable<T>` (true when a `Serializer<T>` specialization exists) lets `write_locals` drop the others at compile time, so a lambda or a `std::function` simply does not appear. Serializing such a type directly with `serialize()` is still a compile error. An iterator is passed with `var_iter` instead, which names its container too (§5.1).

### 2.2 `heap`

`heap` maps ids to objects.

- **Keys** are ids: `"n1"`, `"n2"`, and so on. They are never addresses.
- **Values** are always `object` values: `{"kind": "object", "type": ..., "fields": {...}}`. Fields may hold `ref`s to other entries in the same heap.
- **It contains exactly the objects reachable from this step's frames** (every frame's locals, and a return value), each written once, with its contents at this moment. There is one heap per step, shared by all frames, so a node that a caller and a callee both point to has one id and one entry.
- **It is empty (`{}`)** when no local points to an object, as in every Two Sum step.
- **Key order carries no meaning.** The runtime keeps the heap in a `std::map`, which sorts ids as strings (`n1`, `n10`, `n2`).

An illustrative step from a linked-list solution, where `head` points to the first node and `cur` to the second (the same shape `tests/test_pointers.cpp` checks):

```json
{
  "step": 4,
  "frames": [{"id": "f1", "function": "countNodes", "line": 7, "locals": {
    "head": {"kind": "ref", "id": "n1"},
    "cur":  {"kind": "ref", "id": "n2"},
    "count": 1
  }}],
  "heap": {
    "n1": {"kind": "object", "type": "ListNode", "fields": {"val": 1, "next": {"kind": "ref", "id": "n2"}}},
    "n2": {"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": {"kind": "ref", "id": "n3"}}},
    "n3": {"kind": "object", "type": "ListNode", "fields": {"val": 3, "next": null}}
  }
}
```

Node `n2` is reached twice, through `cur` and through `n1.next`, but it appears in the heap once. Both places hold the same `ref`, so the frontend draws two arrows to one box.

## 3. Three lifetimes

Every piece of recorder state lives for exactly one of three lengths of time. Most design choices in the runtime follow from this table.

| Lifetime | What lives there | Why |
|---|---|---|
| **The whole run** | `Tracer`: the finished steps, the `truncated` flag, the `id_table`, the problem metadata | These facts must stay true from the first step to the last |
| **One step** | The `Heap`, and the `Ctx` that points to it | A step describes one moment, so its contents describe only that moment |
| **One `record` call** | Each `Value` returned by `var(...)` | It only needs to exist until it has been serialized |

> **Key insight 1: identity lasts the whole run, contents last one step.** The `id_table` records *who* an object is, which never changes. The heap records *what it looks like now*, which changes between steps. That is why they are two maps with two lifetimes.

### 3.1 `Tracer`: the whole run

One global instance, `trace::tracer`, declared `inline` so there is exactly one even if the header is included in several files. The code the rewriter inserts has to reach it from anywhere in the user's code.

- `steps` holds every finished step as JSON text. `steps.size()` is the next step's number, so the count and the steps cannot disagree.
- `truncated` records whether the step cap was hit.
- `id_table` maps address to id.
- `problem` holds the problem metadata as finished JSON. The driver sets it with `tracer.begin(...)` before the Solution runs (§7.1).
- `exit_at_cap` (default `true`) decides what `record` does at the step cap (§7.4). Only tests turn it off.

**Why `id_table` must outlive every step.** An id is a promise to the frontend that `n2` at step 3 and `n2` at step 40 are the same object. Take a list `a → b` with `head` pointing to `a`. At step 3, `a` is met first and becomes `n1`, and `b` becomes `n2`. The program runs `head = head->next`. If the table were reset, step 4 would meet `b` first and call it `n1`, and the frontend would conclude that node `n1` changed its value. With the table kept, `b` stays `n2`, and the frontend correctly sees `head` move from `n1` to `n2`.

### 3.2 `Heap`: one step

**Why the heap starts empty every step.** A pointer serializer asks "have I already written this object?" so that cycles terminate and shared objects are written once. That question is answered by looking in the heap. If the heap carried over, an object written at step 3 would be skipped at step 4, and a change such as `head->val = 5` would never show. An empty heap means "already written" really means "already written in this step", and it also keeps every step self-contained.

### 3.3 `Ctx`: two references in one parameter

`Ctx` is not a third table. Both of its members are references:

```cpp
struct Ctx {
  IdTable &id_table; // the Tracer's table
  Heap &heap;        // this step's heap
};
```

Serialization is recursive (a `vector<ListNode*>` serializes pointers, which serialize nodes, which serialize more pointers), and every level needs both maps. Passing one `Ctx` gives every serializer both without reading global state. That is why `test_serialize.cpp` can build its own `Ctx` and test every serializer with no `Tracer` at all.

### 3.4 Two questions per pointer

One serializer, `Serializer<T*>`, handles every pointer to a struct that has a field table (§3.5), including a pointer to `const` (`const ListNode*`). Each pointer goes through two lookups:

1. **`id_table`:** "Have I ever seen this address?" If not, assign the next id. The answer holds for the whole run.
2. **`heap`:** "Have I already written this object in this step?" If not, insert its entry **before** serializing its fields, then fill it in. The answer holds for this step only.

Inserting before recursing is what makes a cycle such as `a → b → a` terminate: the second visit to `a` finds it in the heap and returns a `ref`. The same check handles aliases, so two pointers to one node share an id and one heap entry with no extra code.

The serializer returns the `ref`. The `object` goes into the heap as a side effect, so a local or a field never holds an object inline.

### 3.5 Field tables

C++ cannot list a struct's fields, so each struct that should appear as an object has a small table: its name in the trace, and each field's name paired with a pointer to that member.

```cpp
template <> struct trace::Fields<ListNode> {
  static constexpr const char* type = "ListNode";
  static constexpr auto fields = std::make_tuple(
    std::pair{"val", &ListNode::val},
    std::pair{"next", &ListNode::next});
};
```

- **The table lives next to its struct**, never in `trace.hpp`, which knows no node types.
- **`ListNode` and `TreeNode`** and their tables are in `adapters/cpp/runtime/leetcode_types.hpp`. They are in the global namespace, because the user's code names them with no prefix.
- **`Node` has no shared definition.** It is a different struct in different problems, so each problem supplies its own struct and table. Later the driver generates them.
- **A pointer to a type with no table does not compile**, so an `int*` is still an error and never a pass-through.
- **`const` is ignored when the table is looked up.** The `HasFields` concept and the serializer both ask for `Fields<std::remove_cv_t<T>>`, so one table for `ListNode` also serves `const ListNode`.

> **Key insight 2: the table is the only per-type code.** Ids, the heap, aliases, and cycles are written once, in the generic serializer. Supporting a new struct means writing a few lines of table, which is something the rewriter can generate.

### 3.6 Objects held by value

A variable can hold a node itself instead of pointing to one. The usual case is the dummy head:

```cpp
ListNode dummy(0);        // the node lives in this variable
ListNode* tail = &dummy;  // a pointer to that same node
```

A second serializer, `Serializer<T>` for any `T` with a field table, covers this. It is one line: it takes the address of the object and hands it to the pointer serializer. So `dummy` is written exactly as a pointer to it would be: the object goes in the heap under its own address, and the local is a `ref`.

```json
"frames": [{"id": "f1", "function": "f", "line": 6,
            "locals": {"dummy": {"kind": "ref", "id": "n1"}, "tail": {"kind": "ref", "id": "n1"}}}],
"heap":   {"n1": {"kind": "object", "type": "ListNode", "fields": {"val": 0, "next": null}}}
```

- **`dummy` and `tail` share one id**, because they are one object. Writing `dummy` inline would draw two nodes, and a change through `tail->next` would show on only one.
- **The address is the real one.** `Value` holds a reference to the live variable (§4.2), so `&obj` is the address of `dummy`, not of a copy.
- **It applies inside containers too.** Each element of a `std::vector<ListNode>` is a `ref`, and a pointer into the vector lands on that element.
- **A copy is a different object.** `ListNode copy = *head;` has its own address, so it gets its own id.

### 3.7 Limits of address identity

> **Key insight 3: an id is only as good as the address behind it.** The runtime identifies an object by its address, and follows every pointer it is given. C++ lets an address outlive its object, and lets a pointer exist before it points anywhere. In those cases the trace can be wrong, or the program can crash while recording. These are accepted limitations for now, not bugs to work around in a solution.

| Situation | Example | What happens |
|---|---|---|
| **Dangling pointer** | `delete node;` while a local still holds the address | The next `record` reads freed memory. That is undefined behavior: usually garbage values, sometimes a crash |
| **Uninitialized pointer** | `ListNode* p;` recorded before it is assigned | The same. `p` holds whatever was in memory, and it is followed like a real address |
| **Address reuse after `delete`** | `delete a; ListNode* b = new ListNode(5);` | `new` may return the address `a` had. The id table says "seen before", so `b` gets `a`'s id, and two objects look like one that changed |
| **Address reuse on the stack** | `ListNode tmp(i);` declared inside a loop body | Each iteration's `tmp` usually has the same address, so the trace shows one object changing instead of a new object each time |
| **A container that moves its elements** | `std::vector<ListNode>` that grows | The elements get new addresses, so they get new ids, and pointers to the old elements are dangling |

- **Why it is not fixed yet.** A real fix needs to know which objects are alive, by tracking every `new` and `delete`, and it needs a way to say "this pointer points at nothing valid" in the trace, which is a spec change. The rewriter is the natural place for the tracking, and it does not exist yet.
- **What to do meanwhile.** Most LeetCode solutions never `delete`, so most are unaffected. Fixtures should not `delete`, and should initialize every pointer where it is declared. The sandbox contains a crash.
- **Planned first step** (with the rewriter): rewrite `delete p;` so the id is removed from the table first. That fixes reuse after `delete`. Dangling and uninitialized pointers still need the spec change.

## 4. The recording API

Instrumented code uses five things from the runtime. This is a recursive function as the rewriter will write it (`fixtures/max_depth_hand_inst.cpp`):

```cpp
int maxDepth(TreeNode *root) {
  ::trace::Frame frame("maxDepth");                                  // 1. push a frame for this call
  ::trace::record(4, ::trace::var("root", root));                     // 2. a step before each statement
  if (root == nullptr) {
    ::trace::record(5, ::trace::var("root", root));
    return ::trace::ret<int>(5, 0, ::trace::var("root", root));       // 3. the return step
  }
  ::trace::record(7, ::trace::var("root", root));
  int left = maxDepth(root->left);
  ...
}
```

| Piece | What it is |
|---|---|
| `var(name, value)` | Returns a `Value<T>`: the name (a `const char*` literal) and a `const T&` to the live variable. It must name a variable: `var("n", nums.size())` does not compile (§4.2) |
| `var_iter(name, it, container_name, container)` | Returns an `IterValue`: an iterator and the local container it points into. It becomes an `iterator` value (§5.1). Like `var`, both arguments must be variables |
| `Frame frame("name")` | An RAII guard on the first line of every function. Pushes a frame for the call, pops it when the call ends |
| `record(line, vars...)` | Records one step: the running frame is about to execute `line`, with these variables in scope |
| `ret<T>(line, value, vars...)` | Records the return step, then returns `value`. `ret_void(line, vars...)` is the same for a function with no return value |
| `Scope scope(line)` | An RAII guard at the start of each loop body and each block that declares a variable (§4.5) |

The rules the rewriter follows, and the hand-written fixtures follow today:

- A `record` before each statement. A loop header gets no `record` of its own: its body's statements do.
- A `return` statement gets its `record` like any statement, then `return ::trace::ret<T>(line, value, ...)`. The first step shows the frame about to evaluate the expression, which matters when the expression calls a function. The second shows the value.
- A `void` function gets `ret_void` before each `return;` and at its closing brace.
- `T` in `ret<T>` is the function's declared return type.

### 4.1 What `record` does, in order

1. **Find the running frame.** If there is none, the instrumentation is broken: print a message and exit with code 1.
2. **Check the cap.** If already truncated, return. If `steps.size()` has reached 2,000, set `truncated`, write the trace, and end the program (§7.4).
3. **Update the running frame.** Set its `line`, and store a lambda that holds copies of this call's `Value`s (§4.3).
4. **Build the step** (`push_step`). Create an empty `Heap` and a `Ctx`. For each frame, bottom to top, call its stored lambda, which serializes that frame's variables as they are now and fills the heap. Then write the heap with `write_heap`. This must come last, because the frames fill it.
5. **Store the step.** Push `{"step": N, "frames": [...], "heap": {...}}` onto `tracer.steps`.

When `record` returns, the `Ctx` and the heap are gone. What remains is the finished step, any new `id_table` entries, and the running frame's stored `Value`s.

> **Key insight 4: serialize at the call, store text.** A step holds finished JSON, never a reference to program state. A later mutation cannot reach back and change an earlier step.

### 4.2 Why `Value` holds a reference

- **No copies.** Each variable is serialized and thrown away, so copying every container on every step would be wasted work.
- **Arrays keep their type.** A by-value parameter turns `int arr[5]` into `int*`, which has no serializer, and turns `char buf[8]` into `char*`, which loses the bounded read.
- **Addresses stay real.** Identity is taken from the address of the live object. A copy would have a new address on every call, and aliases would get different ids.
- **Callers stay live.** Copying a `Value` copies the reference, so a frame can keep its `Value`s and serialize the same variables again at a later step, inside a function it called.

A frame keeps its `Value`s after `record` returns, so a `Value` must never refer to a temporary, which would be destroyed at the end of the `record(...)` call. `var` has a deleted overload for temporaries (`const T&&`), so `var("n", nums.size())` or `var("k", 5)` fails to compile instead of leaving a dangling reference.

### 4.3 How a frame keeps its variables

The frame stack is a `std::vector<FrameState>` in the `Tracer`. Each `FrameState` holds the frame's id, function name, line, and a `std::function<Json(Ctx&)>` that writes its locals.

**Why `std::function`.** Every `record` call passes different variable types, so each call builds a lambda of a different type. A vector needs one element type. `std::function<Json(Ctx&)>` can hold any callable that takes a `Ctx&` and returns `Json`, and hides which lambda it is. This is called type erasure.

**What the lambda holds.** `[vars...](Ctx& ctx) { return write_locals(ctx, vars...); }` copies each `Value` into the lambda. Each copy still refers to its variable (§4.2), so calling the lambda at a later step reads the variables as they are then. That is the whole mechanism behind live callers.

**Why not keep the caller's text from its last step instead.** Callers change while their callees run: a backtracking `path` or a `visited` array is passed by reference and changed by the callee. Text saved at call time would show stale values, and its `ref`s could name objects missing from the current step's heap.

### 4.4 Frames and return steps

**`Frame` is RAII.** RAII means an object whose constructor does a setup and whose destructor undoes it. The constructor runs where the guard is declared, the first line of the function. The destructor runs whenever the function is left: through any `return`, at the closing brace, or by an exception. So the frame stack always matches the real call stack, and no exit path needs its own pop code. The guard cannot be copied, because a copy would pop the same frame twice.

**`ret<T>` records, then returns.** It sets the running frame's line and `Value`s like `record`, builds a step whose top frame also has `return_value`, and returns `value` unchanged. The return value is serialized after every frame's locals, so ids are given in a fixed order. `T` is named, never deduced. That keeps `return {it->second, i};` working: a braced list cannot be deduced, but it can initialize a parameter of a known type.

**Past the step cap**, `ret` adds no step but still returns the value, so the program's behavior does not change.

**Exceptions** pop frames through the guards' destructors, but produce no return step. The format does not model exceptions yet.

### 4.5 `Scope`: no dangling `Value`s

A frame keeps the `Value`s of its latest `record`. If that `record` was inside a block, its `Value`s may name variables declared in the block, which die when the block ends. If the function then calls another function before its next `record`, the callee's steps would serialize the caller from dead variables. The usual way this happens is a call in a loop condition:

```cpp
while (i < count(n)) {     // the condition has no record of its own
  int y = ...;             // the body's last record names y
}                          // y dies; the condition runs again and calls count()
```

`Scope` is the fix. At the start of the block it saves the frame's stored `Value`s, and at the end it restores them. The restored `Value`s only name variables declared outside the block, which are still alive. It also sets the frame's line to the line of the statement that owns the block (the `while`), which is where the frame is once the block has ended. Without it, AddressSanitizer reports `stack-use-after-scope` for exactly this program. With it, the run is clean.

A `Scope` goes at the start of each loop body (its header may declare a variable, like `int i`) and each block that declares a variable. The rewriter adds one to every block except a function's body and a `switch` body (§8), which is simpler and costs nothing.

### 4.6 Why there are no macros

A function cannot learn the name of the variable passed to it. A macro (`V(x)` with `#x`) could, but the rewriter already knows every name from the AST, so it writes the names as string literals itself. This avoids two macro problems: macros ignore namespaces, and a short name like `V` collides with user code (graph solutions often name the vertex count `V`). The rewriter emits fully qualified names (`::trace::record`), so nothing in the user's code can shadow them.

The line number is passed explicitly rather than taken from `std::source_location`, because only the rewriter knows the line in the user's original source. `source_location` would report the line in the rewritten file.

## 5. Normalization: C++ types to kinds

| C++ type | Kind |
|---|---|
| `bool` | bare `true` / `false` |
| `char` | one-character string |
| integers (including `int8_t`, `uint8_t`) | bare number, or `int` outside ±(2^53 − 1) |
| `float`, `double`, `long double` | bare number, or `float` for NaN and ±Infinity |
| `std::string`, `std::string_view`, `const char*`, `char[N]` | string (a null `const char*` is `null`) |
| `T[N]`, `std::array`, `std::vector`, `std::bitset` | `array` (bitset: booleans in index order) |
| `std::list`, `std::forward_list` | `list` |
| `std::pair`, `std::tuple` | `tuple` |
| `std::set`, `std::unordered_set` | `set` |
| `std::multiset`, `std::unordered_multiset` | `multiset` |
| `std::map`, `std::unordered_map` | `map` |
| `std::multimap`, `std::unordered_multimap` | `multimap` |
| `std::stack` | `stack`, bottom to top |
| `std::queue` | `queue`, front to back |
| `std::deque` | `deque` |
| `std::priority_queue` | `priority-queue`, storage order, with `order` |
| `std::optional<T>` | `null` when empty, otherwise the value |
| `TreeNode*`, `ListNode*`, `Node*`, and pointers to `const` | `ref`, plus an `object` in the heap. `nullptr` is `null`. Needs a field table (§3.5) |
| `TreeNode`, `ListNode`, `Node` held by value | The same `ref` a pointer to it would give (§3.6) |

Any other type fails to compile at the primary `Serializer` template's `static_assert`, so an unknown type is an error, never a pass-through.

### 5.1 Iterators

An iterator has no value of its own: it is a position in a container. So it is never serialized alone. `var_iter("it", it, "numMap", numMap)` gives the runtime the iterator and the container together, and `write_local` writes ([`trace-format.md`, "Positions in a container"](../trace-format.md#positions-in-a-container-iterators)):

| The iterator | Written as |
|---|---|
| equal to `container.end()` | `{"kind": "iterator", "container": "numMap", "end": true}` |
| into a `map`, `multimap`, `unordered_map` (it has `mapped_type`) | `"key"`: the serialized `pos->first` |
| into a `set`, `multiset`, `unordered_set` | `"key"`: the serialized `*pos` |
| random access (`vector`, `deque`, `string`, `array`) | `"index"`: `pos - begin()` |
| any other (`list`, `forward_list`) | `"index"`: counted by walking from `begin()` |

The concept `IteratorOf<It, C>` accepts only `C::iterator` and `C::const_iterator`. Anything else passed through `var_iter` falls back to an ordinary local: an `int` the rewriter paired by mistake is written as an `int`, and a reverse iterator, or an iterator into another container type, has no serializer and is left out. So a wrong guess by the rewriter loses a marker, but never writes a wrong one. An index outside the container (impossible for a valid iterator) is left out too.

The rewriter checks nothing at run time: it cannot know whether `it` still points into `nums` after `it = other.begin()` in a branch it did not see. It re-pairs on every assignment it can read (§8.2), and the runtime's type check catches the rest.

## 6. Layout of `trace.hpp`

Each section uses only what is above it, so no part depends on something declared later.

| Section | Contents |
|---|---|
| 1. Aliases and constants | `i8`…`f64`, the ±(2^53 − 1) limits |
| 2. Core types | `Json`, `Heap`, `IdTable`, `Ctx` |
| 3. Dispatch | The primary `Serializer` and `serialize()`, declared before any use |
| 4. JSON text helpers | `escape`, `quote` |
| 5. Writing helpers | `write_items`, `write_entries`, `write_tuple`, `get_container`, `write_heap`, `comparator_name` |
| 6. Serializers | Grouped by the kind they produce. Group 6i holds `Fields`, `HasFields`, the pointer serializer, and the serializer for objects held by value |
| 7. The recorder | `FrameState`, `Tracer`, `tracer`, `Value`, `var`, `IterValue`, `var_iter`, `IteratorOf`, `write_iterator`, then the document writer (`output_path`, `write_file`, `build_document`, `write_document`, `write_result`, `write_void_result`), then the steps: `write_locals`, `top_frame`, `step_allowed`, `push_step`, `set_frame`, `record`, `ret`, `ret_void`, and the `Frame` and `Scope` guards |

The recorder comes last because it uses everything else. Nothing above it touches the global `tracer`. Inside it, the document writer sits above `record`, because `record` calls it at the step cap.

## 7. Writing the trace

The steps stay in memory until the trace is written to a file as one JSON document. These functions do this, and each one uses the ones above it:

| Function | What it does |
|---|---|
| `build_document(result, result_heap)` | Returns the whole trace as text. It does no file I/O, so it is easy to test |
| `output_path()` | Returns the value of the `TRACE_OUT` environment variable, or `trace.json` when it is unset or empty |
| `write_file(path, text)` | Writes text to a path atomically. Returns 0 on success and 1 on failure |
| `write_document(result, result_heap)` | Calls the three above. Ends the program with exit code 1 if the file cannot be written |
| `write_result(value)` | For the driver: serializes the return value with a heap of its own, then calls `write_document` |
| `write_void_result()` | For the driver: writes `"result": null` for a `void` method that returned |

### 7.1 What the driver does

Until driver generation exists, `main` is written by hand. This is the one in `fixtures/two_sum_hand_inst.cpp`:

```cpp
trace::tracer.begin(R"({"method": "twoSum", "params": [...], "returns": {"type": "array<int>"}, "input": {...}})");

vector<int> nums{2, 7, 11, 15};
vector<int> answer = Solution().twoSum(nums, 9);

trace::write_result(answer);
```

- **`begin` stores the problem metadata** as finished JSON, before the Solution runs. The runtime never looks inside it. It has to be stored up front because `record` may need to write a whole document from inside the Solution (§7.4).
- **`write_result` serializes the return value with a heap of its own.** It is a template, so the return type is deduced from the call and the driver never names it. When the method returns a pointer, the objects it reaches land in that heap, which becomes `result_heap` ([`trace-format.md` §3, The return value](../trace-format.md#the-return-value)). The id table is the run-long one, so a returned node keeps the id it had in the steps.
- **A `void` method** has no `answer`. The driver calls `trace::write_void_result()`, which writes `"result": null`, and the metadata says `"returns": {"type": "void"}`.
- **The document is written once**, after the method returns.

**A step at the closing brace.** For a `void` method the answer is the input it changed, and a step is taken before its line runs, so the last statement's effect would never be seen. The rewriter adds a `ret_void` at the method's closing brace, which is that step. `tests/programs/void_method.cpp` does it by hand.

### 7.2 What the document contains

| Field | Written | Source |
|---|---|---|
| `version` | Always | The `VERSION` constant (`"0.7"`) |
| `language` | Always | The `LANGUAGE` constant (`"cpp"`) |
| `problem` | Always | The JSON passed to `begin`, pasted in unchanged |
| `steps` | Always | `tracer.steps`, joined with `", "` |
| `result` | Only when the caller passes one | The serialized return value, or `null` for a `void` method |
| `result_heap` | Only with a `result`, and only when the heap is not empty | The heap filled while serializing the return value |
| `truncated` | Only as `true` | `tracer.truncated` |

A document written at the step cap has no `result`, and a normal one has no `truncated`. Both rules come from the spec ([`trace-format.md` §3, Unfinished runs](../trace-format.md#unfinished-runs)).

### 7.3 Where it goes

- **A file, not stdout.** The user's own `cout` lines share stdout, so a stray debug print would corrupt the trace and a deliberate one could forge it.
- **The path comes from `TRACE_OUT`**, because the injected code never sees `main`'s arguments. The runner sets it. The default is `trace.json` in the working directory.
- **The write is atomic.** `write_file` writes to `<path>.tmp`, closes it, checks that the write succeeded, and then renames it onto the real path. A process killed halfway leaves the old file or the new one, never half of one. On failure it removes the `.tmp` file and leaves the real file untouched.

### 7.4 At the step cap

The 2,001st call to `record` does not add a step. It sets `truncated`, calls `write_document()` with no result, and ends the program with `std::exit(0)`.

- **Why write here.** A solution stuck in an infinite loop never returns to `main`, so a write in `main` would never happen. Writing at the cap is what gives the user 2,000 steps to look at instead of a timeout error.
- **Why exit.** Nothing after the cap is recorded, so letting the program run on only burns time until the sandbox kills it. Exiting also means the document is written exactly once.
- **Why exit code 0.** The run did what the recorder is meant to do, and `"truncated": true` in the trace already says what happened. A nonzero code is kept for a trace that could not be written.
- **Why `std::exit` and not `std::_Exit`.** `std::exit` flushes the user's buffered `cout` output first.

`Tracer::exit_at_cap` (default `true`) turns the write and the exit off. With it off, `record` only sets `truncated`, and later calls return early. Only tests use it, so that a test program can reach the cap and keep running.

The sandbox's time limit is still needed for a loop that never calls `record`, for example one inside library code. That run ends in a timeout, not a trace.

> **Key insight 5: the trace is written exactly once, by whichever comes first: the method returning, or the step cap.**

## 8. The rewriter

`adapters/cpp/rewriter/` is a Clang LibTooling tool, `trace-rewrite`. It reads a plain Solution and writes the same code with the runtime's calls inserted, exactly the calls the fixtures' `_hand_inst.cpp` files make by hand.

| File | What it is |
|---|---|
| `instrumenter.hpp`, `instrumenter.cpp` | The AST visitor: where every insertion is decided |
| `main.cpp` | The tool: options, parsing the file with Clang, writing the result |
| `Makefile` | Builds `build/trace-rewrite` with `llvm-config`; `make test` runs its tests |

```bash
make -C adapters/cpp/rewriter                                   # Ubuntu: needs libclang-18-dev libclang-cpp18-dev llvm-18-dev
make -C adapters/cpp/rewriter LLVM_CONFIG=$(brew --prefix llvm)/bin/llvm-config   # macOS

trace-rewrite solution.cpp -o out.cpp -- -std=c++20 -I adapters/cpp/runtime -include prelude.hpp
python3 -m driver solution.cpp --example "..." --out DIR --rewrite                # the same, through the driver
```

The file is parsed with the driver's prelude, the same flags the program is compiled with, so `vector`, `ListNode`, and a commented `Node` are all known. Code that does not compile is reported by Clang, at the user's line numbers, and nothing is written (exit 1).

### 8.1 What it inserts

| Where | Inserted |
|---|---|
| After the `{` of each instrumented function | `::trace::Frame trace_frame_("name");` |
| Before each statement in a block, except loops, `{ }`, and `;` | `::trace::record(LINE, ::trace::var("a", a), ...);` |
| After the `{` of every other block | `::trace::Scope trace_scope_(LINE);`, with the line of the `if`, `for`, or `while` that owns it |
| Around an unbraced body (`if (x) y++;`, an `else if`) | `{ ` and ` }`, so it has a block for the above |
| `return expr;` | `return ::trace::ret<T>(LINE, expr, vars...);`, with `T` the declared return type |
| `return;`, and the closing `}` of a `void` function | `::trace::ret_void(LINE, vars...);` before it |

**Which functions:** the methods of class `Solution` and free functions, defined in the main file. Not constructors, destructors, operators (comparators), other classes' methods, or lambdas.

> **Key insight 6: no insertion contains a newline, so the output has the input's lines.** The `Rewriter` records each edit against a position in the original file, so `SourceManager::getSpellingLineNumber` gives the user's line whatever was inserted before it. And because nothing adds a line, line 12 of the output is line 12 of the input. The `record` calls carry their line explicitly anyway, but a compile error in the user's code also points at the right line.

### 8.2 The walk

`Instrumenter` is a `RecursiveASTVisitor`. It overrides **`Traverse`** functions, not `Visit` functions. A `Visit` function sees one node and runs before its children are walked. A `Traverse` function replaces the walk of a node's whole subtree, so it can do work before, between, and after its children. Scope analysis needs that.

A block's statements are handled one at a time, in this order:

1. **Insert the `record`** before the statement, listing every variable visible now.
2. **Walk into the statement.** A nested block sees the scope as it is at this point.
3. **Then add what it declares** (`int x = ...`), so it is visible to the statements after it, and not to its own `record`.

The scope is a stack of name lists: the parameters, then one list per block, and one for the header of each `for`, `if`, `while`, and `switch` (`for (int i = ...)`, `if (auto x = f(); ...)`, a range-`for` variable, a condition variable). Structured bindings (`auto [lo, hi] = p;`) declare each name.

**Shadowing.** A name declared again in an inner scope hides the outer one, and C++ name lookup would also pick the inner one, so only the innermost is listed. A step never has two keys with the same name.

**Bodies without braces** get a block: `if (x) y++;` becomes `if (x) { ::trace::Scope ...; ::trace::record(...); y++; }`. An `else if` is an `IfStmt` as the else body, so it gets the same treatment, and its closing `}` goes after the whole rest of the chain. The `}` goes after the statement's last token and its `;` (`Lexer::findLocationAfterToken`), because a statement's `getEndLoc()` is the start of its last token.

**Order at one position.** Every insertion is appended after earlier ones at the same position. The walk is ordered so that this is right: a body's `{` is inserted before the `record` that follows it, and an inner block's `}` before the `}` of the block around it.

**Iterators are paired with a container.** For each variable declared or assigned (`auto it = m.find(x);`, `it = s.lower_bound(v);`), the walk looks for the container in the initializer: the object of a `begin`, `end`, `cbegin`, `cend`, `find`, `lower_bound`, `upper_bound`, `erase`, `insert`, `emplace`, or `emplace_hint` call, or the argument of a free `begin`/`end`. If exactly one visible variable is found, the variable's later `var(...)` becomes `var_iter("it", it, "m", m)`. An assignment with no container (`it = f();`) clears the pairing. The runtime decides whether the type really is that container's iterator (§5.1), so `int i = v.size();`-like lookalikes that pass the syntax check (`auto n = m.find(x)->second;`) are written as ordinary locals.

**A `switch` body** gets records but no `Scope`: a jump to a `case` label may not skip a variable's initialization, and the guard is a variable. The `record` for `case 1: x = 2;` goes after the label, so it stays in that case.

### 8.3 Limits

- **Lambdas are not instrumented.** A lambda's body runs as its own call, with its own captures and parameters. Listing the enclosing function's variables inside it would name variables it may not capture. Recursive lambdas (`function<void(int)> dfs = [&](...)`) therefore get no frames yet.
- **Code from macros is not edited**, and neither are other classes' methods or operators.
- **Member variables of `Solution` are not listed** (roadmap Phase 5).
- **Uninitialized variables are listed**, so `int x;` shows a garbage value until assigned, and an uninitialized pointer can crash the serializer (§3.7).
- **`return expr;` in a `void` function** gets its return step before `expr` runs. Rare.
- **A function returning `auto` that is not yet deduced** (a template) gets no `ret`: its returns are recorded but not shown as return steps.

## 9. Testing

```bash
make -C adapters/cpp both               # every test, with clang++ and g++
make -C adapters/cpp test T=record      # one test file
make -C adapters/cpp e2e                # the end-to-end check (needs python3 and jsonschema)
```

The test programs are built into `adapters/cpp/build/<compiler>/`, and the traces the end-to-end check writes go to `adapters/cpp/build/traces/<compiler>/`. Both are ignored by git.

- `tests/test_serialize.cpp` checks the exact JSON text of every serializer, with its own `Ctx` and no `Tracer`.
- `tests/test_record.cpp` checks that `record` reproduces Two Sum's steps character for character (each section declares a `Frame`), the rules for `locals`, that locals with no serializer (a bare iterator, a lambda, a `std::function`) are left out, snapshot-at-call, the step cap, and the heap and id rules. The heap tests use a test-only `Probe` type as a stand-in until pointer serializers exist. It sets `exit_at_cap` to `false` so it can reach the cap and keep running.
- `tests/test_pointers.cpp` checks the object serializers: null, one node, a chain, aliases, cycles, `TreeNode`, pointers inside containers, a problem's own graph `Node`, pointers to `const`, objects held by value (alone, next to a pointer to them, copied, and inside a `vector`), the dummy-head pattern through `record`, ids staying stable across steps while the heap is rebuilt, and a returned pointer's own heap.
- `tests/test_frames.cpp` checks the call stack: one frame, a call (two frames, a return step, one frame again), frame ids never reused, callers read live after a callee changes their vector, one heap shared by every frame, `ret` with a braced value and with a pointer, `ret_void`, recursion three levels deep and its unwinding, `Scope` restoring a frame after a block, a frame popped by an exception, the step cap inside `ret`, and (at compile time) that `var` rejects a temporary.
- `tests/test_document.cpp` checks the exact text of `build_document`: no steps, one step and several joined with `", "`, steps written by `record` itself, a result (including a `null` one), no `result` key at all when there is none, `result_heap` after a `ref` result and absent when the heap is empty or there is no result, no `truncated` key unless it is `true`, a problem pasted in unchanged (odd spacing, escapes, UTF-8), and that building the document twice gives the same text and changes nothing.
- `tests/test_iterators.cpp` checks `var_iter`: an index into a `vector` (and `end`, a `const_iterator`, an empty vector), a key into a `map`, `set`, and `multimap`, a pointer key as a `ref` with its object in the heap, an index into a `list`, `forward_list`, `deque`, and `string`, the fallbacks (an `int` stays an `int`; a reverse iterator or another container's iterator is left out), a loop step by step, and that `ret` gives no `return_value` for an iterator.
- `tests/test_write_file.cpp` checks `output_path` and `write_file`: a successful write, a failed open, a failed write, and a failed rename. After every failure the old file must be unchanged and the `.tmp` file gone. Its files go in a private folder in the system's temp directory, which it removes at the end. It is POSIX only (`setenv`, `setrlimit`).

`make e2e` is the end-to-end check. It runs every hand-instrumented fixture, and three test programs, with `TRACE_OUT` set, then checks what they wrote with [`tools/check_trace.py`](../../tools/check_trace.py):

| Program | Must | Checked with |
|---|---|---|
| `fixtures/<name>_hand_inst.cpp` for two-sum, reverse-list, preorder-traversal, clone-graph, max-depth, subsets | Write a trace equal to its golden one | `--equals fixtures/<name>.trace.json` |
| `tests/programs/loop_forever.cpp` | Exit with code 0 from inside `record` at the step cap | `--expect-truncated`: `"truncated": true`, no `result`, exactly 2,000 steps numbered 0 to 1999 |
| `tests/programs/return_pointer.cpp` | Return a `ListNode*` out of a dummy-head method | `--expect-result-heap`: `result` contains a `ref`, and `result_heap` is present |
| `tests/programs/void_method.cpp` | Return from a `void` method | `--expect-void`: `returns.type` is `"void"` and `result` is `null` |

Every trace is also checked for dangling refs: each `ref` must name an object in the heap that travels with it.

- **Equality is after parsing**, not byte for byte, so spacing can change. Types must still match, and `set` items and `map` entries compare in any order, because their order is unspecified ([`trace-format.md` §10](../trace-format.md#10-validation-and-testing)).
- **The old trace is deleted before each run**, so a program that writes nothing cannot pass on a stale file.
- **Each run has a 20-second limit** (`E2E_TIMEOUT`). If the cap stops ending the run, `loop_forever` spins until the limit kills it, and the target fails with exit code 142 instead of hanging. The limit uses `perl`'s `alarm`, because coreutils `timeout` is not on macOS by default.
- `driver/tests/test_rewriter.py` checks the rewriter (§8): every golden fixture, rewritten from its plain `_trace.cpp`, equals its golden trace; every original line survives on its own line; and unbraced bodies, `else if` chains, loop-variable scope, shadowing, recursion through a private helper, lambdas, iterators (from `find`, walking a `list`, reassigned, `lower_bound`, and lookalikes that are not iterators), `void` returns, `switch`, structured bindings, `if` with an initializer, `do`/`while`, and compile errors at the user's line. `make -C adapters/cpp/rewriter test` builds the tool and runs them.
- **The files in `tests/programs/` are not `tests/test_*.cpp`**, so `make test` never builds them. Each is a whole program that writes a trace, and `loop_forever.cpp` is meant to end the process.

CI ([`.github/workflows/ci.yml`](../../.github/workflows/ci.yml)) runs `make both header e2e` on Ubuntu 24.04 with GCC 14 and Clang 18, which both use libstdc++, and `make test header e2e` on macOS with Apple Clang and libc++. On macOS `g++` is Apple Clang too, so `make both` there would build with the same compiler twice.

## 10. Known limitations

- **Shadowed names inside one function.** Two variables named `i` in scope at once in the same function (an inner block's `int i` hiding an outer one) produce a duplicate key in that frame's `locals`. The call stack fixed the same name in *different* calls, since each call has its own frame, but not this case. The rewriter will have to pass only the innermost one.
- **Instrumentation rules are not checked at run time.** A `record` outside any `Frame` stops the program with a message. A call made before a function's first `record` would write a frame with line 0, which the schema rejects. A missing `Scope` is undefined behavior only when a call happens between the end of the block and the next `record` (§4.5).
- **Step size grows with recursion depth.** Every step writes every frame. For LeetCode examples and a 2,000-step cap this is small. A cap on frames can be added if a test shows it is needed.
- **Iterators into something that is not a local** (a member, a temporary, a container inside a container: `g[u].begin()`) have no container to name, so they are left out. So are reverse iterators.
- **Container aliasing.** Two references to the same `vector` appear as two copies. Only objects have identity.
- **Wide character types** (`wchar_t`, `char8_t`, `char16_t`, `char32_t`) are rejected by the integer serializer's comparisons.
- **Dangling and uninitialized pointers, and reused addresses.** A pointer to a deleted node, or one that was never assigned, is followed as if it were valid, which is undefined behavior. An object that reuses an address also reuses its id. See §3.7.
- **A table must be declared before its type is first serialized.** `HasFields<T>` is decided the first time it is asked, so a `Fields<T>` specialization that appears later in the file is not seen. Keeping each table next to its struct avoids this.
- **Very long chains.** The serializer recurses once per node it follows, so a list of many thousands of nodes can overflow the stack. Traces are meant for small examples.
- **A crash writes no trace.** A solution that crashes before the cap (a segfault, an uncaught exception) never reaches `write_document`, so the steps recorded so far are lost. The spec allows a trace with no `result` and no `truncated` for this case, but the runtime does not produce one yet.

## 11. Design questions

**Q1. Why does the heap start empty every step when the `id_table` does not?** They answer different questions. The `id_table` says who an object is, and that must be the same at every step or the frontend cannot follow an object. The heap says what the object looks like now, and reusing it would make the runtime skip objects it wrote in an earlier step, so their changes would never show.

**Q2. Why does `Ctx` exist if it owns nothing?** Every serializer needs both maps, at every level of recursion. Bundling two references into one parameter keeps the signatures short and keeps serializers independent of global state, which is what lets the serializer tests run without a `Tracer`.

**Q3. Why is the heap a map of strings instead of objects?** Each entry is written as JSON at the moment it is reached, while the serializer still knows the real type (`TreeNode*`). By the time `record` writes the heap, there is nothing left to compute, only text to join. An address alone could not be serialized later anyway, because a `const void*` has lost its type.

**Q4. Why are the locals serialized before the heap?** Serializing the locals is what fills the heap. Writing the heap first would always produce `{}`.

**Q5. Why no `V(x)` macro?** The rewriter already knows each name, so a macro adds nothing, and a macro would ignore namespaces and could collide with user code. See §4.6.

**Q6. Why does `record` end the program at the step cap instead of only stopping the recording?** A solution that reaches the cap is usually in an infinite loop, so it would never return to `main` and no trace would be written. Writing inside `record` saves the 2,000 steps, and exiting right after means the document is written once and no time is spent on a run nobody is recording. See §7.4.

**Q7. Why is the problem metadata one JSON string and not a struct?** The runtime never reads the method name, the parameters, or the input. It only pastes them into the document. Whoever calls `begin` already has them as text: a person today, the driver generator later. A struct would add types and a serializer for data that is never used as data.

**Q8. Why does an object held by value reuse the pointer serializer instead of writing itself inline?** Because the two must agree. A pointer to the object is a `ref` to a heap entry found by address. If the object also wrote itself inline, the same node would appear twice with no link between the copies. Forwarding the address means there is one code path, one id, and one heap entry, however the object is reached.

**Q9. Why does the result get a new heap instead of the last step's?** The heap is per step so that "already written" means "already written now" (§3.2). The return value is read after the last step, when the objects may have changed, so it needs the same fresh start. `write_result` creates one, exactly as `record` does for a step.

**Q10. Why are dangling pointers a documented limit instead of something the runtime checks?** A raw address cannot be asked whether its object is still alive. Checking would mean tracking every allocation, and reporting a dead pointer would need a value the trace format does not have. Both belong with the rewriter and a spec change (§3.7), so for now the limit is written down where a fixture author will see it.

**Q11. Why does every frame get re-serialized at every step, instead of each frame keeping the text of its last step?** Because callers change while their callees run, through references (§4.3). Re-serializing costs a little more per step, and it is the only way a caller's `path` or `visited` shows what it holds now.

**Q12. Why is `Frame` a guard object instead of a pair of `push()`/`pop()` calls?** A function has many ways out: every `return`, the closing brace, and exceptions. A `pop()` would have to be written before each of them, and one missed exit would leave the stack wrong for the rest of the run. A destructor runs on every exit, so the stack cannot drift.

**Q13. Why does a return statement get two steps?** The first is the ordinary pre-execution step: the frame is about to evaluate `1 + max(left, right)`, or `n * fact(n - 1)`, which may call functions, and the caller's line must already be the return line while those calls run. The second is the return step, which shows the value. For `return 0;` the first step looks redundant, but one rule for every return statement is simpler for the rewriter and for the reader.

**Q14. Why does the rewriter list every variable and let the runtime drop the unsupported ones?** The rewriter sees types, but whether `trace.hpp` has a serializer for a type is decided by template rules when the program is compiled, after the rewriter has finished. A list of unsupported types inside the rewriter would always lag behind `trace.hpp`. With the `Serializable` concept, the runtime is the only place that knows, and adding a serializer (an iterator kind, say) makes those variables appear with no change to the rewriter.

**Q15. Why are the inserted calls on the same line as the code, instead of on lines of their own?** Readability of the generated file matters less than its line numbers. Keeping every original line on its own line means the output can be read against the original line by line, and the compiler's errors and warnings point at the lines the user wrote.
