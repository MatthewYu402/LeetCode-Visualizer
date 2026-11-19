import { describe, expect, it } from "vitest";
import suite from "../../../docs/manual-test-suite.md?raw";
import type { EditorLanguage } from "../editor/languages";
import { EXAMPLES, exampleNamed } from "./examples";

const FENCE: Record<EditorLanguage, string> = { cpp: "cpp", python: "python", java: "java" };

/** The code and example of case `n` in the manual suite, as written there. */
function suiteCase(n: number, fence = "cpp"): { code: string; text: string } {
  const start = suite.search(new RegExp(`^## ${n} `, "m"));
  expect(start, `case ${n} is in the suite`).toBeGreaterThanOrEqual(0);
  const rest = suite.slice(start + 1);
  const end = rest.search(/^## \d+ /m);
  const body = end < 0 ? rest : rest.slice(0, end);
  const code = new RegExp("\\*\\*Code\\*\\*\\s*```" + fence + "\\n([\\s\\S]*?)```").exec(body)?.[1] ?? "";
  const text = /\*\*Example\*\*\s*```text\n([\s\S]*?)```/.exec(body)?.[1] ?? "";
  return { code, text };
}

describe("home page examples", () => {
  it("match their cases in docs/manual-test-suite.md, so they are known to run", () => {
    for (const e of EXAMPLES) {
      for (const [language, s] of Object.entries(e.solutions) as [EditorLanguage, (typeof e.solutions)["cpp"]][]) {
        const c = suiteCase(s.suiteCase, FENCE[language]);
        expect(s.code, `${e.slug} (${language})`).toBe(c.code);
        expect(s.text, `${e.slug} (${language})`).toBe(c.text);
      }
    }
  });

  it("are the eight topics of the Examples menu, each in every language", () => {
    expect(EXAMPLES.map((e) => e.topic)).toEqual(["Hashing", "Two pointers", "Stack", "Linked list", "Tree", "Graph", "Backtracking", "DP"]);
    for (const e of EXAMPLES) expect(Object.keys(e.solutions).sort()).toEqual(["cpp", "java", "python"]);
  });

  it("have unique slugs that are safe in a route", () => {
    const slugs = EXAMPLES.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
    for (const s of slugs) expect(s).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("are found by slug, and nothing else is", () => {
    expect(exampleNamed("two-sum")?.title).toBe("Two Sum");
    expect(exampleNamed("nope")).toBeUndefined();
    expect(exampleNamed(undefined)).toBeUndefined();
  });
});
