# Frontend
> **Status:** Draft v0.4 (reads trace format v0.8)
> **Related:** [`trace-format.md`](trace-format.md) (the contract every renderer reads), [`schema/trace.schema.json`](../schema/trace.schema.json), [`fixtures/two-sum.trace.json`](../fixtures/two-sum.trace.json) (the trace the page opens on), [`backend.md`](backend.md) (the API the inputs call), [`frontend/CLAUDE.md`](../frontend/CLAUDE.md) (commands and rules for the code)

The frontend replays a trace. It highlights the line about to run, draws each data structure from the current snapshot, and animates what changed since the step before. It knows nothing about the language that produced the trace.

This document covers a single **sandbox page**. It opens on the Two Sum fixture, and with the API service running it traces the user's own Solution on their inputs ([Section 10.1](#101-inputs-and-runs)). It describes what exists in `frontend/` and the decisions behind it. Later pages are listed in [Section 12](#12-out-of-scope) and are only proposals.

```
fixtures/two-sum.trace.json, or POST /api/run ──► loader ──► step player ──► code panel
                                                                       └───► diff ──► renderer registry ──► renderers
```

---

## 1. Scope of this version

| In | Out |
|---|---|
| One sandbox page at `/` | The home page |
| Replaying `fixtures/two-sum.trace.json`, then the trace of each run | Visual design of the inputs panel |
| An inputs panel: one field per parameter, Run code through the API | Design problems (LRU Cache, Min Stack) |
| Monaco code panel with the current line highlighted | Hint renderers (grid, adjacency list, intervals, ...) |
| Renderers for every container kind, and a fallback for unknown kinds | The "view as" override UI |
| Linked lists, trees, and graphs drawn from `heap`, with pointer labels | Objects that are not nodes (no `val`/`next`/`left`/`neighbors` shape) drawn as more than a node |
| A recursion tree when calls nest, and a folding call list | |
| Diff highlighting between adjacent steps, and motion (fade, glide, draw-in) | |
| Playback: step, run, pause, scrub, speed, keyboard | Comparing two traces side by side |
| A language select that changes the editor mode | Sending the language anywhere |

The first goal was to prove the shape of the frontend (loader, player, registry, diff) against a real trace before there was a backend; the inputs panel now feeds it real runs. Every piece is written against the contract, not against Two Sum, so a new fixture replays without code changes.

## 2. Page layout
One screen, dark theme, no page scroll on a 1440×900 window. Panels are separated by thin borders (`--border`).

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TOOLBAR   language · title · first prev run/pause next last · Step 5/8   │
│           scrubber · speed · which trace is showing                      │
├──────────────────────────────┬───────────────────────────────────────────┤
│ CODE PANEL   (~40%)          │ VISUAL PANEL                              │
│                              │   recursion tree (when calls nest)        │
│   Monaco, editable           │   lists, trees, graphs from the heap      │
│   step.line highlighted      │   one structure per other container local │
│   (background + gutter)      │   array: boxes, indices, pointer markers  │
│   scrolled into view         │   map: table · stack, queue, set: boxes   │
├──────────────────────────────┼───────────────────────────────────────────┤
│ INPUTS PANEL                 │ STATE PANEL                               │
│   method (when several)      │   Step N of M · line L   [truncated]      │
│   one field per parameter    │   name · kind · value  (one row / local)  │
│   paste a LeetCode example   │   result or "did not return" (last step)  │
│   Run code · status · output │                                           │
└──────────────────────────────┴───────────────────────────────────────────┘
          ◄── drag ──►                        ▲ drag ▼
```

Every split is resizable by dragging the border between panels: the left / right split horizontally, and the code / inputs and visual / state splits vertically. The split sizes are plain UI state and are not saved.

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
| `render/*.tsx` | `ArrayRenderer`, `MapRenderer`, `SequenceRenderer`, `SetRenderer`, `FallbackRenderer` | One value, its diff, context |
| `trace/heap.ts` | Edges between heap objects, a node's label and shape, pointers into the heap, `heapDiff` | One or two steps |
| `trace/calls.ts` | `callTree(trace)`: every call, its caller, arguments, and return value; where a call stands at a step | The whole trace, once |
| `render/layout.ts` | `layoutTrace(trace)`: a fixed place for every node of every linked structure ([Section 6.4](#64-linked-structures-layout)) | The whole trace, once |
| `render/HeapView.tsx` | Draws the linked structures of one step: nodes, edges, pointer labels, highlights | One step, its heap diff, the layout |
| `components/RecursionTree.tsx` | The recursion tree at one step, whole or focused ([Section 6.6](#66-recursion-tree)) | The call tree, one step |
| `components/Toolbar.tsx` | Language select, playback buttons, counter, scrubber, speed | Player state |
| `components/CodePanel.tsx` | Monaco with the line decoration | Source, `step.line` |
| `components/VisualPanel.tsx` | The recursion tree, the linked structures, then one renderer per other container local, or a notice / error | One step, its diff, the per-trace layout and call tree |
| `components/StatePanel.tsx` | The call stack (folded when deep) and the snapshot as a table, plus `result` on the last step | One step, its diff |
| `components/Split.tsx` | A draggable split between two panels | Pointer events |
| `editor/monaco.ts` | Bundles Monaco locally and builds its theme from the CSS variables | `theme.css` |
| `editor/languages.ts` | Editor languages and the Java / Python starter templates | Nothing |
| `fixtures.ts` | The example the page opens with: source and trace per editor language | `fixtures/` |
| `api/client.ts` | `signature()` and `run()`: the two API calls, answers as unions, the trace through the loader | The API |
| `api/form.ts` | Fields for a method, placeholders, kept values, filling from an example, the run request | A signature |
| `api/useInputs.ts` | The form's state: the signature re-read 400 ms after an edit, the method, the values, the run | Source |
| `components/InputsPanel.tsx` | The form: method picker, one field per parameter, paste an example, Run code, the outcome | The form's state |

The only module that knows which language is selected is `App.tsx`, and it uses that only to pick the editor mode, to ask `fixtures.ts` for the opening trace, and to enable the inputs (only C++ runs so far) ([Section 10](#10-language-select)).

## 4. Loading traces

#### Fixtures come straight from the repo
`fixtures.ts` imports `fixtures/two-sum.trace.json` and `fixtures/two_sum_trace.cpp` with Vite's `?raw` suffix, so both arrive as text and nothing is copied into `frontend/`. `vite.config.ts` adds the repository root to `server.fs.allow` so the dev server may read outside `frontend/`.

The trace is imported as text, not as a JSON module, so it goes through the same `JSON.parse` call in the loader that a response from the API will. `JSON.parse` rejects the bare tokens `NaN` and `Infinity` on its own.

#### Version check
The loader accepts exactly `"0.8"` and rejects everything else with an error shown in the visual panel:

```
Unsupported trace version "0.2". This frontend reads version 0.8 only.
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

**The call stack.** A step is a list of frames (trace format v0.6 and later). The code highlight, the visual panel, and the locals table show the running frame, read through `topFrame(step)`. Above the table, the state panel lists every frame, running frame first, as `function · line N`, and marks a frame that is `returning`. In a return step the table gets a `returns` row with the frame's `return_value`. The diff compares the running frame with the frame that has the same `id` in the previous step, so after a return the caller is compared with its own earlier self and the variable that took the returned value lights up. A caller's pointers into the heap are drawn as dashed rings on their nodes ([Section 6.5](#65-linked-structures-drawing)), and a stack deeper than 8 frames is folded ([Section 6.6](#66-recursion-tree)).

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

### 6.1 Containers

| Kind | Renderer | Drawing |
|---|---|---|
| `array` | `ArrayRenderer` | A row of boxes, the index under each box, pointer markers under that |
| `map`, `multimap` | `MapRenderer` | Two-column table, `key` and `value`. A multimap may show a key on several rows |
| `stack` | `SequenceRenderer` | A column of boxes, the top first and marked `top` |
| `queue`, `deque`, `list` | `SequenceRenderer` | A row of boxes between `front` and `back` (`⇄` between the nodes of a `list`) |
| `priority-queue` | `SequenceRenderer` | A row of boxes in the trace's order, `items[0]` marked `top`, labelled with its order (`priority queue (max) · 3`) |
| `tuple` | `SequenceRenderer` | A row of boxes in parentheses |
| `set`, `multiset` | `SetRenderer` | Chips in the trace's order, never sorted |
| `object`, `ref` | `HeapView` | Not drawn per local: the heap is drawn once per step, and a local holding a `ref` becomes a pointer label on its node ([Section 6.5](#65-linked-structures-drawing)) |
| an unknown kind | `FallbackRenderer` | A labelled row of boxes plus the kind name |
| primitives | none | Not drawn in the visual panel. They appear in the state panel |

The visual panel draws, top to bottom: the recursion tree when one call made another ([Section 6.6](#66-recursion-tree)), the linked structures of the step's heap, then one renderer per other **container local** of the running frame (a tagged kind other than `int`, `float`, `ref`, and `object`), in the order the trace lists them. A `ref` inside a container (a queue of nodes, a map from node to clone) shows its node's value, with the id on hover.

Items of a queue, deque, priority queue, and set are keyed by their value and which copy of that value they are, so popping the front fades that item out and glides the rest forward, instead of every box changing its value.

### 6.2 Pointer markers
An integer local becomes a labelled marker (`▲ i`) under an array's box when **both** hold:
1. Its name is one of `i`, `j`, `k`, `l`, `r`, `left`, `right`, `lo`, `hi`, `mid`, `start`, `end`, `slow`, `fast`, `p`, `q`.
2. Its value is a bare integer `n` with `0 ≤ n < items.length` for that array.

An `iterator` local is also a marker, with no name rule: when its `container` is this array's own local name and its `index` is in range, it is drawn under that box, labelled with its own name (`▲ it`). The trace says which container it walks, so this is not a guess. An iterator at `end`, or into another container, gets no marker; the state panel shows it as `→ nums[2]`, `→ numMap[7]`, or `→ numMap.end()`.

There is no other heuristic. A local named `idx`, or a `j` that points past the end, is not drawn as a marker, though it is still in the state panel. Several markers on one box stack vertically. A marker is keyed by its name, so when `i` goes from 0 to 1 the same element slides to the next box instead of a new one appearing.

This is a frontend display rule, not a hint. Hints are for what the adapter infers about a parameter ([trace-format.md §4](trace-format.md#4-problem-metadata)), and an index marker does not change how `nums` is drawn, only what is drawn under it.

### 6.3 Map order
`MapRenderer` lists entries in the order the trace gives them. It does not sort. Map order is unspecified and is real language behaviour (spec §8), so the frontend shows what the program saw. Diffs match entries by key, never by position. The same goes for `set`, `multiset`, and `multimap`.

### 6.4 Linked structures: layout
`layoutTrace(trace)` runs once when a trace is loaded. It reads every step's heap, joins objects linked by a `ref` field at any step into one **component**, and gives each node a fixed place for the whole run. A node appears where it stays, and when a link changes only the link moves. This is the one exception to "nothing earlier than the step before" (frontend/CLAUDE.md rule 2): a layout is a function of the whole trace, computed once, and drawing step N still reads only step N's heap and that fixed layout.

Each component gets a shape from its fields, never from the language:

| Shape | When | Layout |
|---|---|---|
| tree | Its nodes have a `left` or `right` field | A tidy tree: in-order across, children a row under their parent |
| list | Its nodes have a `next` field and no array field | One row per chain in link order: a node is placed after the node that first links to it |
| graph | Anything else (`neighbors`, arrays of refs) | A circle of up to 12 nodes, in depth-first order along the edges so neighbours sit side by side; larger graphs in layers by distance from the first node |

A tree whose shape changes during the run (a node that moves under another parent, as in a rotation) cannot keep one place per node without overlaps, so it is marked **dynamic** and laid out from the step's own heap at each step; nodes glide to their new places.

### 6.5 Linked structures: drawing
`HeapView` draws one SVG per component present at the step. A component is labelled with the names of the running frame's pointers into it (`head, prev, curr`), or by its shape when none points at it.

| Element | Drawing |
|---|---|
| Node | A circle with its `val` (or the first scalar field) inside |
| Edge | An arrow from the field's owner to its target. A field other than the shape's primary ones (`random`, `prev`) is dashed and labelled. Two edges between the same nodes bend apart |
| Two-way graph link | A node in each other's `neighbors` is one plain line with no arrows |
| `next = null` | A short stub ending in `null`, to the right, or under the node when a neighbour sits there |
| Pointer label | Each `ref` local of the running frame is a label over its node, keyed by name so it slides when the pointer moves. Several pointers on one node stack |
| Caller pointers | A node a caller's frame points at gets a dashed ring: the path the recursion took to get here |
| Null pointers | A pointer local that is `null` is listed under the structures (`prev → null`), only for names that point at a node at some step |
| Result | On the last step, the node `result` points at is drawn in `--done` and labelled `result` |

Highlights follow the heap diff (`heapDiff`, [Section 7](#7-diffing)): a new node and a new or redirected edge flash `--success`, a node whose scalar fields changed flashes `--attention`, and a removed node fades out.

### 6.6 Recursion tree
`callTree(trace)` runs once when a trace is loaded. A frame id belongs to one call for the whole run (spec §6), and the frame under it on the stack is its caller, so every call, its caller, its arguments (its locals on its first step), and its return value (from its return step) can be read from the steps. Drawing step N uses only what the tree says about step N. The tree is shown only when some call was made by another call.

Each box is labelled `f(args)`. Its colour says where the call stands at this step:

| State | Meaning | Colour |
|---|---|---|
| running | The running frame | `--accent` |
| waiting | On the stack, waiting for a call it made | dashed `--accent` |
| returning | The running frame, at its return step | `--done` |
| returned | Finished, after making calls | muted |
| base case | Finished without making any call | `--attention` |

A call's return value appears under its box (`→ 3`) from its return step on. Calls not yet begun are not drawn, so the tree grows as the run goes.

A run of up to 80 calls is drawn whole, every call in a fixed place. A larger run is drawn **focused on the running call**: the calls on the stack, the calls each of them has made so far, and every finished branch folded into one box (`fib(7)` with `→ 13 · 41 calls` under it). A stack deeper than 14 keeps its top 3 and bottom 10 calls and folds the middle into one box (`⋮ 40 calls`). Either way the number of boxes stays small however deep the recursion goes. The tree sits in a scroll box that scrolls to keep the running call in view.

The state panel's call list folds the same way: a stack deeper than 8 frames shows the 6 frames at the top (the running frame first), then `… N more calls` (which unfolds on click), then the bottom frame.

### 6.7 Motion
Motion uses `framer-motion`. Nothing appears or disappears instantly: nodes, boxes, and labels fade and scale in and out, edges draw themselves in, pointer labels and items glide to their new places, and flashes fade over about 900 ms. Motion only describes the step before; drawing with no diff (step 0, a jump, moving back) shows the step without flashes. `MotionConfig reducedMotion="user"` turns movement off for anyone whose system asks for reduced motion.

## 7. Diffing
`diff(prev, curr)` is a pure function of two steps. For each local it reports:

| Status | Meaning |
|---|---|
| `added` | The name is in `curr` but not `prev` |
| `removed` | The name is in `prev` but not `curr`. The diff keeps the old value so it can be drawn |
| `changed` | In both, with different values |
| `same` | In both, equal |

The heap gets its own diff, `heapDiff(prev, curr)`: nodes added, removed, and changed (a scalar field differs), and edges added, removed, and redirected (the same field of the same node now points elsewhere). Nodes and edges are matched by id and field, never by position.

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
| Java / Python | A short starter `Solution` template | "No trace for this language yet: only C++ can run so far." The inputs are disabled |

Switching back to C++ restores the fixture source and trace. The editor is editable. Editing does not change the trace until Run code is pressed again; until then the highlighted line still comes from `step.line`, so it may point at a different line of text. The toolbar says which trace is showing: the Two Sum example, or the last run.

`fixtures.ts` is the only place a language maps to a trace.

### 10.1 Inputs and runs

The inputs panel turns the pasted Solution into a form ([`backend.md`](backend.md) §2.2):

1. **The signature.** 400 ms after the source stops changing, `POST /api/signature` returns the public methods, each parameter's name and neutral type, and the method to preselect. A request still in flight when the source changes again is cancelled. If the new source cannot be read, the last good fields stay, with the error above them, so typing does not make the form flicker.
2. **The fields.** One per parameter of the chosen method, labeled with its name and neutral type (`nums array<int>`), with LeetCode's notation for that type as the placeholder (`[1,2,3]`, `[3,9,20,null,null,15,7]`). An extra such as `pos` is an optional field. A method picker appears only when the Solution has several public methods. A value typed earlier is kept when the signature changes but the field still exists.
3. **Paste a LeetCode example.** The whole example block from the problem page (`Input: ... Output: ...`) fills the fields: by name, or in order when none of the names match (Clone Graph's `adjList` for the parameter `node`), as the driver does.
4. **Run code.** Disabled, with the reason, until every required field has a value. It sends the source, the method, and the fields to `POST /api/run`. A trace that comes back goes through the same loader as the fixture and replaces it in the player, which restarts at step 0. A failure shows its stage as a heading ("The code does not compile") and the message, such as Clang's error with the line. The program's output and the driver's notes are shown under the button.

The panel is functional only. Its visual design comes later.

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
- The visual design of the inputs panel.
- Design problems (LRU Cache, Min Stack), whose example is a sequence of calls.
- Several examples at once (one run and one trace each).
- Hint renderers (grid, adjacency list, intervals, ...). The registry slot exists and is empty.
- The "view as" override.
- Laying out graphs larger than about 30 nodes well. Layers by distance are readable, not pretty.

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

> **Q10. Why lay out linked structures from the whole trace, when every step is a snapshot?** A layout computed per step would move every node whenever a link changed: reversing a list would redraw it backwards at each step, and the user would lose track of which node is which. Fixed places make the change visible as the one thing that moved. The layout is still pure (a function of the trace, computed once), it never replays steps to build state, and every node, edge, and label drawn at step N comes from step N. A tree whose shape changes is the one case laid out per step, because fixed places would overlap.

> **Q11. Why a recursion tree instead of only a call stack?** A stack shows the calls in progress, but recursion is understood by its branching: which calls a call made, what each returned, and where the base cases are. The tree shows all of that and still contains the stack, as the highlighted path from the root to the running call. The state panel keeps the plain call list for the locals of each frame.

> **Q12. How does a deep or wide recursion stay readable?** By folding, not shrinking. Up to 80 calls fit whole. Beyond that only the path to the running call is drawn in full; a finished branch is one box with its result and its size, and the middle of a very deep path is one `⋮` box. The number of boxes grows with the depth shown, not the size of the run, so `fib(25)` draws about as many boxes as `fib(10)`.

> **Q13. Why framer-motion instead of CSS transitions?** CSS can fade a box in, but it cannot fade out an element React has already removed, glide an item to a new place in a list, or draw an SVG path in. framer-motion's `AnimatePresence` and `layout` do those three, and it was already approved. CSS still does the flashes.
