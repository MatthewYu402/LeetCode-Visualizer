import { AnimatePresence, motion } from "framer-motion";
import { matchByCount, type Change } from "../trace/diff";
import { canonical, formatValue } from "../trace/format";
import { isRef, nodeLabel } from "../trace/heap";
import { hasItems, type ObjectValue, type Value } from "../trace/types";
import { diffClass } from "./ArrayRenderer";
import type { RendererProps } from "./types";

const EASE = { duration: 0.4, ease: [0.22, 1, 0.36, 1] } as const;

/** What an item shows: a ref shows its node's value (with the id on hover), anything else its compact text. */
export function itemText(v: Value, heap?: Record<string, ObjectValue>): { text: string; title?: string } {
  if (isRef(v)) {
    const obj = heap?.[v.id];
    return obj ? { text: nodeLabel(obj), title: `${v.id}: ${obj.type}` } : { text: formatValue(v) };
  }
  return { text: formatValue(v) };
}

/**
 * Keys that follow an item when the others shift around it: the item's value, and
 * which copy of that value it is. Popping a queue's front then fades that item out
 * and glides the rest forward, instead of every box changing its value.
 */
export function valueKeys(items: Value[]): string[] {
  const seen = new Map<string, number>();
  return items.map((v) => {
    const c = canonical(v);
    const n = seen.get(c) ?? 0;
    seen.set(c, n + 1);
    return `${c}#${n}`;
  });
}

/** added / same per item, matched by value and count, for kinds whose items shift (queue, deque, priority-queue). */
function addedByCount(prev: Value | undefined, items: Value[]): Change[] | undefined {
  if (!prev || !hasItems(prev)) return undefined;
  return matchByCount(prev.items, items).status;
}

const ENDS: Record<string, [string, string] | null> = {
  queue: ["front", "back"],
  deque: ["front", "back"],
  list: ["front", "back"],
  "priority-queue": null,
  tuple: null,
};

/**
 * stack, queue, deque, list (std::list), tuple, and priority-queue: one row of
 * boxes (a column for a stack, top first). Items fade in, fade out, and glide.
 */
export function SequenceRenderer({ name, value, diff, ctx }: RendererProps) {
  if (!hasItems(value)) throw new Error(`SequenceRenderer got a ${typeof value} value for ${name}`);
  const kind = value.kind;
  const items = value.items;
  const shifting = kind === "queue" || kind === "deque" || kind === "priority-queue" || kind === "list";
  const keys = shifting ? valueKeys(items) : items.map((_, i) => `i${i}`);
  const status = shifting ? addedByCount(diff?.prev, items) : diff?.items;
  const vertical = kind === "stack";
  const order = vertical ? items.map((_, i) => items.length - 1 - i) : items.map((_, i) => i);
  const ends = ENDS[kind] ?? null;
  const meta =
    kind === "priority-queue" && "order" in value
      ? `priority queue (${value.order}) · ${items.length}`
      : `${kind} · ${items.length}`;

  return (
    <section className="structure" aria-label={`${name}: ${kind}`}>
      <header className="structure-label">
        <span className="structure-name">{name}</span>
        <span className="structure-kind">{meta}</span>
      </header>
      <div className={`sequence sequence-${kind} ${vertical ? "sequence-vertical" : ""}`}>
        {ends && items.length > 0 && <span className="sequence-end">{ends[0]}</span>}
        {kind === "tuple" && <span className="sequence-paren">(</span>}
        <AnimatePresence initial={false} mode="popLayout">
          {order.map((i, pos) => {
            const { text, title } = itemText(items[i], ctx.heap);
            const isTop = (vertical && pos === 0) || (kind === "priority-queue" && i === 0);
            return (
              <motion.div
                key={keys[i]}
                layout
                className="sequence-item"
                initial={{ opacity: 0, scale: 0.7, y: vertical ? -12 : 0 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={EASE}
              >
                {isTop && <span className="sequence-top">top</span>}
                <div className={`cell cell-auto ${diffClass(status?.[i])}`} title={title}>
                  {text}
                </div>
                {kind === "list" && pos < order.length - 1 && <span className="sequence-link">⇄</span>}
              </motion.div>
            );
          })}
        </AnimatePresence>
        {kind === "tuple" && <span className="sequence-paren">)</span>}
        {ends && items.length > 0 && <span className="sequence-end">{ends[1]}</span>}
        {items.length === 0 && <div className="empty">empty</div>}
      </div>
    </section>
  );
}

/**
 * set and multiset: members as chips, in the trace's order (never sorted: the order
 * is unspecified, frontend/CLAUDE.md rule 6). Members fade in and out.
 */
export function SetRenderer({ name, value, diff, ctx }: RendererProps) {
  if (!hasItems(value)) throw new Error(`SetRenderer got a ${typeof value} value for ${name}`);
  const items = value.items;
  const keys = valueKeys(items);
  const status: (Change | undefined)[] =
    value.kind === "set" ? items.map((m) => diff?.keys?.get(canonical(m))) : items.map((_, i) => diff?.items?.[i]);
  // Members gone since the previous step stay one step, faded, under the key they had
  // then (value and copy number), so they fade where they were instead of appearing twice.
  const copies = new Map<string, number>();
  for (const m of items) copies.set(canonical(m), (copies.get(canonical(m)) ?? 0) + 1);
  const ghosts = (diff?.removedKeys ?? []).map(({ value: m }) => {
    const c = canonical(m);
    const n = copies.get(c) ?? 0;
    copies.set(c, n + 1);
    return { m, key: `${c}#${n}` };
  });
  return (
    <section className="structure" aria-label={`${name}: ${value.kind}`}>
      <header className="structure-label">
        <span className="structure-name">{name}</span>
        <span className="structure-kind">
          {value.kind} · {items.length}
        </span>
      </header>
      <div className="set">
        <AnimatePresence initial={false} mode="popLayout">
          {items.map((m, i) => {
            const { text, title } = itemText(m, ctx.heap);
            return (
              <motion.span
                key={keys[i]}
                layout
                className={`set-member ${diffClass(status[i])}`}
                title={title}
                initial={{ opacity: 0, scale: 0.7 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.7 }}
                transition={EASE}
              >
                {text}
              </motion.span>
            );
          })}
          {ghosts.map(({ m, key }) => (
            <motion.span key={key} layout className="set-member diff-removed" exit={{ opacity: 0, scale: 0.7 }} transition={EASE}>
              {itemText(m, ctx.heap).text}
            </motion.span>
          ))}
        </AnimatePresence>
        {items.length === 0 && ghosts.length === 0 && <div className="empty">empty</div>}
      </div>
    </section>
  );
}
