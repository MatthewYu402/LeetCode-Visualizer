import { describe, expect, it } from "vitest";
import twoSum from "../../../fixtures/two-sum.trace.json?raw";
import { loadTrace } from "./loader";
import { problemTitle, returnsVoid, runEnd } from "./types";

const withVersion = (version: string) => JSON.stringify({ ...JSON.parse(twoSum), version });

describe("loadTrace", () => {
  it("accepts version 0.5 (the Two Sum fixture)", () => {
    const r = loadTrace(twoSum);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.trace.steps).toHaveLength(9);
  });

  it.each(["0.1", "0.2", "0.3", "0.4", "0.6", "1.0", "1.5"])("rejects version %s with an error", (v) => {
    const r = loadTrace(withVersion(v));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(`Unsupported trace version "${v}". This frontend reads version 0.5 only.`);
  });

  it("accepts a trace with no result: the run did not finish", () => {
    const t = JSON.parse(twoSum);
    delete t.result;
    t.truncated = true;
    const r = loadTrace(JSON.stringify(t));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect("result" in r.trace).toBe(false);
    expect(runEnd(r.trace)).toBe("truncated");
  });

  it("rejects text that is not JSON, including a bare NaN", () => {
    expect(loadTrace("{").ok).toBe(false);
    expect(loadTrace('{"version":"0.2","x":NaN}').ok).toBe(false);
  });

  it("rejects text that is not JSON in a 0.5 trace too", () => {
    expect(loadTrace('{"version":"0.5","x":Infinity}').ok).toBe(false);
  });

  it("rejects a malformed step", () => {
    const t = JSON.parse(twoSum);
    t.steps[3] = { step: 3, locals: {} };
    const r = loadTrace(JSON.stringify(t));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Step 3/);
  });
});

describe("runEnd", () => {
  const base = JSON.parse(twoSum);
  const without = (...keys: string[]) => {
    const t = { ...base };
    for (const k of keys) delete t[k];
    return t;
  };

  it("result present, truncated absent: returned (the normal case)", () => {
    expect(runEnd(base)).toBe("returned");
  });
  it("result absent, truncated true: stopped at the step limit", () => {
    expect(runEnd({ ...without("result"), truncated: true })).toBe("truncated");
  });
  it("result absent, truncated absent: the run ended early (missing truncated means false)", () => {
    expect(runEnd(without("result", "truncated"))).toBe("stopped");
  });
  it("result present and truncated: the method still returned", () => {
    expect(runEnd({ ...base, truncated: true })).toBe("returned");
  });
  it("a null result is a real return value, not a missing one", () => {
    expect(runEnd({ ...base, result: null })).toBe("returned");
  });
});

describe("returnsVoid", () => {
  const { problem } = JSON.parse(twoSum);
  it("is false for the Two Sum fixture, which returns array<int>", () => {
    expect(returnsVoid(problem)).toBe(false);
  });
  it("is true only when returns.type is void", () => {
    expect(returnsVoid({ ...problem, returns: { type: "void" } })).toBe(true);
  });
  it("is false when returns is absent, so a null result stays a null value", () => {
    const { returns: _r, ...bare } = problem;
    void _r;
    expect(returnsVoid(bare)).toBe(false);
  });
});

describe("problemTitle", () => {
  const p = { method: "twoSum", params: [], input: {} };
  it("uses problem.name when present", () => {
    expect(problemTitle({ ...p, name: "Two Sum" })).toBe("Two Sum");
  });
  it("falls back to problem.method when name is absent or blank", () => {
    expect(problemTitle(p)).toBe("twoSum");
    expect(problemTitle({ ...p, name: "  " })).toBe("twoSum");
  });
});
