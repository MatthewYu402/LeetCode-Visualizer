# Contributing

> **Status:** Beta (Visi 1.0.0-beta.1)
> **Related:** [`README.md`](README.md) (what the project is), [`CHANGELOG.md`](CHANGELOG.md), [`docs/trace-format.md`](docs/trace-format.md) (the contract), [`Skills.md`](Skills.md) (step-by-step procedures)

Thank you for helping. Visi is in public beta, so the most useful contributions right now are **bug reports from real solutions**: a Solution that fails to run, a trace that draws something wrong, or a structure that is hard to follow. Code is welcome too; this page says how to set up, what to check before sending a change, and how the project's rules shape a change.

---

## 1. Reporting a bug

Open an issue on GitHub. A good report has:

- **The language, the Solution, and the example**, exactly as pasted. The trace depends on all three, and with them anyone can run the same trace again.
- **What you saw and what you expected**: "after line 12 the map shows key 3 twice", or "Run code says the build failed at line 1".
- **The step**, when it is about one moment of the replay ("Step 14 of 52"), and a screenshot if it is about drawing.
- **The browser and the theme**, if it is about the page.

Before reporting, check the README's [known limitations](README.md#known-limitations). A design problem (LRU Cache), a run that stops at 2,000 steps or 10 MB, or a lambda that takes no steps are known, not bugs. A trace that differs between languages only in step count or hash-map order is expected too ([trace-format.md §8, What is a bug and what is not](docs/trace-format.md#what-is-a-bug-and-what-is-not)).

For a large change (a new language, a change to the trace format, a new kind of drawing), open an issue to agree on the design **before** writing the code. Those changes touch the contract that every part of the project depends on.

## 2. Setting up

Each part can be worked on alone. You only need the tools of the part you change.

| Part | Needs | Set up and test |
|---|---|---|
| Frontend (`frontend/`) | Node.js 20.19+ and npm | `cd frontend && npm install && npm test && npm run build` |
| C++ adapter (`adapters/cpp/`) | clang++ or g++ with C++20 `<format>`, make | `make -C adapters/cpp both e2e` |
| C++ rewriter (`adapters/cpp/rewriter/`) | LLVM with Clang's development files (`brew install llvm`; Ubuntu: `libclang-18-dev libclang-cpp18-dev llvm-18-dev`) | `make -C adapters/cpp/rewriter && make -C adapters/cpp/rewriter test` |
| Python adapter (`adapters/python/`) | Python 3.12, `pip install sortedcontainers==2.4.0` | `python3 -m unittest discover -s adapters/python/tests` |
| Java adapter (`adapters/java/`) | JDK 21 | `make -C adapters/java && python3 -m unittest discover -s adapters/java/tests` |
| Driver (`driver/`) | Python 3.10+, a C++ compiler | `python3 -m unittest discover -s driver/tests -t .` |
| CLI (`pipeline/`) | The adapters above | `python3 -m unittest discover -s pipeline/tests -t .` |
| Sandbox (`sandbox/`) | Docker; gVisor (`runsc`) for the isolation tests, through Colima on macOS ([`sandbox/colima-gvisor.yaml`](sandbox/colima-gvisor.yaml)) | `docker build -f sandbox/<language>.Dockerfile -t visi-sandbox-<language> .` for `cpp`, `python`, and `java`, then `TRACE_SANDBOX=gvisor python3 -m unittest pipeline.tests.test_sandbox -v` |
| API service (`backend/`) | Python 3.10+ in a virtual environment, the sandbox images | `python3 -m pip install jsonschema -r backend/requirements.txt && python3 -m unittest discover -s backend/tests -t .` |
| Trace checks (`tools/`) | `pip install jsonschema` | `python3 -I tools/check_trace.py fixtures/*.trace.json` and `python3 tools/compare_traces.py --all --core` |

To use the page with real runs, start the API service from the repository root (`python3 -m backend`, on 127.0.0.1:8000) and the frontend's dev server (`cd frontend && npm run dev`, on http://localhost:5173, which proxies `/api` to it). The service runs code under gVisor by default; `TRACE_SANDBOX=docker` uses Docker's own runtime. The full list of commands is in the README's [Getting started](README.md#getting-started) and in [`CLAUDE.md`](CLAUDE.md#commands).

## 3. Sending a change

1. **Branch from `main`** and keep a change to one subject. A fix and the refactor it suggests are two changes.
2. **Run the checks of every part you touched** (the table above). CI runs all of them on every pull request to `main`, on Linux and macOS, and a pull request is merged only when CI is green.
3. **Add a test with the change.** A bug fix gets a test that fails without it. Frontend components are tested with `react-dom/server` in vitest; adapters are tested against golden fixtures and small programs.
4. **Update the docs in the same change.** When the code and a doc disagree, the doc is wrong until someone fixes it, and that someone should be the change that made them disagree. The doc to update is usually the one named at the top of the file you changed.
5. **Add a line to [`CHANGELOG.md`](CHANGELOG.md)** under `Unreleased` for anything a user or an adapter author would notice: what changed, and for a design change, why.
6. **Open a pull request** that says what the change does and why, and links its issue.

### Commit messages

One line, in the imperative, prefixed with the area it changes:

| Prefix | For |
|---|---|
| `feat(frontend):`, `feat(cpp):`, `feat(python):`, `feat(java):`, `feat(sandbox):`, `feat(backend):`, `feat(tools):` | A new capability in that area |
| `feat(spec):` | A change to the trace format (with its version, such as `v0.15`) |
| `fix(<area>):` | A bug fix |
| `test(<area>):` | Tests only |
| `docs:` | Documentation only |
| `chore:` | Anything else: dependencies, CI, housekeeping |

For example: `fix(frontend): note only the outermost of nested shared containers`.

### Dependencies

Ask in an issue before adding one. Every dependency approved so far, and why, is listed in [`CLAUDE.md`, Working agreements](CLAUDE.md#working-agreements). The driver and the trace checker stay on Python's standard library (plus `jsonschema`), and the sandbox images stay small.

## 4. The rules every change keeps

The architecture rests on a few decisions. A change that weakens one needs agreement first. The full list is in [`CLAUDE.md`, Architecture invariants](CLAUDE.md#architecture-invariants); the ones that come up most:

- **The trace is the only interface.** The frontend reads traces and nothing else, and never learns which language ran: nothing in it reads `trace.language`.
- **Snapshots, not events.** Every step holds the whole state and draws on its own; the frontend works out what changed only to animate it.
- **Normalize representation, never hide behavior.** The same concept has the same `kind` in every language (`unordered_map`, `dict`, and `HashMap` are all a `map`), but a real difference, such as hash-map order or integer overflow, stays visible.
- **No implementation details in a trace**: no addresses, capacities, or raw debugger text. An unrecognized type is left out of a step, never written as text.
- **Tracer output is untrusted.** User code runs next to the tracer, in the sandbox, and every trace is validated against the schema outside it.
- **The schema is strict on purpose** (`additionalProperties: false`). Do not loosen it to make an adapter pass; it is how leaked language details get caught.

The frontend has its own rules on top (pure renderers, theme tokens instead of colours, motion for everything that appears): [`frontend/CLAUDE.md`](frontend/CLAUDE.md#rules).

## 5. Changing the trace format

The spec ([`docs/trace-format.md`](docs/trace-format.md)), the schema ([`schema/trace.schema.json`](schema/trace.schema.json)), the golden fixtures, and the docs that quote them are one contract and change together.

1. **Open an issue first**, saying what cannot be expressed today and for which languages or problems.
2. Check the change against the spec's principles: language-neutral, self-contained, declarative, deliberately lossy. A change that leaks one language's detail is the wrong change.
3. Bump the version: an optional field or a new kind is a minor bump (`0.15` to `0.16`). While the major version is 0, a minor bump may also break old traces.
4. Change the spec (including its history in §9), the schema, every affected fixture, every adapter that writes the format, and the frontend's loader, which accepts only the versions it was built for.
5. Validate every fixture, and add one deliberately bad trace that the new rule must reject.

The full procedure, step by step, is [`Skills.md` §3](Skills.md#3-change-the-trace-format).

## 6. Adding a language

A new language needs an adapter and a sandbox image, and nothing else: the trace format and the frontend do not change. If they seem to need to, stop and propose a format change first (§5).

What an adapter is made of:

| Piece | What it does | Examples in this repo |
|---|---|---|
| **Driver** | Reads the Solution's signature and LeetCode's example text, and rebuilds LeetCode's harness: helper types (`ListNode`, `TreeNode`, `Node`), the arguments, the call. Writes the problem's neutral types and hints | `driver/cpp/`, `driver/python/`, `driver/java/`; the shared example parser is `driver/example.py` |
| **Tracer** | Observes the run before each line of the user's code: runtime hooks, source instrumentation, or a debugger through DAP | `sys.settrace` in `adapters/python/tracer.py`; rewriters in `adapters/cpp/rewriter/` and `adapters/java/src/lvtrace/Rewriter.java` |
| **Normalizer** | Turns each native value into a trace kind, with stable ids for objects | `Serializer<T>` in `trace.hpp`, `adapters/python/tracer.py`, `Snapshot.java` |
| **Outcomes** | What each line evaluated: conditions, stores, reads, and which locals index which containers (`indexes`) | the rewriters, and `adapters/python/instrument.py` |
| **Sandbox image** | The toolchain and the adapter, run with no network and every limit in [`docs/sandboxing.md`](docs/sandboxing.md) | `sandbox/<language>.Dockerfile` |

How to know it is done:

1. **Twins of the six golden fixtures.** Write each fixture's Solution in the new language (`fixtures/<name>_trace.<ext>`), record its trace (`fixtures/<name>.<language>.trace.json`), and check that it is valid, that it is like the C++ one (`check_trace.py --like`), and that it matches it call by call (`compare_traces.py --core`).
2. **The hard cases behave**: an infinite loop leaves a trace truncated at the step limit, a large input or endless recursion one truncated at the size budget, a cyclic structure terminates, and a type with no kind is left out.
3. **The pipeline and the service know it**: `pipeline/` dispatches on the language, `backend/app.py` accepts it, and the sandbox's isolation tests cover its image.
4. **It is documented** in `docs/adapters/<language>.md` (the strategy, the normalization table, known limitations), with a CI job, a row in the README's documentation map, and a row in [`docs/architecture.md`](docs/architecture.md)'s components table.

The Python adapter ([`docs/adapters/python.md`](docs/adapters/python.md)) is the simplest to read as a model for runtime hooks, and the Java one ([`docs/adapters/java.md`](docs/adapters/java.md)) for source instrumentation. The checklist is also in [`docs/trace-format.md` §11](docs/trace-format.md#11-adding-a-new-language) and, step by step, in [`Skills.md` §4](Skills.md#4-add-a-language-adapter).

## 7. Adding a drawing

A new renderer (a trie, union-find) is developed against fixture traces, with no backend running: that is what the contract is for. It is a pure function of one step that draws correctly with no diff, is registered by kind or hint, and contains nothing language-specific. The procedure is [`Skills.md` §5](Skills.md#5-add-a-renderer), and the frontend's design is in [`docs/frontend.md`](docs/frontend.md). Propose anything visual as a sketch in an issue first.

## 8. Security

The project runs code that anyone typed in. If you find a way out of the sandbox, a way to make the service run code outside it, or a way to make a trace harm the page, **do not open a public issue**. Write to the author through the contact link at the bottom of the home page instead, with the steps to reproduce it.

## 9. License

By contributing, you agree that your contribution is licensed under the [Apache License 2.0](LICENSE), like the rest of the project.
