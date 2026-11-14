import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import twoSum from "../../../fixtures/two-sum.trace.json?raw";
import { diff, diffValue } from "../trace/diff";
import { loadTrace } from "../trace/loader";
import { topFrame, type Trace, type Value } from "../trace/types";
import maxDepthRaw from "../../../fixtures/max-depth.trace.json?raw";
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
    expect(trace.steps.map((s) => topFrame(s).line)).toEqual([5, 8, 9, 11, 16, 8, 9, 11, 12, 12]);
    const html = renderStep(trace, 5, true);
    expect(html).toMatch(/<div class="kv-row diff-added" role="row"><span role="cell">2<\/span><svg[^]*?<\/svg><span role="cell">0<\/span><\/div>/);
    expect(html).toContain("insert 2"); // the operation chip on numMap's card
    expect(html).toContain("translate(58px, 0px)"); // i = 1 → one cell and one gap to the right
    expect(html).toContain("Step 5 of 9 · line 8");
  });

  it("shows the result only on the last step", () => {
    expect(renderStep(trace, 9, false)).toContain("[0, 1]");
    expect(renderStep(trace, 8, false)).not.toContain("result");
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
    const html = renderStep({ ...noResult, truncated: true }, 9, false);
    expect(html).toContain("did not return: stopped at the step limit");
    expect(html).toContain("not a wrong answer");
    // The last step is still the method's return step, so [0, 1] appears as its
    // return value. What must be missing is the result row.
    expect(html).not.toContain("result-row");
    expect(html).toContain("truncated");
  });

  it("no result and no truncated: the run ended early, and missing truncated means no badge", () => {
    const html = renderStep(noResult, 9, false);
    expect(html).toContain("did not return: the run ended early");
    expect(html).not.toContain("badge");
  });

  it("only the last step shows the missing result", () => {
    expect(renderStep({ ...noResult, truncated: true }, 8, false)).not.toContain("did not return");
  });

  it("a null result is shown as null, not as missing", () => {
    const html = renderStep({ ...trace, result: null }, 9, false);
    expect(html).toContain("result-row");
    expect(html).not.toContain("did not return");
  });
});

describe("a void method", () => {
  const voidTrace = { ...trace, problem: { ...trace.problem, returns: { type: "void" } }, result: null };

  it("a null result with returns void says the method returned no value", () => {
    const html = renderStep(voidTrace, 9, false);
    expect(html).toContain("returned, no value");
    expect(html).toContain("result-void");
    expect(html).not.toContain("did not return");
  });

  it("a null result from a method that returns a value is still shown as null", () => {
    const html = renderStep({ ...trace, problem: { ...trace.problem, returns: { type: "ListNode" } }, result: null }, 9, false);
    expect(html).not.toContain("returned, no value");
    expect(html).toContain("result-row");
  });

  it("a void method that did not return is reported as unfinished, not as void", () => {
    const { result: _gone, ...unfinished } = voidTrace;
    void _gone;
    const html = renderStep({ ...unfinished, truncated: true }, 9, false);
    expect(html).toContain("did not return: stopped at the step limit");
    expect(html).not.toContain("returned, no value");
  });
});

describe("the call stack (Maximum Depth fixture)", () => {
  const md = loadTrace(maxDepthRaw);
  if (!md.ok) throw new Error(md.error);
  const t = md.trace;
  const deepest = t.steps.reduce((best, s, i) => (s.frames.length > t.steps[best].frames.length ? i : best), 0);

  it("lists every frame, running frame first", () => {
    const html = renderStep(t, deepest, false);
    expect(html.match(/<li class="frame[^"]*">/g)).toHaveLength(t.steps[deepest].frames.length);
    expect(html).toMatch(/<ol class="call-stack"[^>]*><li class="frame frame-top">/);
  });

  it("a return step shows what the running frame returns", () => {
    const i = t.steps.findIndex((s) => "return_value" in topFrame(s));
    const html = renderStep(t, i, false);
    expect(html).toContain("return-row");
    expect(html).toContain("returning");
  });

  it("after a return, the caller is diffed against its own earlier self", () => {
    // The step after the first return: the caller now has `left`, which it did not have before the call.
    const i = t.steps.findIndex((s) => "return_value" in topFrame(s)) + 1;
    const d = diff(t.steps[i - 1], t.steps[i]);
    expect(topFrame(t.steps[i]).id).not.toBe(topFrame(t.steps[i - 1]).id);
    expect(d.locals.left?.status).toBe("added");
    expect(d.locals.root?.status).toBe("same");
  });

  it("every step renders in isolation", () => {
    for (let i = 0; i < t.steps.length; i++) expect(() => renderStep(t, i, i > 0)).not.toThrow();
  });
});

describe("iterators", () => {
  const withLocals = (locals: Record<string, Value>) => ({
    ...trace,
    steps: [{ step: 0, frames: [{ id: "f1", function: "f", line: 1, locals }], heap: {} }],
  });

  it("an iterator into an array is a marker under its index, named after the iterator", () => {
    const html = renderStep(
      withLocals({ nums: { kind: "array", items: [4, 5, 6] }, it: { kind: "iterator", container: "nums", index: 2 } }),
      0,
      false,
    );
    expect(html).toContain("translate(116px, 0px)"); // index 2 → two cells and two gaps to the right
    expect(html).toMatch(/class="tag-pill pointer-name">it</);
    expect(html).toContain("→ nums[2]"); // and its row in the state panel
  });

  it("an iterator into another array, or at end(), draws no marker", () => {
    const html = renderStep(
      withLocals({
        a: { kind: "array", items: [1] },
        b: { kind: "array", items: [2] },
        it: { kind: "iterator", container: "b", index: 0 },
        done: { kind: "iterator", container: "a", end: true },
      }),
      0,
      false,
    );
    expect(html.match(/class="tag-pill pointer-name">it</g)).toHaveLength(1); // under b only
    expect(html).not.toMatch(/class="tag-pill pointer-name">done</);
    expect(html).toContain("→ a.end()");
  });

  it("Two Sum's step 8 shows it pointing at key 2 of numMap", () => {
    expect(renderStep(trace, 8, false)).toContain("→ numMap[2]");
  });
});

describe("top bar", () => {
  const bar = (over: Partial<Parameters<typeof Toolbar>[0]> = {}) =>
    renderToStaticMarkup(
      <Toolbar
        language="cpp"
        onLanguage={() => {}}
        showCalls
        onShowCalls={() => {}}
        onRun={() => {}}
        running={false}
        blocked={null}
        runShortcut="Ctrl Enter"
        {...over}
      />,
    );

  it("has the name, the language, the call-stack switch, and Run code", () => {
    const html = bar();
    expect(html).toContain("LeetCode Visualizer");
    expect(html).toContain('<option value="cpp" selected="">C++</option>');
    expect(html).toMatch(/role="switch" aria-checked="true"/);
    expect(html).toContain("Run code");
    expect(html).toContain("(Ctrl Enter)");
  });

  it("Run code is disabled with the reason as its tooltip, and shows a spinner while running", () => {
    expect(bar({ blocked: "Fill in target." })).toMatch(/disabled="" title="Fill in target\."/);
    const running = bar({ running: true, blocked: "Running…" });
    expect(running).toContain("Running…");
    expect(running).toContain('class="spinner"');
    expect(running).not.toMatch(/<button[^>]*class="run-button[^"]*"[^>]*disabled=""/);
  });

  it("the call-stack switch says when it is off", () => {
    expect(bar({ showCalls: false })).toMatch(/role="switch" aria-checked="false"/);
  });
});

describe("every v0.8 kind renders without crashing", () => {
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
    steps: [{ step: 0, frames: [{ id: "f1", function: "f", line: 1, locals: values }], heap: { n1: { kind: "object", type: "TreeNode", fields: { val: 1, left: null, right: null } } } }],
  };

  it("renders each container through the registry", () => {
    const html = renderStep(t, 0, false);
    for (const k of ["list · 2", "stack · 2", "queue · 1", "deque · 0", "priority queue · max · 2", "tuple · 2", "set · 1", "multiset · 3", "multimap · 2", "ref"])
      expect(html).toContain(k);
    expect(html).toContain("9007199254740993");
    expect(html).toContain("NaN");
  });
});

// React keys are not checked here: renderToStaticMarkup does not warn about duplicate
// keys, so a test for them would pass either way. The renderers key repeated members
// by position.
describe("multiset and multimap with repeated members", () => {
  const step = (locals: Record<string, Value>) => ({ step: 0, frames: [{ id: "f1", function: "f", line: 1, locals }], heap: {} });

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

    // multiset: one chip per member with its count; 5 went from three copies to one, 2 from one to two.
    expect(html).toMatch(/set-member diff-changed"[^>]*>5</);
    expect(html).toMatch(/set-member diff-changed"[^>]*>2<span class="count-badge is-changed">×2</);
    // multimap, matched by count: [1,"a"] same, two [1,"z"] added, one [1,"a"] removed in key 1's
    // row; key 2 is gone, so its row is faded with its [2,"b"].
    expect(html.match(/<span class="chip diff-added">&quot;z&quot;<\/span>/g)).toHaveLength(2);
    expect(html.match(/<span class="chip diff-removed">&quot;a&quot;<\/span>/g)).toHaveLength(1);
    expect(html).toMatch(/<div class="kv-row diff-removed" role="row"><span role="cell" class="kv-key">2<\/span>[^]*?<span class="chip diff-removed">&quot;b&quot;<\/span>/);
  });

  it("a reordered multiset or multimap draws with no diff colour", () => {
    const d = diffValue({ kind: "multiset", items: [1, 1, 2] }, { kind: "multiset", items: [2, 1, 1] });
    expect(d.status).toBe("same");
  });
});
