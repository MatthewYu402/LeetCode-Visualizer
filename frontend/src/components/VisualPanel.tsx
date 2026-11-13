import { useMemo } from "react";
import { HeapView, refId } from "../render/HeapView";
import { layoutTrace } from "../render/layout";
import { selectRenderer } from "../render/registry";
import { callTree, hasNestedCalls } from "../trace/calls";
import type { StepDiff } from "../trace/diff";
import { isContainer, topFrame, type Hint, type Step, type Trace, type Value } from "../trace/types";
import { callLayout, RecursionTree } from "./RecursionTree";

interface Props {
  trace: Trace | null;
  step: Step | null;
  diff: StepDiff | null;
  /** Shown instead of the structures: a loader error, or the no-trace notice. */
  notice?: { text: string; tone: "info" | "error" };
}

/**
 * One step, drawn: the recursion tree when calls nest, the linked structures
 * (lists, trees, graphs) from the heap, then one structure per other container
 * local of the running frame. Primitives are left to the state panel.
 *
 * The layout of linked structures and the call tree are computed once per trace
 * (frontend/CLAUDE.md rule 2); everything drawn for a step comes from that step.
 */
export function VisualPanel({ trace, step, diff, notice }: Props) {
  const views = useMemo(() => {
    if (!trace) return null;
    const calls = callTree(trace);
    return { layout: layoutTrace(trace), calls, callPositions: callLayout(calls), nested: hasNestedCalls(calls) };
  }, [trace]);

  if (notice || !trace || !step || !views) {
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

  // The running frame's containers. Refs and objects are drawn by HeapView, as nodes and pointer labels.
  const { locals } = topFrame(step);
  const drawnHere = (v: Value) => isContainer(v) && v.kind !== "ref" && v.kind !== "object";
  const current = Object.entries(locals).filter(([, v]) => drawnHere(v));
  // Container locals that went out of scope on this step: drawn faded with their old value, for this step only.
  const removed = Object.entries(diff?.locals ?? {}).filter(([, d]) => d.status === "removed" && d.prev !== undefined && drawnHere(d.prev));
  const last = step.step === trace.steps.length - 1;
  const resultId = last ? refId(trace.result) : null;
  const hasHeap = Object.keys(step.heap).length > 0;

  if (current.length === 0 && removed.length === 0 && !hasHeap && !views.nested) {
    return (
      <div className="panel-body visual-empty">
        <p className="notice">No containers in scope at this step. Values are in the state panel.</p>
      </div>
    );
  }

  const ctxBase = { locals, heap: step.heap };
  return (
    <div className="panel-body visual">
      {views.nested && <RecursionTree tree={views.calls} layout={views.callPositions} step={step} index={step.step} />}
      <HeapView step={step} diff={diff?.heap ?? null} layout={views.layout} resultId={resultId} />
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
