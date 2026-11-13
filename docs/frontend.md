# Frontend
> **Status:** Draft v0.2 (reads trace format v0.7)
> **Related:** [`trace-format.md`](trace-format.md) (the contract every renderer reads), [`schema/trace.schema.json`](../schema/trace.schema.json), [`fixtures/two-sum.trace.json`](../fixtures/two-sum.trace.json) (the trace this version replays), [`frontend/CLAUDE.md`](../frontend/CLAUDE.md) (commands and rules for the code)

The frontend replays a trace. It highlights the line about to run, draws each data structure from the current snapshot, and animates what changed since the step before. It knows nothing about the language that produced the trace.

This document covers the first version: a single **sandbox page** that replays the Two Sum fixture. It describes what exists in `frontend/` and the decisions behind it. Later pages (home page, real runs through the API) are listed in [Section 12](#12-out-of-scope) and are only proposals.

```
fixtures/two-sum.trace.json ──► loader ──► step player ──► code panel
                                                     └───► diff ──► renderer registry ──► renderers
```

---

## 1. Scope of this version

| In | Out |
|---|---|
| One sandbox page at `/` | The home page |
| Replaying `fixtures/two-sum.trace.json` | Any backend or API call, running user code |
| Monaco code panel with the current line highlighted | Pointers: `object` and `ref` renderers |
| Renderers for `array` and `map`, a fallback for every other kind | Hint renderers (grid, graph, intervals, ...) |
| Diff highlighting between adjacent steps | The "view as" override UI |
| Playback: step, run, pause, scrub, speed, keyboard | Comparing two traces side by side |
| A language select that changes the editor mode | Sending the language anywhere |

The goal is to prove the shape of the frontend (loader, player, registry, diff) against a real trace before there is a backend. Every piece is written against the contract, not against Two Sum, so a new fixture should replay without code changes as long as it uses `array`, `map`, and primitives.

## 2. Page layout
One screen, dark theme, no page scroll on a 1440×900 window. Panels are separated by thin borders (`--border`).

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TOOLBAR   language · title · first prev run/pause next last · Step 5/8   │
│           scrubber · speed · "code does not run yet" notice              │
├──────────────────────────────┬───────────────────────────────────────────┤
│ CODE PANEL   (~40%)          │ VISUAL PANEL                              │
│                              │   one structure per container local       │
│   Monaco, editable           │   array: boxes, indices, pointer markers  │
│   step.line highlighted      │   map:   key / value table                │
│   (background + gutter)      │                                           │
│   scrolled into view         ├───────────────────────────────────────────┤
│                              │ STATE PANEL                               │
│                              │   Step N of M · line L   [truncated]      │
│                              │   name · kind · value  (one row / local)  │
│                              │   result or "did not return" (last step)  │
└──────────────────────────────┴───────────────────────────────────────────┘
          ◄── drag ──►                        ▲ drag ▼
```

Both splits are resizable by dragging the border between panels: the code / right split horizontally, the visual / state split vertically. The split sizes are plain UI state and are not saved.

## 3. Components

| Module | Role | Reads |
|---|---|---|
| `trace/loader.ts` | Parses the JSON text, checks `version`, returns a trace or an error | Raw text |
| `trace/types.ts` | TypeScript types that mirror the schema | Nothing |
| `trace/format.ts` | Turns any value into compact text (`[2, 7, 11, 15]`, `{2: 0}`, `∞`) | One value |
| `trace/diff.ts` | `diff(prev, curr)`: what changed between two steps | Two steps |
| `player/playback.ts` | Pure reducer for the step index and Run / Pause | Actions |
| `player/usePlayer.ts` | Wraps the reducer and owns the Run timer | Step count, speed |
| `render/registry.ts` | Chooses a renderer for a value ([Section 5](#5-renderer-registry)) | Kind and hint |
| `render/*.tsx` | `ArrayRenderer`, `MapRenderer`, `FallbackRenderer` | One value, its diff, context |
| `components/Toolbar.tsx` | Language select, playback buttons, counter, scrubber, speed | Player state |
| `components/CodePanel.tsx` | Monaco with the line decoration | Source, `step.line` |
| `components/VisualPanel.tsx` | One renderer per container local, or a notice / error | One step, its diff |
| `components/StatePanel.tsx` | The snapshot as a table, plus `result` on the last step | One step, its diff |
| `components/Split.tsx` | A draggable split between two panels | Pointer events |
| `editor/monaco.ts` | Bundles Monaco locally and builds its theme from the CSS variables | `theme.css` |
| `editor/languages.ts` | Editor languages and the Java / Python starter templates | Nothing |
| `fixtures.ts` | Stands in for the backend: source and trace per editor language | `fixtures/` |

The only module that knows which language is selected is `App.tsx`, and it uses that only to pick the editor mode and to ask `fixtures.ts` for a trace. `fixtures.ts` is the stand-in for the future run request ([Section 10](#10-language-select)).

## 4. Loading traces

#### Fixtures come straight from the repo
`fixtures.ts` imports `fixtures/two-sum.trace.json` and `fixtures/two_sum_trace.cpp` with Vite's `?raw` suffix, so both arrive as text and nothing is copied into `frontend/`. `vite.config.ts` adds the repository root to `server.fs.allow` so the dev server may read outside `frontend/`.

The trace is imported as text, not as a JSON module, so it goes through the same `JSON.parse` call in the loader that a response from the API will. `JSON.parse` rejects the bare tokens `NaN` and `Infinity` on its own.

#### Version check
The loader accepts exactly `"0.7"` and rejects everything else with an error shown in the visual panel:

```
Unsupported trace version "0.2". This frontend reads version 0.7 only.
```

Spec [§9](trace-format.md#9-versioning): while the major version is 0, any minor bump may break, so there is no "compatible range". A `0.1` trace would be misread, because its `list` means today's `array`, and a `0.3` trace may carry `"truncated": false`, which v0.4 forbids. A `0.4` trace would in fact draw correctly, but accepting exactly one version keeps the rule simple while the major version is 0.

#### How the run ended
`result` and `truncated` are optional ([trace-format.md §3, Unfinished runs](trace-format.md#unfinished-runs)), so the loader requires neither. `runEnd(trace)` in `trace/types.ts` reads them once:

| `result` | `truncated` | `runEnd` | Last step of the state panel |
|---|---|---|---|
| present | absent or `true` | `returned` | The `result` row, even when it is `null` (a real return value) |
| absent | `true` | `truncated` | `did not return: stopped at the step limit` |
| absent | absent | `stopped` | `did not return: the run ended early` |

A `void` method that returned has `"result": null`, which alone would read as a returned null pointer. `returnsVoid(problem)` in `trace/types.ts` checks `problem.returns.type === "void"` ([trace-format.md §3, The return value](trace-format.md#the-return-value)), and the state panel then shows `returned, no value` with the kind `void` instead of `null`.

**The call stack.** A step is a list of frames (trace format v0.6 and later). The code highlight, the visual panel, and the locals table show the running frame, read through `topFrame(step)`. Above the table, the state panel lists every frame, running frame first, as `function · line N`, and marks a frame that is `returning`. In a return step the table gets a `returns` row with the frame's `return_value`. The diff compares the running frame with the frame that has the same `id` in the previous step, so after a return the caller is compared with its own earlier self and the variable that took the returned value lights up. Drawing callers' structures, and animating frames as they push and pop, is planned.

`result_heap` (the objects a `ref` result points to) is in the `Trace` type but nothing draws it yet. It arrives with the `object` / `ref` renderers.

A missing `truncated` is treated as `false`. A missing `result` is never shown as a wrong answer: the visualizer has no expected answer, so the row is muted, not red.

The loader also checks the minimal shape it needs to draw (`steps` is an array of objects with `line` and `locals`). It does **not** validate against the JSON Schema. Validation happens outside the sandbox, in the API service, before the frontend sees a trace (CLAUDE.md invariant 9). The frontend's job is to fail clearly, not to be the gatekeeper.

#### Tagged numbers
- `{"kind": "int", "value": "9007199254740993"}` is displayed by its string. `value` is never passed to `Number()`, so no digit is lost. Nothing in this version does arithmetic or comparison on a tagged int, so `BigInt` is not used yet. If a renderer needs it later (say, sorting by value), it converts there, and only there.
- `{"kind": "float", "value": "NaN"}` is displayed as `NaN`, `"Infinity"` as `∞`, and `"-Infinity"` as `-∞`.
- A tagged int is never a valid array index, since it is beyond 2^53, so it never becomes a pointer marker.

## 5. Renderer registry
A renderer is a component that draws one local's value for one step:

```ts
type Renderer = (props: {
  name: string;            // the local's name, used as the label
  value: Value;            // the value in this step
  diff: ValueDiff | null;  // null on step 0 and after a jump
  ctx: RenderContext;      // this step's locals and the param's hint
}) => JSX.Element;
```

It is a **pure function of its props**. It holds no state, never reads earlier steps, and draws correctly with `diff = null`.

The registry is two maps and a fallback:

```ts
byHint: Partial<Record<Hint, Renderer>>   // empty in this version
byKind: Partial<Record<Kind, Renderer>>   // array, map
fallback: Renderer                        // everything else
```

**Selection order:** the param's hint (from `problem.params`, if the local is a parameter and has one), then the value's `kind`, then the fallback. The first match wins. An unknown or future kind lands on the fallback instead of crashing (spec §9: "draw an unknown kind with a generic fallback").

The README's full order is "view as override, hint, kind, object shape, fallback". This version drops the first and fourth steps because both are out of scope. They slot in without changing the other three.

> **Key insight 1: a step's picture is a pure function of its own snapshot.** The renderer receives one step's value. The diff only decides which boxes get a colour. Remove the diff and the picture is still correct, which is what makes jump, rewind, and the scrubber free.

## 6. Renderers in this version

| Kind | Renderer | Drawing |
|---|---|---|
| `array` | `ArrayRenderer` | A row of boxes, the index under each box, pointer markers under that |
| `map`, `multimap` | `MapRenderer` | Two-column table, `key` and `value`. A multimap may show a key on several rows |
| every other kind | `FallbackRenderer` | A labelled row of boxes plus the kind name (`stack`, `set`, `multiset`, ...) |
| primitives | none | Not drawn in the visual panel. They appear in the state panel |

The visual panel draws one renderer per **container local**: a local whose value is a tagged kind other than `int` and `float`. Locals appear in the order the trace lists them.

#### Pointer markers
An integer local becomes a labelled marker (`▲ i`) under an array's box when **both** hold:
1. Its name is one of `i`, `j`, `k`, `l`, `r`, `left`, `right`, `lo`, `hi`, `mid`, `start`, `end`, `slow`, `fast`, `p`, `q`.
2. Its value is a bare integer `n` with `0 ≤ n < items.length` for that array.

An `iterator` local is also a marker, with no name rule: when its `container` is this array's own local name and its `index` is in range, it is drawn under that box, labelled with its own name (`▲ it`). The trace says which container it walks, so this is not a guess. An iterator at `end`, or into another container, gets no marker; the state panel shows it as `→ nums[2]`, `→ numMap[7]`, or `→ numMap.end()`.

There is no other heuristic. A local named `idx`, or a `j` that points past the end, is not drawn as a marker, though it is still in the state panel. Several markers on one box stack vertically. A marker is keyed by its name, so when `i` goes from 0 to 1 the same element slides to the next box instead of a new one appearing.

This is a frontend display rule, not a hint. Hints are for what the adapter infers about a parameter ([trace-format.md §4](trace-format.md#4-problem-metadata)), and an index marker does not change how `nums` is drawn, only what is drawn under it.

#### Map order
`MapRenderer` lists entries in the order the trace gives them. It does not sort. Map order is unspecified and is real language behaviour (spec §8), so the frontend shows what the program saw. Diffs match entries by key, never by position. The same goes for `set`, `multiset`, and `multimap`.

## 7. Diffing
`diff(prev, curr)` is a pure function of two steps. For each local it reports:

| Status | Meaning |
|---|---|
| `added` | The name is in `curr` but not `prev` |
| `removed` | The name is in `prev` but not `curr`. The diff keeps the old value so it can be drawn |
| `changed` | In both, with different values |
| `same` | In both, equal |

Inside containers it goes one level deeper:
- **Indexed kinds** (`array`, `list`, `stack`, `queue`, `deque`, `priority-queue`, `tuple`): per index. An index past the old length is `added`, past the new length is `removed`, otherwise `changed` or `same`.
- **`set`**: per member, matched by value.
- **`map`**: per key, matched by value. A key only in `curr` is `added`, only in `prev` is `removed`, and a key whose value differs is `changed`.
- **`multiset`** and **`multimap`**: by count, because a member (or a `[key, value]` entry) may repeat. Each copy in `curr` is `same` while `prev` still has an unmatched equal copy, and `added` after that. The unmatched copies in `prev` are `removed`. In a multimap a value that changed under a repeated key shows as the new entry added and the old one removed, since with repeated keys nothing says which old value became which new one.
- If the kind itself changes, the whole local is `changed` with no per-item detail.

Values are compared by a canonical JSON string (object keys sorted), so `{"kind":"int","value":"…"}` compares by its digits and nothing is converted to a number. The members of `set`, `multiset`, `map`, and `multimap` are sorted in that string too, so the same set listed in another order is `same`, not `changed`. That sort is only for comparing. Nothing is drawn in it.

For Two Sum, step 4 → 5 reports `numMap` key `2` added, `i` changed (0 → 1), and `complement` removed (it went out of scope at the end of the loop body).

#### When a diff is shown
A diff is shown only when the step was entered **from the step directly before it**: by Next, by a Run tick, or by a scrubber move of exactly one. On step 0, after First / Last / Previous, and after any jump, there is no diff, and the step draws plainly.

#### Colours
| Change | Drawing |
|---|---|
| added | `--success` border and tint, with a short flash |
| changed | `--attention` border and tint, with a short flash |
| removed | Drawn faded (old value) for this step only. Gone on the next step |

The state panel uses the same colours on its rows.

## 8. Playback semantics
The player holds `{ index, cameFrom, playing }`. All transitions are a pure reducer in `player/playback.ts`. The Run timer lives in `usePlayer`.

| Input | Effect |
|---|---|
| ⏮ First / Home | Pause, go to step 0 |
| ◀ Previous / ← | Pause, go back one step (stays at 0) |
| ▶ Run / Space | Start advancing from the **current** step. At the last step, restart from step 0 |
| ⏸ Pause / Space | Stop where it is. Run again continues from there |
| ▶ Next / → | Pause, go forward one step (stays at the last) |
| ⏭ Last / End | Pause, go to the last step |
| Scrubber | Pause, go to the chosen step |
| Speed | 0.5×, 1×, 2×. 1× is 700 ms per step. Takes effect on the next tick |

- Run advances one step per tick and **stops by itself at the last step**.
- The counter reads `Step 5 / 8`: the zero-based index of the current step over the index of the last step, so Two Sum runs from `Step 0 / 8` to `Step 8 / 8`, matching the `step` field.
- Keyboard shortcuts are ignored while focus is in the editor or in a form control, so typing a space in the code never toggles Run.
- Every button has an `aria-label` and a tooltip (`title`) naming its shortcut.

> **Key insight 2: the player only moves an index.** It never computes state. Drawing step N reads `steps[N]`, and the diff reads `steps[N-1]` and `steps[N]`, nothing earlier. There is no replay path to get wrong.

## 9. State panel
- Header: `Step N of M · line L`, using the same N and M as the toolbar counter, plus a `truncated` badge when the trace sets `"truncated": true`.
- One row per local: name, kind, compact value. The kind of a bare number is `int` when it is an integer and `float` otherwise. Strings, booleans, and `null` show `string`, `bool`, and `null`.
- Rows use the diff colours. A removed local is shown faded with its old value for one step.
- On the last step, `result` is shown under the locals in the same row format.

## 10. Language select
The select (C++, Java, Python) is a **UI input**. It changes the Monaco language mode, and later it will be sent with the run request. No renderer, diff, or state code reads it, and nothing reads `trace.language` (CLAUDE.md invariant 2).

| Selected | Editor | Visual panel |
|---|---|---|
| C++ | The Two Sum source from `fixtures/` | The Two Sum trace |
| Java / Python | A short starter `Solution` template | "No trace for this language yet. Showing nothing until the backend is connected." |

Switching back to C++ restores the fixture source and trace. The editor is editable, and the toolbar says that code does not run yet. Editing does not change the trace. The highlighted line still comes from `step.line`, so after edits it may point at a different line of text.

`fixtures.ts` is the only place a language maps to a trace. When the backend exists, it is replaced by the run request, which sends the language with the source, and the rest of the page does not change.

## 11. Theme tokens
GitHub dark. Every colour is a CSS variable on `:root` in `src/styles/theme.css`, and components use only the variables.

| Token | Value | Used for |
|---|---|---|
| `--bg` | `#0d1117` | Canvas, editor background |
| `--bg-subtle` | `#161b22` | Panels, toolbar |
| `--bg-inset` | `#010409` | Boxes, table cells, inputs |
| `--border` | `#30363d` | Panel borders, box borders |
| `--fg` | `#e6edf3` | Text |
| `--fg-muted` | `#7d8590` | Labels, indices, line numbers |
| `--accent` | `#2f81f7` | Pointer markers, focus, the gutter marker |
| `--success` | `#3fb950` | Diff: added |
| `--attention` | `#d29922` | Diff: changed |
| `--danger` | `#f85149` | Errors |
| `--done` | `#a371f7` | The result row |
| `--line-highlight` | `rgba(56, 139, 253, 0.15)` | The current line |

Syntax colours for the editor are five extra variables in the same file (`--syntax-keyword`, `--syntax-string`, `--syntax-number`, `--syntax-comment`, `--syntax-type`), set to GitHub dark's values.

The Monaco theme (`monaco.editor.defineTheme`, base `vs-dark`) is built at startup by reading these variables with `getComputedStyle`, so the editor and the page cannot drift apart. Monaco accepts only hex colours, so `rgba(...)` values are converted to `#rrggbbaa` first.

Fonts: the system UI stack for text, `ui-monospace, SFMono-Regular, Menlo, monospace` for code and values.

## 12. Out of scope
Planned for later versions, not designed here:
- The home page, and any routing.
- Running code: the run request, the API service, loading states, error traces.
- `object` and `ref` renderers (tree, linked list, graph) and anything that reads `heap`. A `ref` local currently goes to the fallback and shows `→ n1`.
- Hint renderers (grid, adjacency list, intervals, ...). The registry slot exists and is empty.
- The "view as" override.
- Animating structure (boxes sliding when an item is inserted in the middle). This version only colours what changed and slides pointer markers.

## 13. Design questions

> **Q1. Why is the diff shown only after a one-step move forward?** A diff answers "what did this line just do?". That question only makes sense when the previous displayed step is the one before it. After a jump from step 0 to step 7, colouring everything that differs would highlight work done by six lines at once, which looks like a single change and misleads. Showing nothing is honest, and it keeps the rule simple: diff iff `cameFrom === index - 1`.

> **Q2. Why not diff backwards when stepping back?** Going from 5 to 4 could show `[2, 0]` as "removed", but it was never removed in the program. The colours describe what the program did, so they only run forwards.

> **Q3. Why is the index-name rule a fixed list instead of something smarter?** Anything smarter (an integer used inside `nums[...]`) needs to read the source, and that is language knowledge. The adapter can do it later and send a hint. A fixed list of conventional names is language-neutral, predictable, and wrong in an obvious way when it is wrong.

> **Q4. Why does the language select not filter traces by `trace.language`?** Because then the frontend would branch on `language`, which the spec forbids. The select picks what to *ask for* (today a fixture, later a run). Whatever trace comes back is drawn the same way regardless of what produced it.

> **Q5. Why import the trace as text instead of as a JSON module?** A real trace will arrive as a response body. Importing text and calling the loader's `JSON.parse` exercises the same path, including the version check and the rejection of bare `NaN`.

> **Q6. Why does the frontend not validate against the schema?** It would need a schema validator dependency, and it is the wrong place: the API service validates outside the sandbox before a trace reaches the browser. The loader checks only what it needs to draw and fails with a clear message otherwise.

> **Q7. Why read the theme from CSS variables instead of writing the Monaco theme by hand?** One source of truth. If a token changes in `theme.css`, the editor follows it. The cost is a small colour conversion, since Monaco does not accept `rgba(...)`.

> **Q8. Why show the method name as the title?** A bare `Solution` class does not know which problem it solves, so `problem.name` is optional (spec §4). `problem.method` is always present, and it is what the user wrote, so it is the honest fallback. Nothing tries to guess a problem name from it.

> **Q9. Why is a missing result muted instead of shown as an error?** A missing `result` means the method never returned, not that the answer was wrong (spec §3). An infinite loop that hits the step limit is often exactly the bug the user came to see, and its trace is still worth stepping through.
