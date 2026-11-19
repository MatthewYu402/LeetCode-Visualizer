import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VisualPanel } from "../components/VisualPanel";
import { diff } from "./diff";
import { canonical, valuesEqual } from "./format";
import { sharedGroups, sharedPlaces } from "./shared";
import type { Frame, Step, Trace, Value } from "./types";

/** Python's dp = [[0] * 3] * 3, then first = dp[0], after dp[0][0] = 1: one row, reached four ways. */
const row = (a: number): Value => ({ kind: "array", id: "c1", items: [a, 0, 0] });
const dpStep = (i: number, a: number, extra: Partial<Frame> = {}): Step => ({
  step: i,
  frames: [{ id: "f1", function: "f", line: 3 + i, locals: { dp: { kind: "array", items: [row(a), row(a), row(a)] }, first: row(a), n: 3 }, ...extra }],
  heap: {},
});
const trace = (steps: Step[]): Trace => ({ version: "0.14", language: "python", problem: { method: "f", params: [], input: {} }, steps });

describe("sharedPlaces", () => {
  it("names every place one container is reached from, as the reader writes it", () => {
    const places = sharedPlaces(dpStep(0, 1)).get("c1");
    expect(places?.map((p) => p.label)).toEqual(["dp[0]", "dp[1]", "dp[2]", "first"]);
    expect(places?.map((p) => p.card)).toEqual(["dp", "dp", "dp", "first"]);
  });

  it("names a caller's places with their function, once each, and members as members", () => {
    const path = (items: Value[]): Value => ({ kind: "array", id: "c4", items });
    const step: Step = {
      step: 0,
      frames: [
        { id: "f1", function: "subsets", line: 4, locals: { path: path([1]) } },
        { id: "f2", function: "backtrack", line: 9, locals: { path: path([1]) } },
        { id: "f3", function: "backtrack", line: 9, locals: { path: path([1]) } },
      ],
      members: { seen: { kind: "map", id: "c7", entries: [] } },
      heap: { n1: { kind: "object", type: "Node", fields: { val: 1, children: { kind: "map", id: "c7", entries: [] } } } },
    };
    const shared = sharedPlaces(step);
    expect(sharedGroups("path", shared)).toEqual([{ kind: "array", places: ["path", "path (in subsets)", "path (in backtrack)"] }]);
    expect(sharedGroups("#members/seen", shared)).toEqual([{ kind: "map", places: ["seen (member)", "Node.children (a node's field)"] }]);
  });

  it("notes only the outermost of nested shared containers: sink, given grid, shares its rows too", () => {
    const r = (id: string): Value => ({ kind: "array", id, items: [1, 0] });
    const grid = (): Value => ({ kind: "array", id: "g", items: [r("r0"), r("r1")] });
    const step = (extra: Record<string, Value> = {}): Step => ({
      step: 0,
      frames: [
        { id: "f1", function: "numIslands", line: 4, locals: { grid: grid(), ...extra } },
        { id: "f2", function: "sink", line: 9, locals: { grid: grid() } },
      ],
      heap: {},
    });
    expect(sharedGroups("grid", sharedPlaces(step()))).toEqual([{ kind: "array", places: ["grid", "grid (in numIslands)"] }]);
    // A row also held on its own is not implied by grid's note, so it keeps one.
    const aliased = sharedPlaces(step({ row: r("r0") }));
    expect(sharedGroups("grid", aliased)).toEqual([
      { kind: "array", places: ["grid", "grid (in numIslands)"] },
      { kind: "array", places: ["grid[0]", "grid[0] (in numIslands)", "row (in numIslands)"] },
    ]);
  });

  it("finds nothing when no container has an id", () => {
    expect(sharedPlaces({ step: 0, frames: [{ id: "f1", function: "f", line: 1, locals: { a: { kind: "array", items: [1] } } }], heap: {} }).size).toBe(0);
  });
});

describe("a container's id is identity, not content", () => {
  it("leaves the id out of comparisons, so a list that becomes shared has not changed", () => {
    const plain: Value = { kind: "array", items: [1, 0, 0] };
    expect(valuesEqual(plain, row(1))).toBe(true);
    expect(canonical(row(1))).not.toContain('"id"');
  });

  it("keeps a ref's id, which is what the ref is", () => {
    expect(valuesEqual({ kind: "ref", id: "n1" }, { kind: "ref", id: "n2" })).toBe(false);
  });

  it("flashes every row of dp when one write changes the one shared row", () => {
    const d = diff(dpStep(0, 0), dpStep(1, 1));
    const dp = d.locals.dp;
    expect(dp?.status).toBe("changed");
    expect(dp?.items).toEqual(["changed", "changed", "changed"]);
  });
});

describe("the note under a card", () => {
  it("names the places that are one container, under each card that holds one", () => {
    const t = trace([dpStep(0, 0), dpStep(1, 1)]);
    const html = renderToStaticMarkup(<VisualPanel trace={t} step={t.steps[1]} diff={diff(t.steps[0], t.steps[1])} />);
    expect(html.match(/class="shared-note"/g)).toHaveLength(2); // dp's card and first's card
    expect(html).toContain("Same array:");
    expect(html).toMatch(/<code class="shared-place">dp\[0\]<\/code>.*<code class="shared-place">first<\/code>/);
  });

  it("is absent when nothing is shared", () => {
    const t = trace([{ step: 0, frames: [{ id: "f1", function: "f", line: 1, locals: { a: { kind: "array", items: [1] } } }], heap: {} }]);
    expect(renderToStaticMarkup(<VisualPanel trace={t} step={t.steps[0]} diff={null} />)).not.toContain("shared-note");
  });
});
