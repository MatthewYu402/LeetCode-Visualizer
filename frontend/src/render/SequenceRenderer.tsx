import { AnimatePresence, motion } from "framer-motion";
import { matchByCount, type Change } from "../trace/diff";
import { canonical, formatValue } from "../trace/format";
import { isRef, nodeLabel } from "../trace/heap";
import { hasItems, type ObjectValue, type Value } from "../trace/types";
import { diffClass } from "./ArrayRenderer";
import { CardHeader, Empty } from "./Card";
import type { RendererProps } from "./types";

export const EASE = { duration: 0.4, ease: [0.22, 1, 0.36, 1] } as const;

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

/** added / same per item, matched by value and count, for kinds whose items shift (queue, deque). */
function addedByCount(prev: Value | undefined, items: Value[]): Change[] | undefined {
  if (!prev || !hasItems(prev)) return undefined;
  return matchByCount(prev.items, items).status;
}

/** A stack drawn whole up to this many items; past it, the top 3, one folded row, and the bottom 2. */
export const STACK_WHOLE = 6;
const STACK_TOP = 3;
const STACK_BOTTOM = 2;

/**
 * stack: a vertical container open at the top, the top item first, with a `top` tag beside
 * it. Pushed items drop in from above; popped ones lift out and fade. A deep stack folds
 * its middle into one "⋮ N more" row. Items are matched by position from the bottom.
 */
export function StackRenderer({ name, value, diff, ctx }: RendererProps) {
  if (!hasItems(value)) throw new Error(`StackRenderer got a ${typeof value} value for ${name}`);
  const items = value.items;
  const n = items.length;
  // Bottom-up indices to draw, top first; a folded run of indices becomes one row.
  const fold = n > STACK_WHOLE;
  const top = items.map((_, i) => n - 1 - i).slice(0, fold ? STACK_TOP : n);
  const bottom = fold ? [STACK_BOTTOM - 1, 0].filter((i) => i >= 0) : [];
  const hidden = fold ? n - STACK_TOP - STACK_BOTTOM : 0;

  const item = (i: number) => {
    const { text, title } = itemText(items[i], ctx.heap);
    return (
      <motion.div
        key={`s${i}`}
        layout
        className="stack-item"
        initial={{ opacity: 0, y: -14 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -14 }}
        transition={EASE}
      >
        <div className={`cell cell-auto ${diffClass(diff?.items?.[i])}`} title={title}>
          {text}
        </div>
        {i === n - 1 && (
          <span className="tag tag-side">
            <svg className="tag-arrow" aria-hidden="true" width="6" height="10" viewBox="0 0 6 10">
              <path d="M6 0v10L0 5z" />
            </svg>
            <span className="tag-pill">top</span>
          </span>
        )}
      </motion.div>
    );
  };

  return (
    <section className="structure" aria-label={`${name}: stack`}>
      <CardHeader name={name} meta={`stack · ${n}`} op={ctx.op} />
      <div className="stack">
        <AnimatePresence initial={false} mode="popLayout">
          {top.map(item)}
          {fold && (
            <motion.div key="fold" layout className="stack-fold" title={`${hidden} items between`} transition={EASE}>
              <span aria-hidden="true">⋮</span> {hidden} more
            </motion.div>
          )}
          {bottom.map(item)}
        </AnimatePresence>
        {n === 0 && <Empty />}
      </div>
    </section>
  );
}

/**
 * queue and deque: a horizontal tube, open at both ends, "front" and "back" under the ends.
 * A queue's arrows show the flow (in at the back, out at the front); a deque's are
 * double-headed. Items keep their identity by value and copy, so they glide forward.
 */
export function TubeRenderer({ name, value, diff, ctx }: RendererProps) {
  if (!hasItems(value)) throw new Error(`TubeRenderer got a ${typeof value} value for ${name}`);
  const items = value.items;
  const keys = valueKeys(items);
  const status = addedByCount(diff?.prev, items);
  const both = value.kind === "deque";
  const end = (
    <svg className="tube-arrow" aria-hidden="true" width="28" height="12" viewBox="0 0 28 12">
      <path d={both ? "M1 6h26M7 1.5 1 6l6 4.5M21 1.5 27 6l-6 4.5" : "M27 6H1M7 1.5 1 6l6 4.5"} />
    </svg>
  );
  return (
    <section className="structure" aria-label={`${name}: ${value.kind}`}>
      <CardHeader name={name} meta={`${value.kind} · ${items.length}`} op={ctx.op} />
      <div className="tube-wrap">
        {end}
        <div className="tube-body">
          <div className="tube">
            <AnimatePresence initial={false} mode="popLayout">
              {items.map((v, i) => {
                const { text, title } = itemText(v, ctx.heap);
                return (
                  <motion.div
                    key={keys[i]}
                    layout
                    className={`cell cell-auto ${diffClass(status?.[i])}`}
                    title={title}
                    initial={{ opacity: 0, x: 18 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: -18 }}
                    transition={EASE}
                  >
                    {text}
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {items.length === 0 && <span className="tube-empty">empty</span>}
          </div>
          <div className="ends" aria-hidden="true">
            <span>front</span>
            <span>back</span>
          </div>
        </div>
        {end}
      </div>
    </section>
  );
}

/**
 * list (node-based, no identity): cells joined by two-way links, "front" and "back" under the
 * ends. The diff matches items in order (longest common subsequence), so a push at the front
 * adds one item and the rest glide; an item that moved is amber.
 */
export function ListRenderer({ name, value, diff, ctx }: RendererProps) {
  if (!hasItems(value)) throw new Error(`ListRenderer got a ${typeof value} value for ${name}`);
  const items = value.items;
  const keys = valueKeys(items);
  return (
    <section className="structure" aria-label={`${name}: list`}>
      <CardHeader name={name} meta={`list · ${items.length}`} op={ctx.op} />
      <div className="list-wrap">
        <div className="list">
          <AnimatePresence initial={false} mode="popLayout">
            {items.map((v, i) => {
              const { text, title } = itemText(v, ctx.heap);
              return (
                <motion.div
                  key={keys[i]}
                  layout
                  className="list-item"
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 8 }}
                  transition={EASE}
                >
                  <div className={`cell cell-auto ${diffClass(diff?.items?.[i])}`} title={title}>
                    {text}
                  </div>
                  {i < items.length - 1 && (
                    <svg className="list-link" aria-hidden="true" width="26" height="14" viewBox="0 0 26 14">
                      <path d="M1 4h23M20 1l4 3-4 3M25 10H2M6 7l-4 3 4 3" />
                    </svg>
                  )}
                </motion.div>
              );
            })}
          </AnimatePresence>
          {items.length === 0 && <Empty />}
        </div>
        {items.length > 0 && (
          <div className="ends" aria-hidden="true">
            <span>front</span>
            <span>back</span>
          </div>
        )}
      </div>
    </section>
  );
}

/** tuple: the elements inside faint parentheses, each with its position (0, 1, ...) under it. */
export function TupleRenderer({ name, value, diff, ctx }: RendererProps) {
  if (!hasItems(value)) throw new Error(`TupleRenderer got a ${typeof value} value for ${name}`);
  const items = value.items;
  return (
    <section className="structure" aria-label={`${name}: tuple`}>
      <CardHeader name={name} meta={`tuple · ${items.length}`} op={ctx.op} />
      <div className="tuple">
        <span className="bracket" aria-hidden="true">
          (
        </span>
        {items.map((v, i) => {
          const { text, title } = itemText(v, ctx.heap);
          return (
            <div key={i} className="tuple-part">
              <div className="array-col">
                <div className={`cell cell-auto ${diffClass(diff?.items?.[i])}`} title={title}>
                  {text}
                </div>
                <div className="cell-index">{i}</div>
              </div>
              {i < items.length - 1 && (
                <span className="tuple-comma" aria-hidden="true">
                  ,
                </span>
              )}
            </div>
          );
        })}
        <span className="bracket" aria-hidden="true">
          )
        </span>
      </div>
    </section>
  );
}

/**
 * set and multiset: members inside faint curly braces, in the trace's order (never sorted:
 * the order is unspecified, rule 6). A multiset shows each value once, with a ×N badge when it
 * holds more than one copy; the badge turns amber when the count changes (matched by count).
 * A member that is gone stays one step, faded.
 */
export function SetRenderer({ name, value, diff, ctx }: RendererProps) {
  if (!hasItems(value)) throw new Error(`SetRenderer got a ${typeof value} value for ${name}`);
  const multi = value.kind === "multiset";
  const prev = diff?.prev && hasItems(diff.prev) && diff.prev.kind === value.kind ? diff.prev.items : null;

  // One chip per distinct member, in order of first appearance, with its count now and before.
  const count = (list: Value[]) => {
    const m = new Map<string, { v: Value; n: number }>();
    for (const v of list) {
      const c = canonical(v);
      const e = m.get(c);
      if (e) e.n++;
      else m.set(c, { v, n: 1 });
    }
    return m;
  };
  const now = count(value.items);
  const before = prev ? count(prev) : null;
  const chips = [...now.entries()].map(([c, { v, n }]) => {
    const was = before?.get(c)?.n ?? 0;
    const status: Change | undefined = !before ? undefined : was === 0 ? "added" : was !== n ? "changed" : "same";
    return { c, v, n, status };
  });
  const ghosts = before ? [...before.entries()].filter(([c]) => !now.has(c)).map(([c, { v }]) => ({ c, v })) : [];
  const size = value.items.length;

  return (
    <section className="structure" aria-label={`${name}: ${value.kind}`}>
      <CardHeader name={name} meta={`${multi ? "multiset" : "set"} · ${size}`} op={ctx.op} />
      <div className="set">
        <span className="bracket" aria-hidden="true">
          {"{"}
        </span>
        <AnimatePresence initial={false} mode="popLayout">
          {chips.map(({ c, v, n, status }) => {
            const { text, title } = itemText(v, ctx.heap);
            return (
              <motion.span
                key={c}
                layout
                className={`set-member ${diffClass(status)}`}
                title={title}
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={EASE}
              >
                {text}
                {multi && n > 1 && <span className={`count-badge ${status === "changed" ? "is-changed" : ""}`}>×{n}</span>}
              </motion.span>
            );
          })}
          {ghosts.map(({ c, v }) => (
            <motion.span key={c} layout className="set-member diff-removed" exit={{ opacity: 0 }} transition={EASE}>
              {itemText(v, ctx.heap).text}
            </motion.span>
          ))}
        </AnimatePresence>
        {size === 0 && ghosts.length === 0 && <span className="set-empty">empty</span>}
        <span className="bracket" aria-hidden="true">
          {"}"}
        </span>
      </div>
    </section>
  );
}
