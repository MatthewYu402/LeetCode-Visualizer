import { formatValue } from "../trace/format";
import { hasItems } from "../trace/types";
import { pointersFor } from "./pointers";
import type { RendererProps } from "./types";

/** Box width in px, including the border. Pointer markers are positioned with it, so the CSS uses the same variable. */
export const CELL_PX = 52;

/** array: a row of boxes, the index under each, then pointer markers. */
export function ArrayRenderer({ name, value, diff, ctx }: RendererProps) {
  if (!hasItems(value)) throw new Error(`ArrayRenderer got a ${typeof value} value for ${name}`);
  const items = value.items;
  const removed = diff?.removedItems ?? [];
  const pointers = pointersFor(ctx.locals, items.length, name);

  // Markers on the same box stack downwards, in trace order.
  const depth = new Map<number, number>();
  const placed = pointers.map((p) => {
    const d = depth.get(p.index) ?? 0;
    depth.set(p.index, d + 1);
    return { ...p, row: d };
  });
  const rows = Math.max(0, ...placed.map((p) => p.row + 1));

  return (
    <section className="structure" aria-label={`${name}: array`}>
      <header className="structure-label">
        <span className="structure-name">{name}</span>
        <span className="structure-kind">array · {items.length}</span>
      </header>
      <div className="array" style={{ ["--cell" as string]: `${CELL_PX}px` }}>
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
          {items.length === 0 && removed.length === 0 && <div className="empty">empty</div>}
        </div>
        {rows > 0 && (
          <div className="pointers" style={{ height: rows * 22 }}>
            {placed.map((p) => (
              <div
                key={p.name}
                className="pointer"
                style={{ transform: `translate(${p.index * CELL_PX}px, ${p.row * 22}px)` }}
                title={`${p.name} = ${p.index}`}
              >
                <span className="pointer-arrow">▲</span> {p.name}
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
