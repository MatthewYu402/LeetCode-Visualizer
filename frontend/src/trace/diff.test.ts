import { describe, expect, it } from "vitest";
import twoSum from "../../../fixtures/two-sum.trace.json?raw";
import { canonical } from "./format";
import { diff, diffForStep, diffValue } from "./diff";
import type { Trace } from "./types";

const trace = JSON.parse(twoSum) as Trace;

describe("diff on Two Sum", () => {
  it("step 4 → 5: numMap key 2 added, i changed, complement removed", () => {
    const d = diff(trace.steps[4], trace.steps[5]);
    expect(d.locals.numMap.status).toBe("changed");
    expect(d.locals.numMap.keys?.get(canonical(2))).toBe("added");
    expect(d.locals.numMap.removedKeys).toEqual([]);
    expect(d.locals.i).toEqual({ status: "changed", prev: 0 });
    expect(d.locals.complement).toEqual({ status: "removed", prev: 7 });
    expect(d.locals.nums.status).toBe("same");
    expect(d.locals.target.status).toBe("same");
  });

  it("step 0 → 1: numMap and i added", () => {
    const d = diff(trace.steps[0], trace.steps[1]);
    expect(d.locals.numMap.status).toBe("added");
    expect(d.locals.i.status).toBe("added");
  });
});

describe("diffForStep", () => {
  it("applies only when entered from the step directly before", () => {
    expect(diffForStep(trace.steps, 5, 4)).not.toBeNull();
    expect(diffForStep(trace.steps, 0, null)).toBeNull();
    expect(diffForStep(trace.steps, 5, null)).toBeNull();
    expect(diffForStep(trace.steps, 5, 0)).toBeNull(); // jump
    expect(diffForStep(trace.steps, 4, 5)).toBeNull(); // backwards
  });
});

describe("diffValue inside containers", () => {
  it("arrays diff per index, with removed tail items kept", () => {
    const d = diffValue({ kind: "array", items: [1, 2, 3] }, { kind: "array", items: [1, 9] });
    expect(d.items).toEqual(["same", "changed"]);
    expect(d.removedItems).toEqual([{ index: 2, value: 3 }]);
    const g = diffValue({ kind: "stack", items: [1] }, { kind: "stack", items: [1, 2] });
    expect(g.items).toEqual(["same", "added"]);
  });

  it("maps diff per key, regardless of entry order", () => {
    const d = diffValue(
      { kind: "map", entries: [[1, "a"], [2, "b"], [3, "c"]] },
      { kind: "map", entries: [[3, "c"], [2, "z"], [4, "d"]] },
    );
    expect(d.keys?.get(canonical(3))).toBe("same");
    expect(d.keys?.get(canonical(2))).toBe("changed");
    expect(d.keys?.get(canonical(4))).toBe("added");
    expect(d.removedKeys).toEqual([{ key: 1, value: "a" }]);
  });

  it("sets diff by member; a reordered set is unchanged", () => {
    expect(diffValue({ kind: "set", items: [1, 2] }, { kind: "set", items: [2, 1] }).status).toBe("changed");
    const d = diffValue({ kind: "set", items: [1, 2] }, { kind: "set", items: [2, 3] });
    expect(d.keys?.get(canonical(2))).toBe("same");
    expect(d.keys?.get(canonical(3))).toBe("added");
    expect(d.removedKeys).toEqual([{ key: 1, value: 1 }]);
  });

  it("compares tagged ints by digits", () => {
    const a = { kind: "int", value: "9007199254740993" } as const;
    const b = { kind: "int", value: "9007199254740992" } as const;
    expect(diffValue(a, a).status).toBe("same");
    expect(diffValue(a, b).status).toBe("changed");
  });

  it("a kind change is changed with no per-item detail", () => {
    const d = diffValue({ kind: "array", items: [1] }, { kind: "list", items: [1] });
    expect(d.status).toBe("changed");
    expect(d.items).toBeUndefined();
  });
});
