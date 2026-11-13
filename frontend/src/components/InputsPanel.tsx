import { useState } from "react";
import type { Inputs } from "../api/useInputs";

/**
 * The input form: one field per parameter of the chosen method, a box to paste
 * a LeetCode example into the fields, and Run. Functional only, no visual
 * design yet (docs/frontend.md).
 */
export function InputsPanel({ inputs }: { inputs: Inputs }) {
  const [example, setExample] = useState("");
  const [fillMessage, setFillMessage] = useState<string | null>(null);
  const { signature, method, fields, values, blocked, run } = inputs;
  const methods = signature?.methods ?? [];

  const fill = async () => {
    setFillMessage(null);
    const problem = await inputs.fillFromExample(example);
    setFillMessage(problem ?? "Filled.");
  };

  return (
    <form
      className="inputs"
      aria-label="Inputs"
      onSubmit={(e) => {
        e.preventDefault();
        inputs.start();
      }}
    >
      {inputs.signatureError && signature && (
        <p className="notice notice-error" role="alert">
          {inputs.signatureError.message}
        </p>
      )}

      {methods.length > 1 && (
        <label className="inputs-row">
          <span className="inputs-label">Method</span>
          <select value={method?.name ?? ""} onChange={(e) => inputs.chooseMethod(e.target.value)} aria-label="Method">
            {methods.map((m) => (
              <option key={m.name} value={m.name} disabled={!m.readable} title={m.readable ? undefined : m.note}>
                {m.name}({m.params.map((p) => p.name).join(", ")})
              </option>
            ))}
          </select>
        </label>
      )}
      {method && !method.readable && <p className="notice notice-error">{method.note}</p>}

      {fields.map((f) => (
        <label key={f.name} className="inputs-row">
          <span className="inputs-label">
            <span className="inputs-name">{f.name}</span>{" "}
            <span className="inputs-type">{f.optional ? "optional" : f.type}</span>
          </span>
          <input
            className="inputs-value"
            value={values[f.name] ?? ""}
            placeholder={f.placeholder}
            spellCheck={false}
            autoComplete="off"
            aria-label={`${f.name} (${f.optional ? "optional" : f.type})`}
            onChange={(e) => inputs.setValue(f.name, e.target.value)}
          />
        </label>
      ))}

      <details className="inputs-example">
        <summary>Paste a LeetCode example</summary>
        <textarea
          value={example}
          onChange={(e) => setExample(e.target.value)}
          placeholder={"Input: nums = [2,7,11,15], target = 9\nOutput: [0,1]"}
          rows={3}
          spellCheck={false}
          aria-label="LeetCode example"
        />
        <button type="button" className="btn" onClick={() => void fill()} disabled={!example.trim()}>
          Fill fields
        </button>
        {fillMessage && <span className="inputs-status">{fillMessage}</span>}
      </details>

      <div className="inputs-row">
        <button type="submit" className="btn btn-primary" disabled={blocked !== null} title={blocked ?? "Trace this Solution on these inputs"}>
          Run code
        </button>
        <span className="inputs-status" aria-live="polite">
          {run.status === "running" ? "Running in the sandbox…" : blocked && blocked !== "Running…" ? blocked : ""}
        </span>
      </div>

      <RunOutcome run={run} />
    </form>
  );
}

function RunOutcome({ run }: { run: Inputs["run"] }) {
  if (run.status === "failed") {
    return (
      <div className="notice notice-error" role="alert">
        <strong>{STAGE[run.error.stage] ?? run.error.stage}</strong>
        <pre className="inputs-pre">{run.error.message}</pre>
      </div>
    );
  }
  if (run.status !== "done") return null;
  const { trace, output, warnings } = run.result;
  return (
    <div className="notice">
      <p>
        {trace.steps.length} steps{trace.truncated ? ", stopped at the step limit" : ""}.
      </p>
      {warnings.map((w) => (
        <p key={w}>Note: {w}</p>
      ))}
      {output.trim() && (
        <>
          <p>The program printed:</p>
          <pre className="inputs-pre">{output}</pre>
        </>
      )}
    </div>
  );
}

/** A heading for each stage that can fail (pipeline/__init__.py, backend/app.py). */
const STAGE: Record<string, string> = {
  driver: "The inputs cannot be used",
  rewriter: "The code does not compile",
  compile: "Build error (a bug on our side)",
  run: "The program did not finish",
  validate: "Invalid trace (a bug on our side)",
  sandbox: "The sandbox is not available",
  busy: "Busy",
  "already-running": "Your previous run is still going",
  request: "Bad request",
  network: "No connection",
  trace: "Cannot read the trace",
};
