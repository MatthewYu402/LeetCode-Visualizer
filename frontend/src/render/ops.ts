import { matchByCount, matchInOrder, type ValueDiff } from "../trace/diff";
import { canonical, formatValue } from "../trace/format";
import { hasItems, isTagged, type Value } from "../trace/types";

/**
 * What one step did to a container, in plain data-structure words ("push 3", "pop front 1",
 * "erase key 3"), for the chip in its card's header. Worked out from the step's diff alone:
 * the previous value and the current one. Never a language's method name (rule 3).
 *
 * null when there is no diff (step 0, a jump, moving back), when nothing changed, or when the
 * step made more than one change: a chip that guessed would be worse than none.
 */
export function operation(value: Value, diff: ValueDiff | null): string | null {
  const prev = diff?.status === "changed" ? diff.prev : undefined;
  if (prev === undefined || !isTagged(value) || !isTagged(prev) || prev.kind !== value.kind) return null;
  const t = (v: Value) => formatValue(v);

  if ((value.kind === "map" && prev.kind === "map") || (value.kind === "multimap" && prev.kind === "multimap")) {
    return mapOp(prev.entries, value.entries, value.kind === "multimap");
  }
  if (!hasItems(value) || !hasItems(prev)) return null;
  const a = prev.items;
  const b = value.items;
  const same = (x: Value[], y: Value[]) => x.length === y.length && x.every((v, i) => canonical(v) === canonical(y[i]));

  switch (value.kind) {
    case "stack":
      if (b.length === a.length + 1 && same(a, b.slice(0, -1))) return `push ${t(b[b.length - 1])}`;
      if (a.length === b.length + 1 && same(b, a.slice(0, -1))) return `pop ${t(a[a.length - 1])}`;
      return null;
    case "queue":
      if (b.length === a.length + 1 && same(a, b.slice(0, -1))) return `enqueue ${t(b[b.length - 1])}`;
      if (a.length === b.length + 1 && same(b, a.slice(1))) return `dequeue ${t(a[0])}`;
      return null;
    case "deque":
    case "list": {
      const end = endOp(a, b, same);
      if (end || value.kind === "deque") return end;
      const { status, removed } = matchInOrder(a, b);
      const added = status.flatMap((s, i) => (s === "added" ? [i] : []));
      const moved = status.flatMap((s, i) => (s === "changed" ? [i] : []));
      if (added.length === 1 && removed.length === 0 && moved.length === 0) return `insert ${t(b[added[0]])}`;
      if (removed.length === 1 && added.length === 0 && moved.length === 0) return `remove ${t(a[removed[0]])}`;
      if (moved.length === 1 && added.length === 0 && removed.length === 0) return `move ${t(b[moved[0]])}`;
      return null;
    }
    case "priority-queue":
    case "set":
    case "multiset": {
      const { status, removed } = matchByCount(a, b);
      const added = b.filter((_, i) => status[i] === "added");
      const verb = value.kind === "priority-queue" ? ["push", "pop"] : ["insert", "erase"];
      if (added.length === 1 && removed.length === 0) return `${verb[0]} ${t(added[0])}`;
      if (removed.length === 1 && added.length === 0) {
        const left = value.kind === "multiset" && b.some((m) => canonical(m) === canonical(removed[0]));
        return `${verb[1]}${left ? " one" : ""} ${t(removed[0])}`;
      }
      return null;
    }
    default:
      return null; // array, tuple: values are assigned in place, not pushed or popped
  }
}

/** A push or pop at either end of a deque or list. */
function endOp(a: Value[], b: Value[], same: (x: Value[], y: Value[]) => boolean): string | null {
  const t = (v: Value) => formatValue(v);
  if (b.length === a.length + 1) {
    if (same(a, b.slice(0, -1))) return `push back ${t(b[b.length - 1])}`;
    if (same(a, b.slice(1))) return `push front ${t(b[0])}`;
  }
  if (a.length === b.length + 1) {
    if (same(b, a.slice(0, -1))) return `pop back ${t(a[a.length - 1])}`;
    if (same(b, a.slice(1))) return `pop front ${t(a[0])}`;
  }
  return null;
}

function mapOp(prev: [Value, Value][], curr: [Value, Value][], multi: boolean): string | null {
  const t = (v: Value) => formatValue(v);
  if (multi) {
    const { status, removed } = matchByCount(prev, curr);
    const added = curr.filter((_, i) => status[i] === "added");
    if (added.length === 1 && removed.length === 0) return `insert (${t(added[0][0])}, ${t(added[0][1])})`;
    if (removed.length === 1 && added.length === 0) return `erase (${t(removed[0][0])}, ${t(removed[0][1])})`;
    // Every entry of one key gone at once: the key was erased.
    const key = removed[0] && canonical(removed[0][0]);
    if (added.length === 0 && removed.length > 1 && removed.every(([k]) => canonical(k) === key) && !curr.some(([k]) => canonical(k) === key)) {
      return `erase key ${t(removed[0][0])}`;
    }
    return null;
  }
  const before = new Map(prev.map(([k, v]) => [canonical(k), v] as const));
  const after = new Set(curr.map(([k]) => canonical(k)));
  const added = curr.filter(([k]) => !before.has(canonical(k)));
  const changed = curr.filter(([k, v]) => before.has(canonical(k)) && canonical(before.get(canonical(k))!) !== canonical(v));
  const gone = prev.filter(([k]) => !after.has(canonical(k)));
  if (added.length + changed.length + gone.length !== 1) return null;
  if (added.length) return `insert ${t(added[0][0])}`;
  if (changed.length) return `update ${t(changed[0][0])}`;
  return `erase ${t(gone[0][0])}`;
}
