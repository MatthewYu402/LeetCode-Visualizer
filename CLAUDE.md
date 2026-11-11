# CLAUDE.md

Guidance for Claude Code (and any contributor) working in this repository.

## What this project is

LeetCode-Visualizer steps through a LeetCode `Solution` class and draws its data structures (array, hash map, stack, queue, linked list, tree, graph, ...) as they change. It must work with the `Solution` class exactly as LeetCode provides it, in any supported language.

There is no problem catalog. The system knows only the user's `Solution` source and the example input, so the adapter derives everything else: the `problem` object, neutral parameter types, and hints.

The whole design rests on one idea: the backend and the frontend communicate **only** through a language-neutral JSON **trace**. Read [`README.md`](README.md) first, then [`docs/trace-format.md`](docs/trace-format.md).

## Current status

**Implementation started.** The trace format (v0.4) is specified and validated. The C++ adapter serializes every value kind except `object` and `ref`, records steps, and writes the trace to a file, with tests. A hand-instrumented Two Sum reproduces the golden trace, and a looping program proves the step cap writes a truncated trace; `make e2e` checks both. A GitHub Actions workflow checks the fixtures, the adapter, and the frontend on every push and pull request to `main`. The frontend sandbox page replays the Two Sum fixture. What exists:

| File | Role |
|---|---|
| [`README.md`](README.md) | Overview, architecture diagrams, doc map |
| [`docs/trace-format.md`](docs/trace-format.md) | The contract (Draft v0.4). Source of truth |
| [`docs/native-tracing.md`](docs/native-tracing.md) | Runtime hooks and source instrumentation |
| [`docs/dap.md`](docs/dap.md) | Tracing through a debugger via the Debug Adapter Protocol |
| [`docs/driver-generation.md`](docs/driver-generation.md), [`docs/frontend.md`](docs/frontend.md), [`docs/sandboxing.md`](docs/sandboxing.md) | Design notes for later stages |
| [`docs/adapters/cpp.md`](docs/adapters/cpp.md), [`docs/adapters/python.md`](docs/adapters/python.md) | Per-language adapter notes |
| [`schema/trace.schema.json`](schema/trace.schema.json) | Machine-readable form of the contract |
| [`fixtures/two-sum.trace.json`](fixtures/two-sum.trace.json) | Golden trace for Two Sum |
| [`fixtures/two_sum_trace.cpp`](fixtures/two_sum_trace.cpp) | The Two Sum solution the golden trace records |
| [`fixtures/two_sum_hand_inst.cpp`](fixtures/two_sum_hand_inst.cpp) | The same solution with `record` calls placed by hand, plus a hand-written `main`. Running it writes a trace equal to the golden one |
| [`adapters/cpp/runtime/trace.hpp`](adapters/cpp/runtime/trace.hpp) | Header-only C++ runtime: `Serializer<T>` for every value kind, the recorder (`record`, `var`, step cap), and the document writer |
| [`adapters/cpp/tests/`](adapters/cpp/tests/) | Runtime tests, one `test_<name>.cpp` per area |
| [`adapters/cpp/tests/programs/loop_forever.cpp`](adapters/cpp/tests/programs/loop_forever.cpp) | A hand-instrumented Solution that never returns. `make e2e` runs it to prove the step cap writes a truncated trace and exits 0 |
| [`adapters/cpp/Makefile`](adapters/cpp/Makefile) | Builds and runs the adapter tests and the end-to-end check (`e2e`) |
| [`tools/check_trace.py`](tools/check_trace.py) | Checks trace files: rejects bare `NaN`/`Infinity`, validates against the schema, and optionally compares with a fixture (`--equals`) or checks a capped run (`--expect-truncated`) |
| [`.github/workflows/ci.yml`](.github/workflows/ci.yml) | CI: fixtures against the schema, C++ tests with libstdc++ (GCC 14, Clang 18) and libc++ (Apple Clang), the end-to-end check, and the frontend's tests and build |
| [`frontend/`](frontend/) | Sandbox page (React + TypeScript + Vite) that replays the Two Sum fixture. Rules in [`frontend/CLAUDE.md`](frontend/CLAUDE.md) |
| [`LICENSE`](LICENSE) | MIT |

Still planned: pointers (`object` and `ref`), driver generation, the LibTooling rewriter, the frontend beyond the sandbox page (home page, real runs, `object`/`ref` renderers), `backend/`, the Python adapter, and `CONTRIBUTING.md`. Do not describe planned things as existing, and do not link to files that are not there without marking them *Planned*.

Reusable procedures for this repo are in [`Skills.md`](Skills.md).

## Architecture invariants

These are the decisions the project is built on. Do not weaken them without asking.

1. **The trace is the only interface** between adapters and the frontend. Never let the frontend learn about a language.
2. **The frontend must not branch on `language`.** That field is informational only.
3. **Snapshots, not events.** Every step is the full state, drawable on its own. Diffs between steps are computed in the frontend, only to animate.
4. **Normalize representation, never hide behavior.** The same concept always has the same `kind`. Real differences (hash map ordering, integer overflow, step counts, priority-queue layout) are allowed to differ between languages.
5. **No implementation details in a trace.** No memory addresses, bucket counts, capacities, or raw debugger text. An unrecognized type is an error, never a pass-through.
6. **Stable ids, never addresses.** Distinct objects get distinct ids, aliases share one, and the heap entry is created before recursing into fields so cycles terminate.
7. **`line` refers to the user's original source**, not a generated driver, and means "about to execute" (pre-execution snapshot).
8. **`map` and `set` ordering is unspecified.** Nothing may depend on insertion order.
9. **Tracer output is untrusted.** User code runs beside the tracer. Run it in a sandbox and validate the trace against the schema **outside** the sandbox before the frontend sees it.
10. **Snapshot at observation time.** Never keep a live reference to program state and serialize it later.
11. **The type decides the kind, the problem decides the hint.** Hints are inferred by the adapter, never asked of the user.

## Changing the trace format

The spec, schema, fixtures, and docs describe one contract and must stay in sync.

- A change to `docs/trace-format.md` means a matching change to `schema/trace.schema.json`, to every affected fixture, and to any doc that quotes the affected part (the README's "trace format in brief" and renderer table, `docs/native-tracing.md` and `docs/dap.md` examples).
- Versioning is `MAJOR.MINOR` (spec section 9). Adding optional fields or new kinds is a **minor** bump. Anything that breaks existing traces is **major**, except while the major version is 0, when a minor bump may break.
- The `version` string in fixtures must match the spec.
- Known gaps are listed in `docs/native-tracing.md` section 8 and the README's open questions: **call stack**, **container aliasing**, **member variables**, **a `ref` result has no heap**. Do not silently implement one of them. Propose the change, then follow the procedure in `Skills.md`.

## Commands

Run the C++ adapter's tests (clang++ by default):

```bash
make -C adapters/cpp                     # build and run every test
make -C adapters/cpp test T=serialize    # one test file
make -C adapters/cpp both                # with clang++ and with g++
make -C adapters/cpp header              # trace.hpp compiles on its own
make -C adapters/cpp e2e                 # end-to-end: Two Sum equals the fixture, the step cap writes a truncated trace
make -C adapters/cpp test EXTRA="-fsanitize=address,undefined"
```

Run the hand-instrumented Two Sum and write its trace outside the repo:

```bash
clang++ -std=c++20 -I adapters/cpp/runtime fixtures/two_sum_hand_inst.cpp -o /tmp/two_sum
TRACE_OUT=/tmp/two-sum.json /tmp/two_sum     # then check it with tools/check_trace.py --equals (below)
```

Run the frontend (from `frontend/`; rules in [`frontend/CLAUDE.md`](frontend/CLAUDE.md)):

```bash
npm install
npm run dev                              # sandbox page on http://localhost:5173
npm test                                 # vitest
npm run build                            # typecheck + production build
```

Check traces with `tools/check_trace.py`. Needs `pip install jsonschema`. It loads each file with `parse_constant` set to raise, so the bare tokens `NaN` and `Infinity` (which Python's `json` accepts by default) are rejected, then validates it against the schema. It prints one `OK` or `FAIL` line per file and exits nonzero if any failed:

```bash
python3 -I tools/check_trace.py fixtures/*.trace.json                          # schema only, several files
python3 -I tools/check_trace.py --equals fixtures/two-sum.trace.json /tmp/two-sum.json
python3 -I tools/check_trace.py --expect-truncated adapters/cpp/build/traces/clang++/loop-forever.trace.json
```

`--equals` compares after parsing. Types must match (`1` is not `1.0` or `true`), and the items of `set`/`multiset` and entries of `map`/`multimap` are compared in any order, because that order is unspecified. `--expect-truncated` requires `"truncated": true`, no `result`, and exactly 2,000 steps numbered 0 to 1999.

## Conventions

- **Neutral type names** in problem metadata mirror the kinds: `array<int>`, `list<int>`, `map<int,int>`, `stack<int>`, `TreeNode`. Never language types such as `vector<int>&` (the schema rejects `std::`, `vector<`, `unordered_`, `&`, `*`).
- **Value kinds** are exactly: bare primitives, plus the tagged kinds `int`, `float`, `array`, `list`, `stack`, `queue`, `deque`, `priority-queue`, `tuple`, `set`, `map`, `object`, `ref`. `array` is indexed (`vector`); `list` is node-based (`std::list`). Maps use `entries` as raw `[key, value]` pairs because JSON object keys must be strings.
- **Tagged numbers.** Integers outside ±(2^53 − 1) use the `int` kind, and NaN/±Infinity use the `float` kind. Everything else is a bare JSON number.
- **Hints** (`grid`, `adjacency-matrix`, `adjacency-list`, `edge-list`, `intervals`, `tree`, `linked-list`, `graph`, `priority-queue`, `stack`, `queue`) are only for what the type cannot say.
- **Step cap** is 2,000. Adapters set `"truncated": true` when they stop at the cap, and write the trace at that moment so it survives a program that never ends.
- **`result` and `truncated` are written only when they say something.** `result` is present only when the method returned. Absent means the run did not finish, never that the answer was wrong. `truncated` is present only as `true`. Never write `"result": null` as a placeholder, and never write `"truncated": false`.
- **Trace output goes to a file**, never stdout, because the user's own prints share stdout. The path comes from the `TRACE_OUT` environment variable and defaults to `trace.json`.
- **Schema strictness is intentional** (`additionalProperties: false`). It is how leaked language details get caught. Do not loosen it to make an adapter pass.
- The schema checks structure only. It does not check that every `ref` resolves to a heap entry, that ids are unique, or that line numbers are in range. Those need a separate checker (not written yet).
- **C++ style** is set by `.clang-format`: attached braces, 2-space indent, indented namespace bodies, no automatic line wrapping.

## Documentation style

Design docs in this repo share one house style. Match it when adding or editing them:

- A `> **Status:** Draft vX.Y` line and a `**Related:**` line under the title.
- Numbered sections, tables for comparisons, and short code or JSON examples that are consistent with the spec.
- Callouts in the form `> **Key insight N: ...**` for the idea a reader must not miss.
- A closing **Design questions** section with the reasoning written out.
- Plain, direct prose. Say what is a decision and what is only a proposal.

Architecture diagrams are ASCII with box-drawing characters. Keep every box the same width on all of its lines, and re-check alignment after editing one.

## Working agreements

- **Never edit the "Goals" section at the top of `README.md`.** It is the author's personal note. Fix nothing in it, including typos, without asking.
- **Claude writes the frontend code; the author writes the adapter runtime and rewriter.**
- **The author writes the runtime and rewriter code** (it is a learning project). Explain, review, and point out bugs instead of handing over implementations. Test scaffolding, fixtures, schema and doc text, and build files are fine when asked.
- Do not invent details about how LeetCode behaves. If unsure, say so.
- Before claiming an example is valid, run it through the schema.
- Do not add dependencies, frameworks, or directories that the docs have not proposed without checking first.
- When a doc and the code disagree, the spec in `docs/trace-format.md` wins until it is deliberately changed.
- Keep `README.md`'s status table, doc map, and repository layout accurate whenever files are added or removed.