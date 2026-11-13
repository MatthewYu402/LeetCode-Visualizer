import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef } from "react";
import { callState, type Call, type CallState, type CallTree } from "../trace/calls";
import { topFrame, type Step } from "../trace/types";

/** Up to this many calls in the whole run, every call is drawn, each in a fixed place. */
export const FULL_LIMIT = 80;
/** In the focused view, a path deeper than this keeps its top and bottom and folds the middle. */
export const PATH_LIMIT = 14;
export const KEEP_TOP = 3;
export const KEEP_BOTTOM = 10;

const ROW = 64;
const BOX_H = 26;
const CHAR = 7.2;
const PAD = 16;
const EASE = { duration: 0.45, ease: [0.22, 1, 0.36, 1] } as const;

const LEGEND: [CallState, string][] = [
  ["current", "running"],
  ["waiting", "waiting on a call"],
  ["returning", "returning now"],
  ["returned", "returned"],
  ["base", "base case"],
];

/** One drawn box: a call, a folded branch ("+12 calls"), or a folded stretch of the path ("⋮ 40 calls"). */
export interface CallNode {
  key: string;
  label: string;
  /** "→ 3", once the call has returned. */
  value: string | null;
  state: CallState | "folded";
  parent: string | null;
  x: number;
  y: number;
  width: number;
}

/**
 * The recursion tree at one step: every call that has begun, coloured by where it
 * stands. Small runs are drawn whole, with every call in a fixed place; large ones
 * are focused on the running call (focusedTree). Pure apart from scrolling the
 * running call into view.
 */
export function RecursionTree({ tree, layout, step, index }: { tree: CallTree; layout: Map<string, { x: number; y: number }> | null; step: Step; index: number }) {
  const nodes = layout ? fullTree(tree, layout, step, index) : focusedTree(tree, step, index);
  const width = Math.max(...nodes.map((n) => n.x + n.width / 2)) + PAD;
  const height = Math.max(...nodes.map((n) => n.y)) + BOX_H + 30;
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
    const bottom = target.y + BOX_H + 22 + margin;
    const inX = left >= box.scrollLeft && right <= box.scrollLeft + box.clientWidth;
    const inY = top >= box.scrollTop && bottom <= box.scrollTop + box.clientHeight;
    if (inX && inY) return;
    box.scrollTo({
      left: inX ? box.scrollLeft : target.x - box.clientWidth / 2,
      top: inY ? box.scrollTop : target.y + BOX_H / 2 - box.clientHeight / 2,
      behavior: "smooth",
    });
  }, [target?.x, target?.y, target?.width]);

  const started = [...tree.calls.values()].filter((c) => c.first <= index).length;
  return (
    <section className="structure recursion" aria-label="Recursion tree">
      <header className="structure-label">
        <span className="structure-name">calls</span>
        <span className="structure-kind">
          depth {step.frames.length} · {started} of {tree.calls.size} calls{layout ? "" : " · focused on the running call"}
        </span>
      </header>
      <div className="recursion-legend">
        {LEGEND.map(([s, text]) => (
          <span key={s} className={`legend-item call-${s}`}>
            <i />
            {text}
          </span>
        ))}
      </div>
      <div className="recursion-scroll" ref={scroller}>
        <svg className="recursion-svg" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
          <AnimatePresence>
            {nodes
              .filter((n) => n.parent && byKey.has(n.parent))
              .map((n) => {
                const p = byKey.get(n.parent!)!;
                const onPath = n.state === "current" || n.state === "returning" || n.state === "waiting";
                return (
                  <motion.path
                    key={`edge-${n.key}`}
                    className={`call-edge ${onPath ? "call-edge-path" : ""}`}
                    initial={{ opacity: 0, d: link(p, n) }}
                    animate={{ opacity: 1, d: link(p, n) }}
                    exit={{ opacity: 0 }}
                    transition={EASE}
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
                initial={{ opacity: 0, scale: 0.6, x: n.x, y: n.y }}
                animate={{ opacity: 1, scale: 1, x: n.x, y: n.y }}
                exit={{ opacity: 0, scale: 0.6 }}
                transition={EASE}
              >
                <rect x={-n.width / 2} y={0} width={n.width} height={BOX_H} rx={7} />
                <text className="call-label" y={BOX_H / 2} dy="0.35em">
                  {n.label}
                </text>
                <AnimatePresence>
                  {n.value !== null && (
                    <motion.text
                      key="value"
                      className="call-value"
                      y={BOX_H + 14}
                      initial={{ opacity: 0, y: -8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0 }}
                      transition={EASE}
                    >
                      → {n.value}
                    </motion.text>
                  )}
                </AnimatePresence>
              </motion.g>
            ))}
          </AnimatePresence>
        </svg>
      </div>
    </section>
  );
}

function link(p: CallNode, n: CallNode): string {
  const y1 = p.y + BOX_H;
  const y2 = n.y;
  const my = (y1 + y2) / 2;
  return `M ${p.x} ${y1} C ${p.x} ${my}, ${n.x} ${my}, ${n.x} ${y2}`;
}

function callLabel(c: Call): string {
  const text = `${c.fn}(${c.args})`;
  return text.length > 22 ? `${text.slice(0, 21)}…)` : text;
}

function boxWidth(label: string): number {
  return Math.max(44, Math.ceil(label.length * CHAR) + 16);
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
  const col = Math.max(...[...tree.calls.values()].map((c) => boxWidth(callLabel(c)))) + 12;
  const pos = new Map<string, { x: number; y: number }>();
  let leaf = 0;
  const place = (id: string): number => {
    const c = tree.calls.get(id)!;
    const xs = c.children.map(place);
    const x = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : PAD + col / 2 + leaf++ * col;
    pos.set(id, { x, y: PAD + c.depth * ROW });
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
    return v === null ? 0 : Math.ceil((v.length + 2 + (s.folded ? ` · ${s.folded + 1} calls`.length : 0)) * CHAR) + 8;
  };
  const col = Math.max(...shown.map((s) => Math.max(boxWidth(labels.get(s.id)!), valueWidth(s)))) + 12;
  const pos = new Map<string, { x: number; y: number }>();
  let leaf = 0;
  const place = (id: string, depth: number): number => {
    const ch = kids.get(id) ?? [];
    const xs = ch.map((c) => place(c, depth + 1));
    const x = xs.length ? (xs[0] + xs[xs.length - 1]) / 2 : PAD + col / 2 + leaf++ * col;
    pos.set(id, { x, y: PAD + depth * ROW });
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
    return { key: s.id, label, value, state: callState(c, tree, index, running)!, parent: info.get(s.id)!.parent, x: p.x, y: p.y, width: boxWidth(label) };
  });
}

function subtreeSize(tree: CallTree, id: string, index: number): number {
  const c = tree.calls.get(id)!;
  if (c.first > index) return 0;
  return 1 + c.children.reduce((n, k) => n + subtreeSize(tree, k, index), 0);
}
