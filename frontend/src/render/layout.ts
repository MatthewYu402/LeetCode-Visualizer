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

/** A tree or graph node is a circle of this radius. */
export const NODE_R = 22;
/** A list node is a value cell plus a narrow next cell: this wide and this tall in all. */
export const LIST_W = 72;
export const LIST_H = 40;
/** The next cell's width, at the node's right end; arrows leave the dot at its centre. */
export const NEXT_W = 22;
/** A dashed "null" box, the size of a small cell. */
export const NULL_W = 44;
const LIST_GAP_X = 128;
const LIST_GAP_Y = 104;
const TREE_GAP_X = 60;
const TREE_GAP_Y = 84;
const GRAPH_GAP_X = 104;
const GRAPH_GAP_Y = 90;
/** Room around the nodes: pointer tags above, tags shifted to the side, curves and nulls below. */
const MARGIN_X = 64;
const MARGIN_TOP = 52; // a list's tags stack upwards; a tree's or graph's sit side by side
const MARGIN_TOP_ONE_ROW = 34;
const MARGIN_BOTTOM = 40; // a list's reversed links curve under it
const MARGIN_BOTTOM_TREE = 12;
const MARGIN_BOTTOM_GRAPH = 32; // a graph's tags can sit under a node

export interface Point {
  x: number;
  y: number;
}

export interface Component {
  shape: Shape;
  /** A list whose first node can point at null while a node follows it (a list being reversed): its null box goes on the left. */
  leftNull?: boolean;
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
    let leftNull = false;
    if (shape === "list") {
      pos = listLayout(heaps, nodes, members);
      leftNull = needsLeftNull(heaps, nodes, pos);
    }
    else if (shape === "tree") {
      const tree = treeFromHeaps(heaps, members);
      dynamic = tree === null;
      pos = tree ? tidyTree(nodes, tree) : treeLayoutAt(heaps[heaps.length - 1], nodes);
    } else pos = graphLayout(heaps, nodes, members);
    const { width, height } = normalize(pos, shape, leftNull);
    nodes.forEach((id) => componentOf.set(id, components.length));
    components.push({ shape, leftNull, nodes, pos, dynamic, width, height });
  }
  return { components, componentOf, pointerNames: pointerNamesOf(trace.steps) };
}

/**
 * Moves positions (node centres) so the top-left node sits inside the margin; returns the size
 * that holds them all. A list keeps room on the right for a null box, and on the left when its
 * first node can point at null.
 */
export function normalize(pos: Map<string, Point>, shape: Shape = "tree", leftNull = false): { width: number; height: number } {
  if (pos.size === 0) return { width: 0, height: 0 };
  const xs = [...pos.values()].map((p) => p.x);
  const ys = [...pos.values()].map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const halfW = shape === "list" ? LIST_W / 2 : NODE_R;
  const halfH = shape === "list" ? LIST_H / 2 : NODE_R;
  const left = shape === "list" ? halfW + (leftNull ? NULL_W + 40 : 0) + 2 : halfW + MARGIN_X;
  const right = shape === "list" ? halfW + NULL_W + 40 : halfW + MARGIN_X;
  const top = shape === "list" ? MARGIN_TOP : MARGIN_TOP_ONE_ROW;
  for (const p of pos.values()) {
    p.x += left - minX;
    p.y += halfH + top - minY;
  }
  return { width: Math.max(...xs) - minX + left + right, height: Math.max(...ys) - minY + 2 * halfH + top + (shape === "list" ? MARGIN_BOTTOM : shape === "graph" ? MARGIN_BOTTOM_GRAPH : MARGIN_BOTTOM_TREE) };
}

/** True when, in some step, a list's leftmost node points at null while another node sits right after it in its row. */
function needsLeftNull(heaps: Record<string, ObjectValue>[], nodes: string[], pos: Map<string, Point>): boolean {
  const minX = Math.min(...nodes.map((id) => pos.get(id)!.x));
  const at = new Map(nodes.map((id) => [`${pos.get(id)!.x},${pos.get(id)!.y}`, id]));
  return heaps.some((h) =>
    nodes.some((id) => {
      const p = pos.get(id)!;
      if (p.x !== minX || !(id in h) || h[id].fields.next !== null) return false;
      const after = at.get(`${p.x + LIST_GAP_X},${p.y}`);
      return after !== undefined && after in h;
    }),
  );
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
  normalize(pos, "tree");
  return pos;
}

// ---- Graphs: layers by distance from the first node ----

/**
 * Breadth-first from the first node (and then from each node not reached yet), over every
 * edge of every step with direction ignored: a node's layer is its distance from the start,
 * and each layer is centred under the one above, in the order its nodes were reached. So a
 * graph reads top-down from where the search begins, and Clone Graph's square is a diamond.
 */
function graphLayout(heaps: Record<string, ObjectValue>[], nodes: string[], members: Set<string>): Map<string, Point> {
  const near = new Map(nodes.map((id) => [id, [] as string[]]));
  for (const h of heaps) {
    for (const e of edgesOf(h)) {
      if (!members.has(e.from) || !members.has(e.to) || e.from === e.to) continue;
      const a = near.get(e.from)!;
      if (!a.includes(e.to)) a.push(e.to);
      const b = near.get(e.to)!;
      if (!b.includes(e.from)) b.push(e.from);
    }
  }
  const layers: string[][] = [];
  const seen = new Set<string>();
  for (const start of nodes) {
    if (seen.has(start)) continue;
    let base = layers.length;
    seen.add(start);
    let frontier = [start];
    while (frontier.length) {
      (layers[base] ??= []).push(...frontier);
      const next: string[] = [];
      for (const id of frontier) for (const n of near.get(id)!) if (!seen.has(n)) (seen.add(n), next.push(n));
      frontier = next;
      base++;
    }
  }
  const pos = new Map<string, Point>();
  layers.forEach((layer, d) => layer.forEach((id, i) => pos.set(id, { x: (i - (layer.length - 1) / 2) * GRAPH_GAP_X, y: d * GRAPH_GAP_Y })));
  return pos;
}
