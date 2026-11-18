import { canonical } from "../trace/format";
import type { ReadAt } from "../trace/types";

/** What the running line read of one local, ready to look up: positions as "1" or "1,2", keys canonically. */
export interface Reads {
  /** A position, "i" or "r,c", that was read. */
  at(...index: number[]): boolean;
  /** A key of a map, or member of a set, that was read. */
  key(canonicalKey: string): boolean;
  /** Something inside item `i` was read: `words[i][j]`, a character of a string in a 1D array of strings. */
  within(i: number): boolean;
}

export function readsFrom(reads: readonly ReadAt[] | undefined): Reads {
  const at = new Set<string>();
  const inside = new Set<number>();
  const keys = new Set<string>();
  for (const r of reads ?? []) {
    if ("at" in r) {
      at.add(r.at.join(","));
      if (r.at.length > 1) inside.add(r.at[0]);
    } else keys.add(canonical(r.key));
  }
  return { at: (...index) => at.has(index.join(",")), key: (k) => keys.has(k), within: (i) => inside.has(i) };
}
