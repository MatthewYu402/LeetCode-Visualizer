import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "./examples";
import { Home } from "./Home";
import { Preview } from "./Preview";

describe("Home", () => {
  const html = renderToStaticMarkup(<Home />);

  it("links each example into the sandbox by its slug", () => {
    for (const e of EXAMPLES) expect(html).toContain(`href="#/sandbox/${e.slug}"`);
  });

  it("has a way into the bare sandbox, and says which languages run", () => {
    expect(html).toContain('href="#/sandbox"');
    expect(html).toContain("Paste a Solution");
    expect(html).toMatch(/C\+\+<\/span><span class="lang-note">Available now/);
    expect(html).toMatch(/Java<\/span><span class="lang-note">Coming soon/);
  });

  it("shows the logo in both theme versions, for CSS to pick", () => {
    expect(html).toContain("logo-eye-dark");
    expect(html).toContain("logo-eye-light");
  });
});

describe("Preview", () => {
  const html = renderToStaticMarkup(<Preview />);

  it("replays the Reverse Linked List golden trace from its first step", () => {
    expect(html).toContain("Step 1 / 30");
    expect(html).toContain('class="preview-line is-current"><span class="preview-gutter">4</span>'); // step 0 is about to run line 4
  });

  it("draws with the sandbox's canvas: the list's card, named by its pointer", () => {
    const canvas = html.slice(html.indexOf('class="preview-canvas"'));
    expect(canvas).toContain('class="card');
    expect(canvas).toMatch(/card-name[^>]*>head</);
  });
});
