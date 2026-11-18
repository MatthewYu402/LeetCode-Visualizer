import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { VisualPanel } from "../components/VisualPanel";
import { diff, diffValue } from "../trace/diff";
import type { ReadAt, Step, Trace, Value } from "../trace/types";
import { ArrayRenderer, CELL_PX as CELL_PX_ARRAY, cellWidth, PointerRow } from "./ArrayRenderer";
import { selectRenderer } from "./registry";
import { CHAR_PX, stringLocals } from "./StringRenderer";

function draw(value: Value, opts: { locals?: Record<string, Value>; indexes?: Record<string, string[]>; reads?: ReadAt[]; prev?: Value } = {}): string {
  const R = selectRenderer(value);
  const d = opts.prev === undefined ? null : diffValue(opts.prev, value);
  return renderToStaticMarkup(<R name="s" value={value} diff={d} ctx={{ locals: { s: value, ...opts.locals }, indexes: opts.indexes, reads: opts.reads }} />);
}
const count = (html: string, part: string) => html.split(part).length - 1;

describe("StringRenderer", () => {
  it("draws one cell per character, bare letters, with the length in the header", () => {
    const html = draw("Race, car");
    expect(html).toContain("string · 9");
    expect(count(html, 'class="cell ')).toBe(9);
    expect(html).toContain('title="s[0] = &quot;R&quot;">R</div>');
    expect(html).not.toContain("'R'");
  });

  it("marks a space so no cell looks empty", () => {
    expect(draw("a b")).toContain('<span class="char-mark">␣</span>');
  });

  it("puts the locals that index it under their characters", () => {
    const html = draw("racecar", { locals: { left: 1, right: 5 }, indexes: { left: ["s"], right: ["s"] } });
    expect(html).toContain(`translate(${1 * CHAR_PX}px, 0px)`);
    expect(html).toContain(`translate(${5 * CHAR_PX}px, 0px)`);
  });

  it("outlines the characters the line read (s[left] and s[right])", () => {
    const html = draw("racecar", { reads: [{ at: [0] }, { at: [6] }] });
    expect(count(html, "is-read")).toBe(2);
  });

  it("shows characters appended and changed since the previous step", () => {
    const html = draw("abd!", { prev: "abc" });
    expect(count(html, "diff-changed")).toBe(1);
    expect(count(html, "diff-added")).toBe(1);
  });

  it("keeps characters removed from the end as fading ghosts", () => {
    expect(count(draw("ab", { prev: "abc" }), "diff-removed")).toBe(1);
  });

  it("an empty string is drawn as empty", () => {
    expect(draw("")).toContain(">empty<");
  });
});

describe("PointerRow", () => {
  it("stacks tags whose pills would overlap on narrow cells", () => {
    const html = renderToStaticMarkup(<PointerRow pointers={[{ name: "left", index: 4 }, { name: "right", index: 5 }]} step={CHAR_PX} />);
    expect(html).toContain(`translate(${4 * CHAR_PX}px, 0px)`);
    expect(html).toContain(`translate(${5 * CHAR_PX}px, 22px)`);
  });

  it("keeps tags far apart on one row", () => {
    const html = renderToStaticMarkup(<PointerRow pointers={[{ name: "left", index: 0 }, { name: "right", index: 8 }]} step={CHAR_PX} />);
    expect(count(html, ", 0px)")).toBe(2);
  });
});

function trace(steps: Record<string, Value>[], extra: Partial<Trace> = {}): Trace {
  return {
    version: "0.11",
    language: "cpp",
    problem: { method: "f", params: [{ name: "s", type: "string" }], returns: { type: "bool" }, input: { s: "ab" } },
    steps: steps.map((locals, i): Step => ({ step: i, frames: [{ id: "f1", function: "f", line: 3 + i, locals }], heap: {} })),
    ...extra,
  } as Trace;
}

describe("stringLocals", () => {
  it("a char is not a string; a string parameter, a long string, and an indexed string are", () => {
    const t = trace([{ s: "a", c: "x", word: "", n: 0 }, { s: "a", c: "y", word: "ab", n: 1 }]);
    expect([...stringLocals(t)].sort()).toEqual(["f/s", "f/word"]);
  });

  it("a one-character string that a local indexes is a string", () => {
    const t = trace([{ t: "z", i: 0 }], { indexes: { f: { i: ["t"] } } });
    expect(stringLocals(t).has("f/t")).toBe(true);
  });

  it("the canvas draws string cards and no card for chars", () => {
    const t = trace([{ s: "abba", c: "a", left: 0 }, { s: "abba", c: "b", left: 1 }], { indexes: { f: { left: ["s"] } } });
    const html = renderToStaticMarkup(<VisualPanel trace={t} step={t.steps[1]} diff={diff(t.steps[0], t.steps[1])} />);
    expect(html).toContain('aria-label="s: string"');
    expect(html).not.toContain('aria-label="c: string"');
  });
});

describe("an array of strings", () => {
  it("widens every cell to its longest item, so '(())' is not cut off", () => {
    expect(cellWidth([1, 2, 3])).toBe(CELL_PX_ARRAY);
    expect(cellWidth(["(())", "()()"])).toBeGreaterThan(CELL_PX_ARRAY);
  });

  it("outlines the string a character was read from (words[1][2])", () => {
    const words: Value = { kind: "array", items: ["eat", "tea"] };
    const html = renderToStaticMarkup(<ArrayRenderer name="words" value={words} diff={null} ctx={{ locals: { words }, reads: [{ at: [1, 2] }] }} />);
    expect(html.split("is-read").length - 1).toBe(1);
    expect(html).toMatch(/is-read" title="&quot;tea&quot;"/);
  });
});
