import { useEffect, useMemo, useState } from "react";
import reverseListSource from "../../../fixtures/reverse_list_trace.cpp?raw";
import reverseListTrace from "../../../fixtures/reverse-list.trace.json?raw";
import { VisualPanel } from "../components/VisualPanel";
import { diffForStep } from "../trace/diff";
import { loadTrace } from "../trace/loader";
import { topFrame } from "../trace/types";

/** How long each step shows while the preview plays: a little slower than the sandbox's 1x. */
export const PREVIEW_STEP_MS = 1100;
/** The pause on the last step before it starts again. */
export const PREVIEW_END_MS = 2600;

const loaded = loadTrace(reverseListTrace);
const SOURCE_LINES = reverseListSource.replace(/\n$/, "").split("\n");

/**
 * The home page's preview: the Reverse Linked List golden trace (fixtures/), replayed by the
 * same VisualPanel the sandbox uses, beside its code with the running line highlighted. It is
 * a real trace drawn by the real canvas, never a picture of one, so it shows what the sandbox
 * shows. It plays on its own and loops; the play button pauses it, and stepping by hand
 * pauses it too. With the system's "reduce motion" setting on it waits for the play button.
 */
export function Preview() {
  const trace = loaded.ok ? loaded.trace : null;
  const count = trace?.steps.length ?? 0;
  const reduced = useReducedMotion();
  const [position, setPosition] = useState({ index: 0, cameFrom: null as number | null });
  const [chosen, setChosen] = useState<boolean | null>(null); // null until the reader presses something
  const playing = (chosen ?? !reduced) && count > 1;

  useEffect(() => {
    if (!playing) return;
    const last = position.index >= count - 1;
    const timer = setTimeout(
      () => setPosition((p) => (p.index >= count - 1 ? { index: 0, cameFrom: null } : { index: p.index + 1, cameFrom: p.index })),
      last ? PREVIEW_END_MS : PREVIEW_STEP_MS,
    );
    return () => clearTimeout(timer);
  }, [playing, position.index, count]);

  const step = trace?.steps[position.index] ?? null;
  const diff = useMemo(() => (trace ? diffForStep(trace.steps, position.index, position.cameFrom) : null), [trace, position]);
  if (!trace || !step) return null;
  const line = topFrame(step).line;

  const go = (to: number) => {
    setChosen(false);
    const index = Math.max(0, Math.min(count - 1, to));
    setPosition((p) => ({ index, cameFrom: index === p.index + 1 ? p.index : null }));
  };

  return (
    <figure
      className="preview"
      aria-label="A preview: Reverse Linked List, stepping through its trace"
    >
      <div className="preview-bar">
        <span className="preview-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
        <span className="preview-title">Reverse Linked List</span>
        <span className="preview-step">
          Step {position.index + 1} / {count}
        </span>
      </div>
      <div className="preview-body">
        <pre className="preview-code" aria-label="Code">
          {SOURCE_LINES.map((text, i) => (
            <span key={i} className={`preview-line${i + 1 === line ? " is-current" : ""}`}>
              <span className="preview-gutter">{i + 1}</span>
              <span className="preview-text">{text || " "}</span>
            </span>
          ))}
        </pre>
        <div className="preview-canvas">
          <VisualPanel trace={trace} step={step} diff={diff} />
        </div>
      </div>
      <div className="preview-controls">
        <button type="button" className="control icon-control" aria-label="Previous step" onClick={() => go(position.index - 1)} disabled={position.index === 0}>
          <svg className="icon-stroke" aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
            <path d="M8.5 3.5 5 7l3.5 3.5" />
          </svg>
        </button>
        <button
          type="button"
          className="control icon-control"
          aria-label={playing ? "Pause" : "Play"}
          onClick={() => setChosen(!playing)}
        >
          {playing ? (
            <svg className="icon-fill" aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
              <path d="M3 2h2v8H3zM7 2h2v8H7z" />
            </svg>
          ) : (
            <svg className="icon-fill" aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
              <path d="M3 1.8v8.4L10 6z" />
            </svg>
          )}
        </button>
        <button type="button" className="control icon-control" aria-label="Next step" onClick={() => go(position.index + 1)} disabled={position.index === count - 1}>
          <svg className="icon-stroke" aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
            <path d="M5.5 3.5 9 7l-3.5 3.5" />
          </svg>
        </button>
        <div className="preview-progress" aria-hidden="true">
          <span style={{ width: `${((position.index + 1) / count) * 100}%` }} />
        </div>
        <span className="preview-caption">A real trace, drawn by the sandbox's canvas</span>
      </div>
    </figure>
  );
}

/** The system's "reduce motion" setting, following changes. */
function useReducedMotion(): boolean {
  const query = "(prefers-reduced-motion: reduce)";
  const [reduced, setReduced] = useState(() => globalThis.matchMedia?.(query).matches ?? false);
  useEffect(() => {
    const media = globalThis.matchMedia?.(query);
    if (!media) return;
    const onChange = (e: MediaQueryListEvent) => setReduced(e.matches);
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);
  return reduced;
}
