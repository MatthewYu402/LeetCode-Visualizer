import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import twoSum from "../../../fixtures/two-sum.trace.json?raw";
import { diff, diffValue } from "../trace/diff";
import { loadTrace } from "../trace/loader";
import { problemTitle, type Trace, type Value } from "../trace/types";
import { initialPlayer } from "../player/playback";
import { StatePanel } from "./StatePanel";
import { Toolbar } from "./Toolbar";
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

describe("a run that did not finish", () => {
  const { result: _dropped, ...noResult } = trace;
  void _dropped;

  it("truncated, no result: the last step says it stopped at the step limit", () => {
    const html = renderStep({ ...noResult, truncated: true }, 8, false);
    expect(html).toContain("did not return: stopped at the step limit");
    expect(html).toContain("not a wrong answer");
    expect(html).not.toContain("[0, 1]");
    expect(html).toContain("truncated");
  });

  it("no result and no truncated: the run ended early, and missing truncated means no badge", () => {
    const html = renderStep(noResult, 8, false);
    expect(html).toContain("did not return: the run ended early");
    expect(html).not.toContain("badge");
  });

  it("only the last step shows the missing result", () => {
    expect(renderStep({ ...noResult, truncated: true }, 7, false)).not.toContain("did not return");
  });

  it("a null result is shown as null, not as missing", () => {
    const html = renderStep({ ...trace, result: null }, 8, false);
    expect(html).toContain("result-row");
    expect(html).not.toContain("did not return");
  });
});

describe("title", () => {
  const toolbar = (title: string | null) =>
    renderToStaticMarkup(
      <Toolbar
        language="cpp"
        onLanguage={() => {}}
        player={initialPlayer(9)}
        dispatch={() => {}}
        speed={1}
        onSpeed={() => {}}
        title={title}
      />,
    );

  it("shows problem.method when problem.name is absent (the Two Sum fixture)", () => {
    expect(trace.problem.name).toBeUndefined();
    expect(toolbar(problemTitle(trace.problem))).toContain(">twoSum</h1>");
  });

  it("shows problem.name when present", () => {
    expect(toolbar(problemTitle({ ...trace.problem, name: "Two Sum" }))).toContain(">Two Sum</h1>");
  });

  it("shows no title without a trace", () => {
    expect(toolbar(null)).not.toContain("<h1");
  });
});

describe("every v0.4 kind renders without crashing", () => {
  const values: Record<string, Value> = {
    arr: { kind: "array", items: [1, { kind: "int", value: "9007199254740993" }] },
    lst: { kind: "list", items: [1, 2] },
    stk: { kind: "stack", items: [1, 2] },
    que: { kind: "queue", items: [1] },
    dq: { kind: "deque", items: [] },
    pq: { kind: "priority-queue", items: [5, 1], order: "max" },
    tup: { kind: "tuple", items: [0, "a"] },
    st: { kind: "set", items: [1] },
    ms: { kind: "multiset", items: [1, 1, 3] },
    mp: { kind: "map", entries: [] },
    mm: { kind: "multimap", entries: [[1, "a"], [1, "b"]] },
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
    for (const k of ["list", "stack", "queue", "deque", "priority-queue · max", "tuple", "set", "multiset · 3", "multimap · 2", "ref"])
      expect(html).toContain(k);
    expect(html).toContain("9007199254740993");
    expect(html).toContain("NaN");
  });
});

// React keys are not checked here: renderToStaticMarkup does not warn about duplicate
// keys, so a test for them would pass either way. The renderers key repeated members
// by position.
describe("multiset and multimap with repeated members", () => {
  const step = (locals: Record<string, Value>) => ({ step: 0, line: 1, locals, heap: {} });

  it("draw every copy and colour them by count", () => {
    const prev = step({
      ms: { kind: "multiset", items: [5, 5, 5, 2] },
      mm: { kind: "multimap", entries: [[1, "a"], [1, "a"], [2, "b"]] },
    });
    const curr = step({
      ms: { kind: "multiset", items: [5, 2, 2] },
      mm: { kind: "multimap", entries: [[1, "a"], [1, "z"], [1, "z"]] },
    });
    const t: Trace = { ...trace, steps: [prev, curr] };
    const html = renderStep(t, 1, true);

    // multiset: 5 same, 2 same, 2 added; two 5s removed.
    expect(html.match(/cell cell-auto diff-added">2</g)).toHaveLength(1);
    expect(html.match(/cell cell-auto diff-removed">5</g)).toHaveLength(2);
    // multimap: [1,"a"] same, two [1,"z"] added; [1,"a"] and [2,"b"] removed.
    expect(html.match(/<tr class="diff-added"><td>1<\/td><td>&quot;z&quot;<\/td><\/tr>/g)).toHaveLength(2);
    expect(html).toContain('<tr class="diff-removed"><td>2</td><td>&quot;b&quot;</td></tr>');
  });

  it("a reordered multiset or multimap draws with no diff colour", () => {
    const d = diffValue({ kind: "multiset", items: [1, 1, 2] }, { kind: "multiset", items: [2, 1, 1] });
    expect(d.status).toBe("same");
  });
});
