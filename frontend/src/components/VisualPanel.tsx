import { AnimatePresence, motion } from "framer-motion";
import { useMemo, type ReactNode } from "react";
import { HeapView, refId } from "../render/HeapView";
import { layoutTrace } from "../render/layout";
import { operation } from "../render/ops";
import { selectRenderer } from "../render/registry";
import { callTree, hasNestedCalls } from "../trace/calls";
import type { StepDiff } from "../trace/diff";
import { isContainer, isReturning, topFrame, type Hint, type Step, type Trace, type Value } from "../trace/types";
import { callLayout, RecursionTree } from "./RecursionTree";

interface Props {
  trace: Trace | null;
  step: Step | null;
  diff: StepDiff | null;
  /** Shown instead of the structures: a loader error, or why this language has no trace. */
  notice?: { text: string; tone: "info" | "error" };
  /** The keys that run the code, for the empty state: ["⌘", "Enter"] or ["Ctrl", "Enter"]. */
  runKeys?: string[];
}

/**
 * One step, drawn: the recursion tree when calls nest, the linked structures
 * (lists, trees, graphs) from the heap, then one structure per other container
 * local of the running frame. Primitives are left to the state panel.
 *
 * The layout of linked structures and the call tree are computed once per trace
 * (frontend/CLAUDE.md rule 2); everything drawn for a step comes from that step.
 */
export function VisualPanel({ trace, step, diff, notice, runKeys = ["Ctrl", "Enter"] }: Props) {
  const views = useMemo(() => {
    if (!trace) return null;
    const calls = callTree(trace);
    return { layout: layoutTrace(trace), calls, callPositions: callLayout(calls), nested: hasNestedCalls(calls) };
  }, [trace]);

  if (!notice && !trace) {
    return (
      <div className="canvas canvas-empty">
        <p className="empty-title">Run your code to see it here.</p>
        <p className="empty-hint">
          Use <span className="empty-strong">Run code</span> at the top right, or press
          {runKeys.map((k) => (
            <kbd key={k}>{k}</kbd>
          ))}
        </p>
      </div>
    );
  }

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
  const frame = topFrame(step);
  const { locals } = frame;
  const drawnHere = (v: Value) => isContainer(v) && v.kind !== "ref" && v.kind !== "object";
  const current = Object.entries(locals).filter(([, v]) => drawnHere(v));
  const last = step.step === trace.steps.length - 1;
  const resultId = last ? refId(trace.result) : null;
  const hasHeap = Object.keys(step.heap).length > 0;
  const ctxBase = { locals, heap: step.heap };

  return (
    <div className="canvas canvas-filled">
      <div className="line-strip" aria-live="polite">
        <span className="line-strip-bar" aria-hidden="true" />
        <span>
          Line <span className="line-strip-number">{frame.line}</span> {isReturning(frame) ? "is returning" : "runs next"}
        </span>
      </div>
      <div className="cards">
        {/* A card fades in and slides up the first time its structure is drawn, and fades out when it leaves scope. */}
        <AnimatePresence initial={false}>
          {views.nested && (
            <Card key="#calls">
              <RecursionTree tree={views.calls} layout={views.callPositions} step={step} index={step.step} />
            </Card>
          )}
          {hasHeap && (
            <Card key="#heap">
              <HeapView step={step} diff={diff?.heap ?? null} layout={views.layout} resultId={resultId} />
            </Card>
          )}
          {current.map(([name, value]) => {
            const d = diff?.locals[name] ?? null;
            const own = d && d.status !== "added" ? d : null;
            const R = selectRenderer(value, hints.get(name));
            return (
              <Card key={name} added={d?.status === "added"}>
                <R name={name} value={value} diff={own} ctx={{ ...ctxBase, hint: hints.get(name), op: operation(value, own) }} />
              </Card>
            );
          })}
        </AnimatePresence>
        {current.length === 0 && !hasHeap && !views.nested && (
          <p className="canvas-note">No containers in scope at this step. Values are in the state panel.</p>
        )}
      </div>
    </div>
  );
}

/** One structure's card, spanning the canvas. */
function Card({ children, added }: { children: ReactNode; added?: boolean }) {
  return (
    <motion.div
      layout="position"
      className={`card ${added ? "is-new" : ""}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 6 }}
      transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
    >
      {children}
    </motion.div>
  );
}
