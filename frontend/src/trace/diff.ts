import { canonical, valuesEqual } from "./format";
import { hasItems, isTagged, type Step, type Value } from "./types";

// Diffs are for animation only (spec §6). A step must draw correctly with no diff.

export type Change = "added" | "removed" | "changed" | "same";

export interface ValueDiff {
  status: Change;
  /** The value in the previous step. Set for `removed` and `changed`, so a removed value can be drawn faded. */
  prev?: Value;
  /** Indexed kinds (array, list, stack, queue, deque, priority-queue, tuple): status per index of the current items. */
  items?: Change[];
  /** Indexed kinds: items past the new length, with their old index, to draw faded. */
  removedItems?: { index: number; value: Value }[];
  /** set and map: status per canonical key (member for set, key for map) present in the current value. */
  keys?: Map<string, Change>;
  /** set: members gone since prev. map: entries whose key is gone since prev. */
  removedKeys?: { key: Value; value: Value }[];
}

export interface StepDiff {
  /** One entry per local in either step. Removed locals are included. */
  locals: Record<string, ValueDiff>;
}

/** Diff two adjacent steps, local by local. Pure. */
export function diff(prev: Step, curr: Step): StepDiff {
  const locals: Record<string, ValueDiff> = {};
  for (const [name, value] of Object.entries(curr.locals)) {
    locals[name] = name in prev.locals ? diffValue(prev.locals[name], value) : { status: "added" };
  }
  for (const [name, value] of Object.entries(prev.locals)) {
    if (!(name in curr.locals)) locals[name] = { status: "removed", prev: value };
  }
  return { locals };
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
 * The diff to draw for `index`, or null. A diff applies only when the step was entered
 * from the step directly before it (cameFrom === index - 1). Step 0 and jumps get none.
 */
export function diffForStep(steps: Step[], index: number, cameFrom: number | null): StepDiff | null {
  if (cameFrom === null || cameFrom !== index - 1 || index < 1 || index >= steps.length) return null;
  return diff(steps[index - 1], steps[index]);
}
