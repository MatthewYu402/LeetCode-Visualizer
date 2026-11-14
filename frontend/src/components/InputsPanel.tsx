import { useRef, useState } from "react";
import type { Inputs } from "../api/useInputs";

interface Props {
  inputs: Inputs;
  /** Placeholder (ghost) text by field name, for the method named here: the starter's example. */
  example?: { method: string; values: Record<string, string>; text: string };
}

type Note = { tone: "ok" | "info" | "error"; text: string } | null;

/**
 * The inputs: one field per parameter of the chosen method, and a box for a LeetCode example
 * as LeetCode writes it. Pasting into the box fills the fields at once; "Fill fields" is for
 * edits typed by hand. Run code is in the top bar; this panel says why it is disabled, and
 * shows a failed run's error under the inputs that caused it.
 */
export function InputsPanel({ inputs, example }: Props) {
  const [text, setText] = useState("");
  const [note, setNote] = useState<Note>(null);
  const pasted = useRef(false);
  const { signature, method, fields, values, blocked, run } = inputs;
  const methods = signature?.methods ?? [];
  const ghost = example && method?.name === example.method ? example.values : {};

  const fill = async (from: string, how: "paste" | "button") => {
    if (!from.trim()) return;
    const answer = await inputs.fillFromExample(from);
    if (!answer.ok) setNote({ tone: "error", text: answer.error });
    else setNote({ tone: "ok", text: `${how === "paste" ? "Pasted, so " : ""}${names(answer.filled)} ${answer.filled.length === 1 ? "was" : "were"} filled` });
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
      <header className="panel-header">
        <h2 className="panel-heading">Inputs</h2>
        {method && <span className="panel-meta">{method.name}</span>}
      </header>

      {inputs.signatureError && signature && (
        <p className="notice notice-error" role="alert">
          {inputs.signatureError.message}
        </p>
      )}

      {methods.length > 1 && (
        <label className="field">
          <span className="field-label">
            <span className="field-name field-name-plain">Method</span>
          </span>
          <select className="field-input" value={method?.name ?? ""} onChange={(e) => inputs.chooseMethod(e.target.value)} aria-label="Method">
            {methods.map((m) => (
              <option key={m.name} value={m.name} disabled={!m.readable} title={m.readable ? undefined : m.note}>
                {m.name}({m.params.map((p) => p.name).join(", ")})
              </option>
            ))}
          </select>
        </label>
      )}
      {method && !method.readable && <p className="notice notice-error">{method.note}</p>}

      <div className="fields">
        {fields.map((f) => (
          <label key={f.name} className="field">
            <span className="field-label">
              <span className="field-name">{f.name}</span>
              <span className="field-type">{f.optional ? "optional" : f.type}</span>
            </span>
            <input
              className="field-input"
              value={values[f.name] ?? ""}
              placeholder={ghost[f.name] ?? f.placeholder}
              spellCheck={false}
              autoComplete="off"
              aria-label={`${f.name} (${f.optional ? "optional" : f.type})`}
              onChange={(e) => inputs.setValue(f.name, e.target.value)}
            />
          </label>
        ))}
      </div>

      <div className="divider-label">
        <span>or paste a LeetCode example</span>
      </div>

      <div className="example">
        <textarea
          className="field-input example-box"
          value={text}
          onPaste={() => {
            pasted.current = true;
          }}
          onChange={(e) => {
            const next = e.target.value;
            setText(next);
            if (pasted.current) {
              pasted.current = false;
              void fill(next, "paste");
            } else {
              setNote(next.trim() ? { tone: "info", text: "Edited by hand. Fill fields to update them." } : null);
            }
          }}
          placeholder={example?.text ?? "Input: nums = [2,7,11,15], target = 9\nOutput: [0,1]"}
          rows={3}
          spellCheck={false}
          aria-label="LeetCode example"
        />
        <div className="example-actions">
          <button type="button" className="control" onClick={() => void fill(text, "button")} disabled={!text.trim()}>
            Fill fields
          </button>
          {note && (
            <span className={`example-note tone-${note.tone}`} role={note.tone === "error" ? "alert" : undefined}>
              {note.tone === "ok" && (
                <svg className="icon-stroke" aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
                  <path d="M2 6.5 4.8 9 10 3" />
                </svg>
              )}
              {note.text}
            </span>
          )}
        </div>
      </div>

      <div className="inputs-foot">
        {blocked && run.status !== "running" && <p className="inputs-status">{blocked}</p>}
        <RunError run={run} />
      </div>
    </form>
  );
}

/** "nums", "nums and target", "a, b and c". */
function names(list: string[]): string {
  if (list.length <= 1) return list.join("");
  return `${list.slice(0, -1).join(", ")} and ${list[list.length - 1]}`;
}

function RunError({ run }: { run: Inputs["run"] }) {
  if (run.status !== "failed") return null;
  return (
    <div className="error-card" role="alert">
      <div className="error-title">
        <svg className="icon-stroke" aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
          <circle cx="7" cy="7" r="6" />
          <path d="M7 4v3.6M7 10h0" />
        </svg>
        {STAGE[run.error.stage] ?? run.error.stage}
      </div>
      <pre className="error-text">{run.error.message}</pre>
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
