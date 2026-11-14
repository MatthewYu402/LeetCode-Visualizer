import { AnimatePresence, motion } from "framer-motion";
import type { CallTree } from "../trace/calls";
import { formatValue } from "../trace/format";
import { edgesFrom, isPrimaryField, isRef, nodeLabel, shapeOf } from "../trace/heap";
import { isReturning, isTagged, type Frame, type Step, type Value } from "../trace/types";
import { StackIcon } from "./RecursionTree";

const EASE = { duration: 0.42, ease: [0.2, 0.8, 0.2, 1] } as const;
/** Up to this many frames are drawn whole; deeper, the top CALLS_TOP, a folded row, and the bottom 2. */
export const CALLS_WHOLE = 8;
const CALLS_TOP = 5;
const CALLS_BOTTOM = 2;

type RowState = "running" | "waiting" | "returning";
type ChipState = "checked" | "checking" | "waited" | "open";

interface Chip {
  key: string;
  text: string;
  title: string;
  state: ChipState;
}

export interface CallRow {
  id: string;
  label: string;
  state: RowState;
  /** The neighbours of the node this call is about, when it is about one. */
  chips: Chip[] | null;
  /** Otherwise, the call's own working values: "i = 1". */
  values: string;
  note: string;
}

/**
 * The call-stack card, for calls that return nothing and work by changing data structures (a
 * void dfs, flood fill, backtracking): docs/frontend.md §6.6. One row per live frame, running on
 * top. A frame that just began arrives green and its callers glide down; a returning frame is
 * purple for its return step and then fades off the top. A row shows the call, the neighbours of
 * the node it is about (checked muted, being checked blue, waited on dashed), and a short note.
 * Pure for one step; `pushed` (from the diff) only adds the green arrival.
 */
export function CallStackCard({ tree, step, pushed }: { tree: CallTree; step: Step; pushed?: ReadonlySet<string> }) {
  const rows = callRows(tree, step);
  const fold = rows.length > CALLS_WHOLE;
  const shown = fold ? [...rows.slice(0, CALLS_TOP), null, ...rows.slice(-CALLS_BOTTOM)] : rows;
  const hidden = rows.length - CALLS_TOP - CALLS_BOTTOM;
  return (
    <section className="structure call-stack-card" aria-label="Call stack">
      <header className="card-header">
        <span className="card-icon" aria-hidden="true">
          <StackIcon />
        </span>
        <h3 className="card-name">calls</h3>
        <span className="card-meta">call stack · {rows.length}</span>
      </header>
      <ol className="call-rows">
        <AnimatePresence initial={false} mode="popLayout">
          {shown.map((r) =>
            r === null ? (
              <motion.li key="fold" layout className="call-row is-folded" transition={EASE}>
                <span aria-hidden="true">⋮</span> {hidden} more calls
              </motion.li>
            ) : (
              <motion.li
                key={r.id}
                layout
                className={`call-row stack-row is-${r.state} ${pushed?.has(r.id) ? "is-pushed" : ""}`}
                initial={{ opacity: 0, y: -14 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -18 }}
                transition={EASE}
              >
                <span className="call-row-fn">{r.label}</span>
                {r.chips && r.chips.length > 0 && (
                  <>
                    <span className="call-row-key">neighbors</span>
                    <span className="nbr-chips">
                      {r.chips.map((c) => (
                        <span key={c.key} className={`nbr-chip is-${c.state}`} title={c.title}>
                          {c.text}
                        </span>
                      ))}
                    </span>
                  </>
                )}
                {!r.chips && r.values && <span className="call-row-args">{r.values}</span>}
                <span className="call-row-note">{r.note}</span>
                <span className="call-row-state">{r.state}</span>
              </motion.li>
            ),
          )}
        </AnimatePresence>
      </ol>
    </section>
  );
}

/**
 * The rows, running frame first. A call is "about" the node its first parameter points at (as
 * the step holds it now). Its neighbours are that node's primary links (a graph's neighbour
 * list, a tree's children, a list's next), in field order. While the call runs, a working
 * pointer of its own on one of them (`nb`, `neighbor`) is the one being checked, and the ones
 * before it are checked; while it waits, the one the call above it is about is waited on.
 */
export function callRows(tree: CallTree, step: Step): CallRow[] {
  const frames = step.frames;
  const out: CallRow[] = [];
  for (let k = frames.length - 1; k >= 0; k--) {
    const f = frames[k];
    const call = tree.calls.get(f.id);
    const params = new Set(call?.params ?? Object.keys(f.locals));
    const state: RowState = k === frames.length - 1 ? (isReturning(f) ? "returning" : "running") : "waiting";
    const label = `${f.function}(${call?.brief ?? ""})`;
    const node = aboutNode(f, params);
    const above = k < frames.length - 1 ? frames[k + 1] : null;
    const aboveLabel = above ? `${above.function}(${tree.calls.get(above.id)?.brief ?? ""})` : "";
    let chips: Chip[] | null = null;
    let note = "";
    if (node && node in step.heap) {
      const obj = step.heap[node];
      const shape = shapeOf(obj);
      const nbrs = edgesFrom(node, obj).filter((e) => isPrimaryField(shape, e.field) && e.to in step.heap);
      let at = -1;
      let mark: ChipState = "checking";
      if (state === "running") {
        const working = Object.entries(f.locals).filter(([n, v]) => !params.has(n) && isRef(v)).map(([, v]) => (v as { id: string }).id);
        at = nbrs.findIndex((e) => working.includes(e.to));
      } else if (state === "waiting" && above) {
        const target = aboutNode(above, new Set(tree.calls.get(above.id)?.params ?? Object.keys(above.locals)));
        at = nbrs.findIndex((e) => e.to === target);
        mark = "waited";
      }
      chips = nbrs.map((e, i) => {
        const text = nodeLabel(step.heap[e.to]);
        const s: ChipState = state === "returning" || (at >= 0 && i < at) ? "checked" : i === at ? mark : "open";
        return { key: `${e.field}${e.index ?? ""}`, text, title: `${e.to}: ${step.heap[e.to].type} = ${text}`, state: s };
      });
      if (state === "running" && at >= 0) note = `checking ${chips[at].text}`;
    }
    if (state === "waiting") note = `waiting on ${aboveLabel}`;
    if (state === "returning" && f.return_value !== undefined && f.return_value !== null) note = `returns ${formatValue(f.return_value)}`;
    const values = Object.entries(f.locals)
      .filter(([n, v]) => !params.has(n) && isPrimitive(v))
      .map(([n, v]) => `${n} = ${formatValue(v)}`)
      .join(", ");
    out.push({ id: f.id, label, state, chips, values, note });
  }
  return out;
}

/** The node a call is about: the node its first pointer parameter holds now. */
function aboutNode(f: Frame, params: ReadonlySet<string>): string | null {
  for (const [n, v] of Object.entries(f.locals)) if (params.has(n) && isRef(v)) return v.id;
  return null;
}

function isPrimitive(v: Value): boolean {
  return !isTagged(v) || v.kind === "int" || v.kind === "float";
}
