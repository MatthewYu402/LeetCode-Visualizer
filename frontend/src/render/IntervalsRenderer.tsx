import { diffClass } from "./ArrayRenderer";
import { CardHeader, Empty } from "./Card";
import { pointersFor } from "./pointers";
import { readsFrom } from "./reads";
import type { RendererProps } from "./types";
import { numberRows } from "./views";

/** The number line's drawn width, a bar's height and row pitch, and a bar's least width (room for "[a, b]"), in px. */
const LINE_PX = 640;
const BAR_H = 24;
const ROW_PX = 30;
const MIN_BAR = 58;
const INDEX_PX = 26;

/** Tick spacing for a range: 1, 2, 5, 10, 20, 50, ... so there are at most about 20 ticks. */
export function tickStep(span: number): number {
  for (let step = 1; ; step *= 10) for (const k of [1, 2, 5]) if (span / (step * k) <= 20) return step * k;
}

/**
 * A 2D array of [start, end] pairs drawn as bars on a number line (docs/frontend.md §5.3), one row
 * per item in array order, the index on the left. Every card drawn as intervals at one step shares
 * one scale (ctx.scale, from VisualPanel), so `merged` lines up under `intervals`. Rows added or
 * changed since the previous step get the diff colours, a local that indexes the array is a tag
 * beside its row, and a row the line read is outlined.
 */
export function IntervalsRenderer({ name, value, diff, ctx }: RendererProps) {
  const rows = numberRows(value) ?? [];
  const removed = (diff?.removedItems ?? []).flatMap(({ index, value: v }) => {
    const r = numberRows({ kind: "array", items: [v] });
    return r ? [{ index, row: r[0] }] : [];
  });
  const all = [...rows, ...removed.map((r) => r.row)];
  const lo = ctx.scale?.lo ?? Math.min(...all.map((r) => r[0]), 0);
  const hi = ctx.scale?.hi ?? Math.max(...all.map((r) => r[1]), lo + 1);
  const span = Math.max(1, hi - lo);
  const x = (v: number) => INDEX_PX + ((v - lo) / span) * LINE_PX;
  const step = tickStep(span);
  const ticks: number[] = [];
  for (let t = Math.ceil(lo / step) * step; t <= hi; t += step) ticks.push(t);
  const reads = readsFrom(ctx.reads);
  const pointers = pointersFor(ctx.locals, rows.length, name, ctx.indexes, ctx.steady);
  const height = all.length * ROW_PX + 22;

  return (
    <section className="structure" aria-label={`${name}: intervals`}>
      <CardHeader name={name} meta={`intervals · ${rows.length}`} op={ctx.op} />
      {all.length === 0 ? (
        <Empty />
      ) : (
        <div className="intervals" style={{ width: INDEX_PX + LINE_PX + 90, height }}>
          {rows.map((r, i) => (
            <IntervalRow key={i} index={i} start={r[0]} end={r[1]} left={x(r[0])} width={Math.max(MIN_BAR, x(r[1]) - x(r[0]))} cls={`${diffClass(diff?.items?.[i])}${reads.at(i) || reads.within(i) ? " is-read" : ""}`} tags={pointers.filter((p) => p.index === i).map((p) => p.name)} />
          ))}
          {removed.map(({ index, row }, k) => (
            <IntervalRow key={`removed-${index}`} index={index} start={row[0]} end={row[1]} left={x(row[0])} width={Math.max(MIN_BAR, x(row[1]) - x(row[0]))} cls="diff-removed" tags={[]} top={(rows.length + k) * ROW_PX} />
          ))}
          <div className="intervals-axis" style={{ top: all.length * ROW_PX + 2, left: INDEX_PX, width: LINE_PX }} aria-hidden="true">
            {ticks.map((t) => (
              <span key={t} className="intervals-tick" style={{ left: x(t) - INDEX_PX }}>
                {t}
              </span>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

function IntervalRow({ index, start, end, left, width, cls, tags, top }: { index: number; start: number; end: number; left: number; width: number; cls: string; tags: string[]; top?: number }) {
  const y = top ?? index * ROW_PX;
  return (
    <>
      <span className="cell-index intervals-index" style={{ top: y + (BAR_H - 14) / 2 }}>
        {index}
      </span>
      <div className={`interval ${cls}`} style={{ left, top: y, width, height: BAR_H }} title={`[${start}, ${end}]`}>
        [{start}, {end}]
      </div>
      {tags.length > 0 && (
        <span className="row-tag intervals-tag" style={{ left: left + width + 6, top: y + 4 }}>
          <svg className="pointer-arrow" aria-hidden="true" width="5" height="9" viewBox="0 0 6 10">
            <path d="M0 5 6 0v10z" />
          </svg>
          <span className="tag-pill">{tags.join(", ")}</span>
        </span>
      )}
    </>
  );
}
