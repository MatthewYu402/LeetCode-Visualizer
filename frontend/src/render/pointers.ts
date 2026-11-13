import type { Value } from "../trace/types";

/** Conventional index names. The only heuristic for pointer markers; do not add others. */
export const INDEX_NAMES: ReadonlySet<string> = new Set([
  "i", "j", "k", "l", "r", "left", "right", "lo", "hi", "mid", "start", "end", "slow", "fast", "p", "q",
]);

export interface Pointer {
  name: string;
  index: number;
}

/**
 * Locals drawn as markers under the array `arrayName` of `length` items:
 * - an index name whose value is a bare integer n with 0 <= n < length (a tagged int is
 *   beyond 2^53, so it never qualifies), and
 * - an iterator whose container is this array and whose index is in range. That one is not a
 *   guess: the trace says which container it moves through.
 * Returned in the order the trace lists the locals.
 */
export function pointersFor(locals: Record<string, Value>, length: number, arrayName?: string): Pointer[] {
  const out: Pointer[] = [];
  for (const [name, v] of Object.entries(locals)) {
    if (typeof v === "object" && v !== null && v.kind === "iterator") {
      if (v.container === arrayName && v.index !== undefined && v.index < length) out.push({ name, index: v.index });
      continue;
    }
    if (!INDEX_NAMES.has(name)) continue;
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < length) out.push({ name, index: v });
  }
  return out;
}
