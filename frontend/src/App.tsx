import { MotionConfig } from "framer-motion";
import { useEffect, useMemo, useState } from "react";
import { useInputs } from "./api/useInputs";
import { CodePanel } from "./components/CodePanel";
import { InputsPanel } from "./components/InputsPanel";
import { PlaybackBar } from "./components/PlaybackBar";
import { Split } from "./components/Split";
import { StatePanel } from "./components/StatePanel";
import { Toolbar } from "./components/Toolbar";
import { VisualPanel } from "./components/VisualPanel";
import { LANGUAGES, monacoLanguage, STARTER_EXAMPLE, TEMPLATES, type EditorLanguage } from "./editor/languages";
import { usePlayer } from "./player/usePlayer";
import type { PlayerAction } from "./player/playback";
import { diffForStep } from "./trace/diff";
import { topFrame } from "./trace/types";

/** The keys that run the code, as this platform names them. */
const RUN_KEYS = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "") ? ["⌘", "Enter"] : ["Ctrl", "Enter"];

/**
 * The page: the top bar, code and inputs on the left, the canvas and state on the right,
 * and playback at the bottom. It opens on the bare Two Sum Solution with no trace; a run
 * (Run code, or Cmd/Ctrl + Enter) gives the trace to replay.
 */
export function App() {
  // The language is a UI input: it picks the editor mode and the starter template.
  // It is never passed to a renderer, the diff, or the state panel.
  const [language, setLanguage] = useState<EditorLanguage>("cpp");
  const [source, setSource] = useState(TEMPLATES.cpp);
  const [showCalls, setShowCalls] = useState(true);

  // Only C++ runs so far. The language picks the editor mode and whether the form is enabled.
  const inputs = useInputs(source, language === "cpp");
  const trace = inputs.run.status === "done" ? inputs.run.result.trace : null;
  const { state, dispatch, speed, setSpeed } = usePlayer(trace?.steps.length ?? 0, trace);

  // For one render after a trace swap the index may be stale, so guard the lookup.
  const step = trace?.steps[state.index] ?? null;
  const stepDiff = useMemo(
    () => (trace ? diffForStep(trace.steps, state.index, state.cameFrom) : null),
    [trace, state.index, state.cameFrom],
  );
  const notice = !trace && language !== "cpp" ? { text: "Only C++ can run so far.", tone: "info" as const } : undefined;
  const languageLabel = LANGUAGES.find((l) => l.id === language)?.label ?? "";

  const onLanguage = (l: EditorLanguage) => {
    setLanguage(l);
    setSource(TEMPLATES[l]);
  };

  useKeyboard(dispatch, inputs.start);

  return (
    // reducedMotion="user": with the system's "reduce motion" setting on, every
    // framer-motion animation jumps straight to its end, as the CSS ones already do.
    <MotionConfig reducedMotion="user">
      <div className="app">
        <Toolbar
          language={language}
          onLanguage={onLanguage}
          showCalls={showCalls}
          onShowCalls={setShowCalls}
          onRun={inputs.start}
          running={inputs.run.status === "running"}
          blocked={inputs.blocked}
          runShortcut={RUN_KEYS.join(" ")}
        />
        <main className="workspace">
          <Split
            direction="row"
            initial={38}
            label="Resize code panel"
            first={
              <Split
                direction="column"
                initial={58}
                label="Resize inputs panel"
                first={
                  <section className="panel" aria-label="Code">
                    <header className="panel-header">
                      <h2 className="panel-heading">Code</h2>
                      <span className="panel-meta panel-meta-end">{languageLabel}</span>
                    </header>
                    <CodePanel
                      source={source}
                      language={monacoLanguage(language)}
                      line={step ? topFrame(step).line : null}
                      onChange={setSource}
                      onRun={inputs.start}
                    />
                  </section>
                }
                second={
                  <section className="panel">
                    <div className="panel-body">
                      <InputsPanel inputs={inputs} example={language === "cpp" ? STARTER_EXAMPLE : undefined} />
                    </div>
                  </section>
                }
              />
            }
            second={
              <Split
                direction="column"
                initial={62}
                label="Resize visual panel"
                first={
                  <section className="panel panel-canvas" aria-label="Visual">
                    <VisualPanel trace={trace} step={step} diff={stepDiff} notice={notice} runKeys={RUN_KEYS} />
                  </section>
                }
                second={
                  <section className="panel" aria-label="State">
                    <StatePanel trace={trace} step={step} index={state.index} diff={stepDiff} />
                  </section>
                }
              />
            }
          />
        </main>
        <PlaybackBar player={state} dispatch={dispatch} speed={speed} onSpeed={setSpeed} />
      </div>
    </MotionConfig>
  );
}

/**
 * ← / → step, Space plays or pauses, Home / End jump: ignored while typing in the editor
 * or a form control. Cmd/Ctrl + Enter runs the code from anywhere (the editor binds it itself).
 */
function useKeyboard(dispatch: (a: PlayerAction) => void, runCode: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target instanceof HTMLElement ? e.target : null;
      const inEditor = !!t?.closest(".monaco-editor");
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && !e.altKey && !e.shiftKey) {
        if (inEditor) return;
        e.preventDefault();
        runCode();
        return;
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (t && (inEditor || t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;

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
  }, [dispatch, runCode]);
}
