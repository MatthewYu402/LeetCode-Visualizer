import type { StepDiff } from "../trace/diff";
import { formatValue, kindOf } from "../trace/format";
import { runEnd, type RunEnd, type Step, type Trace, type Value } from "../trace/types";
import { diffClass } from "../render/ArrayRenderer";

interface Props {
  trace: Trace | null;
  step: Step | null;
  index: number;
  diff: StepDiff | null;
}

/**
 * The snapshot as a table: one row per local, plus, on the last step, the result or
 * why there is none. A missing result means the method never returned. It is never
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
  const removed = Object.entries(diff?.locals ?? {}).filter(([, d]) => d.status === "removed");

  return (
    <div className="panel-body state">
      <div className="state-header">
        <span>
          Step {index} of {last} · line {step.line}
        </span>
        {trace.truncated === true && (
          <span className="badge badge-attention" title="Recording stopped at the step limit">
            truncated
          </span>
        )}
      </div>
      <table className="state-table">
        <thead>
          <tr>
            <th>name</th>
            <th>kind</th>
            <th>value</th>
          </tr>
        </thead>
        <tbody>
          {Object.entries(step.locals).map(([name, v]) => (
            <Row key={name} name={name} value={v} cls={diffClass(diff?.locals[name]?.status)} />
          ))}
          {removed.map(([name, d]) => (
            <Row key={`removed-${name}`} name={name} value={d.prev ?? null} cls="diff-removed" />
          ))}
        </tbody>
        {index === last && (
          <tbody className="state-result">
            {end === "returned" ? <Row name="result" value={trace.result as Value} cls="result-row" /> : <NoResultRow end={end} />}
          </tbody>
        )}
      </table>
    </div>
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
