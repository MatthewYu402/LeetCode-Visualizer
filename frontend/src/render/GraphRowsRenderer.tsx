import { motion } from "framer-motion";
import { CardHeader } from "./Card";
import { pointersFor } from "./pointers";
import type { RendererProps } from "./types";
import { numberRows, type Direction } from "./views";

/** Node circle size, and the space between layers and between nodes in a layer, in px. */
const NODE = 36;
const LAYER_GAP = 110;
const ROW_GAP = 62;
const PAD = 8;

type Source = "adjacency-list" | "edge-list" | "adjacency-matrix";

interface Edge {
  key: string;
  from: number;
  to: number;
  /** Drawn with an arrowhead at `to`. */
  directed: boolean;
  /** The weight of an edge list's [u, v, w] row. */
  weight?: number;
  /** The row (and column) this edge comes from, for reads and pointers. */
  row: number;
  col?: number;
}

/** Edges of rows read as `source`: one per row entry, an edge whose reverse is also listed drawn once without an arrow. */
export function edgesOf(rows: number[][], source: Source, direction: Direction = "none"): { nodes: number[]; edges: Edge[] } {
  const raw: Edge[] = [];
  if (source === "adjacency-list") rows.forEach((r, u) => r.forEach((v, k) => raw.push({ key: "", from: u, to: v, directed: true, row: u, col: k })));
  if (source === "adjacency-matrix") rows.forEach((r, i) => r.forEach((v, j) => v !== 0 && i !== j && raw.push({ key: "", from: i, to: j, directed: true, row: i, col: j })));
  if (source === "edge-list")
    rows.forEach((r, i) => {
      const [a, b] = direction === "backward" ? [r[1], r[0]] : [r[0], r[1]];
      raw.push({ key: "", from: a, to: b, directed: direction !== "none", weight: r.length === 3 ? r[2] : undefined, row: i });
    });
  // An edge listed both ways (an undirected adjacency list or a symmetric matrix) is one line.
  const has = new Set(raw.map((e) => `${e.from}>${e.to}`));
  const out: Edge[] = [];
  const seen = new Set<string>();
  for (const e of raw) {
    const both = e.directed && source !== "edge-list" && has.has(`${e.to}>${e.from}`);
    const key = both || !e.directed ? `${Math.min(e.from, e.to)}-${Math.max(e.from, e.to)}${e.weight !== undefined ? `:${e.row}` : ""}` : `${e.from}>${e.to}`;
    if (seen.has(key) && source !== "edge-list") continue;
    seen.add(key);
    out.push({ ...e, key: source === "edge-list" ? `${key}#${e.row}` : key, directed: e.directed && !both });
  }
  const nodes =
    source === "edge-list" ? [...new Set(rows.flatMap((r) => [r[0], r[1]]))].sort((a, b) => a - b) : rows.map((_, i) => i);
  return { nodes, edges: out };
}

/**
 * Places for the nodes: layers by distance from the smallest node of each connected part (edges
 * taken both ways), parts side by side. From the value alone, so a graph drawn at one step needs
 * no other step; the same rows give the same places.
 */
export function placeNodes(nodes: number[], edges: Edge[]): Map<number, { x: number; y: number }> {
  const near = new Map<number, number[]>(nodes.map((n) => [n, []]));
  for (const e of edges) {
    near.get(e.from)?.push(e.to);
    near.get(e.to)?.push(e.from);
  }
  const pos = new Map<number, { x: number; y: number }>();
  let column = 0;
  for (const start of nodes) {
    if (pos.has(start)) continue;
    const layers: number[][] = [];
    const depth = new Map([[start, 0]]);
    const queue = [start];
    while (queue.length) {
      const n = queue.shift()!;
      const d = depth.get(n)!;
      (layers[d] ??= []).push(n);
      for (const m of [...(near.get(n) ?? [])].sort((a, b) => a - b))
        if (!depth.has(m)) {
          depth.set(m, d + 1);
          queue.push(m);
        }
    }
    const tallest = Math.max(...layers.map((l) => l.length));
    layers.forEach((layer, d) =>
      layer.forEach((n, k) => pos.set(n, { x: (column + d) * LAYER_GAP, y: (k + (tallest - layer.length) / 2) * ROW_GAP })),
    );
    column += layers.length;
  }
  return pos;
}

/**
 * A 2D array drawn as a graph (docs/frontend.md §5.3): an adjacency list, an edge list, or an
 * adjacency matrix, picked by ctx.hint. Pure: nodes, edges, and places come from this step's
 * value. Edges added since the previous step (diff.prev) are green; locals that index the rows
 * (`u` in graph[u]) are tags on their node; a read lights the edge or node it read.
 */
export function GraphRowsRenderer({ name, value, diff, ctx }: RendererProps) {
  const rows = numberRows(value);
  const source = (ctx.hint ?? "adjacency-list") as Source;
  if (!rows) throw new Error(`GraphRowsRenderer got a value that is not rows of numbers for ${name}`);
  const direction = ctx.direction ?? "none";
  const { nodes, edges } = edgesOf(rows, source, direction);
  const pos = placeNodes(nodes, edges);
  const prevRows = diff?.prev ? numberRows(diff.prev) : null;
  const before = prevRows ? new Set(edgesOf(prevRows, source, direction).edges.map((e) => e.key)) : null;

  // What the running line touches: rows a local points at (adjacency list, matrix) or edges (edge list), and reads.
  const pointers = pointersFor(ctx.locals, rows.length, name, ctx.indexes);
  const readRows = new Set<number>();
  const readCells = new Set<string>();
  for (const r of ctx.reads ?? []) if ("at" in r) (r.at.length === 1 ? readRows.add(r.at[0]) : readCells.add(`${r.at[0]},${r.at[1]}`));
  const nodeOn = (n: number) => source !== "edge-list" && (readRows.has(n) || pointers.some((p) => p.index === n));
  const edgeOn = (e: Edge) =>
    source === "edge-list"
      ? readRows.has(e.row) || readCells.has(`${e.row},0`) || readCells.has(`${e.row},1`) || pointers.some((p) => p.index === e.row)
      : readCells.has(`${e.row},${e.col}`);

  const xs = [...pos.values()].map((p) => p.x);
  const ys = [...pos.values()].map((p) => p.y);
  const width = (xs.length ? Math.max(...xs) : 0) + NODE + PAD * 2;
  const height = (ys.length ? Math.max(...ys) : 0) + NODE + PAD * 2 + 18;
  const at = (n: number) => ({ x: pos.get(n)!.x + PAD + NODE / 2, y: pos.get(n)!.y + PAD + 18 + NODE / 2 });
  const from = source === "edge-list" ? `from ${rows.length} ${rows.length === 1 ? "pair" : "pairs"}` : source === "adjacency-matrix" ? `from a ${rows.length} × ${rows.length} matrix` : "from an adjacency list";

  return (
    <section className="structure" aria-label={`${name}: graph`}>
      <CardHeader name={name} meta={`graph · ${nodes.length} ${nodes.length === 1 ? "node" : "nodes"} · ${edges.length} ${edges.length === 1 ? "edge" : "edges"} · ${from}`} op={ctx.op} />
      <svg className="rows-graph" width={width} height={height} role="img" aria-label={`${name} as a graph: ${edges.map((e) => `${e.from}${e.directed ? "→" : "–"}${e.to}`).join(", ") || "no edges"}`}>
        <defs>
          <marker id={`arrow-${name}`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0 0 8 4 0 8z" className="rows-graph-head" />
          </marker>
        </defs>
        {edges.map((e) => {
          const a = at(e.from);
          const b = at(e.to);
          const on = edgeOn(e);
          const added = before !== null && !before.has(e.key);
          const cls = `rows-graph-edge${on ? " is-on" : ""}${added ? " is-added" : ""}`;
          if (e.from === e.to) {
            const d = `M ${a.x - 8} ${a.y - NODE / 2 + 2} C ${a.x - 26} ${a.y - NODE - 14}, ${a.x + 26} ${a.y - NODE - 14}, ${a.x + 8} ${a.y - NODE / 2 + 2}`;
            return <motion.path key={e.key} d={d} className={cls} markerEnd={e.directed ? `url(#arrow-${name})` : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} />;
          }
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const len = Math.hypot(dx, dy) || 1;
          const ux = dx / len;
          const uy = dy / len;
          const r = NODE / 2 + 2;
          const x1 = a.x + ux * r;
          const y1 = a.y + uy * r;
          const x2 = b.x - ux * (r + (e.directed ? 2 : 0));
          const y2 = b.y - uy * (r + (e.directed ? 2 : 0));
          return (
            <g key={e.key}>
              <motion.line x1={x1} y1={y1} x2={x2} y2={y2} className={cls} markerEnd={e.directed ? `url(#arrow-${name})` : undefined} initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.3 }} />
              {e.weight !== undefined && (
                <text x={(x1 + x2) / 2 - uy * 10} y={(y1 + y2) / 2 + ux * 10 + 4} className="rows-graph-weight" textAnchor="middle">
                  {e.weight}
                </text>
              )}
            </g>
          );
        })}
        {nodes.map((n) => {
          const p = at(n);
          const tags = source === "edge-list" ? [] : pointers.filter((t) => t.index === n);
          return (
            <g key={n} className={`rows-graph-node${nodeOn(n) ? " is-on" : ""}`}>
              <circle cx={p.x} cy={p.y} r={NODE / 2} />
              <text x={p.x} y={p.y + 4.5} textAnchor="middle">
                {n}
              </text>
              {tags.length > 0 && (
                <text x={p.x} y={p.y - NODE / 2 - 6} textAnchor="middle" className="rows-graph-tag">
                  {tags.map((t) => t.name).join(", ")}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </section>
  );
}
