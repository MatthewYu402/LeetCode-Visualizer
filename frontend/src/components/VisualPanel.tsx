import { AnimatePresence, motion } from "framer-motion";
import { useMemo, type ReactNode } from "react";
import { LinkedCard, NullPointersCard, nullPointers, refId, shownComponents } from "../render/HeapView";
import { layoutTrace } from "../render/layout";
import { operation } from "../render/ops";
import { selectRenderer } from "../render/registry";
import { callsCardKind, callTree } from "../trace/calls";
import type { StepDiff } from "../trace/diff";
import { isContainer, isReturning, topFrame, type Hint, type Step, type Trace, type Value } from "../trace/types";
import { CallStackCard } from "./CallStackCard";
import { callLayout, RecursionTree } from "./RecursionTree";

interface Props {
  trace: Trace | null;
  step: Step | null;
  diff: StepDiff | null;
  /** Shown instead of the structures: a loader error, or why this language has no trace. */
  notice?: { text: string; tone: "info" | "error" };
  /** The keys that run the code, for the empty state: ["⌘", "Enter"] or ["Ctrl", "Enter"]. */
  runKeys?: string[];
  /** The top bar's "Call stack" switch: shows or hides the call-stack card. */
  showCalls?: boolean;
}

/**
 * One step, drawn as cards: the linked structures (lists, trees, graphs) from the heap, one
 * card per other container local of the running frame, and, at the bottom, the calls. Calls
 * that return values get the recursion card for the whole run; calls that return nothing get
 * the call-stack card while more than one frame is live and the top bar's switch is on
 * (callsCardKind). Primitives are left to the state panel.
 *
 * The layout of linked structures and the call tree are computed once per trace
 * (frontend/CLAUDE.md rule 2); everything drawn for a step comes from that step.
 */
export function VisualPanel({ trace, step, diff, notice, runKeys = ["Ctrl", "Enter"], showCalls = true }: Props) {
  const views = useMemo(() => {
    if (!trace) return null;
    const calls = callTree(trace);
    return { layout: layoutTrace(trace), calls, callPositions: callLayout(calls), callsKind: callsCardKind(calls) };
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
  const ctxBase = { locals, heap: step.heap };
  const linked = shownComponents(step, views.layout);
  const nulls = nullPointers(step, views.layout);
  const params = new Set(views.calls.calls.get(frame.id)?.params ?? []);
  const heapProps = { step, diff: diff?.heap ?? null, layout: views.layout, resultId, params };
  const callsCard =
    views.callsKind === "tree" ? "tree" : views.callsKind === "stack" && showCalls && step.frames.length > 1 ? "stack" : null;
  const nothing = current.length === 0 && linked.length === 0 && nulls.length === 0 && !callsCard;

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
          {linked.map((index, k) => (
            <Card key={`#heap-${index}`}>
              <LinkedCard index={index} {...heapProps} nulls={k === 0 ? nulls : []} />
            </Card>
          ))}
          {linked.length === 0 && nulls.length > 0 && (
            <Card key="#nulls">
              <NullPointersCard nulls={nulls} />
            </Card>
          )}
          {current.map(([name, value]) => {
            const d = diff?.locals[name] ?? null;
            const own = d && d.status !== "added" ? d : null;
            const R = selectRenderer(value, hints.get(name));
            return (
              <Card key={name} added={d?.status === "added"}>
                <R name={name} value={value} diff={own} ctx={{ ...ctxBase, hint: hints.get(name), op: operation(value, own, step.heap) }} />
              </Card>
            );
          })}
          {callsCard === "tree" && (
            <Card key="#calls-tree">
              <RecursionTree tree={views.calls} layout={views.callPositions} step={step} index={step.step} />
            </Card>
          )}
          {callsCard === "stack" && (
            <Card key="#calls-stack">
              <CallStackCard tree={views.calls} step={step} pushed={diff?.pushed} />
            </Card>
          )}
        </AnimatePresence>
        {nothing && (
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
