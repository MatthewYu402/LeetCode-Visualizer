import type { Dispatch } from "react";
import { SPEEDS, type PlayerAction, type PlayerState, type Speed } from "../player/playback";
import { LANGUAGES, type EditorLanguage } from "../editor/languages";

interface Props {
  language: EditorLanguage;
  onLanguage: (l: EditorLanguage) => void;
  player: PlayerState;
  dispatch: Dispatch<PlayerAction>;
  speed: Speed;
  onSpeed: (s: Speed) => void;
}

export function Toolbar({ language, onLanguage, player, dispatch, speed, onSpeed }: Props) {
  const has = player.count > 0;
  const last = Math.max(0, player.count - 1);
  const atStart = player.index === 0;
  const atEnd = player.index === last;

  return (
    <header className="toolbar">
      <label className="toolbar-group">
        <span className="sr-only">Language</span>
        <select value={language} onChange={(e) => onLanguage(e.target.value as EditorLanguage)} aria-label="Language" title="Editor language">
          {LANGUAGES.map((l) => (
            <option key={l.id} value={l.id}>
              {l.label}
            </option>
          ))}
        </select>
      </label>

      <div className="toolbar-group" role="group" aria-label="Playback">
        <Btn label="First step" shortcut="Home" disabled={!has || atStart} onClick={() => dispatch({ type: "first" })}>
          ⏮
        </Btn>
        <Btn label="Previous step" shortcut="←" disabled={!has || atStart} onClick={() => dispatch({ type: "prev" })}>
          ◀
        </Btn>
        <Btn
          label={player.playing ? "Pause" : "Run"}
          shortcut="Space"
          disabled={!has}
          onClick={() => dispatch({ type: "toggle" })}
          primary
        >
          {player.playing ? "⏸" : "▶"}
        </Btn>
        <Btn label="Next step" shortcut="→" disabled={!has || atEnd} onClick={() => dispatch({ type: "next" })}>
          ▶
        </Btn>
        <Btn label="Last step" shortcut="End" disabled={!has || atEnd} onClick={() => dispatch({ type: "last" })}>
          ⏭
        </Btn>
      </div>

      <span className="step-counter" aria-live="polite">
        {has ? `Step ${player.index} / ${last}` : "Step – / –"}
      </span>

      <input
        className="scrubber"
        type="range"
        min={0}
        max={last}
        step={1}
        value={player.index}
        disabled={!has}
        onChange={(e) => dispatch({ type: "seek", index: Number(e.target.value) })}
        aria-label="Step"
        title="Scrub through steps"
      />

      <label className="toolbar-group">
        <span className="sr-only">Speed</span>
        <select value={speed} onChange={(e) => onSpeed(Number(e.target.value) as Speed)} aria-label="Speed" title="Playback speed">
          {SPEEDS.map((s) => (
            <option key={s} value={s}>
              {s}×
            </option>
          ))}
        </select>
      </label>

      <span className="toolbar-notice" title="The backend is not connected yet">
        Code does not run yet. Edits do not change the trace.
      </span>
    </header>
  );
}

function Btn(props: {
  label: string;
  shortcut: string;
  disabled: boolean;
  onClick: () => void;
  primary?: boolean;
  children: string;
}) {
  return (
    <button
      type="button"
      className={props.primary ? "btn btn-primary" : "btn"}
      aria-label={props.label}
      title={`${props.label} (${props.shortcut})`}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      {props.children}
    </button>
  );
}
