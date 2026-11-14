import { AnimatePresence, motion } from "framer-motion";
import type { Change } from "../trace/diff";
import { hasItems, type Value } from "../trace/types";
import { diffClass } from "./ArrayRenderer";
import { CardHeader, Empty } from "./Card";
import { EASE, itemText } from "./SequenceRenderer";
import type { RendererProps } from "./types";

/** The tree is drawn for heaps up to this size (four full levels); past it, the storage row alone. */
export const HEAP_TREE_MAX = 31;
/** Values up to this many characters fit in a circle; a wider value turns every node into a rounded rectangle. */
const CIRCLE_CHARS = 3;
const CIRCLE = 40;
const RECT_H = 34;
const LEVEL_DY = 70;
const TOP_PAD = 30; // room for the `top` tag above the root

/**
 * priority-queue: its items are the storage array (spec), so slot i's children are 2i+1 and
 * 2i+2. Drawn as that binary heap, with the storage row beside it, so how it is stored and how
 * it is pictured sit side by side. The diff is per slot: a slot that gained a value is added, a
 * slot whose value changed is changed (a sift moves values through slots), a lost slot stays one
 * step, faded. The root has a `top` tag.
 */
export function HeapRenderer({ name, value, diff, ctx }: RendererProps) {
  if (!hasItems(value) || value.kind !== "priority-queue") throw new Error(`HeapRenderer got a non-priority-queue value for ${name}`);
  const items = value.items;
  const removed = diff?.removedItems ?? [];
  const slots: { v: Value; status?: Change; i: number }[] = [
    ...items.map((v, i) => ({ v, status: diff?.items?.[i], i })),
    ...removed.map(({ index, value: v }) => ({ v, status: "removed" as Change, i: index })),
  ];
  const texts = slots.map((s) => itemText(s.v, ctx.heap));
  const widest = Math.max(1, ...texts.map((t) => t.text.length));
  const round = widest <= CIRCLE_CHARS;
  const w = round ? CIRCLE : Math.round(widest * 7.8 + 24);
  const h = round ? CIRCLE : RECT_H;
  const drawTree = slots.length > 0 && slots.length <= HEAP_TREE_MAX;

  // Place slot i at its level and position in a full binary tree.
  const depth = drawTree ? Math.floor(Math.log2(slots.length)) : 0;
  const slotW = w + 14;
  const treeW = 2 ** depth * slotW;
  const place = (i: number) => {
    const d = Math.floor(Math.log2(i + 1));
    const k = i + 1 - 2 ** d;
    const span = treeW / 2 ** d;
    return { x: span * (k + 0.5), y: TOP_PAD + h / 2 + d * LEVEL_DY };
  };
  const treeH = TOP_PAD + h + depth * LEVEL_DY + 4;

  return (
    <section className="structure" aria-label={`${name}: priority-queue`}>
      <CardHeader name={name} meta={`priority queue · ${value.order} · ${items.length}`} op={ctx.op} />
      <div className="pq-layout">
        {drawTree && (
          <div className="heap-tree" style={{ width: treeW, height: treeH }}>
            <svg className="heap-edges" width={treeW} height={treeH} aria-hidden="true">
              {slots
                .filter((s) => s.i > 0)
                .map((s) => {
                  const p = place(Math.floor((s.i - 1) / 2));
                  const c = place(s.i);
                  const [x1, y1, x2, y2] = round ? trim(p, c, CIRCLE / 2 + 1) : [p.x, p.y + h / 2 + 1, c.x, c.y - h / 2 - 1];
                  return <line key={s.i} x1={x1} y1={y1} x2={x2} y2={y2} className={s.status === "removed" ? "is-removed" : ""} />;
                })}
            </svg>
            <span className="tag tag-top" style={{ left: place(0).x }}>
              <span className="tag-pill">top</span>
              <svg className="tag-arrow" aria-hidden="true" width="10" height="6" viewBox="0 0 10 6">
                <path d="M0 0h10L5 6z" />
              </svg>
            </span>
            <AnimatePresence initial={false}>
              {slots.map((s, k) => {
                const { x, y } = place(s.i);
                return (
                  <motion.div
                    key={s.i}
                    className={["heap-node", round && "is-round", s.i === 0 && (!s.status || s.status === "same") && "is-top", diffClass(s.status)].filter(Boolean).join(" ")}
                    style={{ left: x - w / 2, top: y - h / 2, width: w, height: h }}
                    title={texts[k].title}
                    initial={{ opacity: 0, scale: 0.85 }}
                    animate={{ opacity: 1, scale: 1 }}
                    exit={{ opacity: 0, scale: 0.85 }}
                    transition={EASE}
                  >
                    {texts[k].text}
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        )}
        <div className="heap-storage">
          <span className="heap-storage-label">storage order</span>
          <div className="array-cells">
            {slots.map((s, k) => (
              <div key={s.i} className="array-col">
                <div className={`cell cell-auto ${diffClass(s.status)}`} title={texts[k].title}>
                  {texts[k].text}
                </div>
                <div className="cell-index">{s.i}</div>
              </div>
            ))}
            {slots.length === 0 && <Empty />}
          </div>
          {slots.length > HEAP_TREE_MAX && <p className="heap-note">The tree is drawn up to {HEAP_TREE_MAX} items.</p>}
        </div>
      </div>
    </section>
  );
}

/** A line between two circle centres, cut back by r at both ends so it meets the rims. */
function trim(a: { x: number; y: number }, b: { x: number; y: number }, r: number): [number, number, number, number] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  return [a.x + ux * r, a.y + uy * r, b.x - ux * r, b.y - uy * r];
}
