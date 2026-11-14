import { formatValue } from "../trace/format";
import { hasItems } from "../trace/types";
import { CardHeader, Empty } from "./Card";
import { pointersFor } from "./pointers";
import type { RendererProps } from "./types";

/** One cell's width plus the gap after it, in px. Pointer tags are placed with it, so the CSS uses the same variables. */
export const CELL_PX = 52;
export const CELL_GAP_PX = 6;
export const CELL_STEP_PX = CELL_PX + CELL_GAP_PX;
/** Height of one row of pointer tags. */
const TAG_ROW_PX = 24;

/** array: a row of rounded cells, the index under each, and pointer tags under those that glide between cells. */
export function ArrayRenderer({ name, value, diff, ctx }: RendererProps) {
  if (!hasItems(value)) throw new Error(`ArrayRenderer got a ${typeof value} value for ${name}`);
  const items = value.items;
  const removed = diff?.removedItems ?? [];
  const pointers = pointersFor(ctx.locals, items.length, name);

  // Tags on the same cell stack downwards, in trace order.
  const depth = new Map<number, number>();
  const placed = pointers.map((p) => {
    const d = depth.get(p.index) ?? 0;
    depth.set(p.index, d + 1);
    return { ...p, row: d };
  });
  const rows = Math.max(0, ...placed.map((p) => p.row + 1));

  return (
    <section className="structure" aria-label={`${name}: array`}>
      <CardHeader name={name} meta={`array · ${items.length}`} op={ctx.op} />
      <div className="array" style={{ ["--cell" as string]: `${CELL_PX}px`, ["--cell-gap" as string]: `${CELL_GAP_PX}px` }}>
        <div className="array-cells">
          {items.map((v, i) => (
            <div key={i} className="array-col">
              <div className={`cell ${diffClass(diff?.items?.[i])}`}>{formatValue(v)}</div>
              <div className="cell-index">{i}</div>
            </div>
          ))}
          {removed.map(({ index, value: v }) => (
            <div key={`removed-${index}`} className="array-col">
              <div className="cell diff-removed">{formatValue(v)}</div>
              <div className="cell-index">{index}</div>
            </div>
          ))}
          {items.length === 0 && removed.length === 0 && <Empty />}
        </div>
        {rows > 0 && (
          <div className="pointers" style={{ height: rows * TAG_ROW_PX }}>
            {placed.map((p) => (
              <div
                key={p.name}
                className="pointer"
                style={{ transform: `translate(${p.index * CELL_STEP_PX}px, ${p.row * TAG_ROW_PX}px)` }}
                title={`${p.name} = ${p.index}`}
              >
                <svg className="pointer-arrow" aria-hidden="true" width="10" height="6" viewBox="0 0 10 6">
                  <path d="M5 0 10 6H0z" />
                </svg>
                <span className="tag-pill pointer-name">{p.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export function diffClass(c: string | undefined): string {
  return c === "added" ? "diff-added" : c === "changed" ? "diff-changed" : c === "removed" ? "diff-removed" : "";
}
