import type { StepDiff } from "../trace/diff";
import { formatValue, kindOf } from "../trace/format";
import type { Step, Trace, Value } from "../trace/types";
import { diffClass } from "../render/ArrayRenderer";

interface Props {
  trace: Trace | null;
  step: Step | null;
  index: number;
  diff: StepDiff | null;
}

/** The snapshot as a table: one row per local, plus the result on the last step. */
export function StatePanel({ trace, step, index, diff }: Props) {
  if (!trace || !step) {
    return (
      <div className="panel-body state">
        <p className="notice">No trace loaded.</p>
      </div>
    );
  }
  const last = trace.steps.length - 1;
  const removed = Object.entries(diff?.locals ?? {}).filter(([, d]) => d.status === "removed");

  return (
    <div className="panel-body state">
      <div className="state-header">
        <span>
          Step {index} of {last} · line {step.line}
        </span>
        {trace.truncated && (
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
            <Row name="result" value={trace.result} cls="result-row" />
          </tbody>
        )}
      </table>
    </div>
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
