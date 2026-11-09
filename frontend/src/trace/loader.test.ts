import { describe, expect, it } from "vitest";
import twoSum from "../../../fixtures/two-sum.trace.json?raw";
import { loadTrace } from "./loader";

const withVersion = (version: string) => JSON.stringify({ ...JSON.parse(twoSum), version });

describe("loadTrace", () => {
  it("accepts version 0.2 (the Two Sum fixture)", () => {
    const r = loadTrace(twoSum);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.trace.steps).toHaveLength(9);
  });

  it.each(["0.1", "1.0", "0.3"])("rejects version %s with an error", (v) => {
    const r = loadTrace(withVersion(v));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe(`Unsupported trace version "${v}". This frontend reads version 0.2 only.`);
  });

  it("rejects text that is not JSON, including a bare NaN", () => {
    expect(loadTrace("{").ok).toBe(false);
    expect(loadTrace('{"version":"0.2","x":NaN}').ok).toBe(false);
  });

  it("rejects a malformed step", () => {
    const t = JSON.parse(twoSum);
    t.steps[3] = { step: 3, locals: {} };
    const r = loadTrace(JSON.stringify(t));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/Step 3/);
  });
});
