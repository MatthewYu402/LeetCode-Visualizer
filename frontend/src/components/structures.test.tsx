import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import cloneGraphRaw from "../../../fixtures/clone-graph.trace.json?raw";
import maxDepthRaw from "../../../fixtures/max-depth.trace.json?raw";
import reverseListRaw from "../../../fixtures/reverse-list.trace.json?raw";
import subsetsRaw from "../../../fixtures/subsets.trace.json?raw";
import { HeapView } from "../render/HeapView";
import { layoutTrace } from "../render/layout";
import { callState, callTree, hasNestedCalls } from "../trace/calls";
import { edgesOf } from "../trace/heap";
import { diff } from "../trace/diff";
import { loadTrace } from "../trace/loader";
import { topFrame, type Frame, type Step, type Trace } from "../trace/types";
import { callLayout, FULL_LIMIT, focusedTree, KEEP_BOTTOM, RecursionTree } from "./RecursionTree";
import { CallStack, STACK_SHOWN } from "./StatePanel";
import { VisualPanel } from "./VisualPanel";

function load(raw: string): Trace {
  const r = loadTrace(raw);
  if (!r.ok) throw new Error(r.error);
  return r.trace;
}
const reverseList = load(reverseListRaw);
const maxDepth = load(maxDepthRaw);
const cloneGraph = load(cloneGraphRaw);
const subsets = load(subsetsRaw);

describe("linked structures draw at every step, with and without a diff", () => {
  for (const [name, t] of [["reverse list", reverseList], ["max depth", maxDepth], ["clone graph", cloneGraph]] as const) {
    it(name, () => {
      const layout = layoutTrace(t);
      t.steps.forEach((s, i) => {
        const d = i > 0 ? diff(t.steps[i - 1], s).heap : null;
        expect(() => renderToStaticMarkup(<HeapView step={s} diff={d} layout={layout} />)).not.toThrow();
        expect(() => renderToStaticMarkup(<VisualPanel trace={t} step={s} diff={i > 0 ? diff(t.steps[i - 1], s) : null} />)).not.toThrow();
      });
    });
  }

  it("a reversed link is drawn as a new edge, and pointers label their nodes", () => {
    const layout = layoutTrace(reverseList);
    const i = reverseList.steps.findIndex((s, k) => k > 0 && diff(reverseList.steps[k - 1], s).heap.redirected.size > 0);
    const html = renderToStaticMarkup(<HeapView step={reverseList.steps[i]} diff={diff(reverseList.steps[i - 1], reverseList.steps[i]).heap} layout={layout} />);
    expect(html).toContain("edge-new");
    expect(html).toContain(">curr<");
  });

  it("a graph's two-way links are one line with no arrowheads", () => {
    const html = renderToStaticMarkup(<HeapView step={cloneGraph.steps[0]} diff={null} layout={layoutTrace(cloneGraph)} />);
    const edges = html.match(/<path class="edge[^"]*"[^>]*>/g) ?? [];
    expect(edges.length).toBe(4); // the square 1-2-3-4, each side once
    expect(edges.every((e) => !e.includes("marker-end"))).toBe(true);
  });

  it("a clone built breadth-first gets the same ring as its original", () => {
    const layout = layoutTrace(cloneGraph);
    const last = cloneGraph.steps[cloneGraph.steps.length - 1];
    for (const c of layout.components) {
      // On a circle of 4, a ring's neighbours are next to each other: never across (distance 2).
      const order = [...c.pos.entries()].sort(([, a], [, b]) => Math.atan2(a.y, a.x) - Math.atan2(b.y, b.x)).map(([id]) => id);
      for (const id of c.nodes) {
        for (const e of edgesOf({ [id]: last.heap[id] })) {
          const d = Math.abs(order.indexOf(e.from) - order.indexOf(e.to));
          expect(d === 1 || d === 3).toBe(true);
        }
      }
    }
  });

  it("a map of nodes shows the nodes' values, not their ids", () => {
    const last = cloneGraph.steps[cloneGraph.steps.length - 1];
    const html = renderToStaticMarkup(<VisualPanel trace={cloneGraph} step={last} diff={null} />);
    expect(html).not.toMatch(/→ n\d/);
    expect(html).toMatch(/<td title="n\d+: Node">1<\/td>/);
  });

  it("a null pointer of the running frame is listed", () => {
    const layout = layoutTrace(reverseList);
    const s = reverseList.steps.find((x) => topFrame(x).locals.prev === null && "curr" in topFrame(x).locals)!;
    expect(renderToStaticMarkup(<HeapView step={s} diff={null} layout={layout} />)).toContain("prev → null");
  });
});

describe("the call tree", () => {
  const tree = callTree(maxDepth);

  it("has one call per frame id, each under its caller", () => {
    expect(hasNestedCalls(tree)).toBe(true);
    expect(tree.roots).toHaveLength(1);
    for (const c of tree.calls.values()) if (c.parent) expect(tree.calls.get(c.parent)!.children).toContain(c.id);
  });

  it("knows each call's arguments and what it returned", () => {
    const root = tree.calls.get(tree.roots[0])!;
    expect(root.args).toBe("3");
    expect(root.returned).toBe("3");
    const nullCalls = [...tree.calls.values()].filter((c) => c.args === "null");
    expect(nullCalls.length).toBeGreaterThan(0);
    expect(nullCalls.every((c) => c.returned === "0" && c.children.length === 0)).toBe(true);
  });

  it("colours a call by where it stands at a step", () => {
    const last = maxDepth.steps.length - 1;
    const base = [...tree.calls.values()].find((c) => c.args === "null")!;
    const running = (i: number) => topFrame(maxDepth.steps[i]).id;
    expect(callState(base, tree, base.first - 1, running(base.first - 1))).toBeNull();
    expect(callState(base, tree, base.first, running(base.first))).toBe("current");
    expect(callState(base, tree, last, running(last))).toBe("base");
    const root = tree.calls.get(tree.roots[0])!;
    expect(callState(root, tree, base.first, running(base.first))).toBe("waiting");
    expect(callState(root, tree, last, running(last))).toBe("returning");
  });

  it("a small run is drawn whole, in fixed places", () => {
    expect(tree.calls.size).toBeLessThanOrEqual(FULL_LIMIT);
    const pos = callLayout(tree)!;
    expect(pos.size).toBe(tree.calls.size);
    const html = renderToStaticMarkup(<RecursionTree tree={tree} layout={pos} step={maxDepth.steps[10]} index={10} />);
    expect(html).toContain("call-current");
    expect(html).toContain("maxDepth(3)");
  });

  it("subsets (backtracking) also draws at every step", () => {
    const t = callTree(subsets);
    const pos = callLayout(t);
    subsets.steps.forEach((s, i) => {
      expect(() => renderToStaticMarkup(<RecursionTree tree={t} layout={pos} step={s} index={i} />)).not.toThrow();
    });
  });
});

describe("a deep recursion stays small", () => {
  // f(40) -> f(39) -> ... -> f(0): one call per level, 41 deep, each also having made one finished call.
  const depth = 41;
  const steps: Step[] = [];
  const frames: Frame[] = [];
  for (let d = 0; d < depth; d++) {
    // a finished helper call at this level
    steps.push({ step: steps.length, frames: [...frames, { id: `h${d}`, function: "g", line: 2, locals: { n: d } }], heap: {} });
    steps.push({ step: steps.length, frames: [...frames, { id: `h${d}`, function: "g", line: 2, locals: { n: d }, return_value: 0 }], heap: {} });
    frames.push({ id: `f${d}`, function: "f", line: 3, locals: { n: depth - d } });
    steps.push({ step: steps.length, frames: [...frames], heap: {} });
  }
  // the helpers belong to the f above them: rebuild so each g is called from the f at its level
  const trace: Trace = { version: "0.8", language: "x", problem: { method: "f", params: [], input: {} }, steps };
  const tree = callTree(trace);
  const lastStep = steps[steps.length - 1];

  it("is drawn focused, not whole", () => {
    expect(tree.calls.size).toBeGreaterThan(FULL_LIMIT);
    expect(callLayout(tree)).toBeNull();
  });

  it("folds the middle of the path and keeps every box count small", () => {
    const nodes = focusedTree(tree, lastStep, lastStep.step);
    const fold = nodes.find((n) => n.key === "fold:middle")!;
    expect(fold.label).toMatch(/^⋮ \d+ calls$/);
    expect(nodes.length).toBeLessThan(40);
    expect(nodes.find((n) => n.key === topFrame(lastStep).id)?.state).toBe("current");
    expect(nodes.filter((n) => n.state === "waiting").length).toBeLessThanOrEqual(KEEP_BOTTOM + 3);
  });

  it("the state panel's call list folds too", () => {
    const html = renderToStaticMarkup(<CallStack frames={lastStep.frames} />);
    expect((html.match(/class="frame[ "]/g) ?? []).length).toBe(STACK_SHOWN + 2);
    expect(html).toContain(`… ${lastStep.frames.length - STACK_SHOWN - 1} more calls`);
  });
});
