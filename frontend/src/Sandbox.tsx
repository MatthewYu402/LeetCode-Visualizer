import { useEffect, useMemo, useState } from "react";
import { useInputs } from "./api/useInputs";
import { CodePanel } from "./components/CodePanel";
import { InputsPanel } from "./components/InputsPanel";
import { PasteHint } from "./components/PasteHint";
import { PlaybackBar } from "./components/PlaybackBar";
import { Split } from "./components/Split";
import { StatePanel } from "./components/StatePanel";
import { Toolbar } from "./components/Toolbar";
import { VisualPanel } from "./components/VisualPanel";
import {
  canRun,
  isEditorLanguage,
  LANGUAGES,
  monacoLanguage,
  rememberedLanguage,
  rememberLanguage,
  RUNNABLE,
  STARTER_EXAMPLE,
  TEMPLATES,
  type EditorLanguage,
} from "./editor/languages";
import type { Example } from "./home/examples";
import { href } from "./route";
import { usePlayer } from "./player/usePlayer";
import { useTheme } from "./theme";
import type { PlayerAction } from "./player/playback";
import { diffForStep } from "./trace/diff";
import { topFrame } from "./trace/types";

/** The keys that run the code, as this platform names them. */
const RUN_KEYS = /Mac|iPhone|iPad/.test(globalThis.navigator?.platform ?? "") ? ["⌘", "Enter"] : ["Ctrl", "Enter"];

/**
 * The sandbox page: the top bar, code and inputs on the left, the canvas and state on the
 * right, and playback at the bottom. It opens on the bare Two Sum Solution with no trace, or,
 * from a home page link, on an example's Solution with its inputs filled (still no trace);
 * a run (Run code, or Cmd/Ctrl + Enter) gives the trace to replay. The default export, so
 * App.tsx can load it, with Monaco, only when the sandbox is opened.
 */
export default function Sandbox({ example, language: routeLanguage, reopen }: { example?: Example; language?: string; reopen?: () => void }) {
  // The language is a UI input: it picks the editor mode and the starter template, and is sent
  // to the API with the code. It is never passed to a renderer, the diff, or the state panel.
  // An example opens in the route's language (the home page's cards: C++); the bare sandbox in
  // the language picked last in this tab.
  const [language, setLanguage] = useState<EditorLanguage>(() =>
    isEditorLanguage(routeLanguage) ? routeLanguage : example ? "cpp" : (rememberedLanguage() ?? "cpp"),
  );
  const solution = example?.solutions[language];
  // What the editor was given (an example, or a starter): the user's own changes are anything else.
  const [given, setGiven] = useState(() => solution?.code ?? TEMPLATES[language]);
  const [source, setSource] = useState(given);
  const [showCalls, setShowCalls] = useState(true);
  const { theme, toggle: toggleTheme } = useTheme();

  // A language that cannot run yet (Java) disables the form.
  const runs = canRun(language);
  const cannotRun = `Only ${RUNNABLE} can run so far.`;
  const inputs = useInputs(source, runs ? language : null, cannotRun);
  const done = inputs.run.status === "done" ? inputs.run : null;
  const trace = done?.result.trace ?? null;
  const running = inputs.run.status === "running";
  const { state, dispatch, speed, setSpeed } = usePlayer(trace?.steps.length ?? 0, trace);

  // For one render after a trace swap the index may be stale, so guard the lookup.
  const step = trace?.steps[state.index] ?? null;
  const stepDiff = useMemo(
    () => (trace ? diffForStep(trace.steps, state.index, state.cameFrom) : null),
    [trace, state.index, state.cameFrom],
  );
  const notice = !trace && !runs ? { text: cannotRun, tone: "info" as const } : undefined;
  const languageLabel = LANGUAGES.find((l) => l.id === language)?.label ?? "";

  const onLanguage = (l: EditorLanguage) => {
    setLanguage(l);
    setSource(TEMPLATES[l]);
    setGiven(TEMPLATES[l]);
    rememberLanguage(l);
  };

  // An example from the menu opens a fresh sandbox through the route (App keys the sandbox by it).
  const onExample = (e: Example, l: EditorLanguage) => {
    rememberLanguage(l);
    const target = href({ page: "sandbox", example: e.slug, language: l });
    if (globalThis.location.hash === target) reopen?.();
    else globalThis.location.hash = target;
  };

  useKeyboard(dispatch, inputs.start);

  return (
    <div className="app">
      <Toolbar
        language={language}
        onLanguage={onLanguage}
        showCalls={showCalls}
        onShowCalls={setShowCalls}
        onRun={inputs.start}
        running={running}
        blocked={inputs.blocked}
        runShortcut={RUN_KEYS.join(" ")}
        theme={theme}
        onToggleTheme={toggleTheme}
        dirty={source !== given}
        onExample={onExample}
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
                    <PasteHint />
                    <span className="panel-meta panel-meta-end">{languageLabel}</span>
                  </header>
                  <CodePanel
                    source={source}
                    language={monacoLanguage(language)}
                    line={step ? topFrame(step).line : null}
                    onChange={setSource}
                    onRun={inputs.start}
                    theme={theme}
                  />
                </section>
              }
              second={
                <section className="panel">
                  <div className="panel-body">
                    <InputsPanel inputs={inputs} example={runs && !example ? STARTER_EXAMPLE : undefined} preset={solution?.text} />
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
                  <VisualPanel trace={trace} step={step} diff={stepDiff} notice={notice} runKeys={RUN_KEYS} showCalls={showCalls} running={running} />
                </section>
              }
              second={
                <section className="panel" aria-label="State">
                  <StatePanel trace={trace} step={step} index={state.index} diff={stepDiff} source={done?.source} output={done?.result.output} running={running} />
                </section>
              }
            />
          }
        />
      </main>
      <PlaybackBar player={state} dispatch={dispatch} speed={speed} onSpeed={setSpeed} />
    </div>
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
