import { useMemo } from "react";
import { voidFunctions } from "../trace/calls";
import type { StepDiff } from "../trace/diff";
import { formatValue, kindOf } from "../trace/format";
import { nodeLabel } from "../trace/heap";
import { isReturning, returnsVoid, runEnd, topFrame, type ObjectValue, type Outcome, type RunEnd, type Step, type Trace, type Value } from "../trace/types";

interface Props {
  trace: Trace | null;
  step: Step | null;
  index: number;
  diff: StepDiff | null;
  /** The code the trace was made from, for the statement on the running line. */
  source?: string;
}

/**
 * The snapshot of one step (docs/frontend.md §9). At the top, "Step N of M" with a thin
 * progress bar. Under it the running line: a "Line i" pill, the statement as written, and what
 * the line produced when the trace records it (spec §6, outcomes): a condition's true or false,
 * `name = value` for a store, the value a return step returns. Then the running frame's locals
 * as a table, with a `returns` row in a return step and, on the last step, the result, a note
 * that a void method returned no value, or why there is no result.
 *
 * A missing result means the method never returned. It is never shown as a wrong answer: the
 * visualizer has no expected answer to compare against. The call stack is not listed here: the
 * canvas draws the calls.
 */
export function StatePanel({ trace, step, index, diff, source }: Props) {
  const lines = useMemo(() => source?.split("\n") ?? [], [source]);
  const voids = useMemo(() => (trace ? voidFunctions(trace) : new Set<string>()), [trace]);
  if (!trace || !step) {
    return (
      <div className="panel-body state state-empty">
        <h2 className="state-empty-title">No trace yet</h2>
        <p className="state-empty-text">The step, the line running and the locals appear here once the code has run.</p>
      </div>
    );
  }
  const count = trace.steps.length;
  const last = count - 1;
  const end = runEnd(trace);
  const top = topFrame(step);
  const name = nodeName(step.heap);
  const removed = Object.entries(diff?.locals ?? {}).filter(([, d]) => d.status === "removed");
  const statement = (lines[top.line - 1] ?? "").trim();
  const chips = lineChips(top.outcomes, isReturning(top) ? { value: top.return_value ?? null, none: top.return_value === null && voids.has(top.function) } : null, name);

  return (
    <div className="panel-body state">
      <header className="state-head">
        <div className="state-title-row">
          <h2 className="state-step">
            Step {index + 1} <span className="state-step-of">of {count}</span>
          </h2>
          <div className="state-progress" role="progressbar" aria-label="Progress" aria-valuemin={1} aria-valuemax={count} aria-valuenow={index + 1}>
            <div className="state-progress-fill" style={{ width: `${last > 0 ? (index / last) * 100 : 100}%` }} />
          </div>
          {trace.truncated === true && (
            <span className="badge badge-attention" title="Recording stopped at the step limit">
              truncated
            </span>
          )}
        </div>
        <div className="state-line">
          <span className="line-pill">Line {top.line}</span>
          {statement && (
            <code key={`${index}`} className="state-code" title={statement}>
              {statement}
            </code>
          )}
          {chips.length > 0 && (
            <>
              <svg className="state-arrow" aria-hidden="true" width="18" height="10" viewBox="0 0 18 10">
                <path d="M1 5h15M12 1.5 16 5l-4 3.5" />
              </svg>
              {chips.map((c, k) => (
                <span key={k} className={`outcome-chip is-${c.tone}`} title={c.title}>
                  {c.name && <span className="outcome-name">{c.name} = </span>}
                  {c.text}
                </span>
              ))}
            </>
          )}
        </div>
      </header>

      <section className="state-locals" aria-label="Locals">
        <h3 className="state-locals-title">
          Locals in <span className="state-locals-fn">{top.function}</span>
        </h3>
        <div className="state-table-wrap">
          <table className="state-table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Kind</th>
                <th>Value</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(top.locals).map(([n, v]) => (
                <Row key={n} name={n} value={v} cls={rowClass(diff?.locals[n]?.status)} node={name} />
              ))}
              {removed.map(([n, d]) => (
                <Row key={`removed-${n}`} name={n} value={d.prev ?? null} cls="diff-removed" node={name} note="out of scope" />
              ))}
              {isReturning(top) &&
                (top.return_value === null && voids.has(top.function) ? (
                  <tr className="return-row">
                    <td className="state-name">returns</td>
                    <td className="state-kind">void</td>
                    <td className="state-value">no value</td>
                  </tr>
                ) : (
                  <Row name="returns" value={top.return_value ?? null} cls="return-row" node={name} />
                ))}
              {index === last &&
                (end !== "returned" ? (
                  <NoResultRow end={end} />
                ) : returnsVoid(trace.problem) ? (
                  <VoidResultRow />
                ) : (
                  <Row name="result" value={trace.result as Value} cls="result-row" node={(id) => (trace.result_heap?.[id] ? nodeLabel(trace.result_heap[id]) : name(id))} />
                ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

interface Chip {
  tone: "true" | "false" | "store" | "return";
  name?: string;
  text: string;
  title: string;
}

/**
 * What the running line produced, as chips: each recorded outcome in order, or, in a return
 * step, the value being returned. A line with nothing recorded has no chips (adapters that do
 * not record outcomes yet still show the line and its statement).
 */
export function lineChips(outcomes: Outcome[] | undefined, returning: { value: Value; none: boolean } | null, node: (id: string) => string | undefined): Chip[] {
  if (returning) {
    const text = returning.none ? "returns" : `returns ${formatValue(returning.value, node)}`;
    return [{ tone: "return", text, title: returning.none ? "Returns, with no value" : text }];
  }
  return (outcomes ?? []).map((o): Chip =>
    o.kind === "condition"
      ? { tone: o.value ? "true" : "false", text: String(o.value), title: `${o.code} is ${o.value}` }
      : { tone: "store", name: o.target, text: formatValue(o.value, node), title: `${o.code}: ${o.target} = ${formatValue(o.value, node)}` },
  );
}

/** Names a node by its value ("→ 3"), so the table never shows heap ids. */
function nodeName(heap: Record<string, ObjectValue>): (id: string) => string | undefined {
  return (id) => (heap[id] ? nodeLabel(heap[id]) : undefined);
}

function rowClass(status: string | undefined): string {
  return status === "added" ? "diff-added" : status === "changed" ? "diff-changed" : "";
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

function Row({ name, value, cls, node, note }: { name: string; value: Value; cls: string; node: (id: string) => string | undefined; note?: string }) {
  const text = formatValue(value, node);
  return (
    <tr className={cls || undefined}>
      <td className="state-name">{name}</td>
      <td className="state-kind">{kindOf(value)}</td>
      <td className="state-value" title={formatValue(value)}>
        {text}
        {note && <span className="state-note">{note}</span>}
      </td>
    </tr>
  );
}
