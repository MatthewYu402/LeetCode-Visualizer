import { describe, expect, it } from "vitest";
import twoSum from "../../../fixtures/two-sum.trace.json?raw";
import { apiUrl, normalizeBase, run, signature } from "./client";

/** A fetch that answers once with this status and body, and records what it was sent. */
function fakeFetch(status: number, body: unknown) {
  const sent: { url: string; body: unknown }[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    sent.push({ url, body: JSON.parse(String(init?.body)) });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
  }) as unknown as typeof fetch;
  return { f, sent };
}

const REQUEST = { source: "class Solution {};", method: "twoSum", fields: { nums: "[2,7,11,15]", target: "9" } };

describe("run", () => {
  it("sends the request and loads the trace it gets back", async () => {
    const { f, sent } = fakeFetch(200, { trace: JSON.parse(twoSum), output: "hi\n", warnings: ["w"] });
    const answer = await run(REQUEST, { fetch: f });
    expect(sent).toEqual([{ url: "/api/run", body: REQUEST }]);
    expect(answer.ok).toBe(true);
    if (answer.ok) {
      expect(answer.value.trace.steps).toHaveLength(12);
      expect(answer.value.output).toBe("hi\n");
      expect(answer.value.warnings).toEqual(["w"]);
    }
  });

  it("an error body becomes its stage and message", async () => {
    const { f } = fakeFetch(422, { error: { stage: "rewriter", message: "solution.cpp:4: error" } });
    expect(await run(REQUEST, { fetch: f })).toEqual({ ok: false, error: { stage: "rewriter", message: "solution.cpp:4: error" } });
  });

  it("a trace the loader cannot read is an error, not a crash", async () => {
    const { f } = fakeFetch(200, { trace: { version: "0.1", steps: [] }, output: "", warnings: [] });
    const answer = await run(REQUEST, { fetch: f });
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error.stage).toBe("trace");
  });

  it("no backend is a network error that says how to start it", async () => {
    const f = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const answer = await run(REQUEST, { fetch: f });
    expect(answer).toEqual({ ok: false, error: { stage: "network", message: expect.stringContaining("python3 -m backend") } });
  });

  it("a status with no JSON body", async () => {
    const { f } = fakeFetch(502, "Bad Gateway");
    const answer = await run(REQUEST, { fetch: f });
    expect(answer.ok).toBe(false);
    if (!answer.ok) expect(answer.error).toEqual({ stage: "network", message: "The backend answered 502 with no JSON." });
  });
});

describe("signature", () => {
  it("sends the example only when there is one", async () => {
    const methods = { methods: [], method: null };
    const a = fakeFetch(200, methods);
    await signature("src", "  ", { fetch: a.f });
    expect(a.sent[0].body).toEqual({ source: "src" });
    const b = fakeFetch(200, methods);
    await signature("src", "nums = [1]", { fetch: b.f });
    expect(b.sent[0].body).toEqual({ source: "src", example: "nums = [1]" });
  });

  it("sends the language when there is one", async () => {
    const a = fakeFetch(200, { methods: [], method: null });
    await signature("src", undefined, { fetch: a.f, language: "python" });
    expect(a.sent[0].body).toEqual({ source: "src", language: "python" });
  });

  it("a malformed answer is an error", async () => {
    const { f } = fakeFetch(200, { nope: true });
    expect((await signature("src", undefined, { fetch: f })).ok).toBe(false);
  });
});

describe("the API's address", () => {
  it("is the page's own origin when no base is set", () => {
    expect(apiUrl("/api/run", "")).toBe("/api/run");
  });

  it("puts the base in front of the path, without a doubled slash", () => {
    expect(apiUrl("/api/run", normalizeBase("https://api.example.org/"))).toBe("https://api.example.org/api/run");
    expect(normalizeBase("  https://api.example.org//  ")).toBe("https://api.example.org");
    expect(normalizeBase(undefined)).toBe("");
  });

  it("sends a call to the base when one is given", async () => {
    const { f, sent } = fakeFetch(200, { methods: [], method: null });
    await signature("src", undefined, { fetch: f, base: "https://api.example.org" });
    expect(sent[0].url).toBe("https://api.example.org/api/signature");
  });

  it("an unreachable deployed API is not blamed on a backend left unstarted", async () => {
    const failing = (async () => {
      throw new TypeError("Failed to fetch");
    }) as unknown as typeof fetch;
    const deployed = await run(REQUEST, { fetch: failing, base: "https://api.example.org" });
    const local = await run(REQUEST, { fetch: failing, base: "" });
    expect(deployed.ok || deployed.error.message).not.toContain("python3 -m backend");
    expect(local.ok || local.error.message).toContain("python3 -m backend");
  });
});
