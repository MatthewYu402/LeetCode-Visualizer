import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { EXAMPLES } from "./examples";
import { APP_VERSION, CONTACT_EMAIL, Home, REPO_URL } from "./Home";
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
    expect(html).toMatch(/Python<\/span><span class="lang-note">Available now/);
    expect(html).toMatch(/Java<\/span><span class="lang-note">Coming soon/);
    expect(html).toContain("C++ and Python today. Java is coming.");
  });

  it("shows the logo in the bar and the footer only, in both theme versions for CSS to pick", () => {
    expect(html).toContain("logo-eye-dark");
    expect(html).toContain("logo-eye-light");
    expect(html.match(/class="logo-eye"/g)).toHaveLength(2);
    expect(html).not.toContain("hero-logo");
  });

  it("puts the app's version from package.json above the title", () => {
    expect(APP_VERSION).toMatch(/^v\d+\.\d+\.\d+$/);
    expect(html).toMatch(new RegExp(`class="version-badge">.*${APP_VERSION.replace(/\./g, "\\.")}</p><h1`));
  });

  it("links the sections from the bar, without #anchors (the hash is the route)", () => {
    const nav = html.slice(html.indexOf('<nav class="home-nav"'), html.indexOf("</nav>"));
    expect(nav).toContain(">Examples<");
    expect(nav).toContain(">How it works<");
    expect(nav).toContain(">Languages<");
    expect(nav).not.toContain("href=");
  });

  it("links the repository and the author's email in the footer", () => {
    const foot = html.slice(html.indexOf('<footer class="home-foot"'));
    expect(foot).toContain(`href="${REPO_URL}"`);
    expect(foot).toContain(`href="mailto:${CONTACT_EMAIL}"`);
    expect(foot).toContain('rel="noopener noreferrer"');
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
