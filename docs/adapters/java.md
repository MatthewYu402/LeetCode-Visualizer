# Java Adapter

> **Status:** Draft v0.15
> **Related:** [`trace-format.md`](../trace-format.md) (the contract), [`native-tracing.md`](../native-tracing.md) §4 (source instrumentation), [`cpp.md`](cpp.md) (the C++ adapter, whose rules this one follows), [`python.md`](python.md), [`adapters/java/`](../../adapters/java/) (the runtime and the rewriter), [`driver/java/`](../../driver/java/) (the driver), [`sandboxing.md`](../sandboxing.md) (where it runs)

This document describes how the Java adapter turns a running `Solution` into a trace: how the source is rewritten, what the runtime records, how Java values become the trace's kinds, and what the driver gives the program. Everything here is implemented, except what §9 lists as a limitation.

---

## 1. Where the adapter sits

Java, like C++, is traced by **source instrumentation** ([`native-tracing.md` §4](../native-tracing.md)): the Solution is rewritten with calls to a small runtime on its own lines, compiled, and run. A debugger (the JDK's JDI) would give the steps without a rewrite, but it costs a second JVM and a round trip per local per step, and it still could not say what a line evaluated. The rewrite gives the steps and the outcomes from one place, with the same rules as the C++ rewriter, which is what lets the three languages' traces be compared call by call (§8).

The rewriter is written in Java with the JDK's own parser (`com.sun.source.tree`, in the `jdk.compiler` module), so the adapter has no third-party library. It runs in the same JVM as javac:

| File | Role |
|---|---|
| [`src/lvtrace/Build.java`](../../adapters/java/src/lvtrace/Build.java) | Stages 2 and 3 in one JVM: parse, rewrite, compile `Solution.java` with the driver's `LvMain.java` and `Nodes.java`; exit 0, 10 (the user's code does not compile), or 20 (a bug here) |
| [`src/lvtrace/Rewriter.java`](../../adapters/java/src/lvtrace/Rewriter.java) | The rewriter: inserts frames, steps, outcomes, and return steps; reads `indexes` and the kind hints (§5) from the tree |
| [`src/lvtrace/Trace.java`](../../adapters/java/src/lvtrace/Trace.java) | The runtime: frames, steps, outcomes, members, the step cap, the document writer, and what the program says when the user's code throws |
| [`src/lvtrace/Snapshot.java`](../../adapters/java/src/lvtrace/Snapshot.java), `Step.java`, `Frame.java`, `Json.java` | Values to kinds by reflection, one step's heap and shared containers, JSON text |
| [`src/lvtrace/Args.java`](../../adapters/java/src/lvtrace/Args.java) | Large inputs read from text (§6) |
| [`Makefile`](../../adapters/java/Makefile) | Compiles the adapter to `build/classes` (`make -C adapters/java`) |

The driver runs outside the sandbox. `Build`, the compiler, and the program run inside it, in the Java image (§7).

## 2. What one step looks like

The same as in C++ ([`cpp.md` §2](cpp.md)): the whole call stack, each frame with its `id`, `function`, `line`, and `locals`; the Solution's `members`; one `heap`. The rewriter places the steps where the C++ rewriter does:

| Statement | Step |
|---|---|
| any statement (a declaration, an expression, `if`, `return`, `break`, `throw`, `switch`) | one before it, on its first line |
| `while (c)`, `do ... while (c)` | one at each check of the condition, with its outcome |
| `for (init; c; update)` | one before the initializer runs, and one before each update; the init's or update's store and the condition go on it, so the step shows the locals before the line runs, as in C++ |
| `for (T x : xs)` | one per item, at the header, with the loop variable and its store |
| `while (true)`, `for (;;)` | one at the start of each pass (the constant must stay: javac's reachability depends on it) |
| `return e;`, a method's end | a return step, with `return_value` (`null` for `void`) |

A call that ends by an exception has no return step (spec §6): the `finally` the rewriter adds pops the frame. The step cap is 2,000, and the size budget 10 MB of the steps' JSON text (each step is measured as it is taken, and the one before it again once its outcomes are in): at either, the runtime writes the trace with `"truncated": true` and `"truncated_by"` (`"steps"` or `"size"`) and ends the JVM at once.

**Locals.** Java cannot list a frame's locals at run time, so each step's call passes the locals in scope by name (`record(7, __f, "nums", nums, "i", i)`). A caller is drawn from the values its own last step passed: its primitives cannot change while a callee runs, and its objects are read again at every step. A local declared without a value (`int x;`) cannot be read until it is assigned; javac says so, and `Build` drops it from those steps (§4).

## 3. Normalization: Java types to kinds

| Java | Kind | Notes |
|---|---|---|
| `int`, `long`, `short`, `byte` (and boxed) | bare JSON | The tagged `int` beyond ±(2⁵³ − 1) |
| `double`, `float` (and boxed) | bare JSON | The tagged `float` for NaN, the infinities, and whole values (`3.0`) |
| `boolean` | bare JSON | |
| `char` | `char` (a one-letter string) | The type tells it from a `String` |
| `String`, `StringBuilder` | string | A builder is the string it is building |
| arrays (`int[]`, `char[][]`, `ListNode[]`) | `array` | |
| `List` (`ArrayList`, `Arrays.asList`) | `array` | |
| `LinkedList` declared as a `List` or `LinkedList` | `list` | |
| `Queue` (a `LinkedList` or `ArrayDeque` declared as a `Queue`) | `queue` | Front to back |
| `Deque`, `ArrayDeque` | `deque` | Or `stack`, by its use (§5) |
| `Stack` | `stack` | Bottom to top |
| `PriorityQueue` | `priority-queue` | `order` from its comparator: none is `min`, `Collections.reverseOrder()` is `max`, any other is `custom` |
| `Map` (`HashMap`, `TreeMap`, `LinkedHashMap`) | `map` | |
| `Set` (`HashSet`, `TreeSet`) | `set` | |
| an instance of a class from the user's file or the node classes (`ListNode`, `TreeNode`, `Node`) | `object` in the heap, written as a `ref` | Its fields are its instance fields, read by reflection |

- **The declared type says more than the class.** A `LinkedList` is a `Queue`, a `Deque`, and a `List` at once, so its kind comes from how the local or member is declared; the rewriter passes that hint with the frame (`Trace.enter`). A value inside a container has no declaration: a `LinkedList` there is a `list`, an `ArrayDeque` a `deque`.
- **Anything else is not data.** A local holding an iterator, a lambda, a `Map.Entry`, or an instance of a library class is left out of the step, never written as text (CLAUDE.md invariant 5), and so is a container holding one.
- **Shared containers.** A container reached from two or more places in a step carries the same `id` at each (spec, Shared containers). Java's references decide: an array passed to a helper is the caller's array, so both frames' locals carry one `id`.
- **A container that contains itself** stops the run with an error that says so.

## 4. The rewriter

`Rewriter.java` collects insertions on the original source and writes them in; no insertion contains a line break, so every line keeps its number. Each method of `class Solution` gets a frame and a `finally`:

```java
public int[] twoSum(int[] nums, int target) {lvtrace.Frame __f = lvtrace.Trace.enter("twoSum", "", "i:nums", ""); try {
    lvtrace.Trace.record(4, __f, "nums", nums, "target", target); Map<Integer, Integer> numMap = new HashMap<>(); lvtrace.Trace.store(4, ...);
    lvtrace.Trace.head(6, __f, ...); for (int i = lvtrace.Trace.init(6, "int i = 0", "i", 0); lvtrace.Trace.at(6, __f, ...) && lvtrace.Trace.cond(6, "i < nums.length", (i < nums.length)); lvtrace.Trace.head(6, __f, ...), i++, lvtrace.Trace.pend(6, "i++", "i", i)) {
    ...
} finally { __f.exit(); }}
```

**Outcomes.** As in C++ and Python:

- **Conditions:** the test of an `if`, `while`, `do`, `for`, and a conditional expression, wrapped in `cond(line, code, (test))`.
- **Stores:** after an assignment, a compound assignment, `++`/`--`, a declaration with a value, a `for` loop's init and update, and an enhanced `for`'s variable. Only a *pure* target is read back (names, fields, cells with pure positions). `m.put(k, v)` on a map is a store to `m[k]`, written the way the C++ and Python traces write it, so a line that fills a map says what it stored.
- **Reads:** `a[i]`, `a[i][j]` (`ix0` keeps the outer positions, `ixN` records the read), `s.charAt(i)`, `list.get(i)`, and the key reads `m.get(k)`, `m.containsKey(k)`, `m.getOrDefault(k, d)`, `set.contains(k)`, when the container is a local or a field named directly. Each inserted call returns its argument, so the user's expression runs as written, once.

**`indexes`.** For each method, an integer local used as `c[i]`, `c[i ± k]`, `c.get(i)`, or `c.charAt(i)`, where `c` is a local or field declared as an array, a `List`, or a `String`. Unlike Python's, these are certain from the declarations, so the runtime only drops functions that never ran.

**What javac decides.** Every insertion is numbered. When the rewritten file does not compile, `Build` looks at where each error is: one inside an insertion (a local that is not definitely assigned yet, a return step after a body that cannot complete, a store into a `byte` that the generic call widened) drops that insertion, and the file is compiled again, at most 8 times. An error in the user's own text means their code does not compile: `Build` compiles their file as written and reports javac's messages for it, naming `Solution.java` and the line. Anything else is a bug in the rewriter (exit 20).

## 5. Members, and where use decides the kind

**Members.** A step's `members` hold the Solution's fields, as the spec describes (Members). Constants are left out as C++ leaves out `const`: a `static final` field, or a `final` primitive or string. A `final` collection (`private final Map<Integer, Integer> memo = new HashMap<>()`) can change, so it is written. Java creates fields with the object, so every step has `members` from the first one, as in C++.

**A `Deque` used as a stack.** Java's documentation recommends `Deque<Integer> stack = new ArrayDeque<>()` over the old `Stack` class, and LeetCode's Java Solutions follow it. By its type that local is a `deque`; drawn as one, its head (where `push` adds) is the left end, and the reader sees a sideways tube instead of the stack the code builds. So a `Deque`, `ArrayDeque`, or `LinkedList` local or field that the code uses **only** through `push`, `pop`, `peek`, `isEmpty`, `size`, and `clear` (and at least one of `push` and `pop`) is written as a `stack`, bottom to top. One call outside that list (`offerLast`, `pollFirst`) and it is a `deque`.

> **Key insight 1: this is the same exception as Python's heapq lists, and it is one on purpose.** C++ lets the declared type decide the kind (CLAUDE.md invariant 11), and its `std::stack` is a stack because it is one. Python and Java have no type that says "stack" or "heap" for what LeetCode writes, so their adapters let the code's use decide, from the code the rewriter reads, and only where every call agrees. The trace then shows what the reader thinks the value is, not how Java holds it. The spec records both exceptions (Where use decides the kind) as an open question to revisit.

## 6. The driver

`driver/java/` mirrors `driver/cpp/` and shares its rules for choosing the method, reading LeetCode's example text, decoding linked structures, and inferring hints.

- **Signature.** Read from the text with comments and literals blanked (`driver/cpp/source.py`, which reads Java's the same way). A method is public when it says `public` or says nothing; `private` and `protected` helpers stay out of the form. Types become neutral names (`types.py`): `int[]` is `array<int>`, `List<List<Integer>>` is `array<array<int>>`, `char` is `char`, `String` is `string`, `LinkedList<T>` is `list<T>`, `Deque<T>` is `deque<T>`.
- **Node classes.** `ListNode` and `TreeNode` are supplied in `Nodes.java`, as LeetCode defines them. Any other class comes from LeetCode's comment (`/* class Node { public int val; public List<Node> neighbors; ... } */`, with or without `*` margins), its fields read from its field declarations, and is compiled as written into `Nodes.java`. A class the user wrote out is used as it is.
- **`LvMain.java`.** The arguments are built as Java literals, as the C++ driver writes them into `main`: `new int[]{2, 7, 11, 15}`, `new ArrayList<List<Integer>>(Arrays.asList(...))`, `'a'`, `5L`, and node objects linked by statements. javac allows 64 KB of bytecode per method, so an array of more than 500 values is written as its example text and read by `lvtrace.Args` instead. `LvMain` calls the method, then `Trace.finish(answer)`; when the user's code throws, `Trace.failed(t)`.
- **`problem.json`.** The problem object, which the runtime copies into the trace as written.

The user's file is compiled as `Solution.java`. LeetCode's Java environment imports `java.util` and friends, so `Build` puts `import java.util.*; import java.util.function.*; import java.util.stream.*; import java.math.*;` in front of the user's first line, on the same line.

## 7. Running it

```
java -cp RUNTIME lvtrace.Build WORK        WORK holds Solution.java, LvMain.java, Nodes.java, problem.json
java -cp WORK/classes:RUNTIME LvMain       TRACE_OUT names the trace file
```

| Exit status | Meaning | The pipeline says |
|---|---|---|
| Build 10 | The user's code does not compile | `rewriter`: javac's messages, naming the user's file and line |
| Build 20 | The rewritten or generated code does not compile | `compile`: a bug in the rewriter or the driver |
| Program 0 | The trace was written (finished, or truncated at the cap) | The trace, validated |
| Program 1 | The user's code threw: the exception and the user's own frames (`at Solution.f(Solution.java:5)`) on stderr | `run`: "The code stopped with an error before it returned" |
| Program 3 | A bug in the tracer | `adapter` |

- **JDK 21.** The image is Eclipse Temurin 21. Each JVM runs with `-XX:+UseSerialGC -XX:TieredStopAtLevel=1 -XX:-UsePerfData -XX:MaxRAMPercentage=50`: one GC thread and the quick compiler only, so it starts fast and stays well under the sandbox's process limit (each JVM thread counts), and no performance file is written to `/tmp`. A run takes about 2 s under Docker, most of it the two JVM starts.
- **Deep recursion.** Each traced call takes at least one step, and every step holds every call, so a recursion that never ends reaches the size budget a few hundred calls deep, long before Java's stack runs out, and the reader gets those steps (`"truncated_by": "size"`). Recursion in code that is not traced (a helper class, a lambda) runs out of stack instead: the run stops with `StackOverflowError` and a note that the example may be too deep or the recursion may never reach its base case.
- **The image** (`sandbox/java.Dockerfile`, `leetcode-visualizer-sandbox-java`) holds the JDK and the compiled adapter in `/opt/trace/java/`, and nothing else. It is locked down as the C++ image is ([`sandboxing.md`](../sandboxing.md)).

## 8. Testing

```bash
make -C adapters/java
python3 -m unittest discover -s adapters/java/tests        # fixtures, kinds, outcomes, limits (needs a JDK)
python3 tools/compare_traces.py --all --core               # every fixture's twins, call by call
```

Each of the six golden fixtures has a Java twin: `fixtures/<name>_trace.java` and `fixtures/<name>.java.trace.json`. The tests check each trace three ways: exactly against its Java golden (`check_trace.py --equals`), structurally against the C++ golden (`--like`), and call by call (`compare_traces.py --core`): for each call, every local both traces have takes the same values in the same order, each call returns the same value, and `indexes` and `members` agree. Differences that come from how each language writes the algorithm (a C++ iterator, a declaration with no value, `TreeNode* curr = st.top(); st.pop();` on two lines against `st.pop()` on one) are listed but are not failures.

## 9. Known limitations

- **Lambdas, anonymous classes, local classes, and methods of classes other than Solution are not instrumented**, as C++ lambdas are not. Their calls take no steps.
- **Switch expressions** (`int r = switch (k) { case 1 -> 2; ... }`) are one step of the statement that holds them.
- **Reads of containers reached through expressions** (`getGraph()[u]`, `nodes.get(i).neighbors.get(j)`) are not recorded; `grid[i][j]`, `grid.get(i).get(j)`, and `this.memo.get(n)` are.
- **`Map.Entry`, iterators, and other library objects** are left out of a step (§3).
- **Design problems** are not supported, as for C++ and Python.

## 10. Design questions

> **Q1. Why rewrite the source rather than drive a debugger (JDI)?**
> A debugger gives steps without touching the code, but every local of every frame at every step is a request over the debug connection, in a second JVM; a 2,000-step trace of a tree would take many seconds, more under gVisor. It also cannot tell what a line evaluated, so the source would be rewritten for outcomes anyway. One rewrite gives both, with the C++ rewriter's rules, in one JVM. Decided with the author (Java adapter issue).

> **Q2. Why let javac decide which insertions are legal?**
> Whether a local can be read at a statement depends on Java's definite-assignment and reachability rules, which are long and subtle. Reimplementing them would be a second compiler that can disagree with the real one. Numbering every insertion and dropping the ones javac rejects keeps the rewriter simple and always agrees with javac; the cost is a second compile when it happens, inside the same warm JVM.

> **Q3. Why arguments as literals, and text only for large arrays?**
> Literals keep `LvMain` readable and need no parser, as in C++ (decided with the author). javac's 64 KB limit per method is the only reason for `Args`: a 10,000-value array as a literal does not compile.

> **Q4. Why one JVM for the rewriter and javac?**
> A JVM start is most of a Java run's time. The rewriter parses with javac's own classes anyway, so compiling in the same process costs nothing extra; the program still runs in a JVM of its own, as the user, with the tools' files out of reach.
