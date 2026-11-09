import { describe, expect, it } from "vitest";
import { formatValue, kindOf } from "./format";
import { loadTrace } from "./loader";
import type { Value } from "./types";

describe("tagged numbers", () => {
  it("shows an int beyond 2^53 by its exact digits", () => {
    // 2^53 + 1 rounds to 2^53 as a JS number. The tagged form must keep the 3.
    const big: Value = { kind: "int", value: "9007199254740993" };
    expect(formatValue(big)).toBe("9007199254740993");
    expect(formatValue({ kind: "int", value: "-123456789012345678901234567890" })).toBe("-123456789012345678901234567890");
    expect(kindOf(big)).toBe("int");
  });

  it("keeps exact digits through JSON parsing and inside containers", () => {
    const text = '{"kind":"array","items":[{"kind":"int","value":"9007199254740993"},1]}';
    expect(formatValue(JSON.parse(text) as Value)).toBe("[9007199254740993, 1]");
  });

  it("shows NaN and ±Infinity", () => {
    expect(formatValue({ kind: "float", value: "NaN" })).toBe("NaN");
    expect(formatValue({ kind: "float", value: "Infinity" })).toBe("∞");
    expect(formatValue({ kind: "float", value: "-Infinity" })).toBe("-∞");
    expect(kindOf({ kind: "float", value: "NaN" })).toBe("float");
  });

  it("survives the loader", () => {
    const t = {
      version: "0.2", language: "x", problem: { method: "f", params: [], input: {} },
      steps: [{ step: 0, line: 1, heap: {}, locals: { a: { kind: "int", value: "18446744073709551615" }, b: { kind: "float", value: "-Infinity" } } }],
      result: null,
    };
    const r = loadTrace(JSON.stringify(t));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(formatValue(r.trace.steps[0].locals.a)).toBe("18446744073709551615");
    expect(formatValue(r.trace.steps[0].locals.b)).toBe("-∞");
  });
});

describe("formatValue", () => {
  it("formats every v0.2 kind compactly", () => {
    expect(formatValue({ kind: "array", items: [2, 7, 11, 15] })).toBe("[2, 7, 11, 15]");
    expect(formatValue({ kind: "map", entries: [[2, 0]] })).toBe("{2: 0}");
    expect(formatValue({ kind: "tuple", items: [0, "a"] })).toBe('(0, "a")');
    expect(formatValue({ kind: "set", items: [1, 2] })).toBe("{1, 2}");
    expect(formatValue({ kind: "ref", id: "n1" })).toBe("→ n1");
    expect(formatValue(null)).toBe("null");
    expect(formatValue(true)).toBe("true");
  });
});
