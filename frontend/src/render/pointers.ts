import type { Value } from "../trace/types";

export interface Pointer {
  name: string;
  index: number;
}

/**
 * Locals drawn as markers under the array `arrayName` of `length` items (frontend/CLAUDE.md rule 7):
 * - an integer local that the trace's `indexes` says the running function uses to index this
 *   array (`indexes` is that function's entry: local name -> container names), whose value is a
 *   bare integer n with 0 <= n < length (a tagged int is beyond 2^53, so it never qualifies), and
 * - an iterator whose container is this array and whose index is in range.
 * Neither is a guess: the adapter read the first from the source, and the trace says which
 * container an iterator moves through. Returned in the order the trace lists the locals.
 */
export function pointersFor(
  locals: Record<string, Value>,
  length: number,
  arrayName: string,
  indexes?: Readonly<Record<string, readonly string[]>>,
): Pointer[] {
  const out: Pointer[] = [];
  for (const [name, v] of Object.entries(locals)) {
    if (typeof v === "object" && v !== null && v.kind === "iterator") {
      if (v.container === arrayName && v.index !== undefined && v.index < length) out.push({ name, index: v.index });
      continue;
    }
    if (!indexes?.[name]?.includes(arrayName)) continue;
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < length) out.push({ name, index: v });
  }
  return out;
}
