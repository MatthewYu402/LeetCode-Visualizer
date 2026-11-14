import { useCallback, useEffect, useRef, useState } from "react";
import { run, signature, type ApiError, type Method, type RunResult, type Signature } from "./client";
import { chooseMethod, fieldsFor, keepValues, missing, runRequest, valuesFromExample, type Field } from "./form";

/** How long the Solution must stay unchanged before its signature is read again. */
export const SIGNATURE_DELAY_MS = 400;

export type RunState =
  | { status: "idle" }
  | { status: "running" }
  | { status: "done"; result: RunResult }
  | { status: "failed"; error: ApiError };

export type FillResult = { ok: true; filled: string[] } | { ok: false; error: string };

export interface Inputs {
  /** null until the first signature arrives. */
  signature: Signature | null;
  signatureError: ApiError | null;
  method: Method | null;
  fields: Field[];
  values: Record<string, string>;
  /** Why Run is disabled, or null. */
  blocked: string | null;
  run: RunState;
  chooseMethod: (name: string) => void;
  setValue: (name: string, value: string) => void;
  /** Fills the fields from a pasted LeetCode example. Resolves to the names it filled, or an error message. */
  fillFromExample: (text: string) => Promise<FillResult>;
  start: () => void;
}

/**
 * The input form's state for one Solution: its signature (read again after
 * each pause in editing), the chosen method, one value per field, and the run.
 * `enabled` is false when the editor holds a language that cannot run yet.
 */
export function useInputs(source: string, enabled: boolean): Inputs {
  const [sig, setSig] = useState<Signature | null>(null);
  const [sigError, setSigError] = useState<ApiError | null>(null);
  const [chosen, setChosen] = useState<string | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});
  const [runState, setRunState] = useState<RunState>({ status: "idle" });
  const runAbort = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const abort = new AbortController();
    const timer = setTimeout(async () => {
      const answer = await signature(source, undefined, { signal: abort.signal });
      if (abort.signal.aborted) return;
      if (answer.ok) {
        setSig(answer.value);
        setSigError(null);
      } else {
        setSigError(answer.error); // keep the last good signature, so the fields do not vanish while typing
      }
    }, SIGNATURE_DELAY_MS);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [source, enabled]);

  const method = sig ? chooseMethod(sig, chosen) : null;
  const fields = fieldsFor(method);
  const shown = keepValues(fields, values);

  const setValue = useCallback((name: string, value: string) => setValues((v) => ({ ...v, [name]: value })), []);

  const fillFromExample = useCallback(
    async (text: string): Promise<FillResult> => {
      const answer = await signature(source, text);
      if (!answer.ok) return { ok: false, error: answer.error.message };
      setSig(answer.value);
      const target = fieldsFor(chooseMethod(answer.value, chosen));
      const filled = valuesFromExample(target, answer.value.fields ?? {});
      if (Object.keys(filled).length === 0) return { ok: false, error: "None of the example's names match this method's parameters." };
      setValues((v) => ({ ...v, ...filled }));
      return { ok: true, filled: target.map((f) => f.name).filter((n) => n in filled) };
    },
    [source, chosen],
  );

  const blocked = !enabled
    ? "Only C++ can run yet."
    : runState.status === "running"
      ? "Running…"
      : sig === null
        ? sigError
          ? sigError.message
          : "Reading the Solution…"
        : missing(fields, shown);

  const start = useCallback(() => {
    if (!method || blocked) return;
    runAbort.current?.abort();
    const abort = new AbortController();
    runAbort.current = abort;
    setRunState({ status: "running" });
    void run(runRequest(source, method, fields, shown), { signal: abort.signal }).then((answer) => {
      if (abort.signal.aborted) return;
      setRunState(answer.ok ? { status: "done", result: answer.value } : { status: "failed", error: answer.error });
    });
  }, [method, blocked, source, fields, shown]);

  return {
    signature: sig,
    signatureError: sigError,
    method,
    fields,
    values: shown,
    blocked,
    run: runState,
    chooseMethod: setChosen,
    setValue,
    fillFromExample,
    start,
  };
}
