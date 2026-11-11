# Skills

Repeatable procedures for working on LeetCode-Visualizer. Each one lists when to use it, the steps, and how to tell it is finished.

Read [`CLAUDE.md`](CLAUDE.md) first. It holds the rules these procedures must respect. Most procedures involve the contract in [`docs/trace-format.md`](docs/trace-format.md) and [`schema/trace.schema.json`](schema/trace.schema.json).

> **Status:** Draft v0.2. `backend/` does not exist yet. Create it when you first need it, and update the README's layout and status table when you do.

| Skill | Use it to |
|---|---|
| [Validate a trace](#1-validate-a-trace) | Check any trace against the schema |
| [Add a golden fixture](#2-add-a-golden-fixture) | Add a new problem example |
| [Change the trace format](#3-change-the-trace-format) | Add a field or kind, or fix the contract |
| [Add a language adapter](#4-add-a-language-adapter) | Support a new language |
| [Add a renderer](#5-add-a-renderer) | Draw a new kind of structure |
| [Write or update a design doc](#6-write-or-update-a-design-doc) | Keep documentation consistent |

---

## 1. Validate a trace

**Use when:** you wrote or edited a trace, a fixture, or an adapter's output.

**Steps**
1. Run `python3 -I tools/check_trace.py <file>` (needs `pip install jsonschema`). It accepts several files at once.
2. If it prints `FAIL`, read each message. They usually name the path to the offending value.
3. Fix the **trace or the adapter**, not the schema. The schema is deliberately strict.
4. If you believe the schema is wrong, use [Change the trace format](#3-change-the-trace-format) instead.

**Done when:** the script prints `OK` for the file and exits with code 0.

**Also check by hand** (the schema cannot): every `ref` id exists in that step's `heap`, ids are unique and never raw addresses, `line` is a line in the user's source, and nothing depends on the order of `set`, `multiset`, `map`, or `multimap` contents.

---

## 2. Add a golden fixture

**Use when:** adding a new problem example, or a structure the current fixtures do not cover (tree, linked list, graph, grid).

**Steps**
1. Pick the problem and one small example input. Keep it small, since traces repeat state on every step.
2. Write the problem metadata: `method`, `params` with neutral `type`s, and `input`. Leave `name` out, because an adapter cannot know it. Add a `hint` only if an adapter could infer it.
3. Write the steps, one snapshot **before** each executed line, following the spec's step rules. Use `step` indexes from 0 and line numbers from the user's original source.
4. For linked structures, put objects in `heap` and refer to them with `ref`. Create each object entry once and reuse its id.
5. Add the final `result` as a normalized value. Leave `truncated` out unless the fixture is meant to show a cut-off run.
6. Save it as `fixtures/<problem-name>.trace.json` (kebab-case), next to the solution source it records.
7. [Validate it](#1-validate-a-trace).
8. For a language that has an adapter, add a hand-instrumented copy of the solution and check that running it produces the fixture: `tools/check_trace.py --equals <fixture> <trace>`. For C++, add it to the `e2e` target in `adapters/cpp/Makefile`.
9. Add a row to the README's documentation map if the fixture is a notable addition.

**Done when:** it validates, a person can read it and follow the algorithm, it exercises something the existing fixtures do not, and any adapter for its language reproduces it.

**Suggested next fixtures:** Reverse Linked List, a binary tree traversal, Clone Graph, and a grid problem.

---

## 3. Change the trace format

**Use when:** adding a field or value kind, resolving one of the known gaps (call stack, container aliasing, member variables, a `ref` result has no heap, hints for locals), or correcting the spec.

The spec, schema, fixtures, and docs are one contract. Change them together. Propose the change and get agreement before editing anything.

**Steps**
1. **Write down the problem first.** What cannot be expressed today, and for which languages or problems?
2. Check it against the principles: language-neutral, self-contained, declarative, deliberately lossy. A change that leaks a language detail is the wrong change.
3. Decide the version bump. An optional field or a new kind is a **minor** bump. Anything that invalidates existing traces is **major**, except while the major version is 0, when a minor bump may break.
4. Edit `docs/trace-format.md`: the relevant section, the examples, the status line, the history in section 9, and, if the change adds a rule for adapters, section 8.
5. Edit `schema/trace.schema.json` to match. Keep `additionalProperties: false`.
6. Update every fixture that is affected, including its `version`.
7. [Validate every fixture](#1-validate-a-trace), and write one deliberately **bad** trace for the new rule to confirm the schema rejects it.
8. Update the places that quote the format: the README's "trace format in brief" and renderer table, `CLAUDE.md`'s conventions, `docs/native-tracing.md`, `docs/dap.md`, and the adapter docs under `docs/adapters/`.
9. Update what reads or writes the format: the adapter runtimes (for C++, the `VERSION` constant in `trace.hpp`) and the frontend's loader, which accepts only the versions it was built for.
10. If it closes one of the open questions, remove it from `docs/native-tracing.md` section 8 and the README's open questions.

**Done when:** spec, schema, fixtures, and quoting docs agree, all fixtures validate, a bad example is rejected, and CI is green.

---

## 4. Add a language adapter

**Use when:** supporting a new language. The frontend and the schema must not change for this. If they need to, stop and use [Change the trace format](#3-change-the-trace-format).

**Steps**
1. **Choose the observation strategy** using the comparison in `docs/dap.md` section 8:
   - runtime hooks (Python, JavaScript, Java), see `docs/native-tracing.md` section 3
   - source instrumentation (C++, Go), see `docs/native-tracing.md` section 4
   - DAP client (breadth, cheapest to add), see `docs/dap.md`
2. **Driver:** wrap the user's unmodified `Solution`, parse the example input into the method's argument types, and provide the LeetCode helper types (`ListNode`, `TreeNode`, `Node`). Keep the user's line numbers correct. Derive the problem metadata: neutral parameter types and inferred hints.
3. **Observe and snapshot:** capture state just before each line of **user** code (skip the driver and the standard library). Deep-copy at that instant.
4. **Normalize:** map every native type to the kind its type determines. Assign stable ids (`n1`, `n2`, ...), create heap entries before recursing, and fail loudly on an unrecognized type.
5. **Step cap:** stop at 2,000 steps, set `truncated`, and write the trace at that moment, because the program may never end.
6. **Output:** write the trace to the path in `TRACE_OUT`, never to stdout, and write it atomically. Write `result` only when the method returned, and `truncated` only as `true`.
7. **Image:** one container image with the toolchain, run with no network and strict CPU, memory, and time limits (`docs/sandboxing.md`).
8. **Test:** run the adapter on the existing fixtures' inputs. Its traces must [validate](#1-validate-a-trace) and match the golden traces for **structural equivalence** (same kinds and shapes). A fixture recorded from this language's own solution must match exactly, apart from the order of sets and maps.
9. **Adversarial cases:** infinite loop (must leave a truncated trace, or time out if it never reaches the tracer), deep recursion, a cyclic structure, a very long run (must truncate), an unsupported type (must error).
10. Add `docs/adapters/<language>.md` covering the strategy, normalization rules, and quirks, add a CI job, and update the README.

**Done when:** it passes validation and comparison on every fixture, the adversarial cases behave, and the frontend needed no changes.

**What is a bug and what is not:** a different `kind` for the same concept, a leaked address, or different field names are bugs. A different map order, different step counts, or an overflow that only one language has are legitimate.

---

## 5. Add a renderer

**Use when:** the frontend needs to draw a structure it cannot yet (a tree, a trie, union-find, and so on). Frontend rules are in `frontend/CLAUDE.md`.

**Steps**
1. Decide what the renderer reads: a value `kind`, a `hint` from the problem metadata, or the shape of an `object` (for example `val` / `left` / `right` for a tree).
2. Develop it against **fixture traces**, with no backend running. That is the point of the contract.
3. Implement it as a pure function of one step, so any step draws on its own and rewind and jump work.
4. Make it consume the diff between the previous and current step for animation (added, removed, changed), but never depend on the diff to draw correctly.
5. Register it in the renderer registry under the kind and hint it handles.
6. Add a fixture that exercises it, using [Add a golden fixture](#2-add-a-golden-fixture).
7. Add a "view as" option if the data could reasonably be shown another way.
8. Add a row to the renderer table in the README.

**Done when:** it draws correctly from fixtures alone, works for every step in any order, and contains no language-specific code.

---

## 6. Write or update a design doc

**Use when:** adding or editing a doc under `docs/`.

**Steps**
1. Match the house style in `CLAUDE.md`: status and related lines, numbered sections, key insight callouts, a design questions section.
2. Keep examples consistent with the spec, and [validate](#1-validate-a-trace) any full trace you include.
3. Separate what is decided from what is proposed or open.
4. Link to other docs by section so readers can follow a decision to its explanation.
5. Add the doc to the README's documentation map with an accurate status, and to the repository layout if it is a new file.
6. If you drew a diagram, check that every box has one width on all of its lines.

**Done when:** the doc follows the house style, its examples validate, and the README's map and layout list it.