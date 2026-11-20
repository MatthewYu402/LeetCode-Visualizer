// The frontend's only way to reach the backend (docs/backend.md). Two calls:
//
//   signature(source, example?)  POST /api/signature: the Solution's methods and parameters
//                                (options.language: "cpp", the default, or "python")
//   run(request)                 POST /api/run: a validated trace, or why there is none
//
// Where the API is: the same origin by default (/api/..., which the Vite dev server
// proxies to python3 -m backend), or VITE_API_BASE when the page is served from
// another host than the API, such as a static build. It is read at build time:
//   VITE_API_BASE=https://api.example.org npm run build
// The API must then list the page's origin in TRACE_ALLOWED_ORIGINS (docs/backend.md §5).
//
// Every answer is a discriminated union, never a thrown error, so a component
// can show any failure as text. A trace still goes through checkTrace(): the
// backend validated it against the schema, and the loader checks the version
// and the shape the renderers rely on.

import { checkTrace } from "../trace/loader";
import type { Trace } from "../trace/types";

/** One parameter, with its neutral type (trace-format.md §4), such as "array<int>" or "TreeNode". */
export interface Param {
  name: string;
  type: string;
}

export interface Method {
  name: string;
  params: Param[];
  /** The neutral return type; null when the method cannot be read. */
  returns: string | null;
  /** Names the example may give that are not parameters, such as "pos" for a linked list's cycle. */
  extras: string[];
  readable: boolean;
  /** Why it cannot be read, when it cannot. */
  note: string;
}

export interface Signature {
  methods: Method[];
  /** The method to preselect: the first readable public one. */
  method: string | null;
  /** Present when an example was sent: its values, by name. */
  fields?: Record<string, string>;
}

/**
 * Which stage failed: driver, rewriter, compile, run, validate, sandbox, request,
 * busy (the line is full; the message says when to try again), already-running
 * (this visitor has a run in progress), or network.
 */
export interface ApiError {
  stage: string;
  message: string;
}

export interface RunRequest {
  source: string;
  /** "cpp" or "python": which driver and sandbox the backend uses. Absent means C++. */
  language?: string;
  method: string | null;
  /** One value per parameter (and per extra), as LeetCode writes it: {"nums": "[2,7,11,15]", "target": "9"}. */
  fields: Record<string, string>;
}

export interface RunResult {
  trace: Trace;
  /** What the program printed (stdout and stderr), up to 64 KB. */
  output: string;
  warnings: string[];
}

export type Answer<T> = { ok: true; value: T } | { ok: false; error: ApiError };

type Fetch = typeof fetch;

/** The API's origin from the build (VITE_API_BASE), without a trailing slash; "" for the page's own origin. */
export const API_BASE = normalizeBase(import.meta.env.VITE_API_BASE);

export function normalizeBase(base: string | undefined): string {
  return (base ?? "").trim().replace(/\/+$/, "");
}

/** The full URL of an API path such as "/api/run": the path itself when base is "". */
export function apiUrl(path: string, base: string = API_BASE): string {
  return base + path;
}

interface CallOptions {
  signal?: AbortSignal;
  fetch?: Fetch;
  /** Overrides API_BASE (tests). */
  base?: string;
}

export async function signature(
  source: string,
  example?: string,
  options: CallOptions & { language?: string } = {},
): Promise<Answer<Signature>> {
  const body: Record<string, string> = { source };
  if (options.language) body.language = options.language;
  if (example !== undefined && example.trim() !== "") body.example = example;
  const answer = await post("/api/signature", body, options);
  if (!answer.ok) return answer;
  const data = answer.value as Partial<Signature>;
  if (!Array.isArray(data.methods)) return malformed("signature");
  return { ok: true, value: data as Signature };
}

export async function run(request: RunRequest, options: CallOptions = {}): Promise<Answer<RunResult>> {
  const answer = await post("/api/run", request, options);
  if (!answer.ok) return answer;
  const data = answer.value as { trace?: unknown; output?: unknown; warnings?: unknown };
  const loaded = checkTrace(data.trace);
  if (!loaded.ok) return { ok: false, error: { stage: "trace", message: loaded.error } };
  return {
    ok: true,
    value: {
      trace: loaded.trace,
      output: typeof data.output === "string" ? data.output : "",
      warnings: Array.isArray(data.warnings) ? data.warnings.filter((w): w is string => typeof w === "string") : [],
    },
  };
}

async function post(path: string, body: unknown, options: CallOptions): Promise<Answer<unknown>> {
  const doFetch = options.fetch ?? fetch;
  const base = options.base ?? API_BASE;
  let response: Response;
  try {
    response = await doFetch(apiUrl(path, base), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: options.signal,
    });
  } catch (e) {
    if ((e as Error).name === "AbortError") return { ok: false, error: { stage: "aborted", message: "Cancelled." } };
    // A page with its own API address is a deployed one: the hint about starting the backend is for development.
    const message = base
      ? "Cannot reach the server. Check your connection, or try again in a moment."
      : "Cannot reach the backend. Is it running? (python3 -m backend)";
    return { ok: false, error: { stage: "network", message } };
  }
  let data: unknown;
  try {
    data = await response.json();
  } catch {
    return { ok: false, error: { stage: "network", message: `The backend answered ${response.status} with no JSON.` } };
  }
  if (!response.ok) {
    const error = (data as { error?: Partial<ApiError> } | null)?.error;
    if (error && typeof error.stage === "string" && typeof error.message === "string") {
      return { ok: false, error: { stage: error.stage, message: error.message } };
    }
    return { ok: false, error: { stage: "network", message: `The backend answered ${response.status}.` } };
  }
  return { ok: true, value: data };
}

function malformed(what: string): Answer<never> {
  return { ok: false, error: { stage: "network", message: `The backend's ${what} answer is malformed.` } };
}
