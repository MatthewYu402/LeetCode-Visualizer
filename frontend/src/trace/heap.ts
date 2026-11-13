// Linked structures, read from a step's heap (spec §5, objects and refs).
//
// Every node is an object in `heap`, under an id that stays the same in every
// step. A field that holds a ref is an edge, directed from the object to the one
// it names, and labelled with the field (`next`, `left`, `neighbors[1]`). Nothing
// here reads the trace's language: the structure comes from the data alone.

import { formatValue } from "./format";
import { isTagged, type ObjectValue, type Step, type Value } from "./types";

export interface Edge {
  from: string;
  to: string;
  /** The field the ref is in: "next", "left", "neighbors". */
  field: string;
  /** Where in that field, for a field that holds several refs: 1 for neighbors[1]. */
  index?: number;
}

/** One key per edge, stable across steps: the same field slot pointing at the same node. */
export function edgeKey(e: Edge): string {
  return `${e.from}.${e.field}${e.index === undefined ? "" : `[${e.index}]`}>${e.to}`;
}

/** The field slot an edge leaves from, without its target: the edge "moves" when only the target changes. */
export function slotKey(e: Edge): string {
  return `${e.from}.${e.field}${e.index === undefined ? "" : `[${e.index}]`}`;
}

/** Every edge leaving `id`, in field order. A ref directly in a field, or refs inside an array-like field. */
export function edgesFrom(id: string, obj: ObjectValue): Edge[] {
  const out: Edge[] = [];
  for (const [field, v] of Object.entries(obj.fields)) {
    if (isRef(v)) out.push({ from: id, to: v.id, field });
    else if (isTagged(v) && "items" in v && Array.isArray(v.items)) {
      v.items.forEach((item, index) => {
        if (isRef(item)) out.push({ from: id, to: item.id, field, index });
      });
    }
  }
  return out;
}

export function edgesOf(heap: Record<string, ObjectValue>): Edge[] {
  return Object.entries(heap).flatMap(([id, obj]) => edgesFrom(id, obj));
}

export function isRef(v: Value | undefined): v is { kind: "ref"; id: string } {
  return isTagged(v ?? null) && (v as { kind: string }).kind === "ref";
}

/** The text inside a node: its `val` field, else its first field that is not a ref or a container of refs. */
export function nodeLabel(obj: ObjectValue): string {
  if ("val" in obj.fields) return formatValue(obj.fields.val);
  for (const v of Object.values(obj.fields)) {
    if (!isRef(v) && !(isTagged(v) && "items" in v)) return formatValue(v);
  }
  return obj.type;
}

export type Shape = "list" | "tree" | "graph";

/**
 * What kind of structure a node belongs to, from its fields (spec §5: the frontend
 * recognizes a tree from its shape). `left`/`right` is a tree, a single `next` is a
 * linked list, and anything else with refs (an array of neighbors) is a graph.
 */
export function shapeOf(obj: ObjectValue): Shape {
  const f = obj.fields;
  if ("left" in f || "right" in f) return "tree";
  if ("next" in f && !Object.values(f).some((v) => isTagged(v) && "items" in v)) return "list";
  return "graph";
}

/** The fields a shape draws by position, without a label: next, left and right, and a graph's neighbor arrays. */
export function isPrimaryField(shape: Shape, field: string): boolean {
  if (shape === "list") return field === "next";
  if (shape === "tree") return field === "left" || field === "right";
  return true;
}

// ---- Variables that point at nodes ----

export interface Pointer {
  /** The local's name. */
  name: string;
  /** The node it points at, or null for a null pointer. */
  id: string | null;
  /** True for the running frame's locals; false for a caller's. */
  running: boolean;
  /** The function whose local it is. */
  fn: string;
}

/**
 * The ref locals of every frame, running frame first. A caller's pointers show the
 * path a recursion took (the nodes its callers are working on). A local that holds
 * null is included only for the running frame, and only when its name is a pointer
 * somewhere in the trace (`pointerNames`, from pointerNamesOf), so "prev = null" shows
 * while an int that happens to be null-free never does.
 */
export function pointersOf(step: Step, pointerNames: ReadonlySet<string> = new Set()): Pointer[] {
  const out: Pointer[] = [];
  const frames = [...step.frames].reverse();
  frames.forEach((f, depth) => {
    for (const [name, v] of Object.entries(f.locals)) {
      if (isRef(v)) out.push({ name, id: v.id, running: depth === 0, fn: f.function });
      else if (v === null && depth === 0 && pointerNames.has(name)) out.push({ name, id: null, running: true, fn: f.function });
    }
  });
  return out;
}

/** Every local name that holds a ref in some frame of some step: the trace's pointer variables. */
export function pointerNamesOf(steps: Step[]): Set<string> {
  const names = new Set<string>();
  for (const s of steps) for (const f of s.frames) for (const [n, v] of Object.entries(f.locals)) if (isRef(v)) names.add(n);
  return names;
}

// ---- Differences between two steps ----

export interface HeapDiff {
  /** Node ids new in this step. */
  addedNodes: Set<string>;
  /** Nodes gone since the previous step, with their last value, to fade out. */
  removedNodes: Map<string, ObjectValue>;
  /** Nodes whose label (val) changed. */
  changedNodes: Set<string>;
  /** Edge keys new in this step, including an edge whose slot now points elsewhere. */
  addedEdges: Set<string>;
  /** Edges gone since the previous step, to fade out. */
  removedEdges: Edge[];
  /** Field slots that now point at a different node: a redirected edge, such as a reversed `next`. */
  redirected: Set<string>;
}

/** Pure: compares two steps' heaps. For animation only; a step draws correctly without it. */
export function heapDiff(prev: Step, curr: Step): HeapDiff {
  const addedNodes = new Set<string>();
  const changedNodes = new Set<string>();
  const removedNodes = new Map<string, ObjectValue>();
  for (const [id, obj] of Object.entries(curr.heap)) {
    const before = prev.heap[id];
    if (!before) addedNodes.add(id);
    else if (nodeLabel(before) !== nodeLabel(obj)) changedNodes.add(id);
  }
  for (const [id, obj] of Object.entries(prev.heap)) if (!(id in curr.heap)) removedNodes.set(id, obj);

  const before = new Map(edgesOf(prev.heap).map((e) => [edgeKey(e), e]));
  const beforeSlots = new Map(edgesOf(prev.heap).map((e) => [slotKey(e), e.to]));
  const after = edgesOf(curr.heap);
  const afterKeys = new Set(after.map(edgeKey));
  const addedEdges = new Set<string>();
  const redirected = new Set<string>();
  for (const e of after) {
    if (before.has(edgeKey(e))) continue;
    addedEdges.add(edgeKey(e));
    const was = beforeSlots.get(slotKey(e));
    if (was !== undefined && was !== e.to) redirected.add(slotKey(e));
  }
  const removedEdges = [...before.values()].filter((e) => !afterKeys.has(edgeKey(e)) && e.from in curr.heap);
  return { addedNodes, removedNodes, changedNodes, addedEdges, removedEdges, redirected };
}
