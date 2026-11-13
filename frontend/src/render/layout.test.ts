import { describe, expect, it } from "vitest";
import cloneGraphRaw from "../../../fixtures/clone-graph.trace.json?raw";
import maxDepthRaw from "../../../fixtures/max-depth.trace.json?raw";
import reverseListRaw from "../../../fixtures/reverse-list.trace.json?raw";
import { loadTrace } from "../trace/loader";
import type { ObjectValue, Step, Trace } from "../trace/types";
import { layoutTrace, treeLayoutAt } from "./layout";

function load(raw: string): Trace {
  const r = loadTrace(raw);
  if (!r.ok) throw new Error(r.error);
  return r.trace;
}

describe("layout of a linked list", () => {
  const layout = layoutTrace(load(reverseListRaw));

  it("is one row, in link order, and the same for every step", () => {
    expect(layout.components).toHaveLength(1);
    const c = layout.components[0];
    expect(c.shape).toBe("list");
    expect(c.dynamic).toBe(false);
    const ys = new Set(c.nodes.map((id) => c.pos.get(id)!.y));
    expect(ys.size).toBe(1);
    const xs = ["n1", "n2", "n3", "n4", "n5"].map((id) => c.pos.get(id)!.x);
    expect([...xs].sort((a, b) => a - b)).toEqual(xs);
  });

  it("knows which locals are pointers, for null labels", () => {
    expect(layout.pointerNames.has("prev")).toBe(true);
    expect(layout.pointerNames.has("curr")).toBe(true);
  });
});

describe("layout of a tree", () => {
  const trace = load(maxDepthRaw);
  const layout = layoutTrace(trace);
  const c = layout.components[0];

  it("puts children below their parent, left child to the left, right to the right", () => {
    expect(c.shape).toBe("tree");
    expect(c.dynamic).toBe(false);
    const heap = trace.steps[0].heap;
    for (const [id, obj] of Object.entries(heap)) {
      const p = c.pos.get(id)!;
      for (const side of ["left", "right"] as const) {
        const ref = obj.fields[side];
        if (ref && typeof ref === "object" && "id" in ref) {
          const child = c.pos.get(ref.id as string)!;
          expect(child.y).toBeGreaterThan(p.y);
          if (side === "left") expect(child.x).toBeLessThan(p.x);
          else expect(child.x).toBeGreaterThan(p.x);
        }
      }
    }
  });

  it("is laid out per step when the shape changes (children swap sides)", () => {
    const node = (val: number, left: string | null, right: string | null): ObjectValue => ({
      kind: "object",
      type: "TreeNode",
      fields: { val, left: left && { kind: "ref", id: left }, right: right && { kind: "ref", id: right } },
    });
    const step = (i: number, heap: Record<string, ObjectValue>): Step => ({ step: i, frames: [{ id: "f1", function: "invertTree", line: 1, locals: {} }], heap });
    const before = { n1: node(1, "n2", "n3"), n2: node(2, null, null), n3: node(3, null, null) };
    const after = { n1: node(1, "n3", "n2"), n2: node(2, null, null), n3: node(3, null, null) };
    const t: Trace = { version: "0.7", language: "x", problem: { method: "invertTree", params: [], input: {} }, steps: [step(0, before), step(1, after)] };
    const l = layoutTrace(t);
    expect(l.components[0].dynamic).toBe(true);
    const p0 = treeLayoutAt(before, l.components[0].nodes);
    const p1 = treeLayoutAt(after, l.components[0].nodes);
    expect(p0.get("n2")!.x).toBeLessThan(p0.get("n3")!.x);
    expect(p1.get("n2")!.x).toBeGreaterThan(p1.get("n3")!.x);
  });
});

describe("layout of a graph", () => {
  const layout = layoutTrace(load(cloneGraphRaw));

  it("the original and the clone are separate components, each on a circle", () => {
    expect(layout.components.map((c) => [c.shape, c.nodes.length])).toEqual([
      ["graph", 4],
      ["graph", 4],
    ]);
    const c = layout.components[0];
    const center = { x: c.width / 2, y: c.height / 2 };
    const dist = c.nodes.map((id) => Math.round(Math.hypot(c.pos.get(id)!.x - center.x, c.pos.get(id)!.y - center.y)));
    expect(Math.max(...dist) - Math.min(...dist)).toBeLessThanOrEqual(1);
  });

  it("every node has a component", () => {
    for (const c of layout.components) for (const id of c.nodes) expect(layout.componentOf.has(id)).toBe(true);
  });
});
