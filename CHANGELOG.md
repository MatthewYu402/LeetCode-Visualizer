# Changelog

Every change a user or an adapter author would notice is recorded here, newest first. Versions follow [Semantic Versioning](https://semver.org): this file tracks the **app's** version (the one on the home page, from `frontend/package.json`). The **trace format** has its own version (`v0.14`), with its own history in [`docs/trace-format.md` §9](docs/trace-format.md#9-versioning); a release says which trace format it reads and writes.

Each entry says what changed, and for a design change, why. New entries go under **Unreleased** until a version is cut.

---

## [Unreleased]

### Added

- **The tab shows Visi's eye.** The browser tab's icon is the eye from the logo, black on a light tab bar and white on a dark one, instead of the browser's default. PNG copies cover browsers without SVG icons, and a home-screen icon (the white eye on a dark square) covers phones.

- **The page can be served apart from the API.** A build of the frontend can name the API's address (`VITE_API_BASE`), so the page and the API can live on different hosts; development is unchanged. When it cannot reach that address, the page now says the server cannot be reached instead of asking whether you started the backend. The build uses relative paths, so it works at a domain's root or under a path.
- **CI publishes what it tested.** After a push to `main` passes, CI pushes the three sandbox images to the GitHub container registry and deploys the frontend to GitHub Pages.

### Changed

- **The project is now Visi.** The page's tab title, top bar, and home page say Visi, the README opens with the Visi logo, the eye over the word Visi set in Jost, an open-source typeface modelled on Futura (a light and a dark version at the repository's root, picked by the reader's theme), and the docs and code use the name throughout. The sandbox images are now `visi-sandbox-cpp`, `visi-sandbox-python`, and `visi-sandbox-java`: build them again under the new names.
- **Docs: one status for the beta, Mermaid diagrams, and a shorter README.** Every doc that describes what is built is marked `Beta (Visi 1.0.0-beta.1)` instead of its own draft number (the trace format keeps its own version, v0.15); `dap.md` is a reference and `hint-inference.md` a proposal. The README is now the front door: what Visi does, its status, a short "how it works", getting started, the documentation map, and, near the end, the known limitations. The architecture, the trace format in brief, tracing strategies, design decisions, open questions, tech stack, and repository layout moved to a new [`docs/architecture.md`](docs/architecture.md), The roadmap is gone: plans are GitHub issues. Every diagram of how the parts connect, in every doc, is now Mermaid, which GitHub draws in its light and dark themes; file trees and drawings of the page stay as text.

- **Trace format v0.15: a size budget beside the step limit.** Adapters stop recording once the steps reach 10 MB of JSON text, and write the trace so far, as they do at 2,000 steps. Every step repeats every value and every call in progress, so a large input (Two Sum on 3,000 numbers, within LeetCode's constraints) or recursion hundreds of calls deep made a trace over the 16 MB the pipeline reads back, and the reader got an error blaming recursion (or, in Python, a run killed for memory). Now they get the first few hundred steps. A new field, `truncated_by` (`"steps"` or `"size"`), says which limit stopped recording, so the page can say "stopped at the size limit, try a smaller input" instead of suggesting an infinite loop. The frontend still reads v0.14 traces.
- **Trace validation is fast on large traces.** `tools/check_trace.py` checks each distinct value against the schema once (equal values in different steps become one object first), and resolves the schema's references ahead of time. A 10 MB trace took minutes to validate, longer than any run; it now takes about 3 seconds. What is checked is unchanged.

- **New Graph and DP examples.** The Examples menu and the home page now show Course Schedule for Graph (the prerequisites drawn as a graph, a queue of courses ready to take) and Unique Paths for DP (a 2D table filled cell by cell, with the cells each one adds outlined), each in C++, Python, and Java. They replace Number of Islands and Climbing Stairs, whose traces were right but showed a grid and a recursion tree, not the graph and the table their topics promise; the examples are there to show what the canvas can draw. Both stay in the manual test suite.

- **Arrows are drawn as one stroke, and draw themselves in.** Every arrow (linked lists, trees, graphs, graphs from rows, and the recursion card's return arrow) now has a filled head with rounded corners that sits on the end of its line, pointing the way the line arrives, instead of an open chevron that looked cut off from it. A new arrow's line draws from its tail and its head appears as the line reaches it, as the trace line does while a run goes; the head used to appear before the line got there. The return arrow's head stands upright on the caller, the line rising straight into it before it curves away to the call.

### Fixed

- **The Java adapter paired the inner index of a 2D access with the array.** In `dp[r][c]`, `c` indexes `dp[r]`, not `dp`, so the spec leaves it out of `indexes`; the Java rewriter recorded it, unlike C++ and Python. Found by comparing the three languages' Unique Paths traces.

- **The API refuses a request body over 1 MB before reading it** (413, stage `request`). The limits on the Solution and the inputs were checked only after the whole body had been read and parsed, so one 200 MB request took the service from 47 MB to 595 MB of memory, and a few at once could take it down. 1 MB is above the largest valid request (about 576 KB).

---

## [1.0.0-beta.1] - 2026-11-19

The first public beta. Paste a LeetCode `Solution` in C++, Python, or Java, run it on an example in a sandbox, and step through every line with its data structures drawn as they change. Reads and writes trace format **v0.14**.

### In this release

- **Three languages**, each with its own adapter and sandbox image: C++ (C++20, Clang 18), Python 3.12, and Java 21.
- **The sandbox page**: a code editor, one input field per parameter (filled by pasting LeetCode's example text), Run code, and a playback bar to step, jump, or play at three speeds.
- **The canvas** draws every structure in the trace format: arrays and 2D grids, strings, hash maps, sets, stacks, queues, deques, priority queues, tuples, linked lists, binary trees, and graphs, plus a recursion card or a call-stack card for the calls. Changes are coloured and animated; the cells a line read are outlined; pointer markers sit under the cells the code indexes.
- **"View as"** for 2D arrays: a grid, a graph (from an adjacency list, edge list, or matrix), or intervals.
- **Shared containers** (Python and Java): one note under a card names every place that is the same container.
- **The state panel**: the running statement, what it produced (conditions, stored values, return values), and the locals, with an Output tab for what the program printed.
- **The home page**, with a live replay of a real trace, and an **Examples menu** of eight problems in each language.
- **Dark and light themes.**
- **A locked-down sandbox** for every run (gVisor, no network, capped memory, CPU, processes, disk, and time, never root) and an **API service** with size caps, run slots, a capped waiting line, and one run per visitor.

### Changed in this release

- **The version is 1.0.0-beta.1** (it was 0.1.0 during development).
- **A nested shared container is not noted again.** When an outer container is already noted as shared (Java's `grid`, passed to `sink`), its rows are not given notes of their own, unless a row is also held on its own (`int[] row = grid[0]`). The extra notes only repeated the outer one.
- **Documentation** describes what a user can do today: the README's Status section, known limitations, [`CONTRIBUTING.md`](CONTRIBUTING.md), and this file.

### Known limitations

Listed in the README's [Status section](README.md#known-limitations): design problems (LRU Cache, Min Stack) are not supported; a run stops at 2,000 steps; lambdas take no steps; the C++ adapter does not mark shared containers; a dangling C++ pointer is followed as if it were valid; and two kinds come from the code's use rather than its type (Python heapq lists, a Java `Deque` used as a stack), an open question in the spec.

---

## How the project got here

The history before the first release, by theme rather than by commit. It is here so the reasons behind the design are not lost; from 1.0.0-beta.1 on, each change has its own entry above.

### 1. The contract came first

The project began as a specification, not code. The problem it solves is an L × R one: every language (C++, Python, Java, ...) would need its own drawing code for every kind of structure. Putting a **language-neutral JSON trace** in the middle turns that into L + R: each language writes the trace, and one frontend reads it, without ever knowing which language ran.

The decisions that came with it, and still hold:

- **Snapshots, not an event log.** Each step holds the whole state, so any step can be drawn on its own, and rewinding or jumping costs nothing. It costs size, which a step cap of 2,000 keeps small.
- **Abstract, not primitive.** `unordered_map`, `dict`, and `HashMap` all become one `map`; the trace raises values to concepts rather than lowering them toward the machine.
- **Normalize representation, never hide behavior.** The same concept always has the same kind, but real differences (hash-map order, integer overflow, step counts) stay visible.
- **Deliberately lossy.** No addresses, bucket counts, capacities, or debugger text. A small format is a stable one.
- **Tracer output is untrusted.** The user's code runs in the same process as the tracer and could forge a trace, so every trace is validated against a strict JSON Schema outside the sandbox.
- **No problem catalog.** Everything is derived from the pasted Solution and the example, so any LeetCode problem works without being registered.

### 2. How the trace format grew (v0.1 to v0.14)

Each version answered a question the previous one could not. The full history is in [`docs/trace-format.md` §9](docs/trace-format.md#9-versioning).

| Version | What it added | Why |
|---|---|---|
| v0.1 | Steps of `line` and `locals`, values as kinds, a heap of objects and `ref`s | The first draft, modelled on Python Tutor's heap-of-objects view |
| v0.2 | `array` (indexed) split from `list` (node-based); `stack`, `queue`, `deque`, `priority-queue`, `tuple`; tagged `int` and `float` | A `vector` and a `std::list` are different structures; and JavaScript silently rounds integers past 2^53, so those must travel as text. Breaking |
| v0.3 | `multiset`, `multimap`; `null` for an empty optional | Common in C++ solutions (counting duplicates, ordered multimaps) |
| v0.4 | `result` is optional; `truncated` only when true; the trace is written at the cap | A run that never ends must still leave a trace, and a missing result must mean "did not finish", never a wrong answer |
| v0.5 | `result_heap`; `problem.returns`; `void` results | A method that returns a `ListNode*` had no heap to point into |
| v0.6 | **The call stack**: `frames`, frame ids, return steps | Recursion is half of LeetCode, and one `locals` per step could not show it. Breaking |
| v0.7 | The `iterator` kind, as a position in a named local container | Iterators were left out, so `it = m.find(x)` was invisible |
| v0.8 | **Outcomes**: the conditions and stores a line evaluated | Seeing `i < n → false` is how a reader understands why a loop ended; it cannot be recovered from values alone |
| v0.9 | `indexes`: which integer locals index which containers | Pointer markers came from a list of conventional names (`i`, `left`, `mid`) and appeared under every array. Knowing that `i` indexes `nums` requires reading the source, which only the adapter can do |
| v0.10 | `read` outcomes: the cells and entries a line read | Nothing recorded a read, so a lookup like `dp[i - 1]` left no mark on the canvas |
| v0.11 | Reads of a string's characters | Two-pointer string problems are common |
| v0.12 | `members`: the Solution's member variables, once per step | Memo tables and visited sets kept on `this` had nowhere to go; also, `indexes` pairs only `i` and `i ± constant` (`dp[i - coin]` no longer marks `coin`) |
| v0.13 | Whole floats are tagged (`"3.0"`) | A bare `3` made a double look like an int |
| v0.14 | A shared container carries one `id` at every place | `dp = [[0] * 3] * 3` in Python is one row three times; without an id it looked like three copies, hiding a classic bug |

### 3. The C++ adapter

C++ was first because it is the hardest: no runtime hook runs code before each line, and the standard library's containers are opaque to a debugger.

- **Source instrumentation, not a debugger.** A debugger (through DAP) sees raw `std::vector` internals; rewriting the code to call a recording function gives full control over how each type becomes a kind. The trade is a rewriter per language that uses this strategy.
- **A header-only runtime** (`trace.hpp`): a `Serializer<T>` per type, the recorder with its step cap, and the writer. An unrecognized type is a compile error when written directly and is left out of a step otherwise, never written as raw text.
- **Hand-instrumented fixtures first.** Six golden traces were produced from Solutions with the recording calls placed by hand, so the format and the runtime could be tested before any rewriter existed.
- **The driver** (in Python, standard library only) rebuilds LeetCode's harness: it reads the Solution's signature and LeetCode's commented node definitions, parses the example into neutral JSON, and generates a prelude and `main`. The example is parsed once, neutrally, so every language shares that parser.
- **The rewriter** (Clang LibTooling) inserts the runtime's calls into a plain Solution **without adding lines**, so the trace's line numbers are the user's. Every golden fixture is reproduced from its plain source. It grew with the format: frames and return steps, iterators paired with their containers, outcomes (with a step for each check of a loop's header, so a loop's final condition has somewhere to go), `indexes`, reads, members, and structured bindings.
- **Live callers.** Each frame keeps references to its live variables, so a caller's locals are re-read at every step, not frozen at the call.

### 4. Running a stranger's code

- **The CLI** (`python3 -m pipeline`) chains the driver, the rewriter, the compiler, the program, and validation in one command, with exit codes per stage.
- **The sandbox**: one locked-down container per run, never reused, with no network, a read-only image, capped memory, CPU, processes, open files, disk, output, and time, and the code running as a user of its own. **gVisor** sits underneath, so a kernel bug is not an escape. The rewriter and compiler run inside too, because a parser reading hostile source is as exposed as the program.
- **Validation outside.** The trace comes out as bytes and is checked against the schema, and by `tools/check_trace.py` for what a schema cannot say (every `ref` resolves, frames and iterators follow their rules), before anything reads it as a trace.
- **Speed.** A precompiled header, one `docker exec` per stage, files moved through `docker exec` rather than mounts (which also works with Colima on macOS), and a pool of containers started ahead of time brought a run to about 2 seconds under Docker.
- **The API service** (FastAPI): `/api/signature` reads a Solution's methods and parameters for the input form, and `/api/run` runs the pipeline. A load test of 60 runs at once froze every visitor's form, because waiting runs held all the server's threads; **waiting runs now wait in the event loop**, so the form answers in under 10 ms under the same load. Size caps, a capped line that answers "busy" at once rather than after 30 seconds, one run per visitor, and a visitor's address trusted only from a known proxy.

### 5. The frontend

- **Built against fixtures first**, with no backend: the point of the contract.
- **A redesign agreed as mockups** before it was built: a top bar, the code panel above the inputs, the canvas above the state panel, a playback bar at the bottom. Every structure is a card with its name, kind, size, and an operation chip ("push 3", "erase key 3") worked out from the diff, in data-structure words rather than any language's method names.
- **Linked structures from the heap**: lists, trees, and graphs are laid out once per trace, so nodes keep their places as the run goes, and pointer locals are tags on their nodes.
- **Two calls cards**, chosen by what the calls return: a recursion tree (or stack) when calls return values, because recursion that returns values is understood by its branching; a call-stack card when they return nothing (DFS, backtracking).
- **Rules that keep it honest**: renderers are pure functions of one step; nothing reads the trace's language; colours come only from theme tokens, with a dark and a light set; reads and pointer markers come only from what the trace records, never inferred from code or values; nothing appears without motion, and motion respects the system's reduced-motion setting.
- **"View as"** for 2D arrays, because whether `[[0,1],[1,2]]` is a grid, a graph, or intervals depends on the problem, which only a hint (from the parameter's name and the example's shape) or the reader can say.
- **The home page** and a hash route, with no router dependency, and the sandbox loaded lazily so the home page does not download the editor.

### 6. Python: proving the format is language-neutral

Python was the test of the central claim: a second language with a completely different runtime, and no change to the frontend or the format.

- **`sys.settrace` gives the steps**, as the runtime-hook strategy promised.
- **A syntax-tree rewrite gives the outcomes.** settrace says where the program is, not what a line decided: `if stack.pop() > x:` cannot be re-read after it ran. The rewrite follows the C++ rewriter's rules (no extra lines, the user's code evaluated once), and is limited to outcomes, so a construct it does not understand loses an outcome, never a step.
- **A list used through `heapq` is a priority queue.** Its order is the heap's, not a sequence a reader cares about, so the kind says what the value is. This is one of two places where the code's use, not the type, decides the kind: an open question, recorded in the spec.
- **A separate image per language**, so a Python run does not carry Clang, and a fix to one language rebuilds one image.
- **`check_trace.py --like`** compares a Python trace with the C++ golden one by structure, because step counts and hash-map order legitimately differ.

### 7. Java, and three languages compared

- **Source instrumentation on the JDK's own parser**, not a debugger: through JDI every local of every frame at every step would be a request to a second JVM, and a debugger cannot tell what a line evaluated anyway. One rewrite gives both.
- **javac decides which insertions are legal.** Whether a local can be read at a statement depends on Java's definite-assignment rules; rather than reimplement them, every insertion is numbered, and the ones javac rejects are dropped and the code recompiled, in the same warm JVM.
- **A `Deque` used only as a stack is a stack**, the second case where use decides the kind.
- **`tools/compare_traces.py`** compares two languages' traces of one Solution call by call: each local's history, reads, stores, conditions, returns, `indexes`, and members. All three languages agree on everything two adapters must agree on; the remaining differences are the languages' own (Python's `range` loop has no condition to show, C++ declares containers without a value).
- **The Examples menu**: eight problems, each in all three languages, so a reader can see the same algorithm traced in each.
