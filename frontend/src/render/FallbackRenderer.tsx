import { canonical, formatValue } from "../trace/format";
import { hasItems, isTagged } from "../trace/types";
import { diffClass } from "./ArrayRenderer";
import type { RendererProps } from "./types";

/**
 * Generic fallback: a labelled row of boxes plus the kind name.
 * Handles every v0.7 kind without a dedicated renderer (list, stack, queue, deque,
 * priority-queue, tuple, set, multiset), plus object, ref, and kinds from future minor
 * versions. A set's boxes are coloured per member (diff.keys); a multiset may repeat a
 * member, so its boxes are coloured per position (diff.items, matched by count).
 */
export function FallbackRenderer({ name, value, diff }: RendererProps) {
  const kind = isTagged(value) ? value.kind : typeof value;
  const extra = isTagged(value) && value.kind === "priority-queue" ? ` · ${value.order}` : "";

  let boxes: { key: string; text: string; cls: string }[];
  if (hasItems(value)) {
    const isSet = value.kind === "set";
    boxes = value.items.map((v, i) => ({
      key: isSet ? canonical(v) : String(i),
      text: formatValue(v),
      cls: diffClass(isSet ? diff?.keys?.get(canonical(v)) : diff?.items?.[i]),
    }));
    for (const r of diff?.removedItems ?? []) boxes.push({ key: `removed-${r.index}`, text: formatValue(r.value), cls: "diff-removed" });
    // Keyed by position: a multiset can lose two copies of the same member at once.
    (diff?.removedKeys ?? []).forEach((r, i) => boxes.push({ key: `removed-key-${i}`, text: formatValue(r.value), cls: "diff-removed" }));
  } else {
    boxes = [{ key: "v", text: formatValue(value), cls: diff && diff.status !== "same" ? "diff-changed" : "" }];
  }

  return (
    <section className="structure" aria-label={`${name}: ${kind}`}>
      <header className="structure-label">
        <span className="structure-name">{name}</span>
        <span className="structure-kind">
          {kind}
          {extra}
          {hasItems(value) ? ` · ${value.items.length}` : ""}
        </span>
      </header>
      <div className="fallback-row">
        {boxes.map((b) => (
          <div key={b.key} className={`cell cell-auto ${b.cls}`}>
            {b.text}
          </div>
        ))}
        {boxes.length === 0 && <div className="empty">empty</div>}
      </div>
    </section>
  );
}
