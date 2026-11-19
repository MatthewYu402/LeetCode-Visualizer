import { LANGUAGES, type EditorLanguage } from "../editor/languages";
import { href } from "../route";
import type { Theme } from "../theme";
import { Logo } from "./Logo";

interface Props {
  language: EditorLanguage;
  onLanguage: (l: EditorLanguage) => void;
  /** Whether the call-stack card may show on the canvas. */
  showCalls: boolean;
  onShowCalls: (on: boolean) => void;
  /** Runs the code in the sandbox. */
  onRun: () => void;
  running: boolean;
  /** Why Run code is disabled, or null. */
  blocked: string | null;
  /** "⌘ Enter" or "Ctrl Enter", for the Run code tooltip. */
  runShortcut: string;
  theme: Theme;
  onToggleTheme: () => void;
}

/**
 * The top bar: the name, then what to run and how to show it (language, the call-stack
 * switch), then the theme button and Run code. Playback lives in the bar at the bottom.
 */
export function Toolbar({ language, onLanguage, showCalls, onShowCalls, onRun, running, blocked, runShortcut, theme, onToggleTheme }: Props) {
  const otherTheme = theme === "dark" ? "light" : "dark";
  const runTitle = running ? "Running in the sandbox…" : (blocked ?? `Run your Solution on these inputs (${runShortcut})`);
  return (
    <header className="topbar">
      <a className="brand" href={href({ page: "home" })} title="Home">
        <Logo height={18} />
        <span className="brand-name">LeetCode Visualizer</span>
      </a>
      <span className="topbar-sep" aria-hidden="true" />

      <label className="select-wrap">
        <span className="sr-only">Language</span>
        <select value={language} onChange={(e) => onLanguage(e.target.value as EditorLanguage)} title="Language">
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
        <svg className="select-chevron" aria-hidden="true" width="10" height="6" viewBox="0 0 10 6">
          <path d="M1 1l4 4 4-4" />
        </svg>
      </label>

      <button
        type="button"
        role="switch"
        aria-checked={showCalls}
        className="control switch-control"
        title="Show the call stack on the canvas while a function runs"
        onClick={() => onShowCalls(!showCalls)}
      >
        <StackIcon />
        <span>Call stack</span>
        <span className="switch-track" aria-hidden="true">
          <span className="switch-knob" />
        </span>
      </button>

      <div className="topbar-end">
        {/* The icon shows the theme a press switches to: a sun on the dark page, a moon on the light one. */}
        <button type="button" className="control icon-control" aria-label={`Switch to the ${otherTheme} theme`} title={`Switch to the ${otherTheme} theme`} onClick={onToggleTheme}>
          {theme === "dark" ? <SunIcon /> : <MoonIcon />}
        </button>
        <button
          type="button"
          className={`run-button${running ? " is-running" : ""}`}
          onClick={onRun}
          disabled={!running && blocked !== null}
          aria-disabled={running || undefined}
          title={runTitle}
        >
          {running ? <span className="spinner" aria-hidden="true" /> : <PlayIcon />}
          <span>{running ? "Running…" : "Run code"}</span>
        </button>
      </div>
    </header>
  );
}

export function StackIcon() {
  return (
    <svg className="icon-stroke" aria-hidden="true" width="15" height="15" viewBox="0 0 18 18">
      <rect x="3" y="2.5" width="12" height="3" rx="1.5" />
      <rect x="3" y="7.5" width="12" height="3" rx="1.5" />
      <rect x="3" y="12.5" width="12" height="3" rx="1.5" />
    </svg>
  );
}

export function SunIcon() {
  return (
    <svg className="icon-stroke" aria-hidden="true" width="15" height="15" viewBox="0 0 16 16">
      <circle cx="8" cy="8" r="3" />
      <path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" />
    </svg>
  );
}

export function MoonIcon() {
  return (
    <svg className="icon-stroke" aria-hidden="true" width="15" height="15" viewBox="0 0 16 16">
      <path d="M13.2 9.6A5.5 5.5 0 0 1 6.4 2.8a5.5 5.5 0 1 0 6.8 6.8z" />
    </svg>
  );
}

function PlayIcon() {
  return (
    <svg className="icon-fill" aria-hidden="true" width="12" height="12" viewBox="0 0 12 12">
      <path d="M3 1.8v8.4L10 6z" />
    </svg>
  );
}
