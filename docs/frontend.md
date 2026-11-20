# Frontend
> **Status:** Draft v0.19 (reads trace format v0.15 and v0.14)
> **Related:** [`trace-format.md`](trace-format.md) (the contract every renderer reads), [`schema/trace.schema.json`](../schema/trace.schema.json), [`backend.md`](backend.md) (the API the inputs call), [`frontend/CLAUDE.md`](../frontend/CLAUDE.md) (commands and rules for the code)

The frontend replays a trace. It highlights the line about to run, draws each data structure from the current snapshot, and animates what changed since the step before. It knows nothing about the language that produced the trace.

This document covers two pages. The **sandbox page** opens on the bare Two Sum Solution with no trace, and with the API service running it traces the user's own Solution on their inputs ([Section 10.1](#101-inputs-and-runs)). The **home page** says what the tool is, replays a real trace, and links into the sandbox with example problems filled in ([Section 12](#12-home-page)). It describes what exists in `frontend/` and the decisions behind it. What is planned is listed in [Section 13](#13-out-of-scope) and is only proposals.

```
POST /api/run ──► loader ──► step player ──► code panel
                                                                       └───► diff ──► renderer registry ──► renderers
```

---

## 1. Scope of this version

| In | Out |
|---|---|
| A sandbox page (`#/sandbox`) and a home page (`#/`), chosen by a hash route ([Section 12](#12-home-page)) | A router library, and paths without `#` |
| Replaying the trace of each run | |
| An inputs panel: one field per parameter, Run code through the API | Design problems (LRU Cache, Min Stack) |
| Monaco code panel with the current line highlighted | |
| Renderers for every container kind, and a fallback for unknown kinds; a 2D array as a graph (adjacency list, edge list, adjacency matrix) or as intervals, from a hint or the card's View menu ([Section 5.1](#51-view-as)) | |
| Linked lists, trees, and graphs drawn from `heap`, with pointer labels | Objects that are not nodes (no `val`/`next`/`left`/`neighbors` shape) drawn as more than a node |
| The calls: a recursion card (tree or stack) when calls return values, a call-stack card when they return nothing | |
| Diff highlighting between adjacent steps, and motion (fade, glide, draw-in) | |
| A dark theme and a light one, switched in the top bar ([Section 11](#11-theme-tokens)) | |
| Playback: restart, step, play, pause, scrub, speed, keyboard; Cmd/Ctrl + Enter runs the code | Comparing two traces side by side |
| A language select that changes the editor mode | Sending the language anywhere |

The first goal was to prove the shape of the frontend (loader, player, registry, diff) against a real trace before there was a backend; the inputs panel now feeds it real runs. Every piece is written against the contract, not against Two Sum, so a new fixture replays without code changes.

## 2. Page layout
One screen, dark theme, no page scroll on a 1440×900 window. Panels are separated by thin lines (`--border-subtle`). The design was agreed as mockups first (Geist and Geist Mono, a blue-tinted near-black, calm desaturated colours, rounded cards).

```
┌──────────────────────────────────────────────────────────────────────────┐
│ TOP BAR  logo · LeetCode Visualizer │ language · Call stack ◉   ☀ Run code │
├──────────────────────────────┬───────────────────────────────────────────┤
│ CODE PANEL  "Code" (i)   C++ │ CANVAS (dot grid)                         │
│                              │   lists, trees, graphs from the heap      │
│   Monaco, editable           │   one structure per other container local │
│   step.line highlighted      │   the calls, at the bottom (when nested)  │
│   (tint + 4px bar)           │                                           │
│   scrolled into view         │   before a run: "Run your code to see it  │
│                              │   here." and how to run it                │
│                              │   while a run is going: the trace line    │
│                              │   drawing itself, "Running your code in   │
│                              │   the sandbox"                            │
├──────────────────────────────┼───────────────────────────────────────────┤
│ INPUTS PANEL                 │ STATE PANEL                               │
│   method (when several)      │   Step N of M   [truncated]               │
│   one field per parameter    │   Line i  statement  →  true / x = 4      │
│                              │   Locals | Output (when it printed)       │
│                              │   name · kind · value  (one row / local)  │
│   or paste a LeetCode example│   result or "did not return" (last step)  │
│   Fill fields · why Run waits│   before a run: "No trace yet"            │
├──────────────────────────────┴───────────────────────────────────────────┤
│ PLAYBACK  Restart │ ◀ ▶ ▶ ⏭  Step 5 / 9  ──────●────────────  0.5× 1× 2× │
└──────────────────────────────────────────────────────────────────────────┘
          ◄── drag ──►                        ▲ drag ▼
```

The **(i)** beside the Code title is an info button (`components/PasteHint.tsx`). Its note asks for the code exactly as LeetCode gives it, with the comments above the `Solution`: those comments define `ListNode`, `TreeNode`, or `Node`, and the driver reads them to know how linked lists, trees, and graphs are built ([driver-generation.md](driver-generation.md)). The note shows on hover and on keyboard focus, a tap shows it on a touch screen, and Escape hides it.

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
| `render/*.tsx` | `ArrayRenderer`, `MapRenderer`, `MultimapRenderer`, `StackRenderer`, `TubeRenderer`, `ListRenderer`, `TupleRenderer`, `SetRenderer`, `HeapRenderer`, `FallbackRenderer`; `Card.tsx` (the shared header) | One value, its diff, context |
| `render/ops.ts` | `operation(value, diff, heap)`: the operation chip's words ("push 3", "erase key 3"); a ref is named by its node's value | One value, its diff, the step's heap |
| `trace/heap.ts` | Edges between heap objects, a node's label and shape, pointers into the heap, `heapDiff` | One or two steps |
| `trace/calls.ts` | `callTree(trace)`: every call, its caller, parameters, arguments, and return value; where a call stands at a step; which calls card a run gets (`callsCardKind`) | The whole trace, once |
| `trace/shared.ts` | `sharedPlaces(step)`: every place each shared container (v0.14 `id`) is reached from, named as the reader writes it; `sharedGroups` picks a card's ([Section 6.8](#68-shared-containers)) | One step |
| `render/layout.ts` | `layoutTrace(trace)`: a fixed place for every node of every linked structure ([Section 6.4](#64-linked-structures-layout)) | The whole trace, once |
| `render/HeapView.tsx` | `LinkedCard`: one linked structure of one step as a card: nodes, edges, pointer tags, highlights; `NullPointers` for pointers that hold null | One step, its heap diff, the layout, the running call's parameters |
| `components/RecursionTree.tsx` | The recursion card at one step: a Tree view (whole or focused) and a Stack view ([Section 6.6](#66-calls)) | The call tree, one step |
| `components/CallStackCard.tsx` | The call-stack card at one step, for calls that return nothing: one row per live frame, with the node's neighbours ([Section 6.6](#66-calls)) | The call tree, one step, the frames just pushed |
| `components/Toolbar.tsx` | The top bar: logo and name, language select, the call-stack switch, the theme button, Run code | Language, run state, theme |
| `components/PlaybackBar.tsx` | The bottom bar: Restart, previous, play/pause, next, last, the counter, the scrubber with a tick per step, speed. The scrubber's dot is drawn (`.scrubber-dot`), not the range input's own thumb, so a step is one motion: the line moves (180 ms), then the dot fades in where it stops (140 ms), 320 ms in all, inside one step at 2×. While the reader drags, both follow the pointer at once | Player state |
| `components/CodePanel.tsx` | Monaco with the line decoration; rebuilds the editor theme when the page's theme changes | Source, `step.line`, theme |
| `components/PasteHint.tsx` | The info button beside the Code title: paste LeetCode's code with its comments | Nothing |
| `components/VisualPanel.tsx` | The line strip, then one card per linked structure, one per other container local, and the calls card at the bottom, or a notice / error; while a run is going, `RunningCanvas` instead | One step, its diff, the per-trace layout and call tree, the call-stack switch, whether a run is going |
| `components/RunningCanvas.tsx` | The canvas while the sandbox makes a trace: a line of trace points drawing itself, and what the sandbox is doing | Nothing |
| `components/StatePanel.tsx` | "Step N of M" with a progress bar, the running line (its statement and what it produced), and the running frame's locals as a table, plus `result` on the last step, and an Output tab when the program printed ([Section 9](#9-state-panel)) | One step, its diff, the code the run was made from, the run's output |
| `components/Split.tsx` | A draggable split between two panels | Pointer events |
| `editor/monaco.ts` | Bundles Monaco locally and builds its theme from the CSS variables, again after each theme change | `theme.css` |
| `theme.ts` | The page's theme: the first one (the one picked before, else the system's), `data-theme` on `<html>`, the toggle, remembering the choice | The system setting, browser storage |
| `editor/languages.ts` | Editor languages, the bare Two Sum starter in each, and Two Sum's example as placeholder text | Nothing |
| `api/client.ts` | `signature()` and `run()`: the two API calls, answers as unions, the trace through the loader | The API |
| `api/form.ts` | Fields for a method, placeholders, kept values, filling from an example, the run request | A signature |
| `api/useInputs.ts` | The form's state: the signature re-read 400 ms after an edit, the method, the values, the run | Source |
| `components/InputsPanel.tsx` | The form: method picker, one field per parameter, an example box that fills the fields on paste, Fill fields, why Run code waits, a failed run's error | The form's state |

The only module that knows which language is selected is `App.tsx`, and it uses that only to pick the editor mode and the starter template, and sends it with the API requests; C++, Python, and Java all run ([Section 10](#10-language-select)).

## 4. Loading traces

#### Traces come from runs; tests read the fixtures
The page has no trace until the code runs: a run's trace goes through `checkTrace` in `api/client.ts`. The tests import `fixtures/*.trace.json` with Vite's `?raw` suffix, so they arrive as text and go through the same `JSON.parse` call in the loader. Nothing is copied into `frontend/`; `vite.config.ts` adds the repository root to `server.fs.allow`. `JSON.parse` rejects the bare tokens `NaN` and `Infinity` on its own.

#### Version check
The loader accepts `"0.15"` and `"0.14"` and rejects everything else with an error shown in the visual panel:

```
Unsupported trace version "0.2". This frontend reads versions 0.15 and 0.14 only.
```

Spec [§9](trace-format.md#9-versioning): while the major version is 0, any minor bump may break, so there is no "compatible range". A `0.1` trace would be misread, because its `list` means today's `array`, and a `0.3` trace may carry `"truncated": false`, which v0.4 forbids. A `0.4` trace would in fact draw correctly, but accepting only versions checked against this frontend keeps the rule simple while the major version is 0. v0.14 is kept because v0.15 only added the size budget and `truncated_by`: a v0.14 trace draws the same, and a truncated one stopped at the step limit, its only limit.

#### How the run ended
`result` and `truncated` are optional ([trace-format.md §3, Unfinished runs](trace-format.md#unfinished-runs)), so the loader requires neither. `runEnd(trace)` in `trace/types.ts` reads them once, and `truncatedBy(trace)` says which limit stopped a truncated run:

| `result` | `truncated` | `runEnd` | Last step of the state panel |
|---|---|---|---|
| present | absent or `true` | `returned` | The `result` row, even when it is `null` (a real return value) |
| absent | `true`, `truncated_by: "steps"` (or absent, in v0.14) | `truncated` | `did not return: stopped at the step limit` |
| absent | `true`, `truncated_by: "size"` | `truncated` | `did not return: stopped at the size limit`, and its tooltip says why: every step holds every value and every call, so a large input or deep recursion fills it; try a smaller input |
| absent | absent | `stopped` | `did not return: the run ended early` |

A `void` method that returned has `"result": null`, which alone would read as a returned null pointer. `returnsVoid(problem)` in `trace/types.ts` checks `problem.returns.type === "void"` ([trace-format.md §3, The return value](trace-format.md#the-return-value)), and the state panel then shows `returned, no value` with the kind `void` instead of `null`.

**The call stack.** A step is a list of frames (trace format v0.6 and later). The code highlight, the visual panel, and the locals table show the running frame, read through `topFrame(step)`. The state panel names the running function over the table (`Locals in maxDepth`) and lists no other frames: the calls are drawn on the canvas. In a return step, what the frame returns is shown on the running line (`returns [0, 1]`), not as a row of the table: it is not a local. The diff compares the running frame with the frame that has the same `id` in the previous step, so after a return the caller is compared with its own earlier self and the variable that took the returned value lights up. A caller's pointers into the heap are drawn as dashed rings on their nodes ([Section 6.5](#65-linked-structures-drawing)), and the canvas's calls card shows the stack ([Section 6.6](#66-calls)).

`result_heap` (the objects a `ref` result points to) is in the `Trace` type but nothing draws it yet. It arrives with the `object` / `ref` renderers.

A missing `truncated` is treated as `false`. A missing `result` is never shown as a wrong answer: the visualizer has no expected answer, so the row is muted, not red.

The loader also checks the minimal shape it needs to draw (`steps` is an array of objects with `line` and `locals`). It does **not** validate against the JSON Schema. Validation happens outside the sandbox, in the API service, before the frontend sees a trace (CLAUDE.md invariant 9). The frontend's job is to fail clearly, not to be the gatekeeper.

#### Tagged numbers
- `{"kind": "int", "value": "9007199254740993"}` is displayed by its string. `value` is never passed to `Number()`, so no digit is lost. Nothing in this version does arithmetic or comparison on a tagged int, so `BigInt` is not used yet. If a renderer needs it later (say, sorting by value), it converts there, and only there.
- `{"kind": "float", "value": "NaN"}` is displayed as `NaN`, `"Infinity"` as `∞`, and `"-Infinity"` as `-∞`. A whole float (v0.13) is displayed by its value, `3.0`, and its kind is `float`; `asNumber` reads it as a number where one is needed (a graph's node numbers, an interval's ends).
- A tagged int is never a valid array index, since it is beyond 2^53, so it never becomes a pointer marker.
- **Integer limits are written as powers of two**: 2147483647 is `2³¹−1`, −2147483648 is `−2³¹`, and 4294967295, 2^63 − 1, −2^63, and 2^64 − 1 likewise (`formatValue`). Dijkstra's `dist` and many DP tables start from one of them as "infinity", and ten digits in every cell hid the few that matter. They are values, not a language's names (`INT_MAX`, `Integer.MAX_VALUE`), so the rule holds for every language. Tooltips and the state panel's hover keep every digit (`fullValue`).

## 5. Renderer registry
A renderer is a component that draws one local's value for one step:

```ts
type Renderer = (props: {
  name: string;            // the local's name, used as the label
  value: Value;            // the value in this step
  diff: ValueDiff | null;  // null on step 0 and after a jump
  ctx: RenderContext;      // this step's locals, heap, the param's hint, and the operation chip's text
}) => JSX.Element;
```

It is a **pure function of its props**. It holds no state, never reads earlier steps, and draws correctly with `diff = null`.

The registry is two maps and a fallback:

```ts
byHint: Partial<Record<Hint, Renderer>>   // adjacency-list, edge-list, adjacency-matrix, intervals
byKind: Partial<Record<Kind, Renderer>>   // every container kind
fallback: Renderer                        // object, and any kind from a future version
```

**Selection order:** the reader's pick in the card's View menu, then the param's hint (from `problem.params`, if the local is a parameter and has one), then the value's `kind`, then the fallback. The first match wins, and a pick or a hint counts only when it fits the value at this step (`fits` in `render/views.ts`), so a hint that does not fit draws by kind instead of breaking. An unknown or future kind lands on the fallback instead of crashing (spec §9: "draw an unknown kind with a generic fallback").

The README's full order is "view as override, hint, kind, object shape, fallback". Object shape is how linked structures are drawn, by `LinkedCard`, outside the registry.

### 5.1 View as
A 2D array of numbers can mean several structures, and only the problem knows which (spec §4). Each one gets a drawing, and a card whose value more than one of them fits has a **View** button at the end of its header:

| View | Fits when | Drawing |
|---|---|---|
| By kind (`Grid` or `Rows`) | Always | The array as it is ([Arrays](#arrays)) |
| Graph (adjacency list) | Every value is the index of a row; or every entry is a pair `(v, w)` whose `v` is (Network Delay Time's weighted graph) | Node `i` for each row, an edge `i → v` for each `v` in row `i`, the weight beside it; one listed both ways (with the same weight) is a plain line |
| Graph (edge list) | Every row is `[u, v]`, or `[u, v, w]`, of node numbers; or a 1D array of such pairs (`vector<pair<int, int>>`) | A node for each number used, an edge per row, the weight beside it |
| Graph (adjacency matrix) | A square of 0s and 1s | An edge `i → j` for each 1 off the diagonal; a symmetric matrix has plain lines |
| Intervals | Every row is `[start, end]` with `start ≤ end` | One bar per row on a number line, the index on the left |

- **Where a card starts ("auto").** A parameter with a hint the adapter wrote (`edges` → edge list, `intervals` → intervals, `isConnected` → adjacency matrix, `graph` → adjacency list) starts on that view, and the header says "auto, from the name". Everything else, locals included, starts on the drawing by kind. Locals have no hints in the trace (`docs/hint-inference.md` §4.1), and the frontend does not guess one: the menu is how a reader turns a local `adj` into a graph.
- **The menu** lists every view, the ones that do not fit dimmed with the reason ("Needs a square of 0s and 1s"), so a reader learns why. It is fixed to the window under the button, since a card scrolls sideways and would clip it, and closes on Escape, Tab, a click outside, or a scroll. Arrow keys move between the views that fit.
- **An edge list's direction** is the problem's: Course Schedule's `[a, b]` means `b` before `a`, Number of Connected Components' pairs have none. The graph starts with no direction, and the menu adds a choice of `a → b`, `b → a`, or none.
- **A pick lasts for the run.** It is kept by the local's name in `VisualPanel` for the current trace and dropped when a new trace loads. It is UI state, not part of a step, so renderers stay pure; a pick that does not fit the value at some step draws that step by kind.
- **Highlights carry over.** A graph from rows rings the node a local points at (`u` in `graph[u]`) and lights the edge a read used (`graph[u][k]`, a pair `edges[i]`, a cell `isConnected[i][j]`); edges added since the previous step are green. Intervals take the diff colours per row, a local that indexes the array is a tag beside its row, and a read row is dashed. Every intervals card of a step shares one number line, so `merged` lines up under `intervals`.
- **Layout.** A graph from rows is placed from the value alone, in layers by distance from the smallest node of each connected part, so the same rows always give the same picture.

> **Key insight 1: a step's picture is a pure function of its own snapshot.** The renderer receives one step's value. The diff only decides which boxes get a colour. Remove the diff and the picture is still correct, which is what makes jump, rewind, and the scrubber free.

## 6. Renderers in this version

### 6.1 Containers

The canvas is a dot grid. At its top, a full-width strip reads "Line N runs next" (or "is returning"), styled like the editor's line highlight. Under it, every structure sits in its own **card** spanning the canvas: a rounded panel with a header of the variable's name, a muted kind label with its size (`hash map · 3`), and, on the right, an **operation chip** when this step changed it in one clear way. A card fades in and slides up the first time its structure is drawn, and fades out when it leaves scope.

| Kind | Renderer | Drawing |
|---|---|---|
| `array` | `ArrayRenderer` | Drawn by the value's shape ([Arrays](#arrays)): one contiguous strip of joined cells, the index under each and pointer tags under those ([Section 6.2](#62-pointer-markers)); a **grid** when it is an array of rows of plain values whose rows match; **rows** when they do not |
| `map` | `MapRenderer` | One row per entry, `key → value`. Header `hash map · N` |
| `multimap` | `MultimapRenderer` | One row per key, in order of first appearance, with that key's values side by side as chips |
| `stack` | `StackRenderer` | A vertical container open at the top, the top item first with a `top` tag beside it. Up to 6 items drawn whole; deeper, the top 3, a "⋮ N more" row, and the bottom 2 |
| `queue`, `deque` | `TubeRenderer` | A horizontal tube open at both ends, `front` and `back` under the ends. A queue's arrows point the way items flow; a deque's are double-headed |
| `list` | `ListRenderer` | Cells joined by two-way links, `front` and `back` under the ends |
| `priority-queue` | `HeapRenderer` | The binary heap its storage array forms (slot i's children are 2i+1 and 2i+2), with the storage-order row beside it and a `top` tag on the root. Header `priority queue · max · N` (or `min`, `custom`). Circles while every value fits in three characters; otherwise every node of that heap is a rounded rectangle sized to the widest value (a pair shows as `(3, 1)`). The tree is drawn up to 31 items; past that, the storage row alone |
| `tuple` | `TupleRenderer` | The elements inside faint parentheses, each with its position (0, 1, ...) under it |
| `set`, `multiset` | `SetRenderer` | Members inside faint curly braces, in the trace's order, never sorted. A multiset shows each value once with a `×N` badge |
| `object`, `ref` | `LinkedCard` | Not drawn per local: each linked structure of the step's heap is one card, and a local holding a `ref` becomes a pointer tag on its node ([Section 6.5](#65-linked-structures-drawing)) |
| an unknown kind | `FallbackRenderer` | The value as indented data in an inset box, with "There is no view for this kind yet, so it is shown as data." |
| primitives | none | Not drawn on the canvas. They appear in the state panel |

Everything on the canvas is **compact**: cells 34 px tall (40 px wide in an array, 36 × 30 in a grid), tree and graph nodes 34 px across, list nodes 58 × 32, recursion boxes 28 px tall, card padding 12 × 16, 13 to 13.5 px values. Text never goes under 10.5 px. The point is to fit more of a run on the screen at once.

#### Arrays
The drawing comes from the value's shape alone, never from guessing what the problem is (a DP problem cannot be told from its signature: `coinChange(vector<int>& coins, int amount)` looks like any array problem, and its table is a local):

| Shape | Drawing |
|---|---|
| A 1D array | One contiguous strip: joined cells, all one width (`cellWidth`: 40 px, or wide enough for the longest item, so Generate Parentheses' `"(())"` is not cut off) with a line between neighbours and one rounded border around the array, the index under each cell, pointer tags under those. A cell that changed gets an inset `--attention` ring (`--success` when added), so its neighbours keep their shared line. Items past the new length are drawn faded at the end for one step |
| An array of arrays of plain values (numbers, strings, chars, booleans, null, tagged numbers), every row the same length | A **grid** (`array · 6 × 4`): column indexes on top, row indexes on the left, the cells sharing 1 px lines. A local that indexes the outer array (`indexes` pairs it with it) is a tag on its row, left of the row index. Only the cells that changed are ringed: the renderer compares each changed row with its previous value (`diff.prev`) |
| The same, with rows of different lengths (an adjacency list), or no columns | **Rows** (`array · 4 rows`): one strip per row, all starting at the same place, row index and row tags to the left; an empty row is a dashed `empty` box |
| Anything else (rows of containers or refs) | One strip, each cell the item's text |

Whether a 2D local is a grid or rows is decided **once per run** (`raggedLocals`, computed when the trace loads, like the layout of linked structures): a local whose rows differ at any step is drawn as rows at every step. Level Order's `result` is `[[3]]` before it is `[[3], [9, 20]]`; without this it would start as a 1 × 1 grid and then turn into rows.

Column markers are not drawn: `indexes` pairs `i` with `dp` in `dp[i][j]` but records nothing for `j`, which indexes `dp[i]` ([trace-format.md §3, Indexes](trace-format.md#indexes)). What a line read is drawn instead ([Reads](#reads)).

#### Strings
A string local is a bare JSON string in the trace, and it is drawn like a 1D array of characters (`render/StringRenderer.tsx`): one joined strip, `string · 30` in the header, the index under each character, and the locals that `indexes` pairs with it as pointer tags under those, so Valid Palindrome's `left` and `right` walk in from both ends. Characters are bare letters (`R a c e`), since the card already says it is a string; a space is a dimmed `␣` (a tab `⇥`, a newline `↵`), so no cell looks empty. A `vector<char>` is an array and keeps its quotes (`'a'`).

- **A visible scrollbar.** A long string's strip always shows a thin scrollbar under it (styled with the theme's tokens), so it is plain that the string goes on.
- **Narrow cells.** 26 px instead of 40, so Valid Palindrome's 30-character example fits most canvases. A longer string scrolls sideways inside its card, and the strip scrolls itself to keep the pointers and the characters read in view; when they do not all fit (`left` at 0, `right` at 29), the characters the line read win.
- **Pointer tags do not overlap.** On cells this narrow, `left` and `right` one character apart would cover each other, so a tag goes on the first row where its pill is clear of the others (the same rule now places every array's tags).
- **Changes.** A character added at the end is ringed `--success`, one that changed `--attention`, and characters removed from the end fade out for one step, compared with the previous string (`diff.prev`).
- **Reads.** `s[left]` and `s[right]`, the two characters `tolower(s[left]) != tolower(s[right])` compares, are outlined like any read (trace format v0.11). In an array of strings, a read of a character (`words[1][2]`) outlines the string it is in.
- **Which strings get a card.** A trace writes a `char` and a one-character string the same way (spec §4), so a bare string is drawn as a string when the trace shows it is one at some step of the run: its length is not 1, it is a parameter of type `string`, `indexes` pairs a local with it, or a `read` targets it (`stringLocals`, computed once when the trace loads, like `raggedLocals`). `char c` never is, and a result built from `""` to `"a"` to `"ab"` keeps one card the whole time. A local string that is one character long for the whole run and never indexed stays in the locals table only.

#### Members
A step's `members` (trace format v0.12) are the `Solution`'s member variables: a memo table, a visited set, a result every call appends to. Every call sees the same ones, so they are drawn once, not per frame.

- **Cards.** A member container gets the same card as a local of its kind, after the running call's own cards and before the calls card, with a neutral `member` tag after its name. Its diff compares it with the previous step's members (`diff.members`), so `memo` filling as calls return is ringed like any map; a `read` whose target is a member (`memo[n]`, `memo.count(n)`) outlines the entry it found, and `indexes` can pair a local with a member array, so `dp[i]` draws `i` under the member `dp`.
- **A local hides a member.** When the running call has a local with a member's name, only the local is drawn, as in C++. A member string follows the string rule ([Strings](#strings)), minus the parameter case.
- **The state panel** lists every member, plain ones too (`int calls`), under a "Members of Solution" heading after the locals, with the same diff colours. One the running call hides is marked "hidden by a local".
- **Member pointers** (`ListNode* head` as a member) are pointer tags on their node like the running call's.

#### Reads
A cell or entry that the running line **read** gets a dashed `--accent` outline, for that step only. It comes from the top frame's `read` outcomes (trace format v0.10, spec §6), which `readsOf(frame)` groups by the local they read; `VisualPanel` hands each card its own (`ctx.reads`), and `render/reads.ts` turns them into lookups. Nothing is guessed from the code or the values.

| Read | Outlined |
|---|---|
| `at: [i]` of a 1D array | Cell `i` |
| `at: [r, c]` of a grid or of rows | The cell at row `r`, column `c` |
| `at: [r]` of a grid (`dp[i - 1]` passed or bound as a row) | The whole row `r`, one outline over it |
| `at: [r]` of rows | Row `r`'s strip |
| `key` of a map or multimap | That key's row |
| `key` of a set or multiset | That member |

The outline sits inside a cell's diff ring, so a cell that one line reads and writes (`dp[i] = min(dp[i], dp[i - c] + 1)`) shows both. A read is drawn on every step that has it, whatever the move was (a jump, a step back), because it is part of the step, not of the diff; only the diff colours wait for a one-step move forward. Backtracking needs nothing special: a step is drawn from its own top frame, so after a call returns, the caller's pop is a diff like any other and its next `nums[i]` is outlined like the first one. Reads are not chips in the state panel: the canvas shows them where they are.

The canvas draws, top to bottom: one card per linked structure of the step's heap, one card per other **container local** of the running frame (a tagged kind other than `int`, `float`, `ref`, and `object`) in the order the trace lists them, and, at the bottom, the calls card when one call made another ([Section 6.6](#66-calls)). A `ref` inside a container (a queue of nodes, a map from node to clone) shows its node's value, with the id on hover.

Items of a queue, deque, list, and set are keyed by their value and which copy of that value they are, so popping the front fades that item out and glides the rest forward, instead of every cell changing its value. A stack's items are keyed by their position from the bottom.

#### Operation chips
`render/ops.ts` names what one step did to a container, from its diff alone, in plain data-structure words: `push 3` / `pop 3` (stack, priority queue), `enqueue 9` / `dequeue 3` (queue), `push front 0` / `pop back 2` (deque, list), `insert 4` / `remove 3` / `move 3` (list), `insert "b"` / `erase "a"` / `erase one 3` (set, multiset), `insert 2` / `update 2` / `erase 2` (map), `insert (2, "to")` / `erase (2, "to")` / `erase key 3` (multimap). Never a language's method name (`push_back`), so nothing depends on the language. No chip when there is no diff, when nothing changed, when the step made more than one change, or for an array or tuple, whose values are assigned in place.

### 6.2 Pointer markers
An integer local becomes a pointer tag (a small accent pill under a triangle, `i`) under an array's cell when **both** hold:
1. The trace's `indexes` pairs it with that array in the running function: `indexes[frame.function][name]` lists the array's name ([trace-format.md §3, Indexes](trace-format.md#indexes)). The adapter reads that from the source: the code subscripts the array with an expression naming the local (`nums[i]`, `nums[mid + 1]`).
2. Its value is a bare integer `n` with `0 ≤ n < items.length` for that array.

An `iterator` local is also a marker, with no name rule: when its `container` is this array's own local name and its `index` is in range, it is drawn under that cell, labelled with its own name (`it`). The trace says which container it walks, so this is not a guess. An iterator at `end`, or into another container, gets no marker; the state panel shows it as `→ nums[2]`, `→ numMap[7]`, or `→ numMap.end()`.

There is no heuristic: no list of conventional names, no guess from values. In Subsets, `i` is drawn under `nums` only, because the code reads `nums[i]` and never `path[i]` or `result[i]`, and `start`, which only bounds the loop, gets no marker. `idx` or `pos` gets one when the code subscripts with it. A paired local that points past the end is not drawn, though it is still in the state panel; neither is any local when the trace has no `indexes`. Several markers on one box stack vertically. A marker is keyed by its name, so when `i` goes from 0 to 1 the same element slides to the next box instead of a new one appearing.

**A local that never changes is muted.** `dp[amount]` in Coin Change and `dp[m][n]` in LCS pair `amount` and `m` with `dp`, since the index is the local itself, but neither ever moves: they mark the answer's cell, not a position being walked. A local that holds one value at every step it is seen, in every frame of its function, and is seen at more than one step (`steadyLocals`, computed once per trace) is drawn as a grey pill instead of an accent one, so the moving pointers stand out and the marked cell is still shown.

This is not a hint. Hints are for what the adapter infers about a parameter ([trace-format.md §4](trace-format.md#4-problem-metadata)), and an index marker does not change how `nums` is drawn, only what is drawn under it.

### 6.3 Map order
`MapRenderer` lists entries in the order the trace gives them. It does not sort. Map order is unspecified and is real language behaviour (spec §8), so the frontend shows what the program saw. Diffs match entries by key, never by position. The same goes for `set`, `multiset`, and `multimap`.

### 6.4 Linked structures: layout
`layoutTrace(trace)` runs once when a trace is loaded. It reads every step's heap, joins objects linked by a `ref` field at any step into one **component**, and gives each node a fixed place for the whole run. A node appears where it stays, and when a link changes only the link moves. This is the one exception to "nothing earlier than the step before" (frontend/CLAUDE.md rule 2): a layout is a function of the whole trace, computed once, and drawing step N still reads only step N's heap and that fixed layout.

Each component gets a shape from its fields, never from the language:

| Shape | When | Layout |
|---|---|---|
| tree | Its nodes have a `left` or `right` field | A tidy tree: in-order across, children a row under their parent |
| list | Its nodes have a `next` field and no array field | One row per chain in link order: a node is placed after the node that first links to it |
| graph | Anything else (`neighbors`, arrays of refs) | Layers by distance from the first node (breadth-first, direction ignored, over every step's edges), each layer centred under the one above in the order its nodes were reached. A graph reads top-down from where a search starts; Clone Graph's square is a diamond |

A tree whose shape changes during the run (a node that moves under another parent, as in a rotation) cannot keep one place per node without overlaps, so it is marked **dynamic** and laid out from the step's own heap at each step; nodes glide to their new places.

A list keeps room on its right for a `null` box, and on its left too when, at some step, its leftmost node points at null while another node follows it (a list being reversed: the old head's `next` becomes null). The layout records this as `leftNull`, so the room is there for the whole run.

### 6.5 Linked structures: drawing
Each component present at the step is one card (`LinkedCard`). Its title is the running call's pointer into it, preferring a parameter (`head`, `root`, `node`), else any pointer into it, else `result` when it holds the returned node, else its shape; the meta line says `linked list · 5 nodes`, `binary tree · 5 nodes`, or `graph · 6 nodes · 7 edges`. A tree or graph is centred in its card; a list starts at the left.

| Element | Drawing |
|---|---|
| List node | A textbook node: a value cell, then a narrow `next` cell with a dot. Its `next` arrow leaves the dot |
| Tree or graph node | A circle with its `val` (or the first scalar field) inside. Values past 3 characters are drawn smaller, past 6 cut with `…` (the full value on hover) |
| List edge | To a node further right in the row: a straight arrow from the dot. Back to a node on the left (a list being reversed): down out of the dot, under the row, and up into that node |
| `next = null` | A dashed `null` box to the right of the node; to the left (reached under the row) for a leading node when the layout keeps room there; else a short stub with `null` under the node |
| Tree edge | Rim to rim, with a small arrowhead at the child |
| Graph edge | A link only one node lists is an arrow. A link both nodes list (each in the other's `neighbors`) is one plain line with no arrowheads |
| Other fields | A field other than the shape's primary ones (`random`, `prev`) is dashed and labelled. Two edges between the same nodes bend apart; a node pointing at itself loops above it |
| Depth guides | A tree has a dotted line through each level's centres, across the card, with the depth (0, 1, 2, …) at its right end |
| Pointer tag | Each `ref` local of the running frame is a tag above its node, keyed by name so it glides when the pointer moves. A list stacks a node's tags upwards. A tree puts them side by side, shifted away from the edge coming in (to the left over a left child, to the right over a right child). A graph puts them above a node with nothing linked from above, below a node with nothing linked from below, and otherwise above, shifted away from its upper links |
| Null pointers | A pointer local that is `null` is a tag with an arrow to a dashed `null` chip under the first structure (or in a card of its own when the heap is empty), only for names that point at a node at some step |
| Result | On the last step, the returned node and everything it reaches are drawn in `--done`, their links too, and the returned node gets a `result` tag |

Which nodes are highlighted comes from the pointers alone (`focusOf`):

- **Current** (`--accent`): the node(s) the running call is working on. These are its own working pointers (locals that are not parameters); when it has none, its parameters (maxDepth's `root`).
- **Being checked** (a dashed `--accent` ring, graphs only): when the running call's last-declared pointer is on a node another of its pointers links to, that node is being checked and the pointer linking to it is current. So `dfs(node)` looping over `nb`, and Clone Graph's `curr` and `neighbor`, show which neighbour is under consideration. The edge between them is blue.
- **Path**: a node a caller's frame points at gets a faint accent ring, and in a tree the edges from the root down to the current node and the callers' nodes are blue.

Highlights follow the heap diff (`heapDiff`, [Section 7](#7-diffing)): a new node flashes `--success`, a new or redirected edge is drawn in `--success` (and so is the dot it leaves), a node whose scalar fields changed flashes `--attention`, and a removed node fades out.

**An edge never lies on another.** Nodes keep their places for the whole run, so after Merge Two Sorted Lists links its two rows together, a straight line from the dummy (below both lists) to the top row's head would run through the second row's head and on top of the edge between the two heads, which read as one double-headed arrow. A straight edge whose line would pass through another node is bent around it instead (`crosses` in `render/HeapView.tsx`), in lists, trees, and graphs alike.

### 6.6 Calls
`callTree(trace)` runs once when a trace is loaded. A frame id belongs to one call for the whole run (spec §6), and the frame under it on the stack is its caller, so every call, its caller, its parameters and arguments (its locals on its first step), and its return value (from its return step) can be read from the steps. Drawing step N uses only what the tree says about step N.

When some call was made by another, one calls card sits at the bottom of the canvas, chosen by what the calls return (`callsCardKind`):

| The nested calls | Card | Shown |
|---|---|---|
| return values their callers use (`maxDepth`, `fib`) | the **recursion card** | at every step of the run |
| all return nothing: every return step's `return_value` is `null` (a void `dfs`, flood fill, backtracking) | the **call-stack card** | while more than one frame is live, and the top bar's "Call stack" switch is on |

A function that returns a null pointer every time looks like one that returns nothing; that is rare enough to accept.

#### The recursion card
Titled `calls`, with a Tree / Stack segmented toggle (a tree icon and a stack icon) at the top right and a legend under the header.

The **Tree view** draws every call that has begun as a compact rounded box (28 px tall) labelled `f(args)`, with what it returned after the name on the same line (`fib(3) → 2`) from its return step on. A box is as wide as its label and the value it will return, so it never resizes. Calls not yet begun are not drawn, so the tree grows as the run goes. The colour says where the call stands:

| State | Meaning | Look |
|---|---|---|
| running | The running frame | `--accent` border and tint |
| waiting | On the stack, waiting for a call it made | dashed `--accent` border |
| returning | The running frame at its return step, after making calls | `--done` border and tint |
| base case | The running frame at its return step, having made no call | `--attention` border and tint |
| returned | Finished | muted |

On the step a call returns, the edge to its caller turns `--done` with an arrowhead at the caller's end: **return to caller**. The head is a filled triangle drawn as its own shape, its tip on the caller's box, and the edge stops at its base; both ends of an edge leave vertically, so the head's axis is the line's own direction. (A stroked chevron as an SVG marker, with the line running to its tip, showed the line cutting through the head.) Edges down to calls on the stack are blue; edges to finished calls are muted.

A run of up to 80 calls is drawn whole, every call in a fixed place, and the drawing is sized for the run's whole tree from the first step, so the tree is centred in the card once and nothing slides sideways as calls appear. A lopsided tree (fib's `n - 1` side is the larger) has its root right of centre; that is the tree's real shape. A larger run is drawn **focused on the running call**: the calls on the stack, the calls each of them has made so far, and every finished branch folded into one box (`fib(7)` with `→ 13 · 41 calls` inside). A stack deeper than 14 keeps its top 3 and bottom 10 calls and folds the middle into one box (`⋮ 40 calls`). Either way the number of boxes stays small however deep the recursion goes. The tree scrolls inside the card, which scrolls to keep the running call in view.

The **Stack view** lists the calls on the stack, running on top, each as a row: the function, its arguments with their names (`root = 3`), `returns 0` on its return step, and its state at the right. No arrows. Deeper than 8, it shows the top 5, a `⋮ N more calls` row, and the bottom 2.

#### The call-stack card
Titled `calls` with the stack icon and `call stack · N`. One row per live frame, running on top: the call (`dfs(2)`: its arguments that are not containers, since containers have cards of their own), then what the call is working through, a short note, and its state (running, waiting, returning).

- **Neighbours.** A call is about the node its first pointer parameter holds. Its neighbours are that node's primary links in field order (a graph's neighbour list, a tree's children, a list's `next`), drawn as chips. While the call runs, the neighbour one of its own pointers is on is being checked (blue), and the ones before it are checked (muted); the note says `checking 4`. While it waits, the neighbour the call above it is about is waited on (dashed); the note says `waiting on dfs(4)`. At its return step every chip is muted.
- **No node.** A call about no node (backtracking over an array) shows its own working values instead (`i = 1`).

A frame that just began (in the step diff's `pushed`) arrives with a `--success` border and its callers glide down; a returning frame is `--done` for its return step and then fades off the top. Deeper than 8, the card shows the top 5, a `⋮ N more calls` row, and the bottom 2.

The structure card above follows along through the pointers ([Section 6.5](#65-linked-structures-drawing)): the running call's node is current, the neighbour being checked has a dashed ring, and the edge between them is blue.

### 6.7 Motion
Motion uses `framer-motion`. Nothing appears or disappears instantly: nodes, boxes, and labels fade and scale in and out, edges draw themselves in, pointer labels and items glide to their new places, and flashes fade over about 900 ms. Motion only describes the step before; drawing with no diff (step 0, a jump, moving back) shows the step without flashes. `MotionConfig reducedMotion="user"` turns movement off for anyone whose system asks for reduced motion.

### 6.8 Shared containers
Since v0.14 a container reached from two or more places in a step carries the same `id` at every place ([trace-format.md, Shared containers](trace-format.md#shared-containers)): `dp = [[0] * 3] * 3` is one row three times, and `first = dp[0]` is that row again. The cards keep drawing each place in full, as before; what the id adds is a note under each card that holds a shared container, naming every place that is the same one:

```
dp    array · 3 × 3                       first   array · 3
  0 │ 1 │ 0 │ 0 │                           │ 1 │ 0 │ 0 │
  1 │ 1 │ 0 │ 0 │
  2 │ 1 │ 0 │ 0 │                         ⛓ Same array: first · dp[0] · dp[1] · dp[2]
⛓ Same array: dp[0] · dp[1] · dp[2] · first
```

- **The places** come from `sharedPlaces(step)` (`trace/shared.ts`), once per step: the running frame's locals as their names and paths (`dp[0]`, `m[3]`, `an item of s`), a caller's with its function (`path (in backtrack)`), members as `memo (member)`, and a node's field as `Node.children (a node's field)`. The card's own places come first, and each name appears once (a recursion's callers often hold one list under one name).
- **Only the outermost of nested shared containers is noted.** Passing `grid` to `sink` shares each of its rows too, and the trace gives every row an id; a note per row would only repeat the one for `grid`. A container is left out when every place it is reached from lies inside a container that is itself shared. A row also held on its own (`int[] row = grid[0]`) has a place outside `grid`, so it keeps its note.
- **One line per shared container**, named by its kind ("Same array", "Same map"), at most five places with "+N more" and the full list in the tooltip.
- **No new colour.** A write through one name changes every place, and the diff already flashes each one, so `dp[0][0] = 1` lights up all three rows; the note says why.
- **The id is identity, not content.** `canonical` leaves a container's `id` out, so a list that becomes shared at a step is not "changed" by that. A `ref`'s `id` is kept: it is what the ref is.
- **Adapters that cannot tell write no ids** (the C++ adapter, for now), and then no note appears.

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
- **Indexed kinds** (`array`, `stack`, `queue`, `deque`, `priority-queue`, `tuple`): per index. An index past the old length is `added`, past the new length is `removed`, otherwise `changed` or `same`. A queue and a deque are then coloured by count, so items that only shifted are not coloured. A priority queue stays per slot: a sift moves values through slots, and the changed slots show its path.
- **`list`**: matched in order by the longest common subsequence (`matchInOrder`), because a list has no node identity. A push at the front is one `added` item, not every slot `changed`. An item that left one place and appears in another is `changed` (moved). Past 250,000 cells of the matching table (about 500 × 500 items), it falls back to per index.
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
| changed (or moved) | `--attention` border and tint, with a short flash |
| removed | Drawn faded and dashed (old value) for this step only, or faded out by motion. Gone on the next step |

The state panel uses the same colours on its rows.

## 8. Playback semantics
The player holds `{ index, cameFrom, playing }`. All transitions are a pure reducer in `player/playback.ts`. The Run timer lives in `usePlayer`.

| Input | Effect |
|---|---|
| Restart | Go to step 0 of the same trace and play. The code does not run again |
| Home | Pause, go to step 0 |
| ◀ Previous / ← | Pause, go back one step (stays at 0) |
| ▶ Play / Space | Start advancing from the **current** step. At the last step, restart from step 0 |
| ⏸ Pause / Space | Stop where it is. Play again continues from there |
| ▶ Next / → | Pause, go forward one step (stays at the last) |
| ⏭ Last / End | Pause, go to the last step |
| Scrubber | Pause, go to the chosen step |
| Speed | 0.5×, 1×, 2×. 1× is 700 ms per step. Takes effect on the next tick |

- Play advances one step per tick and **stops by itself at the last step**.
- The counter reads `Step 5 / 9`: steps counted from 1 over the number of steps, so a nine-step trace runs from `Step 1 / 9` to `Step 9 / 9`. The trace's `step` field counts from 0; the page adds one for people.
- Cmd + Enter (Ctrl + Enter off the Mac) runs the code from anywhere, the editor included.
- Keyboard shortcuts are ignored while focus is in the editor or in a form control, so typing a space in the code never toggles Run.
- Every button has an `aria-label` and a tooltip (`title`) naming its shortcut.

> **Key insight 2: the player only moves an index.** It never computes state. Drawing step N reads `steps[N]`, and the diff reads `steps[N-1]` and `steps[N]`, nothing earlier. There is no replay path to get wrong.

## 9. State panel
- **Header:** `Step N of M`, counted from 1 like the playback bar, with a thin progress bar, plus a `truncated` badge when the trace sets `"truncated": true`, whose tooltip names the limit.
- **The running line:** a muted `Line i` pill, the statement on that line as written (trimmed, cut with `…` when long), an arrow, and a chip for what the line produced. The statement comes from the code the run was made from, kept with the run's result, so editing the code afterwards does not put other text beside the trace's line numbers.
- **Chips** come from the top frame's `outcomes` (trace format v0.8, spec §6) in order, except reads, which are drawn on the canvas ([Reads](#reads)): a condition is a green `true` or a muted red `false` (the condition's code on hover); a store is `name = value`. In a return step the chip is purple: `returns [0, 1]`, or just `returns` for a function that returns nothing (every return step of it has `return_value: null`, `voidFunctions`). A line with nothing recorded shows the pill and the statement only, so traces from adapters that do not record outcomes yet still read well.
- **Locals:** `Locals in twoSum`, then a full-width rounded table: Name, Kind, Value. The kind of a bare number is `int` when it is an integer and `float` otherwise; strings, booleans, and `null` show `string`, `bool`, and `null`. A `ref` shows its node's value (`→ 7`), with the id on hover, so the table never shows heap ids.
- **Rows** use the diff colours: an added local has a green bar and tint, a changed one amber. A local that went out of scope is shown faded with its last value and `out of scope` beside it, for one step.
- **Returns and result:** what a return step returns is only the purple chip on the running line; the table lists locals, and a return value is not one. On the last step, `result` is a purple row under the locals; a void method shows `returned, no value`; a run that did not finish says why, muted (never as a wrong answer).
- **Output:** when the program printed something (`cout`, and `cerr`: the API returns both as `output`), a tab bar replaces the `Locals in …` title: `Locals in twoSum` | `Output`. Output shows everything the program printed during the whole run, in a monospace box with "Everything the program printed, for the whole run." over it: the API returns the output of the run, not of each step, so it does not change with the step. A run that printed nothing has no tabs. The tab picked stays across runs; a run with no output shows the locals.
- **While a run is going:** "Waiting for the trace" in place of "No trace yet".
- The state panel lists no calls: the canvas draws them ([Section 6.6](#66-calls)).

## 10. Language select
The select (C++, Python, Java) is a **UI input**. It changes the Monaco language mode and the starter, and is sent as `language` with the signature and run requests, where it picks the backend's driver and sandbox image ([`backend.md`](backend.md) §2). No renderer, diff, or state code reads it, and nothing reads `trace.language` (CLAUDE.md invariant 2).

| Selected | Editor | Visual panel |
|---|---|---|
| C++, Python, Java | The bare Two Sum `Solution` in that language | "Run your code to see it here.", until a run |

A language whose adapter does not exist yet would show "Only C++, Python, and Java can run so far." with the inputs disabled (`canRun`, `RUNNABLE` in `editor/languages.ts`); today every language in the select runs.

Switching language replaces the source with that language's starter. The language picked last is remembered for the browser tab (`sessionStorage`, key `lcv-language`), so the bare sandbox opens in it again; an example link opens in its own language. The editor is editable. Editing does not change the trace until Run code is pressed again; until then the highlighted line still comes from `step.line`, so it may point at a different line of text.

### 10.1 Inputs and runs

The inputs panel turns the pasted Solution into a form ([`backend.md`](backend.md) §2.2):

1. **The signature.** 400 ms after the source stops changing, `POST /api/signature` returns the public methods, each parameter's name and neutral type, and the method to preselect. A request still in flight when the source changes again is cancelled. If the new source cannot be read, the last good fields stay, with the error above them, so typing does not make the form flicker.
2. **The fields.** One per parameter of the chosen method, labeled with its name and neutral type (`nums array<int>`), with LeetCode's notation for that type as the placeholder (`[1,2,3]`, `[3,9,20,null,null,15,7]`). For the starter's own method, `twoSum`, the placeholders are Two Sum's example (`[2,7,11,15]`, `9`), ghost text that goes as the user types. An extra such as `pos` is an optional field. A method picker appears only when the Solution has several public methods. A value typed earlier is kept when the signature changes but the field still exists.
3. **Paste a LeetCode example.** Pasting the whole example block from the problem page (`Input: ... Output: ...`) into the box under the fields fills them at once: by name, or in order when none of the names match (Clone Graph's `adjList` for the parameter `node`), as the driver does. A note says which fields were filled. "Fill fields" under the box does the same for an example edited by hand. An example is the whole input, so an optional extra it leaves out is emptied: a `pos = 1` kept from Linked List Cycle would otherwise turn the next problem's list into a cycle, which ran Remove Nth Node to the step cap and made Middle of the Linked List fail with "pos = 1 is not an index of head" (`clearedExtras`).
4. **Run code** is in the top bar (and Cmd/Ctrl + Enter). Disabled until every required field has a value; the inputs panel says why ("Fill in target."). It sends the source, the language, the method, and the fields to `POST /api/run`, and shows a spinner meanwhile. The canvas shows the run is going (`RunningCanvas`): a line of trace points drawing itself on a loop, "Running your code in the sandbox", and "Compiling it, tracing every step, and checking the trace". The run is one request, so no stage is named as the current one. With reduced motion the line is drawn whole and still. A trace that comes back goes through the loader and replaces the last one in the player, which restarts at step 0. A failure shows a red card in the inputs panel with its stage as a heading ("The code does not compile") and the message, such as Clang's error with the line. A successful run adds nothing to the inputs panel: the canvas shows it.

### 10.2 The Examples menu
The top bar has an **Examples** button beside the language select (`components/ExamplesMenu.tsx`), and the Call stack switch sits at the right, beside the theme button. Mockups: the design canvas, Round 4.

```
┌──────────────────────────────────────────────────────────────────────────┐
│ eye LeetCode Visualizer │ [C++ ▾] [▦ Examples ▴]      [Call stack ●] ☀ ▶ │
│                          ┌─────────────────────────────────────┐         │
│                          │  C++   Python   Java                │  tabs   │
│                          │  Hashing       Two Sum   array · map│         │
│                          │  Two pointers  Container With ...   │  eight  │
│                          │  ...           ...                  │  topics │
│                          │  Opens the Solution in Java ...     │         │
│                          └─────────────────────────────────────┘         │
└──────────────────────────────────────────────────────────────────────────┘
```

- **Tabs** C++, Python, and Java across the top; the menu opens on the editor's language. Left and right arrows move between tabs, up and down between problems, Escape closes, and so does a click outside.
- **Eight problems**, one per topic: Hashing (Two Sum), Two pointers (Container With Most Water), Stack (Valid Parentheses), Linked list (Reverse Linked List), Tree (Maximum Depth of Binary Tree), Graph (Course Schedule), Backtracking (Subsets), DP (Unique Paths), each in all three languages (`home/examples.ts`, copied from the manual suite, [Section 12.3](#123-examples)).
- **Picking one** opens `#/sandbox/<slug>/<language>`: a fresh sandbox in that language, the Solution in the editor and the example in the inputs, filled once, not run. Picking the example already open starts it fresh too.
- **The user's own code is not lost without asking.** When the editor holds anything other than the starter or example it was given, picking an example opens a dialog, "Replace your code with Two Sum?", with Keep my code and Replace (focused). Escape or a click outside keeps it.

## 11. Theme tokens
Two themes, dark (the default) and light, with the same tokens and meanings. Every colour is a CSS variable in `src/styles/theme.css`, and components use only the variables. The theme is the `data-theme` attribute on `<html>`: `:root` holds the dark values and `:root[data-theme="light"]` the light ones, so switching is one attribute and nothing re-renders to change colour.

**Which theme.** A first visit follows the system's setting (`prefers-color-scheme`), and so does a change to it while the page is open. The top bar's button switches theme: it shows a sun on the dark page and a moon on the light one, the theme it switches to, and its label says so ("Switch to the light theme"). Once pressed, the choice is remembered in this browser (`localStorage`, key `lcv-theme`) and wins over the system's setting. A small script in `index.html` sets the attribute before the page draws, with the same rule, so the page never flashes the other theme. Storage can be blocked; then the choice lasts until the page is closed.

The dark theme: a blue-tinted dark with calm, slightly desaturated colours.

| Token | Value | Used for |
|---|---|---|
| `--bg` | `#0b0e14` | Page and canvas |
| `--bg-subtle` | `#0f131b` | Panels and bars |
| `--bg-raised` | `#121722` | Cards, tables, secondary controls |
| `--bg-inset` | `#0d1118` | Editor, inputs, cells |
| `--bg-control`, `--bg-control-on` | `#161c28`, `#1f2838` | Secondary buttons; a pressed segment and the play button |
| `--grid-dot` | `#252c3a` | The canvas's dot grid |
| `--border`, `--border-strong`, `--border-subtle` | `#1f2633`, `#262e3d`, `#1a2030` | Cards and tables; controls and cells; between panels |
| `--edge` | `#4a556b` | Arrows and edges, editor line numbers |
| `--fg`, `--fg-soft`, `--fg-muted`, `--fg-faint` | `#e4e8f0`, `#c6cedd`, `#8a93a6`, `#5a6479` | Text, secondary text, labels, placeholders |
| `--accent`, `--accent-strong`, `--accent-fg`, `--on-accent` | `#7aa5f5`, `#5f86cc`, `#9dbdf8`, `#0b0e14` | Current, focus, primary; primary while busy; accent text; text on accent |
| `--success`, `--success-fg` | `#5cc08a`, `#8fd8ad` | Diff: added; a true condition |
| `--attention` | `#d9ab5c` | Diff: changed or moved |
| `--danger`, `--danger-fg` | `#e07a7a`, `#eeb0b0` | Errors; a false condition |
| `--done`, `--done-fg` | `#a995e8`, `#cfc3f5` | Result, returning |
| `--line-highlight` | `rgba(122, 165, 245, 0.1)` | The current line |

`--knob` is a switch's knob, and `--card-shadow` is a card's lift off the canvas, the one token that is a shadow rather than a colour.

**The light theme** keeps every token's hue. Text and lines have their lightness mirrored (`--fg` `#e4e8f0` becomes `#0f131b`). The accents are not mirrored, which would make them nearly black, but deepened to a target contrast on white, so they still work as fills and tints: about 4.9:1 for `--accent`, 7:1 for each `-fg` text colour, 4.6 to 4.8:1 for `--danger` and `--done`, and 3.4:1 for the diff colours `--success` and `--attention`, which are bars, rings, and tints, never text. Amber is deepened the most. One deliberate difference from a mirror: cards stay the lightest surface, white (`--bg-raised`) on a light grey canvas (`--bg` `#edf0f5`), because a mirror would make what is raised darker than the page.

| Token | Light value |
|---|---|
| `--bg`, `--bg-subtle`, `--bg-raised`, `--bg-inset` | `#edf0f5`, `#f5f7fa`, `#ffffff`, `#f8f9fb` |
| `--bg-control`, `--bg-control-on`, `--grid-dot` | `#eaedf3`, `#dde2ec`, `#c1c8d7` |
| `--border`, `--border-strong`, `--border-subtle`, `--edge` | `#d4dae5`, `#c3cbda`, `#dce1ec`, `#808ea8` |
| `--fg`, `--fg-soft`, `--fg-muted`, `--fg-faint` | `#0f131b`, `#222a39`, `#596275`, `#7a859c` |
| `--accent`, `--accent-strong`, `--accent-fg`, `--on-accent` | `#336cd8`, `#6187ca`, `#2254b2`, `#ffffff` |
| `--success`, `--success-fg`, `--attention` | `#349d65`, `#277547`, `#b88021` |
| `--danger`, `--danger-fg`, `--done`, `--done-fg` | `#ca4949`, `#a93131`, `#7a60ca`, `#5f40bf` |
| `--line-highlight`, `--knob` | `rgba(51, 108, 216, 0.09)`, `#ffffff` |

Syntax colours for the editor are five extra variables in the same file (`--syntax-keyword`, `--syntax-string`, `--syntax-number`, `--syntax-comment`, `--syntax-type`), kept soft so the line highlight stays the loudest thing. Bracket pairs are not coloured.

The Monaco theme (`monaco.editor.defineTheme`, base `vs-dark` or `vs` to match the page) is built by reading these variables with `getComputedStyle`, at startup and again each time the theme changes, so the editor and the page cannot drift apart. In the light theme the syntax colours reach at least 4.8:1 on the editor's background, and comments 4:1. Monaco accepts only hex colours, so `rgba(...)` values are converted to `#rrggbbaa` first.

Fonts: Geist for text and Geist Mono for code and values, bundled from npm (`@fontsource-variable/geist`, `@fontsource-variable/geist-mono`, SIL Open Font License) and imported in `main.tsx`, so no font is fetched from a CDN. The editor re-measures its glyphs once the fonts have loaded.

## 12. Home page
The first version of the home page (2026-11-18). It is the default route, and the page a visitor lands on.

### 12.1 Routes
The page is chosen by the URL's hash (`src/route.ts`): no router dependency, no rule on the server (every path serves the same `index.html`, and the hash never reaches the server), and the back button and shared links work because the hash is part of the URL.

| Hash | Page |
|---|---|
| none, `#`, `#/`, or anything unknown | The home page |
| `#/sandbox` | The sandbox, on the bare Two Sum Solution, as before |
| `#/sandbox/<slug>` | The sandbox with an example's C++ Solution in the editor and its example in the inputs ([Section 12.3](#123-examples)); a slug that names no example opens the bare sandbox |
| `#/sandbox/<slug>/<language>` | The same in `cpp`, `python`, or `java`: what the Examples menu opens ([Section 10.2](#102-the-examples-menu)). Any other language is the home page |

`App.tsx` is only the switch, inside `MotionConfig`. The sandbox moved to `Sandbox.tsx` and is loaded with `React.lazy`: it carries Monaco, most of the bundle, so the home page loads about 0.5 MB of script and the editor arrives only when the sandbox is opened. The sandbox is keyed by the example and its language, so following a second example link starts a fresh sandbox. The window title is "LeetCode Visualizer" on the home page and "LeetCode Visualizer · Sandbox" in the sandbox. The top bar's logo and name link home.

### 12.2 Layout
The page scrolls (the sandbox does not), inside `.home`, since `body` never scrolls. Top to bottom:

```
┌──────────────────────────────────────────────────────────────────────────┐
│ eye LeetCode Visualizer  Examples How it works Languages  ☀ [Sandbox]   │  sticky, 52 px
├──────────────────────────────────────────────────────────────────────────┤
│                               ( ● v0.1.0 )                               │
│                         Watch your Solution run,                         │  the pitch,
│                           one line at a time.                            │  centered
│              lede · [Paste a Solution] [Try an example]                  │
│                         ● C++, Python, and Java.                         │
│ ┌──────────────────────────────────────────────────────────────────────┐ │
│ │ ● ● ●  Reverse Linked List                              Step 12 / 30 │ │
│ │ code, running line highlighted │ the sandbox's canvas, same step     │ │  the preview
│ │ ‹  ❚❚  ›  ───────────                    A real trace, drawn by ...  │ │
│ └──────────────────────────────────────────────────────────────────────┘ │
├──────────────────────────────────────────────────────────────────────────┤
│ Start from an example        eight cards, three to a row                 │
├──────────────────────────────────────────────────────────────────────────┤
│ How it works   1 Solution + example › 2 sandbox › 3 trace › 4 canvas     │
├──────────────────────────────────────────────────────────────────────────┤
│ Languages      ● C++ available   ● Python available   ● Java available   │
│ eye · LeetCode Visualizer · Apache License 2.0      <> GitHub  ✉ email   │
└──────────────────────────────────────────────────────────────────────────┘
```

- **The bar.** The brand at the left, links to the three sections in the middle (Examples, How it works, Languages), and the theme button and "Open the sandbox" at the right. The links scroll to their section; they never set a `#anchor`, because the hash is the route. Under 860 px the links are hidden.
- **The pitch is centered**: the version badge, the title on two lines, the lede, the buttons, and the language note. The page has no large logo; the logo is in the bar and the footer.
- **The version badge** shows the app's version with the same green dot as the languages note ("C++, Python, and Java"). It is `version` in `frontend/package.json`, put in at build time (`__APP_VERSION__` in `vite.config.ts`), so `package.json` is the one place to change it. It is the app's version, not the trace format's (`v0.13`).
- **The footer** has the logo, the name and licence, and links to the GitHub repository and the author's email.
- **The two calls to action.** "Paste a Solution" (primary) opens `#/sandbox`; "Try an example" scrolls to the examples. The bar's "Open the sandbox" is the same as the first.
- **The preview** (`home/Preview.tsx`) replays the Reverse Linked List golden trace (`fixtures/reverse-list.trace.json`) with the same `VisualPanel` the sandbox uses, beside its source (`fixtures/reverse_list_trace.cpp`) with the running line highlighted the way the editor highlights it. It plays by itself (1.1 s a step, a 2.6 s pause on the last step, then from the start), and the reader can pause or step it; stepping pauses it. With the system's "reduce motion" setting on it waits for the play button. It is at the page's full width, because a linked list of five nodes needs about 700 px; under 640 px the canvas is drawn at 70% (`zoom`, which shrinks the layout too, unlike a transform) and the code sits above it.
- **Logo.** The author's eye, two files in `src/assets/` (white for the dark theme, black for the light one). `components/Logo.tsx` puts both in the page and CSS shows the one for `data-theme`. It is in the home page's bar and footer, and replaces the earlier rising-line mark in the sandbox's top bar.
- **Theme.** The bar has the same theme button as the sandbox, and every colour comes from the tokens ([Section 11](#11-theme-tokens)): no new token was needed.
- **Below 1040 px** the four "how it works" steps go two to a row; **below 640 px** one, the bar drops the name, and the title shrinks so its first line stays whole.

### 12.3 Examples
`home/examples.ts` lists eight problems, one per topic, the same eight as the sandbox's Examples menu ([Section 10.2](#102-the-examples-menu)): Two Sum, Container With Most Water, Valid Parentheses, Reverse Linked List, Maximum Depth of Binary Tree, Course Schedule, Subsets, and Unique Paths. Each has its Solution in C++, Python, and Java. Each card shows the title, the difficulty, one sentence on what to watch, and tags in the canvas's words, and opens the C++ version; the menu opens the others.

- **Copied from the manual suite.** Each example's code and `Input:`/`Output:` text, in each language, are the verbatim text of its case in `docs/manual-test-suite.md`, so every one is known to run. `examples.test.ts` reads the suite and fails if they drift apart.
- **A link preloads, it does not run.** The sandbox opens with the Solution in the editor and the example text in the inputs panel's box, and fills the fields from it once (the same call as pasting, so the note says "From the example, … were filled"). The reader presses Run code. Running on arrival would spend a sandbox run on every click, including clicks from someone only looking.

## 13. Out of scope
Planned for later versions, not designed here:
- Design problems (LRU Cache, Min Stack), whose example is a sequence of calls.
- Several examples at once (one run and one trace each).
- Hints for locals, and a "view as" for structures other than 2D arrays of numbers (a `vector<vector<pair<int, int>>>` weighted graph).
- Laying out graphs larger than about 30 nodes well. Layers by distance are readable, not pretty.
- On the home page: a picture of each example's canvas on its card.

## 14. Design questions

> **Q1. Why is the diff shown only after a one-step move forward?** A diff answers "what did this line just do?". That question only makes sense when the previous displayed step is the one before it. After a jump from step 0 to step 7, colouring everything that differs would highlight work done by six lines at once, which looks like a single change and misleads. Showing nothing is honest, and it keeps the rule simple: diff iff `cameFrom === index - 1`.

> **Q2. Why not diff backwards when stepping back?** Going from 5 to 4 could show `[2, 0]` as "removed", but it was never removed in the program. The colours describe what the program did, so they only run forwards.

> **Q3. Why do pointer markers come from the trace's `indexes` instead of a list of conventional names?** The first version used a fixed list (`i`, `j`, `left`, `mid`, ...), and it was wrong in an obvious way: any listed integer that fit drew a marker under every array, so Subsets showed `i` and `start` under `nums`, `path`, and `result`. Knowing which array an index belongs to means reading `nums[i]` in the source, which is language knowledge the frontend must not have. The adapter already reads the source, so since trace format v0.9 it records the pairing (`indexes`), and the frontend draws exactly that.

> **Q4. Why does the language select not filter traces by `trace.language`?** Because then the frontend would branch on `language`, which the spec forbids. The select picks what to *ask for* (today a fixture, later a run). Whatever trace comes back is drawn the same way regardless of what produced it.

> **Q5. Why import the trace as text instead of as a JSON module?** A real trace will arrive as a response body. Importing text and calling the loader's `JSON.parse` exercises the same path, including the version check and the rejection of bare `NaN`.

> **Q6. Why does the frontend not validate against the schema?** It would need a schema validator dependency, and it is the wrong place: the API service validates outside the sandbox before a trace reaches the browser. The loader checks only what it needs to draw and fails with a clear message otherwise.

> **Q7. Why read the theme from CSS variables instead of writing the Monaco theme by hand?** One source of truth. If a token changes in `theme.css`, the editor follows it. The cost is a small colour conversion, since Monaco does not accept `rgba(...)`.

> **Q8. Why show the method name as the title?** A bare `Solution` class does not know which problem it solves, so `problem.name` is optional (spec §4). `problem.method` is always present, and it is what the user wrote, so it is the honest fallback. Nothing tries to guess a problem name from it.

> **Q9. Why is a missing result muted instead of shown as an error?** A missing `result` means the method never returned, not that the answer was wrong (spec §3). An infinite loop that hits the step limit is often exactly the bug the user came to see, and its trace is still worth stepping through.

> **Q10. Why lay out linked structures from the whole trace, when every step is a snapshot?** A layout computed per step would move every node whenever a link changed: reversing a list would redraw it backwards at each step, and the user would lose track of which node is which. Fixed places make the change visible as the one thing that moved. The layout is still pure (a function of the trace, computed once), it never replays steps to build state, and every node, edge, and label drawn at step N comes from step N. A tree whose shape changes is the one case laid out per step, because fixed places would overlap.

> **Q11. Why a recursion tree instead of only a call stack?** A stack shows the calls in progress, but recursion that returns values is understood by its branching: which calls a call made, what each returned, and where the base cases are. The tree shows all of that and still contains the stack, as the highlighted path from the root to the running call; the card's Stack view is there for when only the stack matters. The state panel shows the running frame's locals only.

> **Q12. How does a deep or wide recursion stay readable?** By folding, not shrinking. Up to 80 calls fit whole. Beyond that only the path to the running call is drawn in full; a finished branch is one box with its result and its size, and the middle of a very deep path is one `⋮` box. The number of boxes grows with the depth shown, not the size of the run, so `fib(25)` draws about as many boxes as `fib(10)`.

> **Q13. Why framer-motion instead of CSS transitions?** CSS can fade a box in, but it cannot fade out an element React has already removed, glide an item to a new place in a list, or draw an SVG path in. framer-motion's `AnimatePresence` and `layout` do those three, and it was already approved. CSS still does the flashes.

> **Q14. Why two calls cards, chosen by return value?** A call that returns a value hands its answer up to its caller, and the tree is where that hand-off shows: each box holds its result, and the return-to-caller arrow shows it moving up. A call that returns nothing (a void DFS, a flood fill, backtracking) does its work on data structures instead; its tree would be a column of boxes with nothing inside them. What matters there is where each call is in its own loop (which neighbour it is checking, which call it is waiting on), so the call-stack card shows that, next to the structure it is walking. The trace already says which is which: a void call's return step has `return_value: null`.

> **Q15. Why does "being checked" use the last-declared pointer?** The frontend sees only pointers, never the loop that set them. In the searches it is meant for, the pointer that walks the neighbours is declared inside the loop, after the pointer to the node being expanded (`for (Node* nb : node->neighbors)`, or `curr` then `neighbor`), so it is the last one. When that pointer's node is linked from another pointer's node, the pair reads as "expanding this node, looking at that neighbour". When it is not, nothing is marked as checked, which is wrong only by saying less. A hint from the adapter could replace the guess later.

> **Q16. Why is a return step's value on the running line and not a `returns` row in the locals table?** The table answers "what variables does this call have now?", and a return value is not a variable: it exists only for the moment the call hands it back. The running line already answers "what did this line produce?" with a chip (`returns [0, 1]`), so a row said the same thing twice, in a place that suggested it was a local. The run's `result` keeps its row on the last step, because it is the answer to the whole run and has no line of its own.

> **Q17. Why does the Output tab show the whole run's output instead of what was printed up to the step?** The API returns the program's output once, for the whole run, and the trace says nothing about when each line was printed. Showing it per step would mean guessing. The tab says so in plain words. Per-step output would need the trace to record prints, a format change that can come later if it is wanted.

> **Q18. Why are light cards white on a grey canvas, when the light theme mirrors the dark one?** The decision was to mirror lightness and keep hue. Done literally for surfaces, the canvas (darkest in the dark theme) becomes the lightest, and cards become darker than the page they sit on, so a raised card looks sunk. Surfaces keep their meaning instead: the nearer something is, the lighter it is in the light theme, as cards are in most light interfaces. Text, lines, and accents keep the mirror's intent (same hue, contrast reversed).

> **Q19. Why is a 2D array a grid by its shape, when the frontend must not guess a view (invariant 11)?** A hint says what a value *means* (an adjacency list is a graph), and that is the adapter's to infer. A grid is not a meaning: an array of equal rows of plain values is a table whatever the problem is, a DP table, a matrix, a board, the rows of an edge list. Drawing it as a grid only lays out what the value already is, the way a 1D array is a strip. Rows that differ are drawn as rows, so nothing is padded or invented. Turning the same value into a graph, or a list of intervals, still needs a hint.

> **Q20. Why are the cards compact?** Recursion trees, DP tables and graphs need room, and at the first sizes (44 px cells, 46 px recursion boxes) a fib(5) tree or a 6 × 4 table did not fit the canvas. Everything shrank to about 75%, the same for every card so the canvas stays one system; text stays at 10.5 px or more. A density switch was considered and left out: one size that fits is simpler than a setting.

> **Q21. Why are reads outlined on the canvas and not listed as chips?** A read says where a value came from, and a place is better shown than written: `dp[2][3]` as a chip makes the reader find row 2 and column 3, while an outline is already there. A chip row for LCS would also grow to three or four entries on every step and push out the conditions and stores, which are what the line *did*. The outline is dashed, and in the accent colour, so it does not look like a diff: amber and green mean changed and added, and a read changes nothing.

> **Q22. Why draw a string as cells, when a trace writes it as one value?** The algorithms that use strings treat them as arrays: two pointers in Valid Palindrome, a window in Longest Substring, a character at a time in Generate Parentheses. Shown as one line of text, nothing points at anything and the reader cannot see which characters a line compares. The trace already pairs `left` and `right` with `s` (v0.9 `indexes`) and records the characters read (v0.11), so the string card only draws what the trace says. The cost is one rule for telling a string from a `char`, which the trace cannot say directly; the rule only adds cards, so at worst a short string stays in the locals table.

> **Q23. Why a tag on a member's card instead of a separate "Solution" section?** A memo table is a map, and the reader already knows how a map card reads; a section around it would add a frame and a heading for one or two cards, and push the running call's own cards apart from the calls card they belong with. The tag says the one thing that differs, that every call shares this one, and the state panel, which has room for words, groups the members under a heading.

> **Q24. Why does a dimmed view stay in the menu instead of being hidden?** A menu that shows three options for one array and two for the next looks broken, and the reader cannot tell whether "Graph (adjacency matrix)" exists. Keeping it, dimmed, with "Needs a square of 0s and 1s", says both that it exists and why this value is not one, which is also a small lesson about the shapes.

> **Q25. Why do locals start on the drawing by kind instead of following a hinted parameter?** Course Schedule's `adj` looks like an adjacency list because of how the code fills it, which the frontend cannot see; a rule like "a local whose rows look like a hinted parameter's gets its view" would be a guess made where guesses are not allowed (CLAUDE.md invariant 11). The kind drawing is always true, and one click turns it into a graph. Hints for locals, inferred by the adapter, are the clean way if this proves too many clicks.

> **Q26. Why a hash route instead of a router library or state in `App.tsx`?** State in `App.tsx` would need no dependency either, but the URL would not change: the back button would leave the site, and an example could not be linked to. A router library gives real paths, which need the server to answer every path with `index.html`, and it is a dependency for two pages. A hash route is twenty lines, has neither cost, and can be replaced by a router later without changing a link's meaning.

> **Q27. Why does the home page replay a golden fixture, when only tests import fixtures?** The rule exists so the sandbox never opens on a canned trace and fixtures are never copied into `frontend/`. Both still hold: the sandbox opens with no trace, and the preview imports the fixture from `../fixtures` like the tests. A drawing of the canvas would have to be redrawn by hand whenever a renderer changes and could show things the canvas does not do; the golden trace through the real `VisualPanel` is always exactly what the sandbox draws, and CI already checks the trace against the schema.

> **Q28. Why does an example link not run the example?** A run takes a few seconds of sandbox time and holds one of the visitor's slots. Many visitors click an example to see what it is, and the trace is one button away; the field note and the filled inputs say the example is ready.

> **Q29. Why a note under the card, and not lines between the places, or one card for all of them?** Lines between cards cross the canvas and tangle as soon as two lists are shared, and they cannot point at a caller's local, which has no card. Drawing a shared container once, with the others pointing at it, would change how every card is laid out for the rare list that is shared, and it would hide the thing Python's `[[0] * n] * m` teaches: three rows that are visibly one. Each place keeps its full drawing, which is what the trace says, and a short line of text says which places are one, including the ones with no card.
