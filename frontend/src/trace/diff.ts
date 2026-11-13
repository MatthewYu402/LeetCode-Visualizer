import { canonical, valuesEqual } from "./format";
import { heapDiff, type HeapDiff } from "./heap";
import { hasItems, isTagged, topFrame, type Step, type Value } from "./types";

// Diffs are for animation only (spec §6). A step must draw correctly with no diff.

export type Change = "added" | "removed" | "changed" | "same";

export interface ValueDiff {
  status: Change;
  /** The value in the previous step. Set for `removed` and `changed`, so a removed value can be drawn faded. */
  prev?: Value;
  /**
   * Indexed kinds (array, list, stack, queue, deque, priority-queue, tuple): status per index of the current items.
   * multiset: also per index of the current items, but matched by count, not position (see matchByCount).
   */
  items?: Change[];
  /** Indexed kinds: items past the new length, with their old index, to draw faded. */
  removedItems?: { index: number; value: Value }[];
  /** multimap: status per index of the current entries, matched by count (see matchByCount). */
  entries?: Change[];
  /** set and map: status per canonical key (member for set, key for map) present in the current value. */
  keys?: Map<string, Change>;
  /**
   * set: members gone since prev. map: entries whose key is gone since prev.
   * multiset: copies gone since prev (key and value are the member). multimap: entries gone since prev.
   */
  removedKeys?: { key: Value; value: Value }[];
}

export interface StepDiff {
  /** The running frame's locals: one entry per local in either version of that frame. Removed locals are included. */
  locals: Record<string, ValueDiff>;
  /** Nodes and edges added, removed, or changed in the heap (trace/heap.ts). */
  heap: HeapDiff;
}

/**
 * Diff two adjacent steps, local by local, for the running frame. Pure.
 *
 * The running frame of `curr` is compared with the frame that has the same id in
 * `prev`, wherever it sat on the stack. So after a return, the caller is compared
 * with its own earlier self, and the variable that took the returned value shows as
 * changed. A frame that is new in `curr` (a call just began) has every local added.
 */
export function diff(prev: Step, curr: Step): StepDiff {
  const now = topFrame(curr);
  const before = prev.frames.find((f) => f.id === now.id)?.locals ?? {};
  const locals: Record<string, ValueDiff> = {};
  for (const [name, value] of Object.entries(now.locals)) {
    locals[name] = name in before ? diffValue(before[name], value) : { status: "added" };
  }
  for (const [name, value] of Object.entries(before)) {
    if (!(name in now.locals)) locals[name] = { status: "removed", prev: value };
  }
  return { locals, heap: heapDiff(prev, curr) };
}

/** Diff one value against its previous version. Goes one level into containers. */
export function diffValue(prev: Value, curr: Value): ValueDiff {
  if (valuesEqual(prev, curr)) return { status: "same" };
  const sameKind = isTagged(prev) && isTagged(curr) && prev.kind === curr.kind;
  if (!sameKind) return { status: "changed", prev };

  if (curr.kind === "map" && prev.kind === "map") {
    const before = new Map(prev.entries.map(([k, v]) => [canonical(k), v] as const));
    const after = new Set(curr.entries.map(([k]) => canonical(k)));
    const keys = new Map<string, Change>();
    for (const [k, v] of curr.entries) {
      const ck = canonical(k);
      keys.set(ck, !before.has(ck) ? "added" : valuesEqual(before.get(ck)!, v) ? "same" : "changed");
    }
    const removedKeys = prev.entries.filter(([k]) => !after.has(canonical(k))).map(([key, value]) => ({ key, value }));
    return { status: "changed", prev, keys, removedKeys };
  }

  if (curr.kind === "set" && prev.kind === "set") {
    const before = new Set(prev.items.map(canonical));
    const after = new Set(curr.items.map(canonical));
    const keys = new Map<string, Change>();
    for (const m of curr.items) keys.set(canonical(m), before.has(canonical(m)) ? "same" : "added");
    const removedKeys = prev.items.filter((m) => !after.has(canonical(m))).map((m) => ({ key: m, value: m }));
    return { status: "changed", prev, keys, removedKeys };
  }

  if (curr.kind === "multiset" && prev.kind === "multiset") {
    const { status, removed } = matchByCount(prev.items, curr.items);
    return { status: "changed", prev, items: status, removedKeys: removed.map((m) => ({ key: m, value: m })) };
  }

  if (curr.kind === "multimap" && prev.kind === "multimap") {
    // An entry is a [key, value] pair, so a value that changed under a repeated key
    // shows as the new pair added and the old pair removed. With repeated keys there
    // is no way to tell which old value became which new one.
    const { status, removed } = matchByCount(prev.entries, curr.entries);
    return { status: "changed", prev, entries: status, removedKeys: removed.map(([key, value]) => ({ key, value })) };
  }

  if (hasItems(prev) && hasItems(curr)) {
    const items: Change[] = curr.items.map((v, i) =>
      i >= prev.items.length ? "added" : valuesEqual(prev.items[i], v) ? "same" : "changed",
    );
    const removedItems = prev.items.slice(curr.items.length).map((value, k) => ({ index: curr.items.length + k, value }));
    return { status: "changed", prev, items, removedItems };
  }

  // object, ref, or a future kind: no per-item detail in this version.
  return { status: "changed", prev };
}

/**
 * Matches the members of two unordered lists that may repeat (multiset items,
 * multimap entries). Each current member is "same" while prev still has an unmatched
 * equal copy, and "added" once those run out. The prev copies left unmatched are the
 * removed ones. Order never matters, so a reordered multiset is all "same".
 */
export function matchByCount<T>(prev: T[], curr: T[]): { status: Change[]; removed: T[] } {
  const left = new Map<string, number>();
  for (const m of prev) left.set(canonical(m), (left.get(canonical(m)) ?? 0) + 1);
  const status: Change[] = curr.map((m) => {
    const n = left.get(canonical(m)) ?? 0;
    if (n === 0) return "added";
    left.set(canonical(m), n - 1);
    return "same";
  });
  const removed: T[] = [];
  for (const m of prev) {
    const n = left.get(canonical(m)) ?? 0;
    if (n > 0) {
      removed.push(m);
      left.set(canonical(m), n - 1);
    }
  }
  return { status, removed };
}

/**
 * The diff to draw for `index`, or null. A diff applies only when the step was entered
 * from the step directly before it (cameFrom === index - 1). Step 0 and jumps get none.
 */
export function diffForStep(steps: Step[], index: number, cameFrom: number | null): StepDiff | null {
  if (cameFrom === null || cameFrom !== index - 1 || index < 1 || index >= steps.length) return null;
  return diff(steps[index - 1], steps[index]);
}
