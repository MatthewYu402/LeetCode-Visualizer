import { useEffect, useMemo, useState } from "react";
import { CodePanel } from "./components/CodePanel";
import { Split } from "./components/Split";
import { StatePanel } from "./components/StatePanel";
import { Toolbar } from "./components/Toolbar";
import { VisualPanel } from "./components/VisualPanel";
import { monacoLanguage, type EditorLanguage } from "./editor/languages";
import { fixtureFor, NO_TRACE_NOTICE } from "./fixtures";
import { usePlayer } from "./player/usePlayer";
import type { PlayerAction } from "./player/playback";
import { diffForStep } from "./trace/diff";

/** The sandbox page: replays a fixture trace. */
export function App() {
  // The language is a UI input: it picks the editor mode and which fixture to ask for.
  // It is never passed to a renderer, the diff, or the state panel.
  const [language, setLanguage] = useState<EditorLanguage>("cpp");
  const fixture = fixtureFor(language);
  const [source, setSource] = useState(fixture.source);

  const load = fixture.load;
  const trace = load?.ok ? load.trace : null;
  const { state, dispatch, speed, setSpeed } = usePlayer(trace?.steps.length ?? 0, trace);

  // For one render after a trace swap the index may be stale, so guard the lookup.
  const step = trace?.steps[state.index] ?? null;
  const stepDiff = useMemo(
    () => (trace ? diffForStep(trace.steps, state.index, state.cameFrom) : null),
    [trace, state.index, state.cameFrom],
  );

  const notice =
    load === null
      ? { text: NO_TRACE_NOTICE, tone: "info" as const }
      : !load.ok
        ? { text: load.error, tone: "error" as const }
        : undefined;

  const onLanguage = (l: EditorLanguage) => {
    setLanguage(l);
    setSource(fixtureFor(l).source); // switching back to C++ restores the Two Sum source
  };

  useKeyboard(dispatch);

  return (
    <div className="app">
      <Toolbar language={language} onLanguage={onLanguage} player={state} dispatch={dispatch} speed={speed} onSpeed={setSpeed} />
      <main className="workspace">
        <Split
          direction="row"
          initial={40}
          label="Resize code panel"
          first={
            <section className="panel" aria-label="Code">
              <h2 className="panel-title">Code</h2>
              <CodePanel source={source} language={monacoLanguage(language)} line={step?.line ?? null} onChange={setSource} />
            </section>
          }
          second={
            <Split
              direction="column"
              initial={60}
              label="Resize visual panel"
              first={
                <section className="panel" aria-label="Visual">
                  <h2 className="panel-title">Visual</h2>
                  <VisualPanel trace={trace} step={step} diff={stepDiff} notice={notice} />
                </section>
              }
              second={
                <section className="panel" aria-label="State">
                  <h2 className="panel-title">State</h2>
                  <StatePanel trace={trace} step={step} index={state.index} diff={stepDiff} />
                </section>
              }
            />
          }
        />
      </main>
    </div>
  );
}

/** ← / → step, Space toggles Run, Home / End jump. Ignored while typing in the editor or a form control. */
function useKeyboard(dispatch: (a: PlayerAction) => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const t = e.target instanceof HTMLElement ? e.target : null;
      if (t && (t.closest(".monaco-editor") || t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;

      const action: PlayerAction | null =
        e.key === "ArrowLeft"
          ? { type: "prev" }
          : e.key === "ArrowRight"
            ? { type: "next" }
            : e.key === "Home"
              ? { type: "first" }
              : e.key === "End"
                ? { type: "last" }
                : e.key === " " && t?.tagName !== "BUTTON" // a focused button handles Space itself
                  ? { type: "toggle" }
                  : null;
      if (!action) return;
      e.preventDefault();
      dispatch(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [dispatch]);
}
