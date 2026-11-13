import { AnimatePresence, motion } from "framer-motion";
import { edgeKey, edgesOf, isPrimaryField, nodeLabel, pointersOf, slotKey, type Edge, type HeapDiff, type Pointer, type Shape } from "../trace/heap";
import type { Step, Value } from "../trace/types";
import { NODE_R, treeLayoutAt, type Component, type Point, type TraceLayout } from "./layout";

interface Props {
  step: Step;
  /** null on step 0, after a jump, and whenever no diff applies: the step still draws fully, without highlights. */
  diff: HeapDiff | null;
  layout: TraceLayout;
  /** The node the method returned, on the last step; drawn as the result. */
  resultId?: string | null;
}

const SHAPE_NAME: Record<Shape, string> = { list: "linked list", tree: "tree", graph: "graph" };
const EASE = { duration: 0.45, ease: [0.22, 1, 0.36, 1] } as const;
const FADE = { duration: 0.35, ease: "easeOut" } as const;

/**
 * Linked structures (lists, trees, graphs) of one step, drawn from step.heap with
 * the trace's layout (render/layout.ts). Pure for one step: the diff only adds
 * highlights, and every movement is animated by framer-motion from the previous
 * render to this one: nodes fade in and out, edges draw in, pointers glide.
 */
export function HeapView({ step, diff, layout, resultId = null }: Props) {
  const pointers = pointersOf(step, layout.pointerNames);
  const shown = layout.components
    .map((c, index) => ({ c, index }))
    .filter(({ c }) => c.nodes.some((id) => id in step.heap));
  const nulls = pointers.filter((p) => p.id === null);
  if (shown.length === 0 && nulls.length === 0) return <></>;

  return (
    <>
      {shown.map(({ c, index }) => (
        <ComponentView key={index} c={c} step={step} diff={diff} pointers={pointers} resultId={resultId} />
      ))}
      {nulls.length > 0 && (
        <div className="null-pointers" aria-label="Null pointers">
          {nulls.map((p) => (
            <span key={p.name} className="null-pointer">
              {p.name} → null
            </span>
          ))}
        </div>
      )}
    </>
  );
}

interface Drawn {
  key: string;
  a: Point;
  b: Point;
  /** -1 / 0 / 1: bend to one side, so two edges between the same nodes do not overlap. */
  bend: number;
  arrow: boolean;
  label: string | null;
  primary: boolean;
  isNew: boolean;
}

function ComponentView({ c, step, diff, pointers, resultId }: {
  c: Component;
  step: Step;
  diff: HeapDiff | null;
  pointers: Pointer[];
  resultId: string | null;
}) {
  const pos = c.dynamic ? treeLayoutAt(step.heap, c.nodes) : c.pos;
  const ids = c.nodes.filter((id) => id in step.heap && pos.has(id));
  const members = new Set(ids);
  const width = c.dynamic ? Math.max(...[...pos.values()].map((p) => p.x)) + NODE_R + 34 : c.width;
  const height = c.dynamic ? Math.max(...[...pos.values()].map((p) => p.y)) + NODE_R + 34 : c.height;

  const edges = edgesOf(Object.fromEntries(ids.map((id) => [id, step.heap[id]]))).filter((e) => members.has(e.to));
  const drawn = drawEdges(edges, c.shape, pos, diff);
  const tails = c.shape === "list" ? ids.filter((id) => step.heap[id].fields.next === null) : [];

  const running = pointers.filter((p) => p.running && p.id !== null && members.has(p.id));
  const onPath = new Set(pointers.filter((p) => !p.running && p.id !== null).map((p) => p.id!));
  const current = new Set(running.map((p) => p.id!));
  const stackAt = new Map<string, number>();
  const labels = running.map((p) => {
    const k = stackAt.get(p.id!) ?? 0;
    stackAt.set(p.id!, k + 1);
    return { ...p, row: k };
  });
  const names = [...new Set(running.map((p) => p.name))];

  return (
    <section className="structure" aria-label={`${SHAPE_NAME[c.shape]} with ${ids.length} nodes`}>
      <header className="structure-label">
        <span className="structure-name">{names.length ? names.join(", ") : SHAPE_NAME[c.shape]}</span>
        <span className="structure-kind">
          {SHAPE_NAME[c.shape]} · {ids.length}
        </span>
      </header>
      <svg className="heap" width={width} height={height} viewBox={`0 0 ${width} ${height}`} role="img">
        <defs>
          <Arrow id="arrow" cls="arrow-head" />
          <Arrow id="arrow-new" cls="arrow-head arrow-head-new" />
        </defs>

        <AnimatePresence>
          {drawn.map((e) => (
            <motion.path
              key={e.key}
              className={`edge ${e.primary ? "" : "edge-secondary"} ${e.isNew ? "edge-new" : ""}`}
              initial={{ pathLength: 0, opacity: 0, d: curve(e) }}
              animate={{ pathLength: 1, opacity: 1, d: curve(e) }}
              exit={{ opacity: 0, transition: FADE }}
              transition={EASE}
              markerEnd={e.arrow ? `url(#${e.isNew ? "arrow-new" : "arrow"})` : undefined}
            />
          ))}
          {drawn
            .filter((e) => e.label)
            .map((e) => {
              const m = midpoint(e);
              return (
                <motion.text key={`label-${e.key}`} className="edge-label" initial={{ opacity: 0 }} animate={{ opacity: 1, x: m.x, y: m.y }} exit={{ opacity: 0 }} transition={EASE}>
                  {e.label}
                </motion.text>
              );
            })}
          {tails.map((id) => {
            const p = pos.get(id)!;
            // To the right when nothing is there; below the node when a neighbour (or a link
            // coming back to this node) sits on its right, as in a list being reversed.
            const below = [...pos.values()].some((q) => q !== p && Math.abs(q.y - p.y) < NODE_R && q.x > p.x && q.x - p.x < NODE_R * 2 + 52);
            return (
              <motion.g key={`null-${id}`} className="null-tail" initial={{ opacity: 0, x: p.x, y: p.y }} animate={{ opacity: 1, x: p.x, y: p.y }} exit={{ opacity: 0 }} transition={EASE}>
                {below ? (
                  <>
                    <line x1={0} y1={NODE_R + 2} x2={0} y2={NODE_R + 10} />
                    <text className="null-below" x={0} y={NODE_R + 21}>
                      null
                    </text>
                  </>
                ) : (
                  <>
                    <line x1={NODE_R + 2} y1={0} x2={NODE_R + 18} y2={0} />
                    <text x={NODE_R + 22} y={4}>
                      null
                    </text>
                  </>
                )}
              </motion.g>
            );
          })}
        </AnimatePresence>

        <AnimatePresence>
          {ids.map((id) => {
            const p = pos.get(id)!;
            const cls = [
              "node",
              current.has(id) ? "node-current" : onPath.has(id) ? "node-path" : "",
              id === resultId ? "node-result" : "",
              diff?.addedNodes.has(id) ? "node-added" : diff?.changedNodes.has(id) ? "node-changed" : "",
            ].join(" ");
            return (
              <motion.g
                key={id}
                className={cls}
                initial={{ opacity: 0, scale: 0.5, x: p.x, y: p.y }}
                animate={{ opacity: 1, scale: 1, x: p.x, y: p.y }}
                exit={{ opacity: 0, scale: 0.5, transition: FADE }}
                transition={EASE}
              >
                <title>{`${id}: ${step.heap[id].type}`}</title>
                <circle r={NODE_R} />
                <AnimatePresence mode="popLayout" initial={false}>
                  <motion.text key={nodeLabel(step.heap[id])} className="node-value" dy="0.35em" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={FADE}>
                    {nodeLabel(step.heap[id])}
                  </motion.text>
                </AnimatePresence>
              </motion.g>
            );
          })}
        </AnimatePresence>

        <AnimatePresence>
          {labels.map((l) => {
            const p = pos.get(l.id!)!;
            return (
              <motion.g
                key={`ptr-${l.name}`}
                className="pointer-label"
                initial={{ opacity: 0, x: p.x, y: p.y - NODE_R - 8 - l.row * 14 }}
                animate={{ opacity: 1, x: p.x, y: p.y - NODE_R - 8 - l.row * 14 }}
                exit={{ opacity: 0 }}
                transition={EASE}
              >
                <text textAnchor="middle">{l.name}</text>
              </motion.g>
            );
          })}
          {resultId && members.has(resultId) && (
            <motion.g
              key="result-label"
              className="pointer-label pointer-result"
              initial={{ opacity: 0, x: pos.get(resultId)!.x, y: pos.get(resultId)!.y + NODE_R + 16 }}
              animate={{ opacity: 1, x: pos.get(resultId)!.x, y: pos.get(resultId)!.y + NODE_R + 16 }}
              exit={{ opacity: 0 }}
              transition={EASE}
            >
              <text textAnchor="middle">result</text>
            </motion.g>
          )}
        </AnimatePresence>
      </svg>
    </section>
  );
}

function Arrow({ id, cls }: { id: string; cls: string }) {
  return (
    <marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
      <path d="M 0 0 L 10 5 L 0 10 z" className={cls} />
    </marker>
  );
}

/**
 * The edges to draw. In a graph, a link stored both ways (1 -> 2 and 2 -> 1, as
 * Clone Graph stores neighbors) is one line with no arrowheads. Elsewhere every
 * edge is an arrow, and two edges between the same pair of nodes bend apart.
 */
export function drawEdges(edges: Edge[], shape: Shape, pos: Map<string, Point>, diff: HeapDiff | null): Drawn[] {
  const has = new Set(edges.map((e) => `${e.from}>${e.to}`));
  const out: Drawn[] = [];
  const done = new Set<string>();
  for (const e of edges) {
    const a = pos.get(e.from);
    const b = pos.get(e.to);
    if (!a || !b) continue;
    const primary = isPrimaryField(shape, e.field);
    const isNew = !!diff && (diff.addedEdges.has(edgeKey(e)) || diff.redirected.has(slotKey(e)));
    const both = has.has(`${e.to}>${e.from}`);
    if (shape === "graph" && both && primary) {
      const pair = [e.from, e.to].sort().join("|");
      if (done.has(pair)) continue;
      done.add(pair);
      out.push({ key: `pair:${pair}`, a, b, bend: 0, arrow: false, label: null, primary, isNew });
      continue;
    }
    const label = primary ? null : e.index === undefined ? e.field : `${e.field}[${e.index}]`;
    out.push({ key: edgeKey(e), a, b, bend: both || !primary ? 1 : 0, arrow: true, label, primary, isNew });
  }
  return out;
}

/** An edge from circle to circle (not centre to centre), straight or bent to one side. */
export function curve(e: Pick<Drawn, "a" | "b" | "bend" | "arrow">): string {
  const { a, b } = e;
  if (a.x === b.x && a.y === b.y) {
    // A node pointing at itself: a small loop above it.
    const r = NODE_R;
    return `M ${a.x - r * 0.6} ${a.y - r * 0.8} C ${a.x - r * 1.6} ${a.y - r * 2.6}, ${a.x + r * 1.6} ${a.y - r * 2.6}, ${a.x + r * 0.6} ${a.y - r * 0.8}`;
  }
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const nx = -dy / len;
  const ny = dx / len;
  const off = e.bend * Math.min(28, len / 4);
  const cx = (a.x + b.x) / 2 + nx * off;
  const cy = (a.y + b.y) / 2 + ny * off;
  const start = toward(a, { x: cx, y: cy }, NODE_R);
  const end = toward(b, { x: cx, y: cy }, NODE_R + (e.arrow ? 2 : 0));
  return `M ${r1(start.x)} ${r1(start.y)} Q ${r1(cx)} ${r1(cy)} ${r1(end.x)} ${r1(end.y)}`;
}

function midpoint(e: Drawn): Point {
  const dx = e.b.x - e.a.x;
  const dy = e.b.y - e.a.y;
  const len = Math.hypot(dx, dy) || 1;
  const off = e.bend * Math.min(28, len / 4);
  return { x: (e.a.x + e.b.x) / 2 + (-dy / len) * off * 0.6, y: (e.a.y + e.b.y) / 2 + (dx / len) * off * 0.6 - 4 };
}

function toward(from: Point, to: Point, dist: number): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const len = Math.hypot(dx, dy) || 1;
  return { x: from.x + (dx / len) * dist, y: from.y + (dy / len) * dist };
}

const r1 = (v: number) => Math.round(v * 10) / 10;

/** The node id a returned value points at, if it is a ref. */
export function refId(v: Value | undefined): string | null {
  return v !== null && typeof v === "object" && v !== undefined && "kind" in v && v.kind === "ref" ? v.id : null;
}
