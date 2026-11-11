import { isTagged, isUnorderedKind, UNORDERED_KINDS, type Value } from "./types";

const FLOAT_TEXT = { NaN: "NaN", Infinity: "∞", "-Infinity": "-∞" } as const;

/**
 * Compact text for any value: `[2, 7, 11, 15]`, `{2: 0}`, `9007199254740993`, `∞`.
 *
 * Tagged ints are shown by their string. They are never converted to a JS number,
 * so no digit is lost (spec §5, numbers JSON cannot carry exactly).
 */
export function formatValue(v: Value): string {
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "number" || typeof v === "boolean") return String(v);

  switch (v.kind) {
    case "int":
      return v.value;
    case "float":
      return FLOAT_TEXT[v.value] ?? v.value;
    case "array":
    case "list":
    case "stack":
    case "queue":
    case "deque":
    case "priority-queue":
      return `[${v.items.map(formatValue).join(", ")}]`;
    case "tuple":
      return `(${v.items.map(formatValue).join(", ")})`;
    case "set":
    case "multiset":
      return `{${v.items.map(formatValue).join(", ")}}`;
    case "map":
    case "multimap":
      return `{${v.entries.map(([k, val]) => `${formatValue(k)}: ${formatValue(val)}`).join(", ")}}`;
    case "object":
      return `${v.type} {${Object.entries(v.fields)
        .map(([k, f]) => `${k}: ${formatValue(f)}`)
        .join(", ")}}`;
    case "ref":
      return `→ ${v.id}`;
    default:
      // A kind from a newer minor version. Show something rather than crash.
      return JSON.stringify(v);
  }
}

/** The kind column of the state panel. Bare numbers are `int` or `float` by value. */
export function kindOf(v: Value): string {
  if (v === null) return "null";
  if (typeof v === "string") return "string";
  if (typeof v === "boolean") return "bool";
  if (typeof v === "number") return Number.isInteger(v) ? "int" : "float";
  return isTagged(v) ? v.kind : "unknown";
}

/**
 * Canonical string used to compare values and to match map keys and set members.
 * Object keys are sorted, so two equal values always produce the same string. The
 * members of set, multiset, map, and multimap are sorted too, because their order is
 * unspecified (spec §8): the same set listed in another order is the same value.
 * The sort is only for comparing. Nothing is ever drawn in this order.
 */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (typeof v === "object" && v !== null) {
    const rec = v as Record<string, unknown>;
    const unorderedField = isUnorderedKind(rec.kind) ? UNORDERED_KINDS[rec.kind] : null;
    const keys = Object.keys(rec).sort();
    return `{${keys
      .map((k) => {
        const field = rec[k];
        const text =
          k === unorderedField && Array.isArray(field) ? `[${field.map(canonical).sort().join(",")}]` : canonical(field);
        return `${JSON.stringify(k)}:${text}`;
      })
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export function valuesEqual(a: Value, b: Value): boolean {
  return canonical(a) === canonical(b);
}
