// Where each node of a linked structure is drawn (docs/frontend.md §6.4).
//
// The layout is computed once per trace, from every step's heap, so a node keeps
// its place for the whole run: a reversed list's nodes stay still while their
// arrows turn around, and a node that appears fades in where it stays. This is the
// one thing computed from the whole trace (frontend/CLAUDE.md rule 2); each step is
// still drawn from its own data, with these positions.
//
// One exception: a tree whose shape changes during the run (a child that moves to
// another parent, as in Invert Binary Tree) is laid out per step instead, so its
// nodes glide to their new places rather than edges crossing.

import { edgesFrom, edgesOf, pointerNamesOf, shapeOf, type Shape } from "../trace/heap";
import type { ObjectValue, Trace } from "../trace/types";

export const NODE_R = 20;
const LIST_GAP_X = 84;
const LIST_GAP_Y = 76;
const TREE_GAP_X = 52;
const TREE_GAP_Y = 70;
const GRAPH_GAP = 90;
const MARGIN = NODE_R + 34; // room for pointer labels above a node, and edge labels

export interface Point {
  x: number;
  y: number;
}

export interface Component {
  shape: Shape;
  /** Node ids, in the order they first appear in the trace. */
  nodes: string[];
  /** Positions for the whole trace. For a tree whose shape changes (`dynamic`), use treeLayoutAt per step instead. */
  pos: Map<string, Point>;
  dynamic: boolean;
  width: number;
  height: number;
}

export interface TraceLayout {
  components: Component[];
  /** Node id -> index into components. */
  componentOf: Map<string, number>;
  /** Local names that hold a ref somewhere in the trace (for "prev = null" labels). */
  pointerNames: Set<string>;
}

/** Pure: a function of the whole trace, computed once when a trace is loaded. */
export function layoutTrace(trace: Trace): TraceLayout {
  const heaps = trace.steps.map((s) => s.heap);
  if (trace.result_heap) heaps.push(trace.result_heap);

  // Every node, in order of first appearance, with its first version.
  const first = new Map<string, ObjectValue>();
  for (const h of heaps) for (const [id, obj] of Object.entries(h)) if (!first.has(id)) first.set(id, obj);
  const order = [...first.keys()];

  // Connected components over every edge of every step (direction ignored).
  const parent = new Map(order.map((id) => [id, id]));
  const find = (x: string): string => {
    while (parent.get(x) !== x) {
      parent.set(x, parent.get(parent.get(x)!)!);
      x = parent.get(x)!;
    }
    return x;
  };
  for (const h of heaps) for (const e of edgesOf(h)) if (parent.has(e.to)) parent.set(find(e.from), find(e.to));
  const groups = new Map<string, string[]>();
  for (const id of order) {
    const r = find(id);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r)!.push(id);
  }

  const components: Component[] = [];
  const componentOf = new Map<string, number>();
  for (const nodes of groups.values()) {
    const shape = shapeOf(first.get(nodes[0])!);
    const members = new Set(nodes);
    let pos: Map<string, Point>;
    let dynamic = false;
    if (shape === "list") pos = listLayout(heaps, nodes, members);
    else if (shape === "tree") {
      const tree = treeFromHeaps(heaps, members);
      dynamic = tree === null;
      pos = tree ? tidyTree(nodes, tree) : treeLayoutAt(heaps[heaps.length - 1], nodes);
    } else pos = graphLayout(heaps, nodes, members);
    const { width, height } = normalize(pos);
    nodes.forEach((id) => componentOf.set(id, components.length));
    components.push({ shape, nodes, pos, dynamic, width, height });
  }
  return { components, componentOf, pointerNames: pointerNamesOf(trace.steps) };
}

/** Moves positions so the top-left one is at the margin; returns the size that holds them all. */
function normalize(pos: Map<string, Point>): { width: number; height: number } {
  if (pos.size === 0) return { width: 0, height: 0 };
  const xs = [...pos.values()].map((p) => p.x);
  const ys = [...pos.values()].map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  for (const p of pos.values()) {
    p.x += MARGIN - minX;
    p.y += MARGIN - minY;
  }
  return { width: Math.max(...xs) - minX + 2 * MARGIN, height: Math.max(...ys) - minY + 2 * MARGIN };
}

// ---- Linked lists: one row per list, in link order ----

function listLayout(heaps: Record<string, ObjectValue>[], nodes: string[], members: Set<string>): Map<string, Point> {
  const slot = new Map<string, { row: number; col: number }>();
  const taken = new Set<string>();
  let rows = 0;
  const place = (id: string, row: number, col: number) => {
    while (taken.has(`${row},${col}`)) col++;
    slot.set(id, { row, col });
    taken.add(`${row},${col}`);
  };
  for (const h of heaps) {
    const present = nodes.filter((id) => id in h);
    if (present.every((id) => slot.has(id))) continue;
    const next = new Map<string, string>();
    const hasIncoming = new Set<string>();
    for (const id of present) {
      const e = edgesFrom(id, h[id]).find((x) => x.field === "next" && members.has(x.to) && x.to in h);
      if (e) {
        next.set(id, e.to);
        hasIncoming.add(e.to);
      }
    }
    // Walk each chain from its head; a chain with no head is a cycle, entered at its earliest node.
    const heads = present.filter((id) => !hasIncoming.has(id));
    const starts = [...heads, ...present];
    const seen = new Set<string>();
    for (const start of starts) {
      let prev: string | null = null;
      for (let id: string | undefined = start; id !== undefined && !seen.has(id); id = next.get(id)) {
        seen.add(id);
        if (!slot.has(id)) {
          if (prev !== null && slot.has(prev)) place(id, slot.get(prev)!.row, slot.get(prev)!.col + 1);
          else place(id, rows++, 0);
        }
        prev = id;
      }
    }
  }
  return new Map(nodes.map((id) => [id, { x: slot.get(id)!.col * LIST_GAP_X, y: slot.get(id)!.row * LIST_GAP_Y }]));
}

// ---- Trees: a tidy layout (children under their parent, in-order across) ----

/** child -> [parent, side] over every step, or null if any child ever had two different places. */
function treeFromHeaps(heaps: Record<string, ObjectValue>[], members: Set<string>): Map<string, [string, "left" | "right"]> | null {
  const up = new Map<string, [string, "left" | "right"]>();
  for (const h of heaps) {
    for (const [id, obj] of Object.entries(h)) {
      if (!members.has(id)) continue;
      for (const e of edgesFrom(id, obj)) {
        if (e.field !== "left" && e.field !== "right") continue;
        const was = up.get(e.to);
        if (was && (was[0] !== id || was[1] !== e.field)) return null;
        up.set(e.to, [id, e.field]);
      }
    }
  }
  return up;
}

function tidyTree(nodes: string[], up: Map<string, [string, "left" | "right"]>): Map<string, Point> {
  const kids = new Map<string, { left?: string; right?: string }>();
  for (const [child, [p, side]] of up) {
    if (!kids.has(p)) kids.set(p, {});
    kids.get(p)![side] = child;
  }
  const pos = new Map<string, Point>();
  let x = 0;
  const visit = (id: string | undefined, depth: number) => {
    if (id === undefined || pos.has(id)) return;
    pos.set(id, { x: 0, y: depth * TREE_GAP_Y }); // reserve, so a cycle cannot loop
    visit(kids.get(id)?.left, depth + 1);
    pos.get(id)!.x = x++ * TREE_GAP_X;
    visit(kids.get(id)?.right, depth + 1);
  };
  for (const id of nodes) if (!up.has(id)) visit(id, 0);
  for (const id of nodes) visit(id, 0); // anything left (a cycle): still placed
  return pos;
}

/** The tidy layout of one step's tree, for a tree whose shape changes during the run. Pure. */
export function treeLayoutAt(heap: Record<string, ObjectValue>, nodes: string[]): Map<string, Point> {
  const members = new Set(nodes);
  const up = new Map<string, [string, "left" | "right"]>();
  for (const id of nodes) {
    if (!(id in heap)) continue;
    for (const e of edgesFrom(id, heap[id])) {
      if ((e.field === "left" || e.field === "right") && members.has(e.to) && !up.has(e.to)) up.set(e.to, [id, e.field]);
    }
  }
  const present = nodes.filter((id) => id in heap);
  const pos = tidyTree(present, up);
  normalize(pos);
  return pos;
}

// ---- Graphs: a circle when small, layers by distance when large ----

/**
 * Nodes in depth-first order along their edges, from the first node: neighbours sit
 * next to each other on the circle, so a ring is drawn as a ring however the nodes
 * were created (a clone built breadth-first gets the same circle as its original).
 */
function circleOrder(heaps: Record<string, ObjectValue>[], nodes: string[], members: Set<string>): string[] {
  const out: string[] = [];
  const next = new Map(nodes.map((id) => [id, [] as string[]]));
  for (const h of heaps) {
    for (const e of edgesOf(h)) {
      if (!members.has(e.from) || !members.has(e.to)) continue;
      const a = next.get(e.from)!;
      if (!a.includes(e.to)) a.push(e.to);
      const b = next.get(e.to)!;
      if (!b.includes(e.from)) b.push(e.from);
    }
  }
  const seen = new Set<string>();
  const visit = (id: string) => {
    if (seen.has(id)) return;
    seen.add(id);
    out.push(id);
    next.get(id)!.forEach(visit);
  };
  nodes.forEach(visit);
  return out;
}

function graphLayout(heaps: Record<string, ObjectValue>[], nodes: string[], members: Set<string>): Map<string, Point> {
  const pos = new Map<string, Point>();
  if (nodes.length <= 12) {
    const radius = nodes.length <= 1 ? 0 : Math.max(GRAPH_GAP * 0.7, (nodes.length * GRAPH_GAP) / (2 * Math.PI));
    circleOrder(heaps, nodes, members).forEach((id, i) => {
      const a = -Math.PI / 2 + (2 * Math.PI * i) / nodes.length;
      pos.set(id, { x: Math.round(radius * Math.cos(a)), y: Math.round(radius * Math.sin(a)) });
    });
    return pos;
  }
  const near = new Map(nodes.map((id) => [id, new Set<string>()]));
  for (const h of heaps) {
    for (const e of edgesOf(h)) {
      if (members.has(e.from) && members.has(e.to)) {
        near.get(e.from)!.add(e.to);
        near.get(e.to)!.add(e.from);
      }
    }
  }
  const layerOf = new Map<string, number>();
  for (const start of nodes) {
    if (layerOf.has(start)) continue;
    const base = Math.max(-1, ...layerOf.values()) + 1;
    layerOf.set(start, base);
    const queue = [start];
    while (queue.length) {
      const id = queue.shift()!;
      for (const n of near.get(id)!) {
        if (!layerOf.has(n)) {
          layerOf.set(n, layerOf.get(id)! + 1);
          queue.push(n);
        }
      }
    }
  }
  const across = new Map<number, number>();
  for (const id of nodes) {
    const layer = layerOf.get(id)!;
    const i = across.get(layer) ?? 0;
    across.set(layer, i + 1);
    pos.set(id, { x: i * GRAPH_GAP, y: layer * GRAPH_GAP });
  }
  return pos;
}
