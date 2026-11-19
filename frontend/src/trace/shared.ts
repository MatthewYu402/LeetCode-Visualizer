// Shared containers (spec §5, since v0.14): a container reached from two or more places in a
// step carries the same `id` at every place. This finds those places and names them the way a
// reader writes them (`dp[0]`, `first`, `path (in backtrack)`), for the note under a card.

import { formatValue } from "./format";
import { isTagged, topFrame, type Step, type Value } from "./types";

/** One place a shared container is reached from in a step. */
export interface Place {
  /** As the reader would write it: "dp[0]", "first", "memo (member)", "path (in backtrack)". */
  label: string;
  /** The key of the card that draws this place ("dp", or "#members/memo"), or null when no card does (a caller's local, a node's field). */
  card: string | null;
  /** The container's kind ("array", "map"), the same at every place. */
  kind: string;
}

/** One shared container as a card notes it: its kind, and every place it is reached from, each named once. */
export interface SharedGroup {
  kind: string;
  places: string[];
}

/** For each container id in the step, every place it is reached from, in the order met. */
export function sharedPlaces(step: Step): Map<string, Place[]> {
  const out = new Map<string, Place[]>();
  const top = topFrame(step);
  for (const frame of step.frames) {
    const running = frame === top;
    for (const [name, v] of Object.entries(frame.locals)) {
      walk(v, name, running ? "" : ` (in ${frame.function})`, running ? name : null, out);
    }
  }
  // A member is hidden on the canvas while a running local has its name, so then no card draws it.
  for (const [name, v] of Object.entries(step.members ?? {})) {
    walk(v, name, " (member)", name in top.locals ? null : `#members/${name}`, out);
  }
  for (const obj of Object.values(step.heap)) {
    for (const [field, v] of Object.entries(obj.fields)) walk(v, `${obj.type}.${field}`, " (a node's field)", null, out);
  }
  return out;
}

function walk(v: Value, path: string, where: string, card: string | null, out: Map<string, Place[]>): void {
  if (!isTagged(v)) return;
  if (v.kind !== "ref" && "id" in v && typeof v.id === "string") {
    const list = out.get(v.id) ?? [];
    list.push({ label: path + where, card, kind: v.kind });
    out.set(v.id, list);
  }
  if (v.kind === "map" || v.kind === "multimap") {
    for (const [k, x] of v.entries) {
      walk(k, `a key of ${path}`, where, card, out);
      walk(x, `${path}[${formatValue(k)}]`, where, card, out);
    }
  } else if ("items" in v && Array.isArray(v.items)) {
    const unordered = v.kind === "set" || v.kind === "multiset";
    v.items.forEach((x, i) => walk(x, unordered ? `an item of ${path}` : `${path}[${i}]`, where, card, out));
  }
}

/**
 * The notes under one card: for each shared container inside the card's value (itself
 * included), every place it is reached from, this card's own places first, each named once
 * (a recursion's callers often hold the same list under the same name).
 */
export function sharedGroups(cardKey: string, shared: Map<string, Place[]>): SharedGroup[] {
  const groups: SharedGroup[] = [];
  for (const places of shared.values()) {
    if (!places.some((p) => p.card === cardKey)) continue;
    const ordered = [...places.filter((p) => p.card === cardKey), ...places.filter((p) => p.card !== cardKey)].map((p) => p.label);
    groups.push({ kind: places[0].kind, places: [...new Set(ordered)] });
  }
  return groups;
}
