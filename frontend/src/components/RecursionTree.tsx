import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CardHeader } from "../render/Card";
import { callState, type Call, type CallState, type CallTree } from "../trace/calls";
import { isReturning, topFrame, type Step } from "../trace/types";

/** Up to this many calls in the whole run, every call is drawn, each in a fixed place. */
export const FULL_LIMIT = 80;
/** In the focused view, a path deeper than this keeps its top and bottom and folds the middle. */
export const PATH_LIMIT = 14;
export const KEEP_TOP = 3;
export const KEEP_BOTTOM = 10;
/** The stack view draws this many frames whole; deeper, the top STACK_TOP, a folded row, and the bottom 2. */
export const STACK_VIEW_WHOLE = 8;
const STACK_TOP = 5;
const STACK_BOTTOM = 2;

/** A call's box: two lines (the call, then "→ value" once it has returned). */
const BOX_H = 46;
const ROW = BOX_H + 48;
const CHAR = 7;
const PAD = 16;
const EASE = { duration: 0.45, ease: [0.22, 1, 0.36, 1] } as const;

export type CallsView = "tree" | "stack";

const LEGEND: [string, string][] = [
  ["current", "running"],
  ["waiting", "waiting on a call"],
  ["returning", "returning"],
  ["return-arrow", "return to caller"],
  ["returned", "returned"],
  ["base", "base case"],
];

const STATE_WORD: Record<CallState, string> = {
  current: "running",
  waiting: "waiting",
  returning: "returning",
  base: "base case",
  returned: "returned",
};

/** One drawn box: a call, a folded branch ("→ 2 · 14 calls"), or a folded stretch of the path ("⋮ 40 calls"). */
export interface CallNode {
  key: string;
  label: string;
  /** "3", once the call has returned (drawn as "→ 3"). */
  value: string | null;
  state: CallState | "folded";
  parent: string | null;
  x: number;
  y: number;
  width: number;
}

/**
 * The recursion card, for calls that return values their callers use (docs/frontend.md §6.6).
 * Tree view: every call that has begun, coloured by where it stands, with what it returned
 * inside its box; on the step a call returns, the edge to its caller turns purple with an
 * arrowhead at the caller (return to caller). Stack view: the calls on the stack, running on
 * top. Small runs are drawn whole, each call in a fixed place; large ones focus on the running
 * call (focusedTree). Pure for a step, apart from the view toggle and scrolling into view.
 */
export function RecursionTree({
  tree,
  layout,
  step,
  index,
  initialView = "tree",
}: {
  tree: CallTree;
  layout: Map<string, { x: number; y: number }> | null;
  step: Step;
  index: number;
  initialView?: CallsView;
}) {
  const [view, setView] = useState<CallsView>(initialView);
  const started = [...tree.calls.values()].filter((c) => c.first <= index).length;
  const meta = view === "tree" ? `recursion tree · ${started} of ${tree.calls.size} calls${layout ? "" : " · focused on the running call"}` : `call stack · ${step.frames.length} deep`;

  return (
    <section className="structure recursion" aria-label="Calls">
      <CardHeader name="calls" meta={meta} end={<ViewToggle view={view} onView={setView} />} />
      <div className="recursion-legend">
        {LEGEND.filter(([s]) => view === "tree" || (s !== "return-arrow" && s !== "returned")).map(([s, text]) => (
          <span key={s} className={`legend-item call-${s}`}>
            {s === "return-arrow" ? (
              <svg aria-hidden="true" width="12" height="14" viewBox="0 0 12 14">
                <path d="M6 13V2M2 6l4-4 4 4" />
              </svg>
            ) : (
              <i />
            )}
            {text}
          </span>
        ))}
      </div>
      <AnimatePresence mode="wait" initial={false}>
        {view === "tree" ? (
          <motion.div key="tree" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <TreeView tree={tree} layout={layout} step={step} index={index} />
          </motion.div>
        ) : (
          <motion.div key="stack" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.2 }}>
            <StackView tree={tree} step={step} index={index} />
          </motion.div>
        )}
      </AnimatePresence>
    </section>
  );
}

/** The Tree / Stack segmented toggle in the card's header. */
function ViewToggle({ view, onView }: { view: CallsView; onView: (v: CallsView) => void }) {
  return (
    <div className="segmented" role="group" aria-label="Calls view">
      <button type="button" className="segment" aria-label="Tree" title="Tree" aria-pressed={view === "tree"} onClick={() => onView("tree")}>
        <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
          <circle cx="9" cy="3.75" r="2" />
          <circle cx="4" cy="14.25" r="2" />
          <circle cx="14" cy="14.25" r="2" />
          <path d="M9 5.75v2.5M4 12.25v-1.5a2.5 2.5 0 0 1 2.5-2.5h5a2.5 2.5 0 0 1 2.5 2.5v1.5" />
        </svg>
      </button>
      <button type="button" className="segment" aria-label="Stack" title="Stack" aria-pressed={view === "stack"} onClick={() => onView("stack")}>
        <StackIcon />
      </button>
    </div>
  );
}

export function StackIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 18 18">
      <rect x="3" y="2.5" width="12" height="3" rx="1.5" />
      <rect x="3" y="7.5" width="12" height="3" rx="1.5" />
      <rect x="3" y="12.5" width="12" height="3" rx="1.5" />
    </svg>
  );
}

function TreeView({ tree, layout, step, index }: { tree: CallTree; layout: Map<string, { x: number; y: number }> | null; step: Step; index: number }) {
  const nodes = layout ? fullTree(tree, layout, step, index) : focusedTree(tree, step, index);
  const width = Math.max(...nodes.map((n) => n.x + n.width / 2)) + PAD;
  const height = Math.max(...nodes.map((n) => n.y)) + BOX_H + 8;
  const byKey = new Map(nodes.map((n) => [n.key, n]));
  const running = topFrame(step).id;
  const scroller = useRef<HTMLDivElement>(null);

  // Keep the running call in view. Scroll to where its box is going (its place in
  // `nodes`), not where the gliding box is now, and only when it is out of view.
  const target = byKey.get(running);
  useEffect(() => {
    const box = scroller.current;
    if (!box || !target || typeof box.scrollTo !== "function") return;
    const margin = 24;
    const left = target.x - target.width / 2 - margin;
    const right = target.x + target.width / 2 + margin;
    const top = target.y - margin;
    const bottom = target.y + BOX_H + margin;
    const inX = left >= box.scrollLeft && right <= box.scrollLeft + box.clientWidth;
    const inY = top >= box.scrollTop && bottom <= box.scrollTop + box.clientHeight;
    if (inX && inY) return;
    box.scrollTo({
      left: inX ? box.scrollLeft : target.x - box.clientWidth / 2,
      top: inY ? box.scrollTop : target.y + BOX_H / 2 - box.clientHeight / 2,
      behavior: "smooth",
    });
  }, [target?.x, target?.y, target?.width]);

  return (
    <div className="recursion-scroll" ref={scroller}>
      <svg className="recursion-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Recursion tree">
        <defs>
          <marker id="call-return" viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M 1 1 L 9 5 L 1 9" className="call-return-head" />
          </marker>
        </defs>
        <AnimatePresence>
          {nodes
            .filter((n) => n.parent && byKey.has(n.parent))
            .map((n) => {
              const p = byKey.get(n.parent!)!;
              const back = n.state === "returning" || n.state === "base";
              const tone = back ? "call-edge-return" : n.state === "current" || n.state === "waiting" ? "call-edge-path" : "";
              return (
                <motion.path
                  key={`edge-${n.key}`}
                  className={`call-edge ${tone}`}
                  initial={{ opacity: 0, d: link(p, n) }}
                  animate={{ opacity: 1, d: link(p, n) }}
                  exit={{ opacity: 0 }}
                  transition={EASE}
                  markerStart={back ? "url(#call-return)" : undefined}
                />
              );
            })}
        </AnimatePresence>
        <AnimatePresence>
          {nodes.map((n) => (
            <motion.g
              key={n.key}
              className={`call call-${n.state}`}
              data-current={n.key === running ? "true" : undefined}
              initial={{ opacity: 0, scale: 0.7, x: n.x, y: n.y }}
              animate={{ opacity: 1, scale: 1, x: n.x, y: n.y }}
              exit={{ opacity: 0, scale: 0.7 }}
              transition={EASE}
            >
              <rect x={-n.width / 2} y={0} width={n.width} height={BOX_H} rx={8} />
              <motion.text className="call-label" initial={false} animate={{ y: n.value === null ? BOX_H / 2 : 16 }} transition={EASE} dy="0.35em">
                {n.label}
              </motion.text>
              <AnimatePresence>
                {n.value !== null && (
                  <motion.text key="value" className="call-value" y={32} dy="0.35em" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EASE}>
                    → {n.value}
                  </motion.text>
                )}
              </AnimatePresence>
            </motion.g>
          ))}
        </AnimatePresence>
      </svg>
    </div>
  );
}

/** The calls on the stack, running on top: name, arguments, what it is returning, and its state. */
function StackView({ tree, step, index }: { tree: CallTree; step: Step; index: number }) {
  const running = topFrame(step).id;
  const frames = [...step.frames].reverse();
  const fold = frames.length > STACK_VIEW_WHOLE;
  const shown = fold ? [...frames.slice(0, STACK_TOP), null, ...frames.slice(-STACK_BOTTOM)] : frames;
  const hidden = frames.length - STACK_TOP - STACK_BOTTOM;
  return (
    <ol className="call-rows" aria-label="Call stack">
      <AnimatePresence initial={false} mode="popLayout">
        {shown.map((f) => {
          if (!f) {
            return (
              <motion.li key="fold" layout className="call-row is-folded" transition={EASE}>
                <span aria-hidden="true">⋮</span> {hidden} more calls
              </motion.li>
            );
          }
          const c = tree.calls.get(f.id);
          const state = c ? callState(c, tree, index, running) ?? "current" : "current";
          return (
            <motion.li
              key={f.id}
              layout
              className={`call-row call-${state}`}
              initial={{ opacity: 0, y: -12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={EASE}
            >
              <span className="call-row-fn">{f.function}</span>
              <span className="call-row-args">{c?.named ?? ""}</span>
              {isReturning(f) && c?.returned !== undefined && <span className="call-row-returns">returns {c.returned}</span>}
              <span className="call-row-state">{STATE_WORD[state]}</span>
            </motion.li>
          );
        })}
      </AnimatePresence>
    </ol>
  );
}

function link(p: CallNode, n: CallNode): string {
  const y1 = p.y + BOX_H + 3;
  const y2 = n.y;
  const my = (y1 + y2) / 2;
  return `M ${p.x} ${y1} C ${p.x} ${my}, ${n.x} ${my - 4}, ${n.x} ${y2}`;
}

function callLabel(c: Call): string {
  const text = `${c.fn}(${c.args})`;
  return text.length > 24 ? `${text.slice(0, 23)}…)` : text;
}

function boxWidth(label: string): number {
  return Math.max(96, Math.ceil(label.length * CHAR) + 24);
}

function valueAt(c: Call, index: number): string | null {
  return c.returnStep !== undefined && c.returnStep <= index ? (c.returned ?? null) : null;
}

/**
 * Fixed places for every call of a small run (FULL_LIMIT calls or fewer): a tidy
 * tree with each leaf in its own column and a parent centred over its children,
 * so a call appears where it stays. Pure; computed once per trace.
 */
export function callLayout(tree: CallTree): Map<string, { x: number; y: number }> | null {
  if (tree.calls.size > FULL_LIMIT) return null;
  const col = Math.max(...[...tree.calls.values()].map((c) => boxWidth(callLabel(c)))) + 14;
  const pos = new Map<string, { x: number; y: number }>();
  let leaf = 0;
  const place = (id: string): number => {
    const c = tree.calls.get(id)!;
    const xs = c.children.map(place);
    const x = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : PAD + col / 2 + leaf++ * col;
    pos.set(id, { x, y: 4 + c.depth * ROW });
    return x;
  };
  tree.roots.forEach(place);
  return pos;
}

function fullTree(tree: CallTree, layout: Map<string, { x: number; y: number }>, step: Step, index: number): CallNode[] {
  const running = topFrame(step).id;
  const out: CallNode[] = [];
  for (const id of tree.order) {
    const c = tree.calls.get(id)!;
    const state = callState(c, tree, index, running);
    if (!state) continue;
    const label = callLabel(c);
    const p = layout.get(id)!;
    out.push({ key: id, label, value: valueAt(c, index), state, parent: c.parent, x: p.x, y: p.y, width: boxWidth(label) });
  }
  return out;
}

/**
 * A large run's tree, focused on the running call: the calls on the stack, each
 * one's own calls beside it, and every finished branch folded into one box
 * ("→ 2 · 14 calls"). A stack deeper than PATH_LIMIT keeps its top KEEP_TOP and
 * bottom KEEP_BOTTOM calls and folds the middle ("⋮ 40 calls"). Laid out per step;
 * the boxes glide when the focus moves.
 */
export function focusedTree(tree: CallTree, step: Step, index: number): CallNode[] {
  const running = topFrame(step).id;
  const path = step.frames.map((f) => f.id);
  const shown: { id: string; parent: string | null; folded?: number }[] = [];
  let kept = path;
  let foldedMiddle = 0;
  if (path.length > PATH_LIMIT) {
    foldedMiddle = path.length - KEEP_TOP - KEEP_BOTTOM;
    kept = [...path.slice(0, KEEP_TOP), ...path.slice(path.length - KEEP_BOTTOM)];
  }
  const onPath = new Set(kept);
  kept.forEach((id, k) => {
    const parent = k === 0 ? null : k === KEEP_TOP && foldedMiddle ? "fold:middle" : kept[k - 1];
    shown.push({ id, parent });
    if (k === KEEP_TOP - 1 && foldedMiddle) shown.push({ id: "fold:middle", parent: id, folded: foldedMiddle });
    if (k < KEEP_TOP - 1 || k >= KEEP_TOP || !foldedMiddle) {
      // The calls this call has made so far, other than the one on the path.
      for (const child of tree.calls.get(id)!.children) {
        const c = tree.calls.get(child)!;
        if (c.first > index || onPath.has(child)) continue;
        shown.push({ id: child, parent: id, folded: subtreeSize(tree, child, index) - 1 });
      }
    }
  });

  // Tidy layout of what is shown: leaves in columns, parents over their children.
  const kids = new Map<string, string[]>();
  for (const s of shown) if (s.parent) kids.set(s.parent, [...(kids.get(s.parent) ?? []), s.id]);
  const info = new Map(shown.map((s) => [s.id, s]));
  const labels = new Map(
    shown.map((s) => {
      if (s.id === "fold:middle") return [s.id, `⋮ ${s.folded} calls`];
      return [s.id, callLabel(tree.calls.get(s.id)!)];
    }),
  );
  const valueWidth = (s: { id: string; folded?: number }) => {
    if (s.id === "fold:middle") return 0;
    const v = valueAt(tree.calls.get(s.id)!, index);
    return v === null ? 0 : Math.ceil((v.length + 2 + (s.folded ? ` · ${s.folded + 1} calls`.length : 0)) * CHAR) + 24;
  };
  const col = Math.max(...shown.map((s) => Math.max(boxWidth(labels.get(s.id)!), valueWidth(s)))) + 14;
  const pos = new Map<string, { x: number; y: number }>();
  let leaf = 0;
  const place = (id: string, depth: number): number => {
    const ch = kids.get(id) ?? [];
    const xs = ch.map((c) => place(c, depth + 1));
    const x = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : PAD + col / 2 + leaf++ * col;
    pos.set(id, { x, y: 4 + depth * ROW });
    return x;
  };
  place(kept[0], 0);

  return shown.map((s) => {
    const label = labels.get(s.id)!;
    const p = pos.get(s.id)!;
    if (s.id === "fold:middle") return { key: s.id, label, value: null, state: "folded" as const, parent: s.parent, x: p.x, y: p.y, width: boxWidth(label) };
    const c = tree.calls.get(s.id)!;
    let value = valueAt(c, index);
    if (s.folded && value !== null) value = `${value} · ${s.folded + 1} calls`;
    const width = Math.max(boxWidth(label), valueWidth(s));
    return { key: s.id, label, value, state: callState(c, tree, index, running)!, parent: info.get(s.id)!.parent, x: p.x, y: p.y, width };
  });
}

function subtreeSize(tree: CallTree, id: string, index: number): number {
  const c = tree.calls.get(id)!;
  if (c.first > index) return 0;
  return 1 + c.children.reduce((n, k) => n + subtreeSize(tree, k, index), 0);
}
