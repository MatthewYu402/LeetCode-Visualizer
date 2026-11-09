import { canonical, formatValue } from "../trace/format";
import { diffClass } from "./ArrayRenderer";
import type { RendererProps } from "./types";

/**
 * map: a key / value table, in the order the trace lists the entries.
 * Never sorted: map order is unspecified and is real language behaviour (spec §8).
 */
export function MapRenderer({ name, value, diff }: RendererProps) {
  if (typeof value !== "object" || value === null || value.kind !== "map") {
    throw new Error(`MapRenderer got a non-map value for ${name}`);
  }
  const removed = diff?.removedKeys ?? [];

  return (
    <section className="structure" aria-label={`${name}: map`}>
      <header className="structure-label">
        <span className="structure-name">{name}</span>
        <span className="structure-kind">map · {value.entries.length}</span>
      </header>
      <table className="map-table">
        <thead>
          <tr>
            <th>key</th>
            <th>value</th>
          </tr>
        </thead>
        <tbody>
          {value.entries.map(([k, v]) => {
            const key = canonical(k);
            const status = diff?.keys?.get(key);
            return (
              <tr key={key} className={diffClass(status)}>
                <td>{formatValue(k)}</td>
                <td>{formatValue(v)}</td>
              </tr>
            );
          })}
          {removed.map(({ key, value: v }) => (
            <tr key={`removed-${canonical(key)}`} className="diff-removed">
              <td>{formatValue(key)}</td>
              <td>{formatValue(v)}</td>
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
