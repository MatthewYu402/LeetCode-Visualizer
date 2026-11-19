import type { Value } from "../trace/types";

export interface Pointer {
  name: string;
  index: number;
  /** The local holds one value for the whole run (`amount`, `m`): drawn muted, since it marks a place, not a moving position. */
  steady?: boolean;
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
  steady?: ReadonlySet<string>,
): Pointer[] {
  const out: Pointer[] = [];
  for (const [name, v] of Object.entries(locals)) {
    if (typeof v === "object" && v !== null && v.kind === "iterator") {
      if (v.container === arrayName && v.index !== undefined && v.index < length) out.push({ name, index: v.index });
      continue;
    }
    if (!indexes?.[name]?.includes(arrayName)) continue;
    if (typeof v === "number" && Number.isInteger(v) && v >= 0 && v < length) out.push({ name, index: v, steady: steady?.has(name) });
  }
  return out;
}

/**
 * For each function, its integer locals that hold one value for the whole run, in every frame of
 * it: `amount` in Coin Change, `m` and `n` in LCS. Their markers are drawn muted (frontend.md §6.2).
 * Computed once per trace, like raggedLocals; a local seen at a single step is not counted as steady.
 */
export function steadyLocals(trace: { steps: { frames: { function: string; locals: Record<string, Value> }[] }[] }): Map<string, Set<string>> {
  const seen = new Map<string, { value: Value; steps: number; same: boolean }>();
  for (const step of trace.steps)
    for (const f of step.frames)
      for (const [name, v] of Object.entries(f.locals)) {
        if (typeof v !== "number") continue;
        const key = `${f.function}/${name}`;
        const s = seen.get(key);
        if (!s) seen.set(key, { value: v, steps: 1, same: true });
        else {
          s.steps++;
          if (s.value !== v) s.same = false;
        }
      }
  const out = new Map<string, Set<string>>();
  for (const [key, s] of seen) {
    if (!s.same || s.steps < 2) continue;
    const [fn, name] = [key.slice(0, key.indexOf("/")), key.slice(key.indexOf("/") + 1)];
    if (!out.has(fn)) out.set(fn, new Set());
    out.get(fn)!.add(name);
  }
  return out;
}
