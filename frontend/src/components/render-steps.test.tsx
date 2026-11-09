import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import twoSum from "../../../fixtures/two-sum.trace.json?raw";
import { diff } from "../trace/diff";
import { loadTrace } from "../trace/loader";
import type { Trace, Value } from "../trace/types";
import { StatePanel } from "./StatePanel";
import { VisualPanel } from "./VisualPanel";

const loaded = loadTrace(twoSum);
if (!loaded.ok) throw new Error(loaded.error);
const trace: Trace = loaded.trace;

/** Render one step with nothing but its own snapshot (and optionally the diff from the step before). */
function renderStep(t: Trace, index: number, withDiff: boolean): string {
  const step = t.steps[index];
  const d = withDiff && index > 0 ? diff(t.steps[index - 1], step) : null;
  return (
    renderToStaticMarkup(<VisualPanel trace={t} step={step} diff={d} />) +
    renderToStaticMarkup(<StatePanel trace={t} step={step} index={index} diff={d} />)
  );
}

describe("Two Sum renders every step in isolation", () => {
  it.each(trace.steps.map((s) => s.step))("step %i, with and without a diff", (i) => {
    expect(() => renderStep(trace, i, false)).not.toThrow();
    expect(() => renderStep(trace, i, true)).not.toThrow();
  });

  it("a step drawn with no diff is the same picture as with one, minus colour", () => {
    const strip = (html: string) => html.replace(/ ?diff-[a-z-]+/g, "").replace(/<[^>]*removed-[^>]*>.*?<\/(tr|div)>/g, "");
    const plain = renderStep(trace, 6, false);
    expect(strip(renderStep(trace, 6, true))).toBe(strip(plain));
  });

  it("step 1 highlights line 8; step 5 shows numMap [2, 0] added and i's pointer under index 1", () => {
    expect(trace.steps.map((s) => s.line)).toEqual([5, 8, 9, 11, 16, 8, 9, 11, 12]);
    const html = renderStep(trace, 5, true);
    expect(html).toMatch(/<tr class="diff-added"><td>2<\/td><td>0<\/td><\/tr>/);
    expect(html).toContain("translate(52px, 0px)"); // i = 1 → one cell to the right
    expect(html).toContain("Step 5 of 8 · line 8");
  });

  it("shows the result only on the last step", () => {
    expect(renderStep(trace, 8, false)).toContain("[0, 1]");
    expect(renderStep(trace, 7, false)).not.toContain("result");
  });

  it("shows the truncated badge when the trace says so", () => {
    expect(renderStep({ ...trace, truncated: true }, 0, false)).toContain("truncated");
    expect(renderStep(trace, 0, false)).not.toContain("truncated");
  });
});

describe("every v0.2 kind renders without crashing", () => {
  const values: Record<string, Value> = {
    arr: { kind: "array", items: [1, { kind: "int", value: "9007199254740993" }] },
    lst: { kind: "list", items: [1, 2] },
    stk: { kind: "stack", items: [1, 2] },
    que: { kind: "queue", items: [1] },
    dq: { kind: "deque", items: [] },
    pq: { kind: "priority-queue", items: [5, 1], order: "max" },
    tup: { kind: "tuple", items: [0, "a"] },
    st: { kind: "set", items: [1] },
    mp: { kind: "map", entries: [] },
    ref: { kind: "ref", id: "n1" },
    f: { kind: "float", value: "NaN" },
    i: 0,
  };
  const t: Trace = {
    ...trace,
    steps: [{ step: 0, line: 1, locals: values, heap: { n1: { kind: "object", type: "TreeNode", fields: { val: 1, left: null, right: null } } } }],
  };

  it("renders each container through the registry", () => {
    const html = renderStep(t, 0, false);
    for (const k of ["list", "stack", "queue", "deque", "priority-queue · max", "tuple", "set", "ref"]) expect(html).toContain(k);
    expect(html).toContain("9007199254740993");
    expect(html).toContain("NaN");
  });
});
