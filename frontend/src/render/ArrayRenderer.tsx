import { diffValue, type Change, type ValueDiff } from "../trace/diff";
import { formatValue, fullValue } from "../trace/format";
import { hasItems, isTagged, type Trace, type Value } from "../trace/types";
import { CardHeader, Empty } from "./Card";
import { pointersFor, type Pointer } from "./pointers";
import { readsFrom, type Reads } from "./reads";
import type { RendererProps } from "./types";

/** One cell's width in px. Cells are joined, so this is also the distance between neighbouring cells. Pointer tags are placed with it, so the CSS uses the same variable. */
export const CELL_PX = 40;
export const CELL_STEP_PX = CELL_PX;
/** Height of one row of pointer tags. */
const TAG_ROW_PX = 22;
/** A grid's row height, in px; its row tags are placed with it. */
export const GRID_ROW_PX = 30;
/** A grid's column width, in px. */
export const GRID_COL_PX = 36;

/**
 * array (docs/frontend.md §5.1). Three drawings, chosen by the value's shape alone, never by
 * guessing the problem:
 * - a 1D array: one contiguous strip of joined cells, the index under each, pointer tags under those;
 * - a 2D array whose rows all have the same length and hold only plain values: a grid, with row
 *   indexes on the left and column indexes on top (a DP table, a matrix, a board);
 * - a 2D array with rows of different lengths (an adjacency list): one strip per row, row index on
 *   the left. A local whose rows differ at any step of the run is drawn this way at every step
 *   (ctx.ragged), so Level Order's `result` does not start as a 1 × 1 grid and then turn into rows.
 */
export function ArrayRenderer({ name, value, diff, ctx }: RendererProps) {
  if (!hasItems(value)) throw new Error(`ArrayRenderer got a ${typeof value} value for ${name}`);
  const items = value.items;
  const rows = rowsOf(items);
  const reads = readsFrom(ctx.reads);
  if (rows) {
    const width = rows[0]?.length ?? 0;
    const grid = !ctx.ragged && width > 0 && rows.every((r) => r.length === width);
    const meta = grid ? `array · ${rows.length} × ${width}` : `array · ${rows.length} rows`;
    return (
      <section className="structure" aria-label={`${name}: array`}>
        <CardHeader name={name} meta={meta} op={ctx.op} />
        {grid ? (
          <Grid name={name} rows={rows} diff={diff} reads={reads} pointers={pointersFor(ctx.locals, rows.length, name, ctx.indexes, ctx.steady)} />
        ) : (
          <RaggedRows name={name} rows={rows} diff={diff} reads={reads} pointers={pointersFor(ctx.locals, rows.length, name, ctx.indexes, ctx.steady)} />
        )}
      </section>
    );
  }

  const removed = diff?.removedItems ?? [];
  const pointers = pointersFor(ctx.locals, items.length, name, ctx.indexes, ctx.steady);
  const cell = cellWidth([...items, ...removed.map((r) => r.value)]);
  return (
    <section className="structure" aria-label={`${name}: array`}>
      <CardHeader name={name} meta={`array · ${items.length}`} op={ctx.op} />
      {items.length === 0 && removed.length === 0 ? (
        <Empty />
      ) : (
        <div className="array" style={{ ["--cell" as string]: `${cell}px` }}>
          <div className="array-strip">
            {items.map((v, i) => (
              <div key={i} className={`cell ${diffClass(diff?.items?.[i])}${reads.at(i) || reads.within(i) ? " is-read" : ""}`} title={fullValue(v)}>
                {formatValue(v)}
              </div>
            ))}
            {removed.map(({ index, value: v }) => (
              <div key={`removed-${index}`} className="cell diff-removed">
                {formatValue(v)}
              </div>
            ))}
          </div>
          <div className="array-indexes" aria-hidden="true">
            {items.map((_, i) => (
              <span key={i} className="cell-index">
                {i}
              </span>
            ))}
            {removed.map(({ index }) => (
              <span key={`removed-${index}`} className="cell-index">
                {index}
              </span>
            ))}
          </div>
          <PointerRow pointers={pointers} step={cell} />
        </div>
      )}
    </section>
  );
}

/** Width of every cell of a 1D array, in px: CELL_PX, or wide enough for its longest item ("(())" in Generate Parentheses). One width for all cells, so pointer tags stay one step apart. */
export function cellWidth(items: Value[]): number {
  const longest = Math.max(0, ...items.map((v) => [...formatValue(v)].length));
  return Math.max(CELL_PX, Math.ceil(longest * 8.2 + 14));
}

/** About how wide a pointer's pill is, in px: its name in the mono font plus padding and border. */
const pillWidth = (name: string) => name.length * 7 + 14;

/**
 * Pointer tags under a strip of cells `step` px apart. A tag goes on the first row where its pill
 * does not overlap one already placed, so tags on the same cell stack downwards in trace order, and
 * so do tags on neighbouring narrow cells (a string's `left` and `right` meeting in the middle).
 */
export function PointerRow({ pointers, step = CELL_STEP_PX }: { pointers: Pointer[]; step?: number }) {
  const taken: { lo: number; hi: number }[][] = [];
  const placed = pointers.map((p) => {
    const centre = p.index * step + step / 2;
    const half = Math.max(pillWidth(p.name), step) / 2 + 2;
    const lo = centre - half;
    const hi = centre + half;
    let row = 0;
    while ((taken[row] ?? []).some((t) => lo < t.hi && t.lo < hi)) row++;
    (taken[row] ??= []).push({ lo, hi });
    return { ...p, row };
  });
  const rows = Math.max(0, ...placed.map((p) => p.row + 1));
  if (rows === 0) return null;
  return (
    <div className="pointers" style={{ height: rows * TAG_ROW_PX }}>
      {placed.map((p) => (
        <div key={p.name} className={`pointer${p.steady ? " is-steady" : ""}`} style={{ transform: `translate(${p.index * step}px, ${p.row * TAG_ROW_PX}px)` }} title={`${p.name} = ${p.index}`}>
          <svg className="pointer-arrow" aria-hidden="true" width="9" height="5" viewBox="0 0 10 6">
            <path d="M5 0 10 6H0z" />
          </svg>
          <span className="tag-pill pointer-name">{p.name}</span>
        </div>
      ))}
    </div>
  );
}

/** Row tags to the left of a grid or of ragged rows: a local that indexes the outer array points at its row. */
function RowTags({ pointers, row }: { pointers: Pointer[]; row: number }) {
  const here = pointers.filter((p) => p.index === row);
  return (
    <span className="grid-row-tags">
      {here.map((p) => (
        <span key={p.name} className={`row-tag${p.steady ? " is-steady" : ""}`} title={`${p.name} = ${p.index}`}>
          <span className="tag-pill">{p.name}</span>
          <svg className="pointer-arrow" aria-hidden="true" width="5" height="9" viewBox="0 0 6 10">
            <path d="M6 5 0 0v10z" />
          </svg>
        </span>
      ))}
    </span>
  );
}

/** A grid: every row the same length. Column indexes on top, row indexes (and row tags) on the left. */
function Grid({ name, rows, diff, reads, pointers }: { name: string; rows: Value[][]; diff: ValueDiff | null; reads: Reads; pointers: Pointer[] }) {
  const width = rows[0].length;
  const cells = cellChanges(rows, diff);
  return (
    <div className="grid" role="table" aria-label={`${name}, ${rows.length} rows by ${width} columns`} style={{ ["--grid-col" as string]: `${GRID_COL_PX}px`, ["--grid-row" as string]: `${GRID_ROW_PX}px`, ["--grid-cols" as string]: width }}>
      <span className="grid-corner" aria-hidden="true" />
      <div className="grid-col-indexes" aria-hidden="true">
        {rows[0].map((_, c) => (
          <span key={c} className="cell-index">
            {c}
          </span>
        ))}
      </div>
      <div className="grid-row-heads" aria-hidden="true">
        {rows.map((_, r) => (
          <span key={r} className="grid-row-head">
            <RowTags pointers={pointers} row={r} />
            <span className="cell-index">{r}</span>
          </span>
        ))}
      </div>
      <div className="grid-cells">
        {rows.map((row, r) =>
          row.map((v, c) => (
            <div
              key={`${r}-${c}`}
              role="cell"
              className={`grid-cell ${diffClass(cells[r]?.[c])}${reads.at(r, c) ? " is-read" : ""}`}
              style={{ gridRow: r + 1, gridColumn: c + 1 }}
              title={`${name}[${r}][${c}] = ${fullValue(v)}`}
            >
              {formatValue(v)}
            </div>
          )),
        )}
        {/* A whole row read this step (dp[i - 1]): one outline over the row, placed on the same grid. */}
        {rows.map((_, r) => (reads.at(r) ? <span key={`read-${r}`} className="grid-row-read" style={{ gridRow: r + 1 }} aria-hidden="true" /> : null))}
      </div>
    </div>
  );
}

/** Rows of different lengths: one strip per row, each starting at the left, row index (and row tags) beside it. */
function RaggedRows({ name, rows, diff, reads, pointers }: { name: string; rows: Value[][]; diff: ValueDiff | null; reads: Reads; pointers: Pointer[] }) {
  const cells = cellChanges(rows, diff);
  return (
    <div className="ragged" aria-label={`${name}, ${rows.length} rows`} style={{ ["--cell" as string]: `${CELL_PX}px` }}>
      {rows.map((row, r) => (
        <div key={r} className={`ragged-row ${diff?.items?.[r] === "added" ? "is-added" : ""}`}>
          <span className="grid-row-head">
            <RowTags pointers={pointers} row={r} />
            <span className="cell-index">{r}</span>
          </span>
          {row.length === 0 ? (
            <span className="ragged-empty">empty</span>
          ) : (
            <div className={`array-strip${reads.at(r) ? " is-read" : ""}`}>
              {row.map((v, c) => (
                <div key={c} className={`cell ${diffClass(cells[r]?.[c])}${reads.at(r, c) ? " is-read" : ""}`} title={`${name}[${r}][${c}] = ${fullValue(v)}`}>
                  {formatValue(v)}
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * The rows of an array of arrays whose items are all plain values (numbers, strings, chars, booleans,
 * null, tagged numbers), or null when it is not one: a 1D array, or rows holding containers or refs,
 * which are drawn as one strip of text cells.
 */
export function rowsOf(items: Value[]): Value[][] | null {
  if (items.length === 0) return null;
  const rows: Value[][] = [];
  for (const item of items) {
    if (!isTagged(item) || item.kind !== "array") return null;
    if (!item.items.every(isPlain)) return null;
    rows.push(item.items);
  }
  return rows;
}

/**
 * The locals, as "function/name", whose value is at some step an array of rows of plain values
 * with rows of different lengths (or no columns). Computed once per trace, like the layout of
 * linked structures (frontend/CLAUDE.md rule 2); it decides only which drawing a 2D array gets.
 */
export function raggedLocals(trace: Trace): Set<string> {
  const out = new Set<string>();
  for (const step of trace.steps) {
    for (const frame of step.frames) {
      for (const [name, v] of Object.entries(frame.locals)) {
        if (!hasItems(v)) continue;
        const rows = rowsOf(v.items);
        if (rows && (rows[0].length === 0 || rows.some((r) => r.length !== rows[0].length))) out.add(`${frame.function}/${name}`);
      }
    }
  }
  return out;
}

function isPlain(v: Value): boolean {
  return !isTagged(v) || v.kind === "int" || v.kind === "float";
}

/** Per cell: added or changed since the previous step, from the diff's previous value (diff.prev). */
function cellChanges(rows: Value[][], diff: ValueDiff | null): (Change | undefined)[][] {
  if (!diff) return [];
  if (diff.status === "added") return rows.map((r) => r.map(() => "added" as Change));
  const prev = diff.prev && hasItems(diff.prev) ? diff.prev.items : null;
  return rows.map((row, r) => {
    const status = diff.items?.[r];
    if (status === "added") return row.map(() => "added" as Change);
    if (status !== "changed" || !prev) return [];
    const before = prev[r];
    if (!hasItems(before)) return row.map(() => "changed" as Change);
    const inner = diffValue(before, { kind: "array", items: row });
    return row.map((_, c) => inner.items?.[c]);
  });
}

export function diffClass(c: string | undefined): string {
  return c === "added" ? "diff-added" : c === "changed" ? "diff-changed" : c === "removed" ? "diff-removed" : "";
}
