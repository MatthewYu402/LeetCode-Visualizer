import type { StepDiff } from "../trace/diff";
import { isContainer, topFrame, type Hint, type Step, type Trace } from "../trace/types";
import { selectRenderer } from "../render/registry";

interface Props {
  trace: Trace | null;
  step: Step | null;
  diff: StepDiff | null;
  /** Shown instead of the structures: a loader error, or the no-trace notice. */
  notice?: { text: string; tone: "info" | "error" };
}

/** One rendered structure per container local of one step. Primitives are left to the state panel. */
export function VisualPanel({ trace, step, diff, notice }: Props) {
  if (notice || !trace || !step) {
    return (
      <div className="panel-body visual-empty">
        <p className={notice?.tone === "error" ? "notice notice-error" : "notice"} role={notice?.tone === "error" ? "alert" : undefined}>
          {notice?.text ?? "Nothing to show."}
        </p>
      </div>
    );
  }

  const hints = new Map<string, Hint>();
  for (const p of trace.problem.params) if (p.hint) hints.set(p.name, p.hint);

  // The running frame's containers. Callers' frames are listed in the state panel.
  const { locals } = topFrame(step);
  const current = Object.entries(locals).filter(([, v]) => isContainer(v));
  // Container locals that went out of scope on this step: drawn faded with their old value, for this step only.
  const removed = Object.entries(diff?.locals ?? {}).filter(([, d]) => d.status === "removed" && d.prev !== undefined && isContainer(d.prev));

  if (current.length === 0 && removed.length === 0) {
    return (
      <div className="panel-body visual-empty">
        <p className="notice">No containers in scope at this step. Values are in the state panel.</p>
      </div>
    );
  }

  const ctxBase = { locals };
  return (
    <div className="panel-body visual">
      {current.map(([name, value]) => {
        const d = diff?.locals[name] ?? null;
        const R = selectRenderer(value, hints.get(name));
        return (
          <div key={name} className={`structure-wrap ${d?.status === "added" ? "diff-added-outline" : ""}`}>
            <R name={name} value={value} diff={d && d.status !== "added" ? d : null} ctx={{ ...ctxBase, hint: hints.get(name) }} />
          </div>
        );
      })}
      {removed.map(([name, d]) => {
        const R = selectRenderer(d.prev!, hints.get(name));
        return (
          <div key={`removed-${name}`} className="structure-wrap diff-removed" aria-label={`${name} (out of scope)`}>
            <R name={name} value={d.prev!} diff={null} ctx={{ ...ctxBase, hint: hints.get(name) }} />
          </div>
        );
      })}
    </div>
  );
}
