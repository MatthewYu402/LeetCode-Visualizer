# frontend/CLAUDE.md

Guidance for working in `frontend/`. The root [`CLAUDE.md`](../CLAUDE.md) still applies. The design is in [`docs/frontend.md`](../docs/frontend.md), and the contract is [`docs/trace-format.md`](../docs/trace-format.md) (v0.8).

Claude writes the frontend code; the author writes the adapter runtime and rewriter.

## What this is

The sandbox page: a top bar, a Monaco code panel, an inputs panel, a visual panel (the canvas), a state panel, and a playback bar at the bottom. It opens on the bare Two Sum Solution with no trace. The inputs panel shows one field per parameter of the pasted Solution's method (read through the API, `docs/backend.md`), and Run code (top bar, or Cmd/Ctrl + Enter) traces it. The design was agreed as mockups first; `docs/frontend.md` §2 and §11 describe it. The visual panel draws a recursion tree when calls nest, linked lists, trees, and graphs from the heap, and every container kind (`docs/frontend.md` §6). There is no home page or "view as" override yet.

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

React + TypeScript + Vite, `@monaco-editor/react` with `monaco-editor` bundled locally (no CDN), plain CSS with variables, vitest. Geist and Geist Mono come from `@fontsource-variable/geist` and `@fontsource-variable/geist-mono`, imported in `main.tsx` (bundled, no CDN). `framer-motion` (pinned `~14.7`) does fades, glides, and edge draw-ins; CSS keyframes do the diff flashes. `App.tsx` wraps the page in `MotionConfig reducedMotion="user"`. `dompurify` is pinned through `overrides` in `package.json` to a patched version of Monaco's bundled copy. **Ask before adding any other dependency.**

## Structure

```
src/
├── App.tsx              the sandbox page: layout, language, keyboard shortcuts (Cmd/Ctrl + Enter runs)
├── main.tsx             entry: fonts, theme, styles
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
│   ├── playback.ts      pure reducer: index, cameFrom, playing; restart
│   └── usePlayer.ts     reducer + Run timer (1x = 700 ms)
├── render/
│   ├── registry.ts      hint -> kind -> fallback
│   ├── ArrayRenderer.tsx, MapRenderer.tsx, SequenceRenderer.tsx (stack, queue, deque, list, tuple, priority queue; SetRenderer), FallbackRenderer.tsx
│   ├── layout.ts        layoutTrace(trace): fixed places for every node of every linked structure, once per trace
│   ├── HeapView.tsx     one step's linked structures: nodes, edges, pointer labels, highlights
│   ├── pointers.ts      the index-name rule and iterators, for pointer markers
│   └── types.ts         Renderer, RendererProps, RenderContext
├── components/          Toolbar (top bar), PlaybackBar, CodePanel, InputsPanel, VisualPanel, StatePanel (with CallStack), RecursionTree, Split
├── editor/              Monaco setup and theme, editor languages, the Two Sum starter and its example
└── styles/              theme.css (tokens), app.css (layout)
```

Tests live next to the code as `*.test.ts(x)` and run in Node. Components are tested with `react-dom/server`, so no DOM library is needed.

## Rules

1. **Renderers are pure.** A renderer is a function of `(value, diff, ctx)` for one step. No state, no access to other steps, and it must draw correctly with `diff = null`.
2. **Snapshots, not replays.** Step N is drawn from `steps[N]` alone. The diff reads `steps[N-1]` and `steps[N]` and nothing earlier. Never replay earlier steps to build state. The one exception is what is computed once from the whole trace when it loads and never changes: the layout of linked structures (`layoutTrace`) and the call tree (`callTree`). They give places and the calls' relationships; every node, edge, value, and colour drawn for step N still comes from step N (and its diff).
3. **No language branching.** Nothing reads `trace.language`. The editor language select is a UI input: only `App.tsx` may use it, to pick the editor mode and the starter template. Renderers, diff, and the state panel never see it.
4. **A diff is shown only after a one-step move forward** (`cameFrom === index - 1`). Step 0, jumps, and moving back draw with no diff.
5. **Tagged numbers stay strings.** Show `{"kind":"int"}` by its `value`; never pass it to `Number()`. Use `BigInt` only where arithmetic or comparison is needed. `{"kind":"float"}` shows as `NaN`, `∞`, `-∞`.
6. **Map order is the trace's order.** Never sort map entries (or set, multiset, multimap members) for display. Diffs match by key, never by position; multiset and multimap match by count. `canonical` sorts members only to compare.
7. **Pointer markers** come from one rule only: an integer local named one of `i j k l r left right lo hi mid start end slow fast p q` whose value is a valid index into that array, and an `iterator` local whose `container` is that array and whose `index` is in range. An iterator's marker is labeled with its own name, so `it` points at `nums[2]`; one at `end` gets no marker.
8. **Unknown kinds go to the fallback**, never crash.
9. **Colours come from the theme tokens.** No hex values in components or CSS outside `styles/theme.css` (the one exception is a fully transparent constant in `editor/monaco.ts`). The Monaco theme reads the same variables.
10. **Fixtures are imported from `../fixtures`**, never copied into `frontend/`. `vite.config.ts` allows the repo root in `server.fs.allow`. Only tests import them: the page opens with no trace.
11. **A missing `result` means the run did not finish**, never a wrong answer. A missing `truncated` means `false`. Read both through `runEnd`.
12. **Wherever the problem's title is shown, it is `problem.name`, or `problem.method` when the name is absent.** Use `problemTitle`. (The top bar shows the app's name, not the problem's.)
13. **A step is a call stack.** The code highlight, the visual panel, and the locals table show the running frame, read through `topFrame(step)`. The state panel lists every frame, running frame first. The diff compares the running frame with the frame that has the same `id` in the previous step, wherever it sat, so a caller is compared with its own earlier self after a return.
14. **Refs and objects are drawn by `HeapView`, not per local.** A `ref` local is a pointer label on its node; a `ref` inside a container shows its node's value (`itemText`). Shapes come from field names (`left`/`right`, `next`, anything else is a graph), never from the language.
15. **Nothing appears instantly.** New elements fade (and scale) in, removed ones fade out, moved ones glide, new edges draw in. Keep `MotionConfig reducedMotion="user"` at the top.

## Theme tokens

The full table is in `docs/frontend.md` §11. The ones every component reaches for:

| Token | Value | Use |
|---|---|---|
| `--bg` / `--bg-subtle` / `--bg-raised` / `--bg-inset` | `#0b0e14` / `#0f131b` / `#121722` / `#0d1118` | page and canvas / panels and bars / cards / editor, inputs, cells |
| `--border` / `--border-strong` / `--border-subtle` | `#1f2633` / `#262e3d` / `#1a2030` | cards / controls / between panels |
| `--fg` / `--fg-soft` / `--fg-muted` / `--fg-faint` | `#e4e8f0` / `#c6cedd` / `#8a93a6` / `#5a6479` | text, labels, placeholders |
| `--accent` | `#7aa5f5` | current, focus, primary |
| `--success` | `#5cc08a` | diff: added |
| `--attention` | `#d9ab5c` | diff: changed or moved |
| `--danger` | `#e07a7a` | errors |
| `--done` | `#a995e8` | result, returning |
| `--line-highlight` | `rgba(122, 165, 245, 0.1)` | the current line |

Editor-only syntax tokens: `--syntax-keyword`, `--syntax-string`, `--syntax-number`, `--syntax-comment`, `--syntax-type`.

Fonts: `--font-ui` (Geist) for text, `--font-mono` (Geist Mono) for code and values.

## Gotchas

- Monaco uses the class `.current-line` for its own cursor-line overlay. The trace line uses `.trace-line` and `.trace-line-gutter`. Do not rename them back.
- Monaco accepts only hex colours. `editor/monaco.ts` converts `rgba(...)` tokens with `toHex`.
- Keyboard shortcuts are ignored inside Monaco and form controls. Space on a focused button is left to the button.
- "Run code" (top bar, Cmd/Ctrl + Enter) runs the code in the sandbox. Play, in the playback bar, replays the trace. Restart goes back to step 1 of the same trace without running the code.
- Monaco binds Ctrl/Cmd + Enter to "insert line"; `CodePanel` overrides it to run the code, and the window listener skips key events from inside the editor so a run is not started twice.
- Monaco measures glyphs when it mounts, before Geist Mono has loaded; `CodePanel` calls `remeasureFonts()` once `document.fonts.ready` resolves.
- A browser test that types code into Monaco gets auto-indent and auto-closed braces, which breaks the code. Paste it through the clipboard instead, as a user does.
