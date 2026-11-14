# frontend/CLAUDE.md

Guidance for working in `frontend/`. The root [`CLAUDE.md`](../CLAUDE.md) still applies. The design is in [`docs/frontend.md`](../docs/frontend.md), and the contract is [`docs/trace-format.md`](../docs/trace-format.md) (v0.8).

Claude writes the frontend code; the author writes the adapter runtime and rewriter.

## What this is

The sandbox page: a Monaco code panel, an inputs panel, a visual panel, and a state panel. It opens on `fixtures/two-sum.trace.json`. The inputs panel shows one field per parameter of the pasted Solution's method (read through the API, `docs/backend.md`), and Run code replaces the trace with the one the API returns. The inputs are functional only: no visual design yet. The visual panel draws a recursion tree when calls nest, linked lists, trees, and graphs from the heap, and every container kind (`docs/frontend.md` §6). There is no home page or "view as" override yet.

The API service must be running for the inputs to work: `python3 -m backend` from the repository root. `vite.config.ts` proxies `/api` to it on 127.0.0.1:8000.

## Commands

Run from `frontend/`:

```bash
npm install
npm run dev        # Vite dev server, http://localhost:5173
npm test           # vitest, once
npm run test:watch # vitest, watch mode
npm run typecheck  # tsc, no emit
npm run build      # typecheck, then production build into dist/
```

## Stack

React + TypeScript + Vite, `@monaco-editor/react` with `monaco-editor` bundled locally (no CDN), plain CSS with variables, vitest. `framer-motion` (pinned `~14.7`) does fades, glides, and edge draw-ins; CSS keyframes do the diff flashes. `App.tsx` wraps the page in `MotionConfig reducedMotion="user"`. `dompurify` is pinned through `overrides` in `package.json` to a patched version of Monaco's bundled copy. **Ask before adding any other dependency.**

## Structure

```
src/
├── App.tsx              the sandbox page: layout, language select, keyboard shortcuts
├── main.tsx             entry
├── fixtures.ts          the example the page opens with: language -> source + trace (imports ../fixtures with ?raw)
├── api/
│   ├── client.ts        signature() and run(): fetch /api, answers as unions, the trace through checkTrace
│   ├── form.ts          fields per method, placeholders, kept values, filling from an example, the run request
│   └── useInputs.ts     the form's state: signature re-read 400 ms after edits, method, values, run
├── trace/
│   ├── types.ts         TypeScript mirror of the schema, topFrame, isReturning, runEnd, problemTitle
│   ├── loader.ts        JSON.parse + version check (accepts exactly "0.8")
│   ├── format.ts        compact value text, kind names, canonical comparison
│   ├── diff.ts          diff(prev, curr) per local, per index, per set member, per map key, by count for multiset/multimap, plus the heap diff
│   ├── heap.ts          edges between heap objects, node labels and shapes, pointers into the heap, heapDiff
│   └── calls.ts         callTree(trace): every call, its caller, arguments, return value; callState at a step
├── player/
│   ├── playback.ts      pure reducer: index, cameFrom, playing
│   └── usePlayer.ts     reducer + Run timer (1x = 700 ms)
├── render/
│   ├── registry.ts      hint -> kind -> fallback
│   ├── ArrayRenderer.tsx, MapRenderer.tsx, SequenceRenderer.tsx (stack, queue, deque, list, tuple, priority queue; SetRenderer), FallbackRenderer.tsx
│   ├── layout.ts        layoutTrace(trace): fixed places for every node of every linked structure, once per trace
│   ├── HeapView.tsx     one step's linked structures: nodes, edges, pointer labels, highlights
│   ├── pointers.ts      the index-name rule and iterators, for pointer markers
│   └── types.ts         Renderer, RendererProps, RenderContext
├── components/          Toolbar, CodePanel, InputsPanel, VisualPanel, StatePanel (with CallStack), RecursionTree, Split
├── editor/              Monaco setup and theme, editor languages and starter templates
└── styles/              theme.css (tokens), app.css (layout)
```

Tests live next to the code as `*.test.ts(x)` and run in Node. Components are tested with `react-dom/server`, so no DOM library is needed.

## Rules

1. **Renderers are pure.** A renderer is a function of `(value, diff, ctx)` for one step. No state, no access to other steps, and it must draw correctly with `diff = null`.
2. **Snapshots, not replays.** Step N is drawn from `steps[N]` alone. The diff reads `steps[N-1]` and `steps[N]` and nothing earlier. Never replay earlier steps to build state. The one exception is what is computed once from the whole trace when it loads and never changes: the layout of linked structures (`layoutTrace`) and the call tree (`callTree`). They give places and the calls' relationships; every node, edge, value, and colour drawn for step N still comes from step N (and its diff).
3. **No language branching.** Nothing reads `trace.language`. The editor language select is a UI input: only `App.tsx` and `fixtures.ts` may use it, to pick the editor mode and which fixture to load. Renderers, diff, and the state panel never see it.
4. **A diff is shown only after a one-step move forward** (`cameFrom === index - 1`). Step 0, jumps, and moving back draw with no diff.
5. **Tagged numbers stay strings.** Show `{"kind":"int"}` by its `value`; never pass it to `Number()`. Use `BigInt` only where arithmetic or comparison is needed. `{"kind":"float"}` shows as `NaN`, `∞`, `-∞`.
6. **Map order is the trace's order.** Never sort map entries (or set, multiset, multimap members) for display. Diffs match by key, never by position; multiset and multimap match by count. `canonical` sorts members only to compare.
7. **Pointer markers** come from one rule only: an integer local named one of `i j k l r left right lo hi mid start end slow fast p q` whose value is a valid index into that array, and an `iterator` local whose `container` is that array and whose `index` is in range. An iterator's marker is labeled with its own name, so `it` points at `nums[2]`; one at `end` gets no marker.
8. **Unknown kinds go to the fallback**, never crash.
9. **Colours come from the theme tokens.** No hex values in components or CSS outside `styles/theme.css` (the one exception is a fully transparent constant in `editor/monaco.ts`). The Monaco theme reads the same variables.
10. **Fixtures are imported from `../fixtures`**, never copied into `frontend/`. `vite.config.ts` allows the repo root in `server.fs.allow`.
11. **A missing `result` means the run did not finish**, never a wrong answer. A missing `truncated` means `false`. Read both through `runEnd`.
12. **The title is `problem.name`, or `problem.method` when the name is absent.** Use `problemTitle`.
13. **A step is a call stack.** The code highlight, the visual panel, and the locals table show the running frame, read through `topFrame(step)`. The state panel lists every frame, running frame first. The diff compares the running frame with the frame that has the same `id` in the previous step, wherever it sat, so a caller is compared with its own earlier self after a return.
14. **Refs and objects are drawn by `HeapView`, not per local.** A `ref` local is a pointer label on its node; a `ref` inside a container shows its node's value (`itemText`). Shapes come from field names (`left`/`right`, `next`, anything else is a graph), never from the language.
15. **Nothing appears instantly.** New elements fade (and scale) in, removed ones fade out, moved ones glide, new edges draw in. Keep `MotionConfig reducedMotion="user"` at the top.

## Theme tokens (GitHub dark)

| Token | Value |
|---|---|
| `--bg` | `#0d1117` |
| `--bg-subtle` | `#161b22` |
| `--bg-inset` | `#010409` |
| `--border` | `#30363d` |
| `--fg` | `#e6edf3` |
| `--fg-muted` | `#7d8590` |
| `--accent` | `#2f81f7` |
| `--success` | `#3fb950` (diff: added) |
| `--attention` | `#d29922` (diff: changed) |
| `--danger` | `#f85149` (errors) |
| `--done` | `#a371f7` (result row) |
| `--line-highlight` | `rgba(56, 139, 253, 0.15)` |

Editor-only syntax tokens: `--syntax-keyword`, `--syntax-string`, `--syntax-number`, `--syntax-comment`, `--syntax-type`.

Fonts: system UI stack for text, `ui-monospace, SFMono-Regular, Menlo, monospace` for code and values.

## Gotchas

- Monaco uses the class `.current-line` for its own cursor-line overlay. The trace line uses `.trace-line` and `.trace-line-gutter`. Do not rename them back.
- Monaco accepts only hex colours. `editor/monaco.ts` converts `rgba(...)` tokens with `toHex`.
- Keyboard shortcuts are ignored inside Monaco and form controls. Space on a focused button is left to the button.
- "Run" in the toolbar is playback. Running the code is the inputs panel's "Run code" button.
- `.btn` is sized for the toolbar's icon buttons. Text buttons in the inputs panel override the width.
- A browser test that types code into Monaco gets auto-indent and auto-closed braces, which breaks the code. Paste it through the clipboard instead, as a user does.
