import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { diffValue, matchInOrder } from "../trace/diff";
import type { Value } from "../trace/types";
import { FallbackRenderer } from "./FallbackRenderer";
import { HeapRenderer, HEAP_TREE_MAX } from "./HeapRenderer";
import { operation } from "./ops";
import { selectRenderer } from "./registry";
import { STACK_WHOLE } from "./SequenceRenderer";

/** Draws one value as the canvas would after a one-step move from `prev` (or with no diff). */
function draw(value: Value, prev?: Value): string {
  const d = prev === undefined ? null : diffValue(prev, value);
  const own = d && d.status !== "added" ? d : null;
  const R = selectRenderer(value);
  return renderToStaticMarkup(<R name="x" value={value} diff={own} ctx={{ locals: { x: value }, op: operation(value, own) }} />);
}

const arr = (kind: "stack" | "queue" | "deque" | "list" | "set" | "multiset", items: Value[]) => ({ kind, items }) as Value;
const pq = (items: Value[]): Value => ({ kind: "priority-queue", items, order: "max" });

describe("the operation chip names one clear change, in plain words", () => {
  const op = (prev: Value, curr: Value) => operation(curr, diffValue(prev, curr));

  it("stack, queue, deque", () => {
    expect(op(arr("stack", [1]), arr("stack", [1, "("]))).toBe('push "("');
    expect(op(arr("stack", [1, 2]), arr("stack", [1]))).toBe("pop 2");
    expect(op(arr("queue", [3]), arr("queue", [3, 9]))).toBe("enqueue 9");
    expect(op(arr("queue", [3, 9]), arr("queue", [9]))).toBe("dequeue 3");
    expect(op(arr("deque", [1, 2]), arr("deque", [0, 1, 2]))).toBe("push front 0");
    expect(op(arr("deque", [1, 2]), arr("deque", [1]))).toBe("pop back 2");
  });

  it("list: the ends, then insert, remove, and move found by matching in order", () => {
    expect(op(arr("list", [1, 2]), arr("list", [3, 1, 2]))).toBe("push front 3");
    expect(op(arr("list", [1, 3, 2]), arr("list", [1, 3, 4, 2]))).toBe("insert 4");
    expect(op(arr("list", [1, 3, 2]), arr("list", [1, 2]))).toBe("remove 3");
    expect(op(arr("list", [3, 1, 2]), arr("list", [1, 3, 2]))).toMatch(/^move [13]$/);
  });

  it("set, multiset, priority queue: matched by count", () => {
    expect(op(arr("set", ["a"]), arr("set", ["a", "b"]))).toBe('insert "b"');
    expect(op(arr("multiset", [3, 3, 1]), arr("multiset", [3, 1]))).toBe("erase one 3");
    expect(op(arr("multiset", [3, 1]), arr("multiset", [3]))).toBe("erase 1");
    expect(op(pq([7, 2, 4]), pq([8, 7, 4, 2]))).toBe("push 8");
    expect(op(pq([8, 7, 4]), pq([7, 4]))).toBe("pop 8");
  });

  it("map and multimap", () => {
    const m = (entries: [Value, Value][]): Value => ({ kind: "map", entries });
    const mm = (entries: [Value, Value][]): Value => ({ kind: "multimap", entries });
    expect(op(m([]), m([[2, 0]]))).toBe("insert 2");
    expect(op(m([[2, 0]]), m([[2, 5]]))).toBe("update 2");
    expect(op(m([[2, 0]]), m([]))).toBe("erase 2");
    expect(op(mm([[2, "hi"]]), mm([[2, "hi"], [2, "to"]]))).toBe('insert (2, "to")');
    expect(op(mm([[1, "a"], [3, "x"], [3, "y"]]), mm([[1, "a"]]))).toBe("erase key 3");
  });

  it("a ref names its node's value, never its id", () => {
    const heap = { n2: { kind: "object" as const, type: "TreeNode", fields: { val: 2, left: null, right: null } } };
    const st = (ids: string[]): Value => ({ kind: "stack", items: ids.map((id) => ({ kind: "ref", id })) });
    expect(operation(st([]), diffValue(st(["n2"]), st([])), heap)).toBe("pop 2");
  });

  it("nothing for several changes at once, for arrays and tuples, or with no diff", () => {
    expect(op(arr("stack", [1]), arr("stack", [1, 2, 3]))).toBeNull();
    expect(op({ kind: "array", items: [1] }, { kind: "array", items: [2] })).toBeNull();
    expect(operation(arr("stack", [1]), null)).toBeNull();
  });
});

describe("a list is matched in order, not by position", () => {
  it("a push at the front adds one item; the rest are the same", () => {
    expect(matchInOrder([1, 2], [3, 1, 2]).status).toEqual(["added", "same", "same"]);
  });

  it("an item moved to the front is changed (moved) and paired with where it was", () => {
    const m = matchInOrder([3, 1, 2], [1, 3, 2]);
    expect(m.status.filter((s) => s === "changed")).toHaveLength(1);
    expect(m.removed).toEqual([]);
  });

  it("a removed item is reported by its old index", () => {
    expect(matchInOrder([4, 1, 3], [4, 1]).removed).toEqual([2]);
  });

  it("the diff marks only the pushed item", () => {
    const html = draw(arr("list", [3, 1, 2]), arr("list", [1, 2]));
    expect(html.match(/cell cell-auto diff-added/g)).toHaveLength(1);
    expect(html).toContain("push front 3");
  });
});

describe("cards", () => {
  it("a stack draws whole up to its limit, then folds the middle", () => {
    const small = draw(arr("stack", Array.from({ length: STACK_WHOLE }, (_, i) => i)));
    expect(small).not.toContain("more");
    const deep = draw(arr("stack", Array.from({ length: 14 }, (_, i) => i)));
    expect(deep).toContain("9 more");
    expect(deep.match(/class="stack-item"/g)).toHaveLength(5); // top 3, bottom 2
    expect(deep).toMatch(/>13<\/div><span class="tag tag-side">/); // the top item has the tag
  });

  it("a multiset shows each member once, with its count", () => {
    const html = draw(arr("multiset", [1, 3, 3]));
    expect(html.match(/class="set-member/g)).toHaveLength(2);
    expect(html).toContain(">×2<");
  });

  it("a priority queue is circles while values are short, rectangles when one is not", () => {
    expect(draw(pq([8, 7, 4]))).toContain("heap-node is-round");
    const wide: Value = { kind: "priority-queue", order: "custom", items: [{ kind: "tuple", items: [3, 1] }, { kind: "tuple", items: [5, 3] }] };
    const html = draw(wide);
    expect(html).not.toContain("is-round");
    expect(html).toContain("priority queue · custom · 2");
    expect(html).toContain("(3, 1)");
  });

  it("a priority queue is diffed per slot: a sift changes slots, a new last slot is added", () => {
    const html = draw(pq([8, 7, 4, 1, 2]), pq([7, 2, 4, 1]));
    expect(html.match(/heap-node is-round\s+diff-changed/g)).toHaveLength(2); // slots 0 and 1
    expect(html.match(/heap-node is-round\s+diff-added/g)).toHaveLength(1); // slot 4
    expect(html).toContain("storage order");
  });

  it("a big priority queue keeps its storage row and drops the tree", () => {
    const html = draw(pq(Array.from({ length: HEAP_TREE_MAX + 1 }, (_, i) => i)));
    expect(html).not.toContain("heap-tree");
    expect(html).toContain("The tree is drawn up to");
  });

  it("an unknown kind is shown as data, never a crash, with changed lines tinted", () => {
    const v = { kind: "variant", index: 1, value: "seven" } as unknown as Value;
    const prev = { kind: "variant", index: 0, value: 7 } as unknown as Value;
    const html = renderToStaticMarkup(<FallbackRenderer name="choice" value={v} diff={diffValue(prev, v)} ctx={{ locals: {} }} />);
    expect(html).toContain("There is no view for this kind yet");
    expect(html.match(/data-line is-changed/g)).toHaveLength(2);
    expect(renderToStaticMarkup(<HeapRenderer name="p" value={pq([])} diff={null} ctx={{ locals: {} }} />)).toContain("empty");
  });
});
