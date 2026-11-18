import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PASTE_HINT, PasteHint } from "./PasteHint";

describe("PasteHint", () => {
  it("is a button that names what it explains, described by its note", () => {
    const html = renderToStaticMarkup(<PasteHint />);
    expect(html).toContain('<button type="button" class="paste-hint-button" aria-label="How to paste your code"');
    const id = /aria-describedby="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`role="tooltip" id="${id}"`);
  });

  it("tells people to paste LeetCode's code with its comments, and why", () => {
    expect(PASTE_HINT).toMatch(/exactly as LeetCode gives it/);
    expect(PASTE_HINT).toMatch(/comments/);
    expect(PASTE_HINT).toMatch(/ListNode, TreeNode, or Node/);
    expect(renderToStaticMarkup(<PasteHint />)).toContain(PASTE_HINT);
  });
});
