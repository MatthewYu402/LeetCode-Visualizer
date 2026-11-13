import { describe, expect, it } from "vitest";
import type { Method, Signature } from "./client";
import { chooseMethod, fieldsFor, keepValues, missing, placeholderFor, runRequest, valuesFromExample } from "./form";

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
const hasCycle: Method = { name: "hasCycle", params: [{ name: "head", type: "ListNode" }], returns: "bool", extras: ["pos"], readable: true, note: "" };
const cloneGraph: Method = { name: "cloneGraph", params: [{ name: "node", type: "Node" }], returns: "Node", extras: [], readable: true, note: "" };

describe("fields", () => {
  it("one field per parameter, typed, with LeetCode's notation as the placeholder", () => {
    expect(fieldsFor(twoSum)).toEqual([
      { name: "nums", type: "array<int>", optional: false, placeholder: "[1,2,3]" },
      { name: "target", type: "int", optional: false, placeholder: "9" },
    ]);
  });

  it("an extra such as pos is an optional field after the parameters", () => {
    expect(fieldsFor(hasCycle).map((f) => [f.name, f.optional])).toEqual([
      ["head", false],
      ["pos", true],
    ]);
  });

  it("no fields for no method, or one that cannot be read", () => {
    expect(fieldsFor(null)).toEqual([]);
    expect(fieldsFor({ ...twoSum, readable: false })).toEqual([]);
  });

  it("placeholders for nested and node types", () => {
    expect(placeholderFor("array<array<int>>")).toBe("[[1,2,3],[1,2,3]]");
    expect(placeholderFor("array<string>")).toBe('["ab","cd"]');
    expect(placeholderFor("TreeNode")).toBe("[3,9,20,null,null,15,7]");
    expect(placeholderFor("Node")).toBe("");
  });
});

describe("choosing a method", () => {
  const sig: Signature = { methods: [twoSum, hasCycle], method: "twoSum" };

  it("keeps the user's choice while the Solution still has it, else the backend's pick", () => {
    expect(chooseMethod(sig, "hasCycle")?.name).toBe("hasCycle");
    expect(chooseMethod(sig, "gone")?.name).toBe("twoSum");
    expect(chooseMethod(sig, null)?.name).toBe("twoSum");
  });
});

describe("values", () => {
  it("a value typed earlier survives a new signature with the same field", () => {
    expect(keepValues(fieldsFor(twoSum), { nums: "[1]", other: "x" })).toEqual({ nums: "[1]", target: "" });
  });

  it("Run waits for every required field, but not for an extra", () => {
    expect(missing(fieldsFor(twoSum), { nums: "[1]", target: " " })).toBe("Fill in target.");
    expect(missing(fieldsFor(hasCycle), { head: "[3,2,0,-4]", pos: "" })).toBeNull();
    expect(missing([], {})).toMatch(/No method/);
  });

  it("the request carries the method and every field, as typed", () => {
    expect(runRequest("src", twoSum, fieldsFor(twoSum), { nums: "[2,7,11,15]", target: "9" })).toEqual({
      source: "src",
      method: "twoSum",
      fields: { nums: "[2,7,11,15]", target: "9" },
    });
  });
});

describe("filling from a pasted example", () => {
  it("by name", () => {
    expect(valuesFromExample(fieldsFor(twoSum), { nums: "[2,7,11,15]", target: "9" })).toEqual({ nums: "[2,7,11,15]", target: "9" });
    expect(valuesFromExample(fieldsFor(hasCycle), { head: "[3,2,0,-4]", pos: "1" })).toEqual({ head: "[3,2,0,-4]", pos: "1" });
  });

  it("in order when no name matches, as the driver does for Clone Graph", () => {
    expect(valuesFromExample(fieldsFor(cloneGraph), { adjList: "[[2,4],[1,3],[2,4],[1,3]]" })).toEqual({ node: "[[2,4],[1,3],[2,4],[1,3]]" });
  });

  it("nothing when some names match and others do not: those are typos", () => {
    expect(valuesFromExample(fieldsFor(twoSum), { nums: "[1]", targt: "9" })).toEqual({ nums: "[1]" });
  });
});
