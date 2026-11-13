import { canonical } from "../trace/format";
import { itemText } from "./SequenceRenderer";
import { diffClass } from "./ArrayRenderer";
import type { ObjectValue, Value } from "../trace/types";
import type { RendererProps } from "./types";

/**
 * map and multimap: a key / value table, in the order the trace lists the entries.
 * Never sorted: map order is unspecified and is real language behaviour (spec §8).
 * A multimap may repeat a key, so its rows are coloured per entry (diff.entries),
 * and a map's per key (diff.keys).
 */
export function MapRenderer({ name, value, diff, ctx }: RendererProps) {
  if (typeof value !== "object" || value === null || (value.kind !== "map" && value.kind !== "multimap")) {
    throw new Error(`MapRenderer got a non-map value for ${name}`);
  }
  const multi = value.kind === "multimap";
  const removed = diff?.removedKeys ?? [];

  return (
    <section className="structure" aria-label={`${name}: ${value.kind}`}>
      <header className="structure-label">
        <span className="structure-name">{name}</span>
        <span className="structure-kind">
          {value.kind} · {value.entries.length}
        </span>
      </header>
      <table className="map-table">
        <thead>
          <tr>
            <th>key</th>
            <th>value</th>
          </tr>
        </thead>
        <tbody>
          {value.entries.map(([k, v], i) => {
            // A map key is unique, so it is a stable row key. A multimap key may repeat.
            const key = multi ? `entry-${i}` : canonical(k);
            const status = multi ? diff?.entries?.[i] : diff?.keys?.get(key);
            return (
              <tr key={key} className={diffClass(status)}>
                <Cell v={k} heap={ctx.heap} />
                <Cell v={v} heap={ctx.heap} />
              </tr>
            );
          })}
          {removed.map(({ key, value: v }, i) => (
            <tr key={multi ? `removed-${i}` : `removed-${canonical(key)}`} className="diff-removed">
              <Cell v={key} heap={ctx.heap} />
              <Cell v={v} heap={ctx.heap} />
            </tr>
          ))}
          {value.entries.length === 0 && removed.length === 0 && (
            <tr>
              <td colSpan={2} className="empty">
                empty
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </section>
  );
}

/** One cell: a ref shows its node's value (the id on hover), anything else its compact text. */
function Cell({ v, heap }: { v: Value; heap?: Record<string, ObjectValue> }) {
  const { text, title } = itemText(v, heap);
  return <td title={title}>{text}</td>;
}
