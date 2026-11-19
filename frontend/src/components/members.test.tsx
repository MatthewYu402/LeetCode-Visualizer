import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { diff } from "../trace/diff";
import type { Step, Trace, Value } from "../trace/types";
import { StatePanel } from "./StatePanel";
import { VisualPanel } from "./VisualPanel";

const map = (entries: [Value, Value][]): Value => ({ kind: "map", entries });

/** fib with a memo member: two steps, the memo growing between them. */
function trace(extraLocals: Record<string, Value> = {}): Trace {
  const step = (i: number, memo: Value, read = false): Step => ({
    step: i,
    frames: [
      {
        id: "f1",
        function: "fib",
        line: 3 + i,
        locals: { n: 3, ...extraLocals },
        ...(read ? { outcomes: [{ kind: "read", code: "memo[n]", target: "memo", key: 2, value: 1 }] } : {}),
      },
    ],
    members: { memo, calls: i },
    heap: {},
  });
  return {
    version: "0.14",
    language: "cpp",
    problem: { method: "fib", params: [{ name: "n", type: "int" }], returns: { type: "int" }, input: { n: 3 } },
    steps: [step(0, map([])), step(1, map([[2, 1]]), true)],
  } as Trace;
}

describe("members on the canvas", () => {
  it("draws a member container as a card with a member tag, after the call's own", () => {
    const t = trace({ seen: { kind: "array", items: [1] } });
    const html = renderToStaticMarkup(<VisualPanel trace={t} step={t.steps[1]} diff={diff(t.steps[0], t.steps[1])} />);
    expect(html).toContain('aria-label="memo: map"');
    expect(html).toContain(">member<");
    expect(html.indexOf('aria-label="seen: array"')).toBeLessThan(html.indexOf('aria-label="memo: map"'));
    expect(html.split(">member<").length - 1).toBe(1); // calls is an int: state panel only
  });

  it("shows what a step added to a member, and the entry a line read", () => {
    const t = trace();
    const html = renderToStaticMarkup(<VisualPanel trace={t} step={t.steps[1]} diff={diff(t.steps[0], t.steps[1])} />);
    expect(html).toMatch(/kv-row diff-added is-read/);
  });

  it("a local of the running call hides a member with its name", () => {
    const t = trace({ memo: { kind: "array", items: [] } });
    const html = renderToStaticMarkup(<VisualPanel trace={t} step={t.steps[1]} diff={null} />);
    expect(html).not.toContain(">member<");
  });
});

describe("members in the state panel", () => {
  it("lists every member under its own heading, with its change", () => {
    const t = trace();
    const html = renderToStaticMarkup(<StatePanel trace={t} step={t.steps[1]} index={1} diff={diff(t.steps[0], t.steps[1])} source="" />);
    expect(html).toContain("Members of Solution");
    expect(html).toMatch(/<td class="state-name">memo<\/td>/);
    expect(html).toMatch(/<td class="state-name">calls<\/td>/);
  });

  it("no heading when the trace has no members", () => {
    const t = trace();
    const bare = { ...t, steps: t.steps.map(({ members: _, ...s }) => s) } as Trace;
    const html = renderToStaticMarkup(<StatePanel trace={bare} step={bare.steps[0]} index={0} diff={null} source="" />);
    expect(html).not.toContain("Members of Solution");
  });
});
