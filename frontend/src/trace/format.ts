import { isTagged, isUnorderedKind, UNORDERED_KINDS, type Value } from "./types";

const FLOAT_TEXT = { NaN: "NaN", Infinity: "∞", "-Infinity": "-∞" } as const;

/**
 * The limits of 32- and 64-bit integers, written as powers of two: `2³¹−1` instead of
 * 2147483647, the "infinity" Dijkstra and DP solutions start from. Ten digits in every cell
 * of a `dist` array hide the few that matter; these say what the value is in any language
 * (INT_MAX, Integer.MAX_VALUE, sys.maxsize). The full number stays in the cell's tooltip
 * (`fullValue`). Matched by text, so the 64-bit ones, which are tagged ints, keep every digit.
 */
const LIMITS: Record<string, string> = {
  "2147483647": "2³¹−1",
  "-2147483648": "−2³¹",
  "4294967295": "2³²−1",
  "9223372036854775807": "2⁶³−1",
  "-9223372036854775808": "−2⁶³",
  "18446744073709551615": "2⁶⁴−1",
};

/** A value's text with every digit, for tooltips: formatValue but with integer limits written out. */
export function fullValue(v: Value, node?: (id: string) => string | undefined): string {
  return formatIn(v, node, false);
}

/**
 * Compact text for any value: `[2, 7, 11, 15]`, `{2: 0}`, `9007199254740993`, `∞`.
 *
 * Tagged ints are shown by their string. They are never converted to a JS number,
 * so no digit is lost (spec §5, numbers JSON cannot carry exactly).
 *
 * `node` names what a ref points at (its node's value, from the step's heap); without it, or
 * when it has no name for an id, a ref shows its id: `→ n1`.
 */
export function formatValue(v: Value, node?: (id: string) => string | undefined): string {
  return formatIn(v, node, true);
}

/** formatValue's body. Inside it, `formatValue` is the one-argument version for nested values, carrying `node` along. */
function formatIn(v: Value, node: ((id: string) => string | undefined) | undefined, limits: boolean): string {
  const formatValue = (x: Value) => formatIn(x, node, limits);
  if (v === null) return "null";
  if (typeof v === "string") return JSON.stringify(v);
  if (typeof v === "boolean") return String(v);
  if (typeof v === "number") return (limits && Number.isInteger(v) && LIMITS[String(v)]) || String(v);

  switch (v.kind) {
    case "int":
      return (limits && LIMITS[v.value]) || v.value;
    case "float":
      return FLOAT_TEXT[v.value as keyof typeof FLOAT_TEXT] ?? v.value;
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
      return `→ ${node?.(v.id) ?? v.id}`;
    case "iterator":
      // Where it points, in the container's own terms: nums[2], numMap[7], numMap.end().
      if (v.index !== undefined) return `→ ${v.container}[${v.index}]`;
      if (v.key !== undefined) return `→ ${v.container}[${formatValue(v.key)}]`;
      return `→ ${v.container}.end()`;
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
