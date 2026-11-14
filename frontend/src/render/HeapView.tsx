import { AnimatePresence, motion } from "framer-motion";
import type { ReactNode } from "react";
import { edgeKey, edgesOf, isPrimaryField, nodeLabel, pointersOf, slotKey, type Edge, type HeapDiff, type Pointer, type Shape } from "../trace/heap";
import type { ObjectValue, Step, Value } from "../trace/types";
import { CardHeader } from "./Card";
import { LIST_H, LIST_W, NEXT_W, NODE_R, NULL_W, treeLayoutAt, type Point, type TraceLayout } from "./layout";

const EASE = { duration: 0.45, ease: [0.22, 1, 0.36, 1] } as const;
const FADE = { duration: 0.35, ease: "easeOut" } as const;
/** One row of pointer tags above a node, and a tag's height. */
const TAG_ROW = 20;
const TAG_H = 17;
/** Width of one character of a tag (Geist Mono 11.5 px). */
const TAG_CHAR = 7;
/** Below this many characters a node's value is drawn at full size; past it smaller, then cut with "…". */
const VALUE_FULL = 3;
const VALUE_MAX = 6;
/** The gap between a list node and the null box it points at. */
const NULL_GAP = 40;

export const SHAPE_NAME: Record<Shape, string> = { list: "linked list", tree: "binary tree", graph: "graph" };

export interface HeapViewProps {
  step: Step;
  /** null on step 0, after a jump, and whenever no diff applies: the step still draws fully, without highlights. */
  diff: HeapDiff | null;
  layout: TraceLayout;
  /** The node the method returned, on the last step; it and what it reaches are drawn as the result. */
  resultId?: string | null;
  /** The running call's parameters (trace/calls.ts), to tell the node a call is about from its working pointers. */
  params?: ReadonlySet<string>;
}

/** The linked structures drawn at this step: one card each, by index into layout.components. */
export function shownComponents(step: Step, layout: TraceLayout): number[] {
  return layout.components.flatMap((c, index) => (c.nodes.some((id) => id in step.heap) ? [index] : []));
}

/** The running frame's pointers that hold null and are pointers somewhere in the trace ("prev = null"). */
export function nullPointers(step: Step, layout: TraceLayout): Pointer[] {
  return pointersOf(step, layout.pointerNames).filter((p) => p.id === null);
}

/**
 * One linked structure (list, tree, or graph) at one step, as a card: drawn from step.heap with
 * the trace's layout (render/layout.ts). Pure for one step: the diff only adds highlights, and
 * framer-motion animates every change from the previous render to this one (nodes fade in and
 * out, edges draw in, pointer tags glide). `nulls` are the running frame's null pointers, shown
 * under the structure when this card is the one that lists them.
 */
export function LinkedCard({ index, step, diff, layout, resultId = null, params = new Set(), nulls = [] }: HeapViewProps & { index: number; nulls?: Pointer[] }) {
  const c = layout.components[index];
  const pos = c.dynamic ? treeLayoutAt(step.heap, c.nodes) : c.pos;
  const ids = c.nodes.filter((id) => id in step.heap && pos.has(id));
  const members = new Set(ids);
  const heap = Object.fromEntries(ids.map((id) => [id, step.heap[id]]));
  const edges = edgesOf(heap).filter((e) => members.has(e.to));
  const pointers = pointersOf(step, layout.pointerNames).filter((p) => p.id !== null && members.has(p.id));
  const focus = focusOf(c.shape, pointers, edges, params);
  const result = resultId && members.has(resultId) ? reachable(resultId, edges) : new Set<string>();
  const drawn = c.shape === "list" ? listEdges(edges, pos, diff, result) : drawEdges(edges, c.shape, pos, diff, { focus, result, tree: c.shape === "tree" ? treePath(new Set([...focus.current, ...focus.path]), edges) : null });
  const tails = c.shape === "list" ? listNulls(ids, step.heap, pos, !!c.leftNull) : [];
  const { width, height } = c.dynamic ? sizeOf(pos) : c;
  const levels = c.shape === "tree" ? [...new Set(ids.map((id) => pos.get(id)!.y))].sort((a, b) => a - b) : [];

  const nodeClass = (id: string) =>
    [
      "node",
      focus.current.has(id) ? "node-current" : focus.checking.has(id) ? "node-checking" : focus.path.has(id) ? "node-path" : "",
      result.has(id) ? "node-result" : "",
      diff?.addedNodes.has(id) ? "node-added" : diff?.changedNodes.has(id) ? "node-changed" : "",
    ]
      .filter(Boolean)
      .join(" ");

  const name = cardName(pointers, params, c.shape, resultId !== null && members.has(resultId));
  const count = c.shape === "graph" ? `${ids.length} nodes · ${drawn.length} edges` : `${ids.length} ${ids.length === 1 ? "node" : "nodes"}`;
  const marker = (k: string) => `arrow-${index}-${k}`;

  return (
    <section className="structure" aria-label={`${name}: ${SHAPE_NAME[c.shape]} with ${ids.length} nodes`}>
      <CardHeader name={name} meta={`${SHAPE_NAME[c.shape]} · ${count}`} />
      <div className={`linked linked-${c.shape}`} style={{ height }}>
        {levels.map((y, d) => (
          <div key={d} className="depth-guide" style={{ top: y - 8 }} aria-hidden="true">
            <span className="depth-line" />
            <span className="depth-number">{d}</span>
          </div>
        ))}
        <svg className="heap" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`${SHAPE_NAME[c.shape]} drawing`}>
          <defs>
            {(["plain", "new", "path", "result"] as const).map((k) => (
              <marker key={k} id={marker(k)} viewBox="0 0 10 10" refX="8.5" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                <path d="M 1 1 L 9 5 L 1 9" className={`arrow-head arrow-head-${k}`} />
              </marker>
            ))}
          </defs>

          <AnimatePresence>
            {drawn.map((e) => (
              <motion.path
                key={e.key}
                className={["edge", `edge-${e.tone}`, e.primary ? "" : "edge-secondary"].filter(Boolean).join(" ")}
                initial={{ pathLength: 0, opacity: 0, d: e.d }}
                animate={{ pathLength: 1, opacity: 1, d: e.d }}
                exit={{ opacity: 0, transition: FADE }}
                transition={EASE}
                markerEnd={e.arrow ? `url(#${marker(e.tone)})` : undefined}
              />
            ))}
            {drawn
              .filter((e) => e.label)
              .map((e) => (
                <motion.text key={`label-${e.key}`} className="edge-label" initial={{ opacity: 0 }} animate={{ opacity: 1, x: e.mid.x, y: e.mid.y }} exit={{ opacity: 0 }} transition={EASE}>
                  {e.label}
                </motion.text>
              ))}
            {tails.map((t) => (
              <motion.g key={`null-${t.id}`} className="null-tail" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={EASE}>
                <motion.path className="edge edge-plain" initial={{ d: t.d }} animate={{ d: t.d }} transition={EASE} markerEnd={t.box ? `url(#${marker("plain")})` : undefined} />
                {t.box ? (
                  <motion.g initial={{ x: t.box.x, y: t.box.y }} animate={{ x: t.box.x, y: t.box.y }} transition={EASE}>
                    <rect className="null-box" x={-NULL_W / 2} y={-LIST_H / 2} width={NULL_W} height={LIST_H} rx={8} />
                    <text className="null-text" dy="0.35em">
                      null
                    </text>
                  </motion.g>
                ) : (
                  <text className="null-text" x={t.at.x} y={t.at.y} dy="0.35em">
                    null
                  </text>
                )}
              </motion.g>
            ))}
          </AnimatePresence>

          <AnimatePresence>
            {ids.map((id) => {
              const p = pos.get(id)!;
              const obj = step.heap[id];
              return (
                <motion.g
                  key={id}
                  className={nodeClass(id)}
                  initial={{ opacity: 0, scale: 0.6, x: p.x, y: p.y }}
                  animate={{ opacity: 1, scale: 1, x: p.x, y: p.y }}
                  exit={{ opacity: 0, scale: 0.6, transition: FADE }}
                  transition={EASE}
                >
                  <title>{`${id}: ${obj.type} = ${nodeLabel(obj)}`}</title>
                  {c.shape === "list" ? <ListNode obj={obj} tone={dotTone(id, drawn)} /> : <CircleNode obj={obj} />}
                </motion.g>
              );
            })}
          </AnimatePresence>

          <AnimatePresence>
            {tagGroups(c.shape, pointers.filter((p) => p.running), pos, edges, resultId && members.has(resultId) ? resultId : null).map((g) => (
              <motion.g key={g.key} className="pointer-tags" initial={{ opacity: 0, x: g.x, y: g.y }} animate={{ opacity: 1, x: g.x, y: g.y }} exit={{ opacity: 0 }} transition={EASE}>
                {g.pills.map((pill) => (
                  <g key={pill.name} className={pill.result ? "is-result" : undefined} transform={`translate(${pill.dx} ${pill.dy})`}>
                    <rect className="tag-box" x={0} y={-TAG_H} width={pill.w} height={TAG_H} rx={6} />
                    <text className="tag-text" x={pill.w / 2} y={-TAG_H / 2} dy="0.35em">
                      {pill.name}
                    </text>
                  </g>
                ))}
                <path className="tag-tip" d={g.below ? `M ${g.tip - 5} 7 h 10 l -5 -6 z` : `M ${g.tip - 5} 1 h 10 l -5 6 z`} />
              </motion.g>
            ))}
          </AnimatePresence>
        </svg>
      </div>
      {nulls.length > 0 && <NullPointers nulls={nulls} />}
    </section>
  );
}

/** The running frame's null pointers ("prev" → null), as tags beside a small null box. */
export function NullPointers({ nulls }: { nulls: Pointer[] }) {
  return (
    <div className="null-pointers" aria-label="Null pointers">
      {nulls.map((p) => (
        <span key={p.name} className="null-pointer">
          <span className="tag-pill pointer-name">{p.name}</span>
          <svg className="null-pointer-arrow" aria-hidden="true" width="18" height="10" viewBox="0 0 18 10">
            <path d="M1 5h15M12 1.5 16 5l-4 3.5" />
          </svg>
          <span className="null-chip">null</span>
        </span>
      ))}
    </div>
  );
}

/** A card for null pointers alone, when the heap has no structure to put them under. */
export function NullPointersCard({ nulls }: { nulls: Pointer[] }) {
  return (
    <section className="structure" aria-label="Null pointers">
      <CardHeader name={nulls.map((p) => p.name).join(", ")} meta="null" />
      <NullPointers nulls={nulls} />
    </section>
  );
}

// ---- Nodes ----

function valueText(obj: ObjectValue): { text: string; small: boolean } {
  const t = nodeLabel(obj);
  if (t.length <= VALUE_FULL) return { text: t, small: false };
  return { text: t.length > VALUE_MAX ? `${t.slice(0, VALUE_MAX - 1)}…` : t, small: true };
}

/** A textbook list node: the value cell, then a narrow next cell with a dot that its arrow leaves from. */
function ListNode({ obj, tone }: { obj: ObjectValue; tone: Tone | null }) {
  const { text, small } = valueText(obj);
  const split = LIST_W / 2 - NEXT_W;
  const r = 6;
  return (
    <>
      <rect className="node-body" x={-LIST_W / 2} y={-LIST_H / 2} width={LIST_W} height={LIST_H} rx={r} />
      <path className="node-next" d={`M ${split} ${-LIST_H / 2} H ${LIST_W / 2 - r} a ${r} ${r} 0 0 1 ${r} ${r} V ${LIST_H / 2 - r} a ${r} ${r} 0 0 1 ${-r} ${r} H ${split} Z`} />
      <line className="node-divider" x1={split} y1={-LIST_H / 2} x2={split} y2={LIST_H / 2} />
      <circle className={`node-dot dot-${tone ?? "none"}`} cx={split + NEXT_W / 2} cy={0} r={3} />
      <text className={`node-value ${small ? "is-small" : ""}`} x={(-LIST_W / 2 + split) / 2} dy="0.35em">
        {text}
      </text>
    </>
  );
}

function CircleNode({ obj }: { obj: ObjectValue }) {
  const { text, small } = valueText(obj);
  return (
    <>
      <circle className="node-body" r={NODE_R} />
      <text className={`node-value ${small ? "is-small" : ""}`} dy="0.35em">
        {text}
      </text>
    </>
  );
}

const halfHeight = (shape: Shape) => (shape === "list" ? LIST_H / 2 : NODE_R);

// ---- Which nodes the code is working on ----

interface Focus {
  /** The node(s) the running call is working on: blue. */
  current: Set<string>;
  /** In a graph, a neighbour of the current node that a working pointer is on: a dashed ring, its edge blue. */
  checking: Set<string>;
  /** Nodes a caller points at: the path the recursion took. */
  path: Set<string>;
}

/**
 * From the pointers alone (rule 14).
 *  - In a graph, when the running call's last pointer (in declaration order) is on a node that
 *    another of its pointers links to, that node is being checked (a dashed ring), and the
 *    pointer linking to it is current: dfs(node) looping over `nb`, Clone Graph's `curr` and
 *    `neighbor`. If several link to it, the one declared last.
 *  - Otherwise the running call's working pointers (locals that are not its parameters) are
 *    current, or, when it has none, its parameters (maxDepth's `root`).
 * A caller's pointer marks the path the recursion took.
 */
export function focusOf(shape: Shape, pointers: Pointer[], edges: Edge[], params: ReadonlySet<string>): Focus {
  const running = pointers.filter((p) => p.running && p.id !== null);
  const linked = new Set(edges.map((e) => `${e.from}>${e.to}`));
  let current = new Set<string>();
  const checking = new Set<string>();
  const last = running[running.length - 1];
  const from = last ? running.filter((a) => a.id !== last.id && linked.has(`${a.id}>${last.id}`)) : [];
  if (shape === "graph" && from.length > 0) {
    checking.add(last.id!);
    current.add(from[from.length - 1].id!);
  } else {
    const own = running.filter((p) => !params.has(p.name));
    current = new Set((own.length ? own : running).map((p) => p.id!));
  }
  const path = new Set(pointers.filter((p) => !p.running && p.id !== null && !current.has(p.id)).map((p) => p.id!));
  return { current, checking, path };
}

/** Every node reachable from `id` along this step's edges, itself included. */
function reachable(id: string, edges: Edge[]): Set<string> {
  const out = new Set([id]);
  const queue = [id];
  while (queue.length) {
    const at = queue.shift()!;
    for (const e of edges) if (e.from === at && !out.has(e.to)) (out.add(e.to), queue.push(e.to));
  }
  return out;
}

/** In a tree, the edges from the root down to the given nodes (the current one and its callers' nodes), as "parent>child" keys. */
function treePath(current: Set<string>, edges: Edge[]): Set<string> {
  const up = new Map<string, string>();
  for (const e of edges) if (e.field === "left" || e.field === "right") up.set(e.to, e.from);
  const out = new Set<string>();
  for (let id of current) {
    const seen = new Set<string>();
    while (up.has(id) && !seen.has(id)) {
      seen.add(id);
      out.add(`${up.get(id)}>${id}`);
      id = up.get(id)!;
    }
  }
  return out;
}

/** The card's title: the running call's pointer into the structure, else any pointer into it, else "result" or the shape. */
function cardName(pointers: Pointer[], params: ReadonlySet<string>, shape: Shape, holdsResult: boolean): string {
  const running = pointers.filter((p) => p.running);
  const pick = running.find((p) => params.has(p.name)) ?? running[0] ?? pointers[0];
  if (pick) return pick.name;
  return holdsResult ? "result" : SHAPE_NAME[shape];
}

// ---- Edges ----

export type Tone = "plain" | "new" | "path" | "result";

export interface Drawn {
  key: string;
  from: string;
  d: string;
  mid: Point;
  arrow: boolean;
  label: string | null;
  primary: boolean;
  tone: Tone;
}

function toneOf(e: Edge, diff: HeapDiff | null, onPath: boolean, result: Set<string>): Tone {
  if (diff && (diff.addedEdges.has(edgeKey(e)) || diff.redirected.has(slotKey(e)))) return "new";
  if (result.has(e.from) && result.has(e.to)) return "result";
  return onPath ? "path" : "plain";
}

/** The colour of a list node's dot: the colour of the `next` arrow that leaves it, if any. */
function dotTone(id: string, drawn: Drawn[]): Tone | null {
  return drawn.find((e) => e.from === id && e.primary)?.tone ?? null;
}

/**
 * A list's edges. `next` to a node further right in the same row is a straight arrow from the dot
 * to that node's left side; `next` back to a node on the left (a list being reversed) leaves the
 * dot downwards, runs under the list, and comes up into that node. Anything else (another row,
 * a field other than `next`) is a curve between the nodes.
 */
export function listEdges(edges: Edge[], pos: Map<string, Point>, diff: HeapDiff | null, result: Set<string>): Drawn[] {
  const dotX = LIST_W / 2 - NEXT_W / 2;
  return edges.flatMap((e) => {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) return [];
    const primary = isPrimaryField("list", e.field);
    const tone = toneOf(e, diff, false, result);
    const base = { key: edgeKey(e), from: e.from, arrow: true, primary, tone, label: primary ? null : e.field };
    if (primary && a.y === b.y && b.x > a.x) {
      const sx = a.x + dotX;
      const ex = b.x - LIST_W / 2 - 3;
      return [{ ...base, d: path(["M", sx, a.y, "L", ex, b.y]), mid: { x: (sx + ex) / 2, y: a.y - 6 } }];
    }
    if (primary && a.y === b.y && b.x < a.x) return [{ ...base, ...under(a.x + dotX, a.y, b.x - 6, LIST_H / 2 + 3) }];
    if (e.from === e.to) return [{ ...base, d: path(["M", a.x + dotX, a.y - 3, "C", a.x + dotX + 20, a.y - 46, a.x - 20, a.y - 46, a.x - 6, a.y - LIST_H / 2 - 3]), mid: { x: a.x, y: a.y - 40 } }];
    return [{ ...base, d: curve({ a, b, bend: primary ? 0 : 1, arrow: true }, { w: LIST_W / 2, h: LIST_H / 2 }), mid: midpoint(a, b, primary ? 0 : 1) }];
  });
}

/** Down out of a dot at (sx, y), under the row, and up into the bottom of whatever is centred at tx (`stop` below the row's centre line). */
function under(sx: number, y: number, tx: number, stop: number): { d: string; mid: Point } {
  return { d: path(["M", sx, y, "L", sx, y + 26, "C", sx, y + 50, tx, y + 50, tx, y + 26, "L", tx, y + stop]), mid: { x: (sx + tx) / 2, y: y + 48 } };
}

interface Tail {
  id: string;
  d: string;
  /** Where the null box is centred, when there is room for one beside the node. */
  box: Point | null;
  /** Where "null" is written instead, under the node, when there is not. */
  at: Point;
}

/**
 * Where each list node whose `next` is null draws its null: a dashed box to the right when that
 * spot is free; to the left when the node leads its row and the list reserves room there (a list
 * being reversed, whose old head now points at null), reached by a curve under the row; else a
 * short stub below the node.
 */
function listNulls(ids: string[], heap: Record<string, ObjectValue>, pos: Map<string, Point>, leftNull: boolean): Tail[] {
  const dotX = LIST_W / 2 - NEXT_W / 2;
  const taken = (x: number, y: number) => ids.some((o) => Math.abs(pos.get(o)!.x - x) < LIST_W && pos.get(o)!.y === y);
  const minX = Math.min(...ids.map((id) => pos.get(id)!.x));
  return ids
    .filter((id) => heap[id].fields.next === null)
    .map((id) => {
      const p = pos.get(id)!;
      const rightBox = p.x + LIST_W / 2 + NULL_GAP + NULL_W / 2;
      if (!taken(rightBox, p.y)) {
        const sx = p.x + dotX;
        return { id, d: path(["M", sx, p.y, "L", rightBox - NULL_W / 2 - 3, p.y]), box: { x: rightBox, y: p.y }, at: p };
      }
      const leftBox = p.x - LIST_W / 2 - NULL_GAP - NULL_W / 2;
      if (leftNull && p.x === minX) return { id, ...under(p.x + dotX, p.y, leftBox, LIST_H / 2 + 3), box: { x: leftBox, y: p.y }, at: p };
      const sx = p.x + dotX;
      return { id, d: path(["M", sx, p.y, "L", sx, p.y + LIST_H / 2 + 12]), box: null, at: { x: sx, y: p.y + LIST_H / 2 + 22 } };
    });
}

/**
 * A tree's or graph's edges, rim to rim. In a graph, a link stored both ways (1 -> 2 and 2 -> 1,
 * as Clone Graph stores neighbors) is one line with no arrowheads; a link only one node lists is
 * an arrow. Two edges between the same pair bend apart, and a node pointing at itself loops above.
 */
export function drawEdges(
  edges: Edge[],
  shape: Shape,
  pos: Map<string, Point>,
  diff: HeapDiff | null,
  hl: { focus?: Focus; result?: Set<string>; tree?: Set<string> | null } = {},
): Drawn[] {
  const has = new Set(edges.map((e) => `${e.from}>${e.to}`));
  const result = hl.result ?? new Set<string>();
  const checks = (x: string, y: string) => !!hl.focus && ((hl.focus.current.has(x) && hl.focus.checking.has(y)) || (hl.focus.current.has(y) && hl.focus.checking.has(x)));
  const out: Drawn[] = [];
  const done = new Set<string>();
  for (const e of edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const primary = isPrimaryField(shape, e.field);
    const onPath = hl.tree ? hl.tree.has(`${e.from}>${e.to}`) : checks(e.from, e.to);
    const tone = toneOf(e, diff, onPath, result);
    const both = has.has(`${e.to}>${e.from}`) && e.from !== e.to;
    if (shape === "graph" && both && primary) {
      const pair = [e.from, e.to].sort().join("|");
      if (done.has(pair)) continue;
      done.add(pair);
      const other = edges.find((x) => x.from === e.to && x.to === e.from)!;
      const t = tone === "plain" ? toneOf(other, diff, onPath, result) : tone;
      out.push({ key: `pair:${pair}`, from: e.from, d: curve({ a, b, bend: 0, arrow: false }), mid: midpoint(a, b, 0), arrow: false, label: null, primary, tone: t });
      continue;
    }
    const label = primary ? null : e.index === undefined ? e.field : `${e.field}[${e.index}]`;
    const bend = !primary || (both && shape !== "graph") ? 1 : 0;
    out.push({ key: edgeKey(e), from: e.from, d: curve({ a, b, bend, arrow: true }), mid: midpoint(a, b, bend), arrow: true, label, primary, tone });
  }
  return out;
}

/**
 * An edge between two nodes, from rim to rim (not centre to centre), straight or bent to one
 * side. `box` gives a rectangle's half size instead of a circle's radius (list nodes).
 */
export function curve(e: { a: Point; b: Point; bend: number; arrow: boolean }, box?: { w: number; h: number }): string {
  const { a, b } = e;
  if (a.x === b.x && a.y === b.y) {
    const r = NODE_R;
    return path(["M", a.x - r * 0.6, a.y - r * 0.8, "C", a.x - r * 1.6, a.y - r * 2.6, a.x + r * 1.6, a.y - r * 2.6, a.x + r * 0.6, a.y - r * 0.8 - 2]);
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const off = e.bend * Math.min(28, len / 4);
  const c = { x: (a.x + b.x) / 2 + (-dy / len) * off, y: (a.y + b.y) / 2 + (dx / len) * off };
  const rim = (p: Point, extra: number) => (box ? toBox(p, c, box, extra) : toward(p, c, NODE_R + extra));
  const start = rim(a, 2);
  const end = rim(b, e.arrow ? 3 : 2);
  return path(["M", start.x, start.y, "Q", c.x, c.y, end.x, end.y]);
}

function midpoint(a: Point, b: Point, bend: number): Point {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = bend * Math.min(28, len / 4);
  return { x: (a.x + b.x) / 2 + (-dy / len) * off * 0.6, y: (a.y + b.y) / 2 + (dx / len) * off * 0.6 - 4 };
}

function toward(from: Point, to: Point, dist: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist };
}

/** Where the line from a rectangle's centre toward `to` leaves the rectangle, plus `extra`. */
function toBox(from: Point, to: Point, half: { w: number; h: number }, extra: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  const t = Math.min(dx === 0 ? Infinity : half.w / Math.abs(dx), dy === 0 ? Infinity : half.h / Math.abs(dy));
  return { x: from.x + dx * t + (dx / len) * extra, y: from.y + dy * t + (dy / len) * extra };
}

function path(parts: (string | number)[]): string {
  return parts.map((p) => (typeof p === "number" ? String(Math.round(p * 10) / 10) : p)).join(" ");
}

function sizeOf(pos: Map<string, Point>): { width: number; height: number } {
  const ps = [...pos.values()];
  return { width: Math.max(0, ...ps.map((p) => p.x)) + NODE_R + 64, height: Math.max(0, ...ps.map((p) => p.y)) + NODE_R + 40 };
}

// ---- Pointer tags ----

/** The tag on the returned node. A local named "result" that points elsewhere still gets its own tag. */
const RESULT = "result";

interface TagGroup {
  key: string;
  /** The tip's point, just above the node. */
  x: number;
  y: number;
  /** The tip's x inside the group (0 unless shifted). */
  tip: number;
  /** Under the node, pointing up, instead of above it. */
  below?: boolean;
  pills: { name: string; w: number; dx: number; dy: number; result?: boolean }[];
}

/**
 * The running frame's pointers, as tags above their nodes. A list stacks a node's tags upwards,
 * one per row. A tree or graph puts a node's tags side by side; in a tree they shift away from
 * the edge coming into the node (to the left of a left child, to the right of a right child) so
 * they never sit on it.
 */
function tagGroups(shape: Shape, running: Pointer[], pos: Map<string, Point>, edges: Edge[], resultId: string | null): TagGroup[] {
  const byNode = new Map<string, string[]>();
  for (const p of running) {
    const names = byNode.get(p.id!) ?? [];
    if (!names.includes(p.name)) names.push(p.name);
    byNode.set(p.id!, names);
  }
  // The returned node, on the last step, gets a purple "result" tag with the others.
  if (resultId) byNode.set(resultId, [...(byNode.get(resultId) ?? []).filter((n) => n !== RESULT), RESULT]);
  const side = new Map<string, "left" | "right">();
  for (const e of edges) if (e.field === "left" || e.field === "right") side.set(e.to, e.field);
  const top = halfHeight(shape) + 3;
  return [...byNode.entries()].flatMap(([id, names]) => {
    const p = pos.get(id);
    if (!p) return [];
    const widths = names.map((n) => n.length * TAG_CHAR + 14);
    if (shape === "list") {
      return [{ key: `tags-${id}`, x: p.x, y: p.y - top - 4, tip: 0, pills: names.map((name, k) => ({ name, w: widths[k], dx: -widths[k] / 2, dy: -k * TAG_ROW, result: name === RESULT })) }];
    }
    const total = widths.reduce((s, w) => s + w, 0) + 4 * (names.length - 1);
    // A tree's tags shift away from the edge coming in. A graph's go above the node when nothing
    // is linked from above, else below when nothing is linked from below, else above and away
    // from the side its upper links come from.
    let s = shape === "tree" ? side.get(id) : undefined;
    let below = false;
    if (shape === "graph") {
      const near = edges.flatMap((e) => (e.from === id ? [e.to] : e.to === id ? [e.from] : [])).map((n) => pos.get(n)).filter((q): q is Point => !!q);
      const up = near.filter((q) => q.y < p.y - 1);
      const down = near.filter((q) => q.y > p.y + 1);
      const lean = up.reduce((sum, q) => sum + (q.x - p.x), 0);
      if (up.length > 0 && down.length === 0) below = true;
      else if (up.length > 0) s = lean > 0 ? "left" : lean < 0 ? "right" : undefined;
    }
    const start = s === "left" ? 6 - total : s === "right" ? -6 : -total / 2;
    let at = start;
    const pills = names.map((name, k) => {
      const pill = { name, w: widths[k], dx: at, dy: 0, result: name === RESULT };
      at += widths[k] + 4;
      return pill;
    });
    if (below) return [{ key: `tags-${id}`, x: p.x, y: p.y + top - 3, tip: 0, pills: pills.map((q) => ({ ...q, dy: TAG_H + 7 })), below }];
    return [{ key: `tags-${id}`, x: p.x, y: p.y - top - 4, tip: 0, pills }];
  });
}

/** The node id a returned value points at, if it is a ref. */
export function refId(v: Value | undefined): string | null {
  return v !== null && typeof v === "object" && v !== undefined && "kind" in v && v.kind === "ref" ? v.id : null;
}

/** Keeps the old name importable for tests that draw every linked structure of a step at once. */
export function HeapView(props: HeapViewProps): ReactNode {
  const shown = shownComponents(props.step, props.layout);
  const nulls = nullPointers(props.step, props.layout);
  if (shown.length === 0) return nulls.length ? <NullPointersCard nulls={nulls} /> : null;
  return (
    <>
      {shown.map((index, k) => (
        <LinkedCard key={index} index={index} {...props} nulls={k === 0 ? nulls : []} />
      ))}
    </>
  );
}
