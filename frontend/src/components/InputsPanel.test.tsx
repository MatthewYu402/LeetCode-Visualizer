import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { Method } from "../api/client";
import { fieldsFor } from "../api/form";
import type { Inputs, RunState } from "../api/useInputs";
import { InputsPanel } from "./InputsPanel";

const twoSum: Method = {
  name: "twoSum",
  params: [
    { name: "nums", type: "array<int>" },
    { name: "target", type: "int" },
  ],
  returns: "array<int>",
  extras: [],
  readable: true,
  note: "",
};
const helper: Method = { name: "helper", params: [{ name: "a", type: "int" }], returns: "int", extras: [], readable: true, note: "" };

function inputs(over: Partial<Inputs> = {}): Inputs {
  const method = over.method ?? twoSum;
  return {
    signature: { methods: [twoSum], method: "twoSum" },
    signatureError: null,
    method,
    fields: fieldsFor(method),
    values: { nums: "[2,7,11,15]", target: "9" },
    blocked: null,
    run: { status: "idle" },
    chooseMethod: () => {},
    setValue: () => {},
    fillFromExample: async () => ({ ok: true, filled: [] }),
    start: () => {},
    ...over,
  };
}

const html = (i: Inputs, example?: Parameters<typeof InputsPanel>[0]["example"]) => renderToStaticMarkup(<InputsPanel inputs={i} example={example} />);

describe("InputsPanel", () => {
  it("one labeled field per parameter, with its type and value", () => {
    const out = html(inputs());
    expect(out).toContain('aria-label="nums (array&lt;int&gt;)"');
    expect(out).toContain('value="[2,7,11,15]"');
    expect(out).toContain('aria-label="target (int)"');
    expect(out).not.toContain('aria-label="Method"'); // one method: no picker
  });

  it("a method picker when the Solution has several public methods", () => {
    const out = html(inputs({ signature: { methods: [twoSum, helper], method: "twoSum" } }));
    expect(out).toContain('aria-label="Method"');
    expect(out).toContain("twoSum(nums, target)");
    expect(out).toContain("helper(a)");
  });

  it("says why Run code is disabled, but has no Run button of its own (it is in the top bar)", () => {
    const out = html(inputs({ blocked: "Fill in target." }));
    expect(out).toContain("Fill in target.");
    expect(out).not.toContain('type="submit"');
    expect(out).not.toContain("Run code");
  });

  it("no reason while a run is going: the top bar's button shows it", () => {
    expect(html(inputs({ blocked: "Running…", run: { status: "running" } }))).not.toContain("Running…");
  });

  it("a finished run adds nothing to the panel", () => {
    const done: RunState = { status: "done", result: { trace: { version: "0.8", language: "x", problem: { method: "f", params: [], input: {} }, steps: [] }, output: "hi", warnings: ["a note"] } };
    const out = html(inputs({ run: done }));
    expect(out).not.toContain("steps");
    expect(out).not.toContain("a note");
  });

  it("the starter's example is ghost text: in the fields of its method, and in the example box", () => {
    const example = { method: "twoSum", values: { nums: "[2,7,11,15]", target: "9" }, text: "Input: nums = [2,7,11,15], target = 9\nOutput: [0,1]" };
    const out = html(inputs({ values: { nums: "", target: "" } }), example);
    expect(out).toContain('placeholder="[2,7,11,15]"');
    expect(out).toContain('placeholder="9"');
    expect(out).toContain("Output: [0,1]");
    // Another method keeps the type's own placeholder.
    const other = html(inputs({ method: helper, signature: { methods: [helper], method: "helper" }, values: { a: "" } }), example);
    expect(other).not.toContain('placeholder="[2,7,11,15]"');
  });

  it("Fill fields stays under the example box, disabled while it is empty", () => {
    expect(html(inputs())).toMatch(/<button type="button"[^>]*disabled=""[^>]*>Fill fields<\/button>/);
  });

  it("a failed run shows its stage and the message", () => {
    const run: RunState = { status: "failed", error: { stage: "rewriter", message: "solution.cpp:4:16: error: use of undeclared identifier 'm'" } };
    const out = html(inputs({ run }));
    expect(out).toContain("The code does not compile");
    expect(out).toContain("use of undeclared identifier");
  });

  it("a second run while one is in progress, and a full line, say what to do", () => {
    const already: RunState = { status: "failed", error: { stage: "already-running", message: "You already have a run in progress." } };
    expect(html(inputs({ run: already }))).toContain("Your previous run is still going");
    const busy: RunState = { status: "failed", error: { stage: "busy", message: "Busy: 12 runs are waiting. Try again in about 25 seconds." } };
    expect(html(inputs({ run: busy }))).toContain("Try again in about 25 seconds.");
  });

  it("an optional extra says so", () => {
    const hasCycle: Method = { name: "hasCycle", params: [{ name: "head", type: "ListNode" }], returns: "bool", extras: ["pos"], readable: true, note: "" };
    const out = html(inputs({ method: hasCycle, signature: { methods: [hasCycle], method: "hasCycle" }, values: { head: "", pos: "" } }));
    expect(out).toContain('aria-label="pos (optional)"');
  });
});
