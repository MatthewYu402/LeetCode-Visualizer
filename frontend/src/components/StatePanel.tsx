import type { StepDiff } from "../trace/diff";
import { formatValue, kindOf } from "../trace/format";
import { isReturning, returnsVoid, runEnd, topFrame, type Frame, type RunEnd, type Step, type Trace, type Value } from "../trace/types";
import { diffClass } from "../render/ArrayRenderer";

interface Props {
  trace: Trace | null;
  step: Step | null;
  index: number;
  diff: StepDiff | null;
}

/**
 * The snapshot: the call stack (running frame first), then a table of the running
 * frame's locals, its return value in a return step, and, on the last step, the
 * result, a note that a void method returned no value, or why there is no result. A missing result means the method never returned. It is never
 * shown as a wrong answer: the visualizer has no expected answer to compare against.
 */
export function StatePanel({ trace, step, index, diff }: Props) {
  if (!trace || !step) {
    return (
      <div className="panel-body state">
        <p className="notice">No trace loaded.</p>
      </div>
    );
  }
  const last = trace.steps.length - 1;
  const end = runEnd(trace);
  const top = topFrame(step);
  const removed = Object.entries(diff?.locals ?? {}).filter(([, d]) => d.status === "removed");

  return (
    <div className="panel-body state">
      <div className="state-header">
        <span>
          Step {index} of {last} · line {top.line}
        </span>
        {trace.truncated === true && (
          <span className="badge badge-attention" title="Recording stopped at the step limit">
            truncated
          </span>
        )}
      </div>
      <CallStack frames={step.frames} />
      <table className="state-table">
        <thead>
          <tr>
            <th>name</th>
            <th>kind</th>
            <th>value</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(top.locals).map(([name, v]) => (
            <Row key={name} name={name} value={v} cls={diffClass(diff?.locals[name]?.status)} />
          ))}
          {removed.map(([name, d]) => (
            <Row key={`removed-${name}`} name={name} value={d.prev ?? null} cls="diff-removed" />
          ))}
        </tbody>
        {isReturning(top) && (
          <tbody className="state-return">
            <Row name="returns" value={top.return_value as Value} cls="return-row" />
          </tbody>
        )}
        {index === last && (
          <tbody className="state-result">
            {end !== "returned" ? (
              <NoResultRow end={end} />
            ) : returnsVoid(trace.problem) ? (
              <VoidResultRow />
            ) : (
              <Row name="result" value={trace.result as Value} cls="result-row" />
            )}
          </tbody>
        )}
      </table>
    </div>
  );
}

/**
 * The call stack, running frame first (the way debuggers list it). Each row is a
 * function and the line it is on. A frame that is returning says so.
 */
function CallStack({ frames }: { frames: Frame[] }) {
  const ordered = [...frames].reverse();
  return (
    <ol className="call-stack" aria-label="Call stack">
      {ordered.map((f, i) => (
        <li key={f.id} className={i === 0 ? "frame frame-top" : "frame"}>
          <span className="frame-function">{f.function}</span>
          <span className="frame-line">line {f.line}</span>
          {isReturning(f) && <span className="frame-returning">returning</span>}
        </li>
      ))}
    </ol>
  );
}

const NO_RESULT: Record<Exclude<RunEnd, "returned">, { text: string; why: string }> = {
  truncated: {
    text: "did not return: stopped at the step limit",
    why: "Recording stopped at the step limit before the method returned, often because of an infinite loop. This is not a wrong answer.",
  },
  stopped: {
    text: "did not return: the run ended early",
    why: "The run ended before the method returned, for example because it crashed. This is not a wrong answer.",
  },
};

function NoResultRow({ end }: { end: Exclude<RunEnd, "returned"> }) {
  const { text, why } = NO_RESULT[end];
  return (
    <tr className="result-missing">
      <td className="state-name">result</td>
      <td className="state-kind">none</td>
      <td className="state-value" title={why}>
        {text}
      </td>
    </tr>
  );
}

/** A void method that returned. Its result is null in the trace, but "null" would read as a null pointer. */
function VoidResultRow() {
  return (
    <tr className="result-row result-void">
      <td className="state-name">result</td>
      <td className="state-kind">void</td>
      <td className="state-value" title="The method returned. It has no return value: its answer is the input it changed.">
        returned, no value
      </td>
    </tr>
  );
}

function Row({ name, value, cls }: { name: string; value: Value; cls: string }) {
  const text = formatValue(value);
  return (
    <tr className={cls}>
      <td className="state-name">{name}</td>
      <td className="state-kind">{kindOf(value)}</td>
      <td className="state-value" title={text}>
        {text}
      </td>
    </tr>
  );
}
