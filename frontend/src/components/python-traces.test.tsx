import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import cloneGraph from "../../../fixtures/clone-graph.python.trace.json?raw";
import maxDepth from "../../../fixtures/max-depth.python.trace.json?raw";
import preorder from "../../../fixtures/preorder-traversal.python.trace.json?raw";
import reverseList from "../../../fixtures/reverse-list.python.trace.json?raw";
import subsets from "../../../fixtures/subsets.python.trace.json?raw";
import twoSum from "../../../fixtures/two-sum.python.trace.json?raw";
import { diff } from "../trace/diff";
import { loadTrace } from "../trace/loader";
import type { Trace } from "../trace/types";
import { StatePanel } from "./StatePanel";
import { VisualPanel } from "./VisualPanel";

// The Python adapter's golden traces (adapters/python): the same frontend draws them, with no
// branch on `language` (CLAUDE.md invariant 2). Every step renders, alone and with its diff.
const TRACES: Record<string, string> = {
  "two-sum": twoSum,
  "reverse-list": reverseList,
  "preorder-traversal": preorder,
  "clone-graph": cloneGraph,
  "max-depth": maxDepth,
  subsets,
};

function load(raw: string): Trace {
  const r = loadTrace(raw);
  if (!r.ok) throw new Error(r.error);
  return r.trace;
}

describe.each(Object.keys(TRACES))("the Python %s trace", (name) => {
  const trace = load(TRACES[name]);

  it("loads and renders every step", () => {
    expect(trace.language).toBe("python");
    trace.steps.forEach((step, i) => {
      const d = i > 0 ? diff(trace.steps[i - 1], step) : null;
      expect(() => renderToStaticMarkup(<VisualPanel trace={trace} step={step} diff={d} />)).not.toThrow();
      expect(() => renderToStaticMarkup(<StatePanel trace={trace} step={step} index={i} diff={d} />)).not.toThrow();
    });
  });
});
