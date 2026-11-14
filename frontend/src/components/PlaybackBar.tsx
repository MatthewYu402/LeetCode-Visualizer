import type { Dispatch } from "react";
import { SPEEDS, type PlayerAction, type PlayerState, type Speed } from "../player/playback";

interface Props {
  player: PlayerState;
  dispatch: Dispatch<PlayerAction>;
  speed: Speed;
  onSpeed: (s: Speed) => void;
}

/** A tick per step when there are few enough to tell apart; past this, the track alone. */
const MAX_TICKS = 60;

/**
 * The bar at the bottom of the page: Restart (step 1 of this trace again, without running
 * the code), the transport, the step counter, a scrubber with a tick per step, and speed.
 * Steps are counted from 1 here; the trace numbers them from 0.
 */
export function PlaybackBar({ player, dispatch, speed, onSpeed }: Props) {
  const has = player.count > 0;
  const last = Math.max(0, player.count - 1);
  const atStart = player.index === 0;
  const atEnd = player.index === last;
  const progress = has && last > 0 ? (player.index / last) * 100 : 0;

  return (
    <footer className={`playback${has ? "" : " is-empty"}`} aria-label="Playback">
      <button
        type="button"
        className="control restart-control"
        disabled={!has}
        title="Back to step 1 of this trace. The code does not run again."
        onClick={() => dispatch({ type: "restart" })}
      >
        <svg className="icon-stroke" aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
          <path d="M2.5 6.5A4.5 4.5 0 1 1 4 10.2" />
          <path d="M2.3 2.8v3.9h3.9" />
        </svg>
        Restart
      </button>
      <span className="playback-sep" aria-hidden="true" />

      <div className="transport" role="group" aria-label="Step controls">
        <IconButton label="Previous step" shortcut="←" disabled={!has || atStart} onClick={() => dispatch({ type: "prev" })} d="M10.5 2.5v9L4 7z" />
        <IconButton
          label={player.playing ? "Pause" : "Play"}
          shortcut="Space"
          disabled={!has}
          onClick={() => dispatch({ type: "toggle" })}
          d={player.playing ? "M3.5 2.5h2.5v9H3.5zM8 2.5h2.5v9H8z" : "M4 2.2v9.6L11.5 7z"}
          primary
        />
        <IconButton label="Next step" shortcut="→" disabled={!has || atEnd} onClick={() => dispatch({ type: "next" })} d="M3.5 2.5v9L10 7z" />
        <IconButton label="Last step" shortcut="End" disabled={!has || atEnd} onClick={() => dispatch({ type: "last" })} d="M9.9 2.5h1.6v9H9.9zM2.5 2.5v9L9 7z" />
      </div>

      <span className="step-counter" aria-live="polite">
        Step {has ? player.index + 1 : "–"} <span className="muted">/ {has ? player.count : "–"}</span>
      </span>

      <div className="scrubber">
        <div className="scrubber-track" aria-hidden="true" />
        <div className="scrubber-fill" aria-hidden="true" style={{ width: `${progress}%` }} />
        {has && player.count <= MAX_TICKS && last > 0 && (
          <div className="scrubber-ticks" aria-hidden="true">
            {Array.from({ length: player.count }, (_, i) => (
              <span key={i} className={i <= player.index ? "tick is-past" : "tick"} style={{ left: `${(i / last) * 100}%` }} />
            ))}
          </div>
        )}
        <input
          type="range"
          min={0}
          max={last}
          step={1}
          value={player.index}
          disabled={!has}
          onChange={(e) => dispatch({ type: "seek", index: Number(e.target.value) })}
          aria-label="Step"
          aria-valuetext={has ? `Step ${player.index + 1} of ${player.count}` : "No trace"}
        />
      </div>

      <div className="segmented" role="group" aria-label="Speed">
        {SPEEDS.map((s) => (
          <button key={s} type="button" aria-pressed={s === speed} className={s === speed ? "segment is-on" : "segment"} onClick={() => onSpeed(s)}>
            {s}×
          </button>
        ))}
      </div>
    </footer>
  );
}

function IconButton(props: { label: string; shortcut: string; disabled: boolean; onClick: () => void; d: string; primary?: boolean }) {
  return (
    <button
      type="button"
      className={props.primary ? "transport-button is-primary" : "transport-button"}
      aria-label={props.label}
      title={`${props.label} (${props.shortcut})`}
      disabled={props.disabled}
      onClick={props.onClick}
    >
      <svg className="icon-fill" aria-hidden="true" width="14" height="14" viewBox="0 0 14 14">
        <path d={props.d} />
      </svg>
    </button>
  );
}
