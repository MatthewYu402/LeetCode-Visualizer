import { describe, expect, it } from "vitest";
import { href, parseRoute, titleFor, type Route } from "./route";

describe("parseRoute", () => {
  it("is the home page with no hash, #, #/, or anything it does not know", () => {
    for (const h of ["", "#", "#/", "#/nope", "#/sandbox/two-sum/extra", "#examples"]) expect(parseRoute(h), h).toEqual({ page: "home" });
  });

  it("is the sandbox, with or without an example", () => {
    expect(parseRoute("#/sandbox")).toEqual({ page: "sandbox" });
    expect(parseRoute("#/sandbox/")).toEqual({ page: "sandbox" });
    expect(parseRoute("#sandbox")).toEqual({ page: "sandbox" });
    expect(parseRoute("#/sandbox/two-sum")).toEqual({ page: "sandbox", example: "two-sum" });
  });
});

describe("href", () => {
  it("round-trips through parseRoute", () => {
    const routes: Route[] = [{ page: "home" }, { page: "sandbox" }, { page: "sandbox", example: "reverse-linked-list" }];
    for (const r of routes) expect(parseRoute(href(r))).toEqual(r);
  });

  it("names each page in the title", () => {
    expect(titleFor({ page: "home" })).toBe("LeetCode Visualizer");
    expect(titleFor({ page: "sandbox", example: "two-sum" })).toBe("LeetCode Visualizer · Sandbox");
  });
});
