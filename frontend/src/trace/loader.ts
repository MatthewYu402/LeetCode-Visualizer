import type { Trace } from "./types";

/** The only trace version this frontend reads. Spec §9: while the major is 0, every minor may break. */
export const SUPPORTED_VERSION = "0.6";

export type LoadResult = { ok: true; trace: Trace } | { ok: false; error: string };

/**
 * Parse trace JSON text and check that it is something this frontend can draw.
 *
 * This is not schema validation. The API service validates every trace against
 * schema/trace.schema.json outside the sandbox (CLAUDE.md invariant 9). The loader
 * checks the version and the minimal shape the renderers rely on, and fails with a
 * readable message instead of crashing a renderer later.
 */
export function loadTrace(text: string): LoadResult {
  let data: unknown;
  try {
    // JSON.parse rejects the bare tokens NaN and Infinity, as the spec requires.
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, error: `Trace is not valid JSON: ${(e as Error).message}` };
  }
  return checkTrace(data);
}

export function checkTrace(data: unknown): LoadResult {
  if (!isRecord(data)) return fail("Trace must be a JSON object.");

  const { version } = data;
  if (typeof version !== "string") return fail("Trace has no version string.");
  if (version !== SUPPORTED_VERSION) {
    return fail(`Unsupported trace version "${version}". This frontend reads version ${SUPPORTED_VERSION} only.`);
  }

  if (!isRecord(data.problem) || !Array.isArray(data.problem.params)) {
    return fail("Trace has no problem metadata.");
  }
  if (!Array.isArray(data.steps)) return fail("Trace has no steps array.");
  for (const [i, s] of data.steps.entries()) {
    if (!isRecord(s) || !Array.isArray(s.frames) || s.frames.length === 0) {
      return fail(`Step ${i} is malformed: it needs a non-empty frames array.`);
    }
    for (const [j, f] of s.frames.entries()) {
      if (!isRecord(f) || typeof f.id !== "string" || typeof f.line !== "number" || !isRecord(f.locals)) {
        return fail(`Step ${i}, frame ${j} is malformed: it needs an id, a numeric line, and a locals object.`);
      }
    }
  }
  // `result` is optional: absent means the run did not finish (spec §3). `truncated`
  // is present only as true. `result_heap` and `problem.returns` are optional too.
  // None is required here; see runEnd() and returnsVoid() in types.ts.

  return { ok: true, trace: data as unknown as Trace };
}

function fail(error: string): LoadResult {
  return { ok: false, error };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
