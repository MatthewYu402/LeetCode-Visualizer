import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import cloneGraphRaw from "../../../fixtures/clone-graph.trace.json?raw";
import maxDepthRaw from "../../../fixtures/max-depth.trace.json?raw";
import reverseListRaw from "../../../fixtures/reverse-list.trace.json?raw";
import subsetsRaw from "../../../fixtures/subsets.trace.json?raw";
import { HeapView, refId } from "../render/HeapView";
import { layoutTrace } from "../render/layout";
import { callsCardKind, callState, callTree, hasNestedCalls } from "../trace/calls";
import { diff } from "../trace/diff";
import { loadTrace } from "../trace/loader";
import { topFrame, type Frame, type Step, type Trace } from "../trace/types";
import { CallStackCard, callRows } from "./CallStackCard";
import { callLayout, FULL_LIMIT, focusedTree, KEEP_BOTTOM, RecursionTree } from "./RecursionTree";
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

  it("a map of nodes shows the nodes' values, not their ids", () => {
    const last = cloneGraph.steps[cloneGraph.steps.length - 1];
    const html = renderToStaticMarkup(<VisualPanel trace={cloneGraph} step={last} diff={null} />);
    expect(html).not.toMatch(/→ n\d/);
    expect(html).toMatch(/<span role="cell" title="n\d+: Node">1<\/span>/);
  });

  it("a null pointer of the running frame is listed", () => {
    const layout = layoutTrace(reverseList);
    const s = reverseList.steps.find((x) => topFrame(x).locals.prev === null && "curr" in topFrame(x).locals)!;
    expect(renderToStaticMarkup(<HeapView step={s} diff={null} layout={layout} />)).toMatch(/pointer-name">prev<\/span>.*null-chip">null</);
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
    expect(callState(base, tree, base.returnStep!, running(base.returnStep!))).toBe("base");
    expect(callState(base, tree, last, running(last))).toBe("returned");
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

});

describe("linked structures, drawn as the mockups agreed", () => {
  it("a list node is a value cell and a next cell; a reversed list's old head points at a null box on the left", () => {
    const layout = layoutTrace(reverseList);
    const last = reverseList.steps[reverseList.steps.length - 1];
    const html = renderToStaticMarkup(<HeapView step={last} diff={null} layout={layout} resultId={refId(reverseList.result)} />);
    expect(html.match(/class="node-next"/g)).toHaveLength(5);
    expect(html).toContain("null-box");
    expect(html).toContain("linked list · 5 nodes");
    // The returned list is the result: its nodes and links are purple, and it has a result tag.
    expect(html.match(/node-result/g)).toHaveLength(5);
    expect(html).toContain("edge-result");
    expect(html).toMatch(/class="is-result"[^>]*>.*?>result</);
  });

  it("a tree has one dotted depth guide per level, numbered from 0", () => {
    const html = renderToStaticMarkup(<HeapView step={maxDepth.steps[0]} diff={null} layout={layoutTrace(maxDepth)} />);
    expect(html.match(/class="depth-guide"/g)).toHaveLength(3);
    expect(html).toContain('<span class="depth-number">2</span>');
    expect(html).toContain("binary tree · 5 nodes");
  });

  it("in a tree, the edges from the root down to the running call's node are on the path", () => {
    const layout = layoutTrace(maxDepth);
    const deep = maxDepth.steps.find((s) => s.frames.length === 3 && s.frames[2].locals.root !== null)!;
    const html = renderToStaticMarkup(<HeapView step={deep} diff={null} layout={layout} params={new Set(["root"])} />);
    expect(html.match(/class="edge edge-path"/g)).toHaveLength(2);
  });
});

/** A void dfs over a triangle 1-2, 1-3: dfs(1) checks 2, calls dfs(2), which checks 1. */
function dfsTrace(): Trace {
  const node = (val: number, nbrs: string[]) => ({ kind: "object" as const, type: "Node", fields: { val, neighbors: { kind: "array" as const, items: nbrs.map((id) => ({ kind: "ref" as const, id })) } } });
  const heap = { n1: node(1, ["n2", "n3"]), n2: node(2, ["n1"]), n3: node(3, ["n1"]) };
  const ref = (id: string) => ({ kind: "ref" as const, id });
  const steps: Step[] = [
    { step: 0, frames: [{ id: "f1", function: "dfs", line: 1, locals: { node: ref("n1") } }], heap },
    { step: 1, frames: [{ id: "f1", function: "dfs", line: 3, locals: { node: ref("n1"), nb: ref("n2") } }], heap },
    { step: 2, frames: [{ id: "f1", function: "dfs", line: 4, locals: { node: ref("n1"), nb: ref("n2") } }, { id: "f2", function: "dfs", line: 1, locals: { node: ref("n2") } }], heap },
    { step: 3, frames: [{ id: "f1", function: "dfs", line: 4, locals: { node: ref("n1"), nb: ref("n2") } }, { id: "f2", function: "dfs", line: 3, locals: { node: ref("n2"), nb: ref("n1") } }], heap },
    { step: 4, frames: [{ id: "f1", function: "dfs", line: 4, locals: { node: ref("n1"), nb: ref("n2") } }, { id: "f2", function: "dfs", line: 6, locals: { node: ref("n2") }, return_value: null }], heap },
    { step: 5, frames: [{ id: "f1", function: "dfs", line: 6, locals: { node: ref("n1") }, return_value: null }], heap },
  ];
  return { version: "0.8", language: "x", problem: { method: "dfs", params: [], input: {}, returns: { type: "void" } }, steps, result: null };
}

describe("calls: the recursion card or the call-stack card, by what the calls return", () => {
  it("calls that return values get the recursion card; void calls get the call-stack card", () => {
    expect(callsCardKind(callTree(maxDepth))).toBe("tree");
    expect(callsCardKind(callTree(subsets))).toBe("stack");
    expect(callsCardKind(callTree(dfsTrace()))).toBe("stack");
    expect(callsCardKind(callTree(reverseList))).toBeNull();
  });

  it("the recursion card has a Tree / Stack toggle, and draws a returning call's edge back to its caller", () => {
    const tree = callTree(maxDepth);
    const base = [...tree.calls.values()].find((c) => c.args === "null")!;
    const html = renderToStaticMarkup(<RecursionTree tree={tree} layout={callLayout(tree)} step={maxDepth.steps[base.returnStep!]} index={base.returnStep!} />);
    expect(html).toContain('aria-label="Tree"');
    expect(html).toContain('aria-label="Stack"');
    expect(html).toContain("call-edge-return");
    expect(html).toContain('marker-start="url(#call-return)"');
    const stack = renderToStaticMarkup(<RecursionTree tree={tree} layout={callLayout(tree)} step={maxDepth.steps[base.returnStep!]} index={base.returnStep!} initialView="stack" />);
    expect(stack).toContain("returns 0");
    expect(stack.indexOf("root = null")).toBeLessThan(stack.indexOf("root = 3")); // running on top
  });

  it("a call-stack row shows the node's neighbours: checked, being checked, waited on", () => {
    const t = dfsTrace();
    const tree = callTree(t);
    const rows = callRows(tree, t.steps[3]);
    expect(rows.map((r) => [r.label, r.state])).toEqual([
      ["dfs(2)", "running"],
      ["dfs(1)", "waiting"],
    ]);
    expect(rows[0].chips!.map((c) => [c.text, c.state])).toEqual([["1", "checking"]]);
    expect(rows[0].note).toBe("checking 1");
    expect(rows[1].chips!.map((c) => [c.text, c.state])).toEqual([
      ["2", "waited"],
      ["3", "open"],
    ]);
    expect(rows[1].note).toBe("waiting on dfs(2)");
    expect(callRows(tree, t.steps[4])[0].chips!.every((c) => c.state === "checked")).toBe(true);
  });

  it("a pushed frame arrives green, and the graph card marks the neighbour being checked", () => {
    const t = dfsTrace();
    const tree = callTree(t);
    const d = diff(t.steps[1], t.steps[2]);
    expect([...d.pushed]).toEqual(["f2"]);
    expect(renderToStaticMarkup(<CallStackCard tree={tree} step={t.steps[2]} pushed={d.pushed} />)).toContain("is-pushed");
    const html = renderToStaticMarkup(<HeapView step={t.steps[3]} diff={null} layout={layoutTrace(t)} params={new Set(["node"])} />);
    expect(html).toMatch(/class="node node-checking"[^>]*><title>n1:/);
    expect(html).toMatch(/class="node node-current"[^>]*><title>n2:/);
    expect(html).toContain("edge edge-path");
  });

  it("the call-stack card shows while more than one frame is live and the switch is on", () => {
    const t = dfsTrace();
    const at = (i: number, showCalls: boolean) => renderToStaticMarkup(<VisualPanel trace={t} step={t.steps[i]} diff={null} showCalls={showCalls} />);
    expect(at(3, true)).toContain('aria-label="Call stack"');
    expect(at(3, false)).not.toContain('aria-label="Call stack"');
    expect(at(1, true)).not.toContain('aria-label="Call stack"');
  });

  it("backtracking rows show the call's own values instead of neighbours", () => {
    const tree = callTree(subsets);
    const s = subsets.steps.find((x) => x.frames.length === 3 && "i" in x.frames[2].locals)!;
    const rows = callRows(tree, s);
    expect(rows[0].chips).toBeNull();
    expect(rows[0].values).toMatch(/^i = \d+$/);
    expect(rows[2].label).toBe("subsets()");
  });
});
