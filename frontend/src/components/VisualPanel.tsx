import { AnimatePresence, motion } from "framer-motion";
import { useMemo, useState, type ReactNode } from "react";
import { LinkedCard, NullPointersCard, nullPointers, refId, shownComponents } from "../render/HeapView";
import { layoutTrace } from "../render/layout";
import { operation } from "../render/ops";
import { selectRenderer } from "../render/registry";
import { callsCardKind, callTree } from "../trace/calls";
import type { StepDiff } from "../trace/diff";
import { isContainer, isReturning, readsOf, topFrame, type Hint, type Step, type Trace, type Value } from "../trace/types";
import { CallStackCard } from "./CallStackCard";
import { callLayout, RecursionTree } from "./RecursionTree";
import { RunningCanvas } from "./RunningCanvas";
import { raggedLocals } from "../render/ArrayRenderer";
import { stringLocals } from "../render/StringRenderer";
import { steadyLocals } from "../render/pointers";
import { CardControls, MemberCard } from "../render/Card";
import { autoView, fits, hintOfView, numberRows, viewOptions, type View, type ViewChoice } from "../render/views";
import type { RenderContext } from "../render/types";
import type { ValueDiff } from "../trace/diff";
import { sharedGroups, sharedPlaces, type SharedGroup } from "../trace/shared";
import { ViewMenu } from "./ViewMenu";

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
  /** The sandbox is making a trace: the canvas shows that instead of anything else. */
  running?: boolean;
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
export function VisualPanel({ trace, step, diff, notice, runKeys = ["Ctrl", "Enter"], showCalls = true, running = false }: Props) {
  const views = useMemo(() => {
    if (!trace) return null;
    const calls = callTree(trace);
    return { layout: layoutTrace(trace), calls, callPositions: callLayout(calls), callsKind: callsCardKind(calls), ragged: raggedLocals(trace), strings: stringLocals(trace), steady: steadyLocals(trace) };
  }, [trace]);
  // What the reader picked in each card's View menu, by local name, for this trace only: a new run starts on auto.
  const [chosen, setChosen] = useState<{ trace: Trace | null; map: Record<string, ViewChoice> }>({ trace: null, map: {} });
  const choices = chosen.trace === trace ? chosen.map : {};
  const choose = (key: string, c: ViewChoice) => setChosen({ trace, map: { ...choices, [key]: c } });

  if (running) return <RunningCanvas />;

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

  // The running frame's containers. Refs and objects are drawn by LinkedCard, as nodes and pointer tags.
  const frame = topFrame(step);
  const { locals } = frame;
  // An iterator is a pointer marker on its container (rule 7), not a card of its own. A string is
  // drawn when the trace shows it is a string, not a char (stringLocals).
  const drawnHere = (name: string, v: Value) =>
    typeof v === "string" ? views.strings.has(`${frame.function}/${name}`) : isContainer(v) && v.kind !== "ref" && v.kind !== "object" && v.kind !== "iterator";
  const current = Object.entries(locals).filter(([name, v]) => drawnHere(name, v));
  // The Solution's member variables, after the running call's own: drawn like locals, with a "member" tag.
  // A member is hidden in the canvas, as in C++, while a local of the running call has its name.
  const members = Object.entries(step.members ?? {}).filter(
    ([name, v]) => !(name in locals) && (typeof v === "string" ? views.strings.has(`#members/${name}`) : drawnHere(name, v)),
  );
  const last = step.step === trace.steps.length - 1;
  const resultId = last ? refId(trace.result) : null;
  const reads = readsOf(frame);
  // Containers reached from more than one place this step (v0.14 ids): each card notes its own.
  const shared = sharedPlaces(step);
  const ctxBase = { locals, heap: step.heap, indexes: trace.indexes?.[frame.function], steady: views.steady.get(frame.function) };
  const linked = shownComponents(step, views.layout);
  const nulls = nullPointers(step, views.layout);
  const params = new Set(views.calls.calls.get(frame.id)?.params ?? []);
  const heapProps = { step, diff: diff?.heap ?? null, layout: views.layout, resultId, params };
  const callsCard =
    views.callsKind === "tree" ? "tree" : views.callsKind === "stack" && showCalls && step.frames.length > 1 ? "stack" : null;
  // Every container card of this step, the running call's then the members, with the drawing it
  // gets: the reader's pick from its View menu when that fits the value now, else auto (render/views.ts).
  const cards = [
    ...current.map(([name, value]) => ({ key: name, name, value, diff: diff?.locals[name] ?? null, member: false, hint: hints.get(name) })),
    ...members.map(([name, value]) => ({ key: `#members/${name}`, name, value, diff: diff?.members[name] ?? null, member: true, hint: undefined as Hint | undefined })),
  ].map((c) => {
    const auto = autoView(c.value, c.hint);
    const choice: ViewChoice = choices[c.key] ?? { view: auto };
    const view: View = fits(choice.view, c.value) ? choice.view : "kind";
    const rows = numberRows(c.value);
    const kindLabel = rows && !(!c.member && views.ragged.has(`${frame.function}/${c.name}`)) && rows.every((r) => r.length === rows[0].length && r.length > 0) ? "Grid" : rows ? "Rows" : "Array";
    return { ...c, diff: c.diff as ValueDiff | null, auto, choice: { ...choice, view }, view, options: viewOptions(c.value, kindLabel) };
  });
  // One number line for every intervals card of the step, so their bars line up.
  const intervalRows = cards.filter((c) => c.view === "intervals").flatMap((c) => numberRows(c.value) ?? []);
  const scale = intervalRows.length ? { lo: Math.min(0, ...intervalRows.map((r) => r[0])), hi: Math.max(...intervalRows.map((r) => r[1])) } : undefined;
  const nothing = current.length === 0 && members.length === 0 && linked.length === 0 && nulls.length === 0 && !callsCard;

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
          {cards.map((c) => {
            const own = c.diff && c.diff.status !== "added" ? c.diff : null;
            const R = selectRenderer(c.value, hintOfView(c.view));
            const ctx: RenderContext = {
              ...ctxBase,
              hint: hintOfView(c.view),
              direction: c.choice.direction,
              scale: c.view === "intervals" ? scale : undefined,
              op: operation(c.value, own, step.heap),
              ragged: !c.member && views.ragged.has(`${frame.function}/${c.name}`),
              reads: reads.get(c.name),
            };
            const controls =
              c.options.length > 0 ? <ViewMenu name={c.name} options={c.options} current={c.choice} auto={c.auto} fromHint={c.auto !== "kind"} onPick={(choice) => choose(c.key, choice)} /> : null;
            return (
              <Card key={c.key} added={c.diff?.status === "added"}>
                <MemberCard.Provider value={c.member}>
                  <CardControls.Provider value={controls}>
                    <R name={c.name} value={c.value} diff={own} ctx={ctx} />
                  </CardControls.Provider>
                </MemberCard.Provider>
                <SharedNote groups={sharedGroups(c.key, shared)} />
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

/** At most this many places are named in one note; the rest are in its tooltip. */
const MAX_PLACES = 5;

/**
 * Under a card that holds a shared container: every place that is the same container this step
 * ("Same array: dp[0] · dp[1] · dp[2] · first"), one line per container, named by its kind. A
 * change through any of those names shows at all of them, because they are one.
 */
export function SharedNote({ groups }: { groups: SharedGroup[] }) {
  if (groups.length === 0) return null;
  return (
    <div className="shared-note">
      {groups.map(({ kind, places }) => {
        const shown = places.slice(0, MAX_PLACES);
        const more = places.length - shown.length;
        return (
          <p key={places.join("\u0000")} className="shared-line" title={`One container, reached as ${places.join(", ")}`}>
            <svg className="icon-stroke" aria-hidden="true" width="12" height="12" viewBox="0 0 16 16">
              <path d="M6.5 9.5a3 3 0 0 0 4.2 0l2.3-2.3a3 3 0 0 0-4.2-4.2l-.9.9M9.5 6.5a3 3 0 0 0-4.2 0L3 8.8A3 3 0 0 0 7.2 13l.9-.9" />
            </svg>
            <span className="shared-label">Same {kind.replace("-", " ")}:</span>
            {shown.map((p, i) => (
              <span key={p}>
                {i > 0 && <span className="shared-sep" aria-hidden="true"> · </span>}
                <code className="shared-place">{p}</code>
              </span>
            ))}
            {more > 0 && <span className="shared-more">+{more} more</span>}
          </p>
        );
      })}
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
