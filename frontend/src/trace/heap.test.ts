import { describe, expect, it } from "vitest";
import cloneGraphRaw from "../../../fixtures/clone-graph.trace.json?raw";
import maxDepthRaw from "../../../fixtures/max-depth.trace.json?raw";
import reverseListRaw from "../../../fixtures/reverse-list.trace.json?raw";
import { diff } from "./diff";
import { edgeKey, edgesOf, heapDiff, nodeLabel, pointerNamesOf, pointersOf, shapeOf } from "./heap";
import { loadTrace } from "./loader";
import type { Trace } from "./types";

function load(raw: string): Trace {
  const r = loadTrace(raw);
  if (!r.ok) throw new Error(r.error);
  return r.trace;
}
const reverseList = load(reverseListRaw);
const maxDepth = load(maxDepthRaw);
const cloneGraph = load(cloneGraphRaw);

describe("edges", () => {
  it("a linked list: one directed `next` edge per link", () => {
    const edges = edgesOf(reverseList.steps[0].heap).map(edgeKey).sort();
    expect(edges).toEqual(["n1.next>n2", "n2.next>n3", "n3.next>n4", "n4.next>n5"]);
  });

  it("a tree: `left` and `right`", () => {
    const fields = edgesOf(maxDepth.steps[0].heap).map((e) => e.field);
    expect(new Set(fields)).toEqual(new Set(["left", "right"]));
  });

  it("a graph: one edge per neighbor, with its index", () => {
    const n1 = edgesOf(cloneGraph.steps[0].heap).filter((e) => e.from === "n1");
    expect(n1.map((e) => [e.field, e.index, e.to])).toEqual([
      ["neighbors", 0, "n2"],
      ["neighbors", 1, "n4"],
    ]);
  });
});

describe("nodes", () => {
  it("the label is val, and the shape comes from the fields", () => {
    expect(nodeLabel(reverseList.steps[0].heap.n1)).toBe("1");
    expect(shapeOf(reverseList.steps[0].heap.n1)).toBe("list");
    expect(shapeOf(maxDepth.steps[0].heap.n1)).toBe("tree");
    expect(shapeOf(cloneGraph.steps[0].heap.n1)).toBe("graph");
  });
});

describe("heap diff", () => {
  it("reversing a link is a redirected `next`: the old edge removed, the new one added", () => {
    const i = reverseList.steps.findIndex(
      (s, k) => k > 0 && reverseList.steps[k - 1].heap.n2?.fields.next !== null && isRefTo(s.heap.n2?.fields.next, "n1"),
    );
    expect(i).toBeGreaterThan(0);
    const d = heapDiff(reverseList.steps[i - 1], reverseList.steps[i]);
    expect([...d.redirected]).toEqual(["n2.next"]);
    expect([...d.addedEdges]).toEqual(["n2.next>n1"]);
    expect(d.removedEdges.map(edgeKey)).toEqual(["n2.next>n3"]);
  });

  it("a cloned node is added, with no change to the originals", () => {
    const i = cloneGraph.steps.findIndex((s, k) => k > 0 && Object.keys(s.heap).length > Object.keys(cloneGraph.steps[k - 1].heap).length);
    const d = heapDiff(cloneGraph.steps[i - 1], cloneGraph.steps[i]);
    expect(d.addedNodes.size).toBe(1);
    expect(d.changedNodes.size).toBe(0);
  });

  it("is part of the step diff", () => {
    expect(diff(reverseList.steps[0], reverseList.steps[1]).heap).toBeDefined();
  });
});

describe("pointers", () => {
  it("the running frame's refs, and a null pointer only for a name that is a pointer somewhere in the trace", () => {
    const names = pointerNamesOf(reverseList.steps);
    expect(names.has("prev")).toBe(true);
    const step = reverseList.steps.find((s) => s.frames.at(-1)!.locals.prev === null && "curr" in s.frames.at(-1)!.locals)!;
    const ps = pointersOf(step, names);
    expect(ps.find((p) => p.name === "prev")).toEqual({ name: "prev", id: null, running: true, fn: "reverseList" });
    expect(ps.find((p) => p.name === "curr")?.id).toBe("n1");
  });

  it("in a recursion, callers' pointers are listed too, not as running", () => {
    const deep = maxDepth.steps.reduce((a, s) => (s.frames.length > a.frames.length ? s : a));
    const ps = pointersOf(deep, pointerNamesOf(maxDepth.steps));
    expect(ps.filter((p) => !p.running).length).toBeGreaterThan(0);
  });
});

function isRefTo(v: unknown, id: string): boolean {
  return typeof v === "object" && v !== null && (v as { kind?: string }).kind === "ref" && (v as { id: string }).id === id;
}
