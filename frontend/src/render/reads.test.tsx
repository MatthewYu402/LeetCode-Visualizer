import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import subsetsRaw from "../../../fixtures/subsets.trace.json?raw";
import twoSumRaw from "../../../fixtures/two-sum.trace.json?raw";
import { VisualPanel } from "../components/VisualPanel";
import { diff, diffValue } from "../trace/diff";
import { loadTrace } from "../trace/loader";
import { readsOf, topFrame, type ReadAt, type Trace, type Value } from "../trace/types";
import { readsFrom } from "./reads";
import { selectRenderer } from "./registry";

function load(raw: string): Trace {
  const r = loadTrace(raw);
  if (!r.ok) throw new Error(r.error);
  return r.trace;
}

/** Draws one value with the reads the running line made of it, and optionally a diff from `prev`. */
function draw(value: Value, reads: ReadAt[], prev?: Value): string {
  const d = prev === undefined ? null : diffValue(prev, value);
  const R = selectRenderer(value);
  return renderToStaticMarkup(<R name="x" value={value} diff={d} ctx={{ locals: { x: value }, reads }} />);
}
const count = (html: string, cls: string) => html.split(cls).length - 1;
const arr = (items: Value[]): Value => ({ kind: "array", items });

describe("readsFrom", () => {
  it("looks up positions and canonical keys", () => {
    const r = readsFrom([{ at: [1, 2] }, { at: [3] }, { key: "a" }]);
    expect(r.at(1, 2)).toBe(true);
    expect(r.at(1)).toBe(false);
    expect(r.at(3)).toBe(true);
    expect(r.key('"a"')).toBe(true);
    expect(readsFrom(undefined).at(0)).toBe(false);
  });
});

describe("cells read this step get a dashed outline", () => {
  it("a 1D strip: the cell read, and only it", () => {
    const html = draw(arr([5, 6, 7]), [{ at: [1] }]);
    expect(count(html, "is-read")).toBe(1);
    expect(html).toMatch(/class="cell\s+is-read"[^>]*>6</);
  });

  it("no reads, no outline", () => {
    expect(draw(arr([5, 6, 7]), [])).not.toContain("is-read");
  });

  it("a grid: each cell read (dp[i-1][j-1], dp[i-1][j]) and a whole row (dp[i-1])", () => {
    const grid = arr([arr([0, 0, 0]), arr([0, 1, 1]), arr([0, 1, 2])]);
    const cells = draw(grid, [{ at: [1, 1] }, { at: [1, 2] }]);
    expect(count(cells, "grid-cell") - count(cells, "grid-cells")).toBe(9);
    expect(count(cells, "is-read")).toBe(2);
    expect(cells).toContain('title="x[1][1] = 1"');
    const row = draw(grid, [{ at: [2] }]);
    expect(row).toContain('class="grid-row-read" style="grid-row:3"');
    expect(row).not.toContain("is-read");
  });

  it("a cell read and written by one line keeps both its change and its outline", () => {
    const html = draw(arr([0, 4, 9]), [{ at: [1] }], arr([0, 3, 9]));
    expect(html).toMatch(/class="cell diff-changed is-read"/);
  });

  it("ragged rows: a row read and a cell read", () => {
    const adj = arr([arr([1, 2]), arr([0]), arr([])]);
    const html = draw(adj, [{ at: [0] }, { at: [1, 0] }]);
    expect(html).toContain('class="array-strip is-read"');
    expect(count(html, "is-read")).toBe(2);
  });

  it("map rows, set members, and multimap rows by key", () => {
    const m: Value = { kind: "map", entries: [[2, 0], [7, 1]] };
    expect(count(draw(m, [{ key: 7 }]), "is-read")).toBe(1);
    expect(draw(m, [{ key: 7 }])).toMatch(/kv-row\s+is-read/);
    const s: Value = { kind: "set", items: ["a", "b"] };
    expect(count(draw(s, [{ key: "b" }]), "is-read")).toBe(1);
    const mm: Value = { kind: "multimap", entries: [[1, "x"], [1, "y"], [3, "z"]] };
    expect(count(draw(mm, [{ key: 1 }]), "is-read")).toBe(1);
  });
});

describe("reads on the canvas, from real traces", () => {
  it("Two Sum: the map entry found is outlined", () => {
    const t = load(twoSumRaw);
    const i = t.steps.findIndex((s) => readsOf(topFrame(s)).has("numMap"));
    expect(i).toBeGreaterThan(0);
    const html = renderToStaticMarkup(<VisualPanel trace={t} step={t.steps[i]} diff={diff(t.steps[i - 1], t.steps[i])} />);
    expect(count(html, "is-read")).toBe(1);
  });

  it("backtracking: after a call returns, the caller's pop is shown and its next read is outlined", () => {
    const t = load(subsetsRaw);
    const steps = t.steps;
    // Every step whose line read nums draws exactly one outline, in the running backtrack frame.
    const readSteps = steps.map((s, i) => [s, i] as const).filter(([s]) => readsOf(topFrame(s)).has("nums"));
    expect(readSteps.length).toBe(7);
    for (const [s, i] of readSteps) {
      const html = renderToStaticMarkup(<VisualPanel trace={t} step={s} diff={diff(steps[i - 1], s)} />);
      expect(count(html, "is-read")).toBe(1);
    }
    // A read that comes after backtracking: the previous steps returned and popped path.
    const after = readSteps.find(([, i]) => steps.slice(0, i).some((p) => "return_value" in topFrame(p) && topFrame(p).function === "backtrack"))!;
    const [s, i] = after;
    const popped = steps.slice(0, i).map((p, k) => [p, k] as const).reverse().find(([p, k]) => k > 0 && topFrame(p).id === topFrame(s).id && diff(steps[k - 1], p).locals.path?.status === "changed");
    expect(popped).toBeDefined();
    const [p, k] = popped!;
    const popHtml = renderToStaticMarkup(<VisualPanel trace={t} step={p} diff={diff(steps[k - 1], p)} />);
    expect(popHtml).toContain("diff-removed");
    const html = renderToStaticMarkup(<VisualPanel trace={t} step={s} diff={null} />);
    expect(count(html, "is-read")).toBe(1);
  });

  it("a read is drawn for that step only", () => {
    const t = load(subsetsRaw);
    const i = t.steps.findIndex((s) => readsOf(topFrame(s)).has("nums"));
    const next = renderToStaticMarkup(<VisualPanel trace={t} step={t.steps[i + 1]} diff={diff(t.steps[i], t.steps[i + 1])} />);
    expect(next).not.toContain("is-read");
  });
});
