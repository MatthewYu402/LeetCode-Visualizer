import { isTagged, type Value } from "../trace/types";
import { CardHeader } from "./Card";
import type { RendererProps } from "./types";

/**
 * Generic fallback, for a kind with no view yet (an `object` local, or a kind from a future
 * minor version): the value as formatted data in an inset box, so nothing is ever hidden and
 * nothing crashes (rule 8). Lines whose text changed since the step before are tinted.
 */
export function FallbackRenderer({ name, value, diff, ctx }: RendererProps) {
  const kind = isTagged(value) ? value.kind : typeof value;
  const lines = asLines(value);
  const before = diff && diff.status !== "same" && diff.prev !== undefined ? asLines(diff.prev) : null;
  return (
    <section className="structure" aria-label={`${name}: ${kind}`}>
      <CardHeader name={name} meta={kind} op={ctx.op} />
      <pre className={`data-box ${before ? "is-changed" : ""}`}>
        {lines.map((line, i) => (
          <span key={i} className={before && before[i] !== line ? "data-line is-changed" : "data-line"}>
            {line}
            {"\n"}
          </span>
        ))}
      </pre>
      <p className="data-note">There is no view for this kind yet, so it is shown as data.</p>
    </section>
  );
}

/** The value as indented JSON, one line per entry. Tagged numbers are tagged objects, so their text is kept exactly. */
function asLines(v: Value): string[] {
  return JSON.stringify(v, null, 2).split("\n");
}
