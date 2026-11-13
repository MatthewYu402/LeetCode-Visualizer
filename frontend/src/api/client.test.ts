import { describe, expect, it } from "vitest";
import twoSum from "../../../fixtures/two-sum.trace.json?raw";
import { run, signature } from "./client";

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
      expect(answer.value.trace.steps).toHaveLength(10);
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

  it("a malformed answer is an error", async () => {
    const { f } = fakeFetch(200, { nope: true });
    expect((await signature("src", undefined, { fetch: f })).ok).toBe(false);
  });
});
