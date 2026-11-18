import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VisualPanel } from "../components/VisualPanel";
import { ViewMenu } from "../components/ViewMenu";
import { diffValue } from "../trace/diff";
import type { Step, Trace, Value } from "../trace/types";
import { edgesOf, GraphRowsRenderer, placeNodes } from "./GraphRowsRenderer";
import { IntervalsRenderer, tickStep } from "./IntervalsRenderer";
import { selectRenderer } from "./registry";
import { autoView, fits, viewOptions } from "./views";

const rows = (r: number[][]): Value => ({ kind: "array", items: r.map((items) => ({ kind: "array", items })) });
const count = (html: string, part: string) => html.split(part).length - 1;

describe("which views fit a value", () => {
  it("checks each drawing against the shape", () => {
    expect(fits("edge-list", rows([[1, 0], [2, 1]]))).toBe(true);
    expect(fits("edge-list", rows([[1, 0, 5]]))).toBe(true);
    expect(fits("edge-list", rows([[1, 0], [2]]))).toBe(false);
    expect(fits("adjacency-list", rows([[1, 2], [0], [0]]))).toBe(true);
    expect(fits("adjacency-list", rows([[3], [0]]))).toBe(false);
    expect(fits("adjacency-matrix", rows([[0, 1], [1, 0]]))).toBe(true);
    expect(fits("adjacency-matrix", rows([[0, 2], [1, 0]]))).toBe(false);
    expect(fits("intervals", rows([[1, 3], [2, 6]]))).toBe(true);
    expect(fits("intervals", rows([[3, 1]]))).toBe(false);
    expect(fits("kind", "anything")).toBe(true);
  });

  it("starts on the hint when it fits, else the drawing by kind", () => {
    expect(autoView(rows([[1, 3]]), "intervals")).toBe("intervals");
    expect(autoView(rows([[3, 1]]), "intervals")).toBe("kind");
    expect(autoView(rows([[1, 3]]), undefined)).toBe("kind");
    expect(autoView(rows([[1, 3]]), "grid")).toBe("kind");
  });

  it("offers a menu only when more than one drawing fits, and lists the others with why", () => {
    const opts = viewOptions(rows([[1, 0], [2, 0]]), "Grid");
    expect(opts.map((o) => [o.view, o.fits])).toEqual([
      ["kind", true],
      ["adjacency-list", false], // 2 is not the index of a row of 2
      ["edge-list", true],
      ["adjacency-matrix", false],
      ["intervals", false],
    ]);
    expect(opts[3].note).toMatch(/square/);
    expect(viewOptions({ kind: "array", items: [1, 2] }, "Rows")).toEqual([]);
    expect(viewOptions(rows([[5, -9, 7]]), "Grid")).toEqual([]); // nothing but the grid fits
  });

  it("the registry draws a hint only on a value it fits", () => {
    expect(selectRenderer(rows([[1, 3]]), "intervals")).toBe(IntervalsRenderer);
    expect(selectRenderer(rows([[3, 1]]), "intervals")).not.toBe(IntervalsRenderer);
    expect(selectRenderer(rows([[1, 0]]), "edge-list")).toBe(GraphRowsRenderer);
  });
});

describe("graphs from rows", () => {
  it("an adjacency list listed both ways is one line; one way is an arrow", () => {
    const { edges } = edgesOf([[1], [0, 2], []], "adjacency-list");
    expect(edges.map((e) => [e.from, e.to, e.directed])).toEqual([
      [0, 1, false],
      [1, 2, true],
    ]);
  });

  it("an edge list's direction comes from the menu", () => {
    expect(edgesOf([[1, 0]], "edge-list", "none").edges[0]).toMatchObject({ from: 1, to: 0, directed: false });
    expect(edgesOf([[1, 0]], "edge-list", "backward").edges[0]).toMatchObject({ from: 0, to: 1, directed: true });
    expect(edgesOf([[2, 1, 7]], "edge-list").edges[0].weight).toBe(7);
    expect(edgesOf([[5, 9]], "edge-list").nodes).toEqual([5, 9]);
  });

  it("a matrix leaves out the diagonal", () => {
    expect(edgesOf([[1, 1], [1, 1]], "adjacency-matrix").edges).toHaveLength(1);
  });

  it("places nodes in layers by distance, and the same rows give the same places", () => {
    const { nodes, edges } = edgesOf([[1, 2], [3], [3], []], "adjacency-list");
    const a = placeNodes(nodes, edges);
    expect(a.get(0)!.x).toBeLessThan(a.get(1)!.x);
    expect(a.get(1)!.x).toBe(a.get(2)!.x);
    expect(a.get(3)!.x).toBeGreaterThan(a.get(1)!.x);
    expect(placeNodes(nodes, edges)).toEqual(a);
  });

  it("draws new edges green and the node a local points at", () => {
    const value = rows([[1], [0, 2], []]);
    const html = renderToStaticMarkup(
      <GraphRowsRenderer name="graph" value={value} diff={diffValue(rows([[1], [0], []]), value)} ctx={{ locals: { graph: value, u: 2 }, indexes: { u: ["graph"] }, hint: "adjacency-list" }} />,
    );
    expect(html).toContain("graph · 3 nodes · 2 edges · from an adjacency list");
    expect(count(html, "is-added")).toBe(1);
    expect(html).toContain('class="rows-graph-node is-on"');
  });
});

describe("intervals", () => {
  it("draws one bar per row on a shared scale, the read row outlined, a pointer beside its row", () => {
    const value = rows([[1, 3], [2, 6]]);
    const html = renderToStaticMarkup(<IntervalsRenderer name="intervals" value={value} diff={null} ctx={{ locals: { intervals: value, i: 1 }, indexes: { i: ["intervals"] }, reads: [{ at: [1, 0] }], scale: { lo: 0, hi: 10 } }} />);
    expect(count(html, 'class="interval ')).toBe(2);
    expect(html).toContain("[2, 6]");
    expect(count(html, "is-read")).toBe(1);
    expect(html).toContain('class="tag-pill">i<');
  });

  it("ticks stay readable for wide ranges", () => {
    expect(tickStep(18)).toBe(1);
    expect(tickStep(100)).toBe(5);
    expect(tickStep(10000)).toBe(500);
  });
});

describe("the View menu on the canvas", () => {
  const trace = (params: Trace["problem"]["params"], locals: Record<string, Value>): Trace =>
    ({
      version: "0.12",
      language: "cpp",
      problem: { method: "f", params, returns: { type: "int" }, input: {} },
      steps: [{ step: 0, frames: [{ id: "f1", function: "f", line: 2, locals }], heap: {} } as Step],
    }) as Trace;

  it("a hinted parameter starts on its view, says auto, and has a View button", () => {
    const t = trace([{ name: "edges", type: "array<array<int>>", hint: "edge-list" }], { edges: rows([[0, 1], [1, 2]]) });
    const html = renderToStaticMarkup(<VisualPanel trace={t} step={t.steps[0]} diff={null} />);
    expect(html).toContain('aria-label="edges: graph"');
    expect(html).toContain("auto, from the name");
    expect(html).toContain('class="view-button"');
  });

  it("a local starts on the drawing by kind; a value with one drawing has no button", () => {
    const t = trace([], { adj: rows([[1], [0]]), nums: { kind: "array", items: [1, 2] } });
    const html = renderToStaticMarkup(<VisualPanel trace={t} step={t.steps[0]} diff={null} />);
    expect(html).toContain('aria-label="adj: array"');
    expect(count(html, 'class="view-button"')).toBe(1);
  });

  it("the button names what is shown", () => {
    const html = renderToStaticMarkup(<ViewMenu name="adj" options={viewOptions(rows([[1], [0]]), "Grid")} current={{ view: "adjacency-list" }} auto="kind" fromHint={false} onPick={() => {}} />);
    expect(html).toContain('aria-label="View adj as: Graph (adjacency list)"');
    expect(html).toContain(">Graph<");
    expect(html).not.toContain("auto");
  });
});
