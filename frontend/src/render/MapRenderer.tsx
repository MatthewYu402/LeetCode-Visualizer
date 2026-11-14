import { canonical } from "../trace/format";
import type { Change } from "../trace/diff";
import type { ObjectValue, Value } from "../trace/types";
import { diffClass } from "./ArrayRenderer";
import { CardHeader, Empty } from "./Card";
import { itemText } from "./SequenceRenderer";
import type { RendererProps } from "./types";

/**
 * map: one row per entry, key → value, in the order the trace lists them. Never sorted:
 * map order is unspecified and is real language behaviour (spec §8). Rows are coloured
 * per key (diff.keys); an entry whose key is gone stays one step, faded.
 */
export function MapRenderer({ name, value, diff, ctx }: RendererProps) {
  if (typeof value !== "object" || value === null || value.kind !== "map") throw new Error(`MapRenderer got a non-map value for ${name}`);
  const removed = diff?.removedKeys ?? [];
  return (
    <section className="structure" aria-label={`${name}: map`}>
      <CardHeader name={name} meta={`hash map · ${value.entries.length}`} op={ctx.op} />
      <div className="kv" role="table" aria-label={`${name} entries`}>
        <div className="kv-head" role="row">
          <span role="columnheader">key</span>
          <span aria-hidden="true" />
          <span role="columnheader">value</span>
        </div>
        {value.entries.map(([k, v]) => {
          const key = canonical(k);
          return <Row key={key} k={k} v={v} status={diff?.keys?.get(key)} heap={ctx.heap} />;
        })}
        {removed.map(({ key, value: v }) => (
          <Row key={`removed-${canonical(key)}`} k={key} v={v} status="removed" heap={ctx.heap} />
        ))}
        {value.entries.length === 0 && removed.length === 0 && <Empty />}
      </div>
    </section>
  );
}

function Row({ k, v, status, heap }: { k: Value; v: Value; status?: Change; heap?: Record<string, ObjectValue> }) {
  const key = itemText(k, heap);
  const val = itemText(v, heap);
  return (
    <div className={`kv-row ${diffClass(status)}`} role="row">
      <span role="cell" title={key.title}>
        {key.text}
      </span>
      <Arrow />
      <span role="cell" title={val.title}>
        {val.text}
      </span>
    </div>
  );
}

function Arrow() {
  return (
    <svg className="kv-arrow" aria-hidden="true" width="16" height="10" viewBox="0 0 16 10">
      <path d="M1 5h13M10 1l4 4-4 4" />
    </svg>
  );
}

/**
 * multimap: one row per key, in order of first appearance, with that key's values side by
 * side. Entries are matched by count (diff.entries), so erasing one ("2", "to") fades only that
 * value. An entry that is gone stays one step, faded: in its key's row, or as a faded row when
 * the whole key is gone.
 */
export function MultimapRenderer({ name, value, diff, ctx }: RendererProps) {
  if (typeof value !== "object" || value === null || value.kind !== "multimap") throw new Error(`MultimapRenderer got a non-multimap value for ${name}`);
  type Chip = { v: Value; status?: Change; key: string };
  const rows = new Map<string, { k: Value; chips: Chip[]; live: boolean }>();
  const row = (k: Value) => {
    const c = canonical(k);
    if (!rows.has(c)) rows.set(c, { k, chips: [], live: false });
    return rows.get(c)!;
  };
  value.entries.forEach(([k, v], i) => {
    const r = row(k);
    r.live = true;
    r.chips.push({ v, status: diff?.entries?.[i], key: `e${i}` });
  });
  (diff?.removedKeys ?? []).forEach(({ key, value: v }, i) => row(key).chips.push({ v, status: "removed", key: `removed-${i}` }));

  return (
    <section className="structure" aria-label={`${name}: multimap`}>
      <CardHeader name={name} meta={`multimap · ${value.entries.length}`} op={ctx.op} />
      <div className="kv kv-multi" role="table" aria-label={`${name} entries`}>
        <div className="kv-head" role="row">
          <span role="columnheader">key</span>
          <span aria-hidden="true" />
          <span role="columnheader">values</span>
        </div>
        {[...rows.entries()].map(([c, r]) => {
          const key = itemText(r.k, ctx.heap);
          return (
            <div key={c} className={`kv-row ${r.live ? "" : "diff-removed"}`} role="row">
              <span role="cell" className="kv-key" title={key.title}>
                {key.text}
              </span>
              <Arrow />
              <span role="cell" className="kv-values">
                {r.chips.map((chip) => {
                  const t = itemText(chip.v, ctx.heap);
                  return (
                    <span key={chip.key} className={`chip ${diffClass(chip.status)}`} title={t.title}>
                      {t.text}
                    </span>
                  );
                })}
              </span>
            </div>
          );
        })}
        {rows.size === 0 && <Empty />}
      </div>
    </section>
  );
}
