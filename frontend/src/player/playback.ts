// Pure playback state. The player only moves an index; it never computes program state.

export interface PlayerState {
  /** Number of steps in the trace. 0 when there is no trace. */
  count: number;
  /** Current step index. */
  index: number;
  /** The index displayed just before this one, or null after a reset. A diff is shown only when cameFrom === index - 1. */
  cameFrom: number | null;
  playing: boolean;
}

export type PlayerAction =
  | { type: "reset"; count: number }
  | { type: "first" }
  | { type: "restart" }
  | { type: "prev" }
  | { type: "next" }
  | { type: "last" }
  | { type: "seek"; index: number }
  | { type: "toggle" }
  | { type: "tick" };

export function initialPlayer(count: number): PlayerState {
  return { count, index: 0, cameFrom: null, playing: false };
}

function goTo(s: PlayerState, index: number, playing: boolean): PlayerState {
  const last = Math.max(0, s.count - 1);
  const clamped = Math.min(Math.max(0, Math.trunc(index)), last);
  if (clamped === s.index) return { ...s, playing };
  return { ...s, index: clamped, cameFrom: s.index, playing };
}

export function playerReducer(s: PlayerState, a: PlayerAction): PlayerState {
  const last = Math.max(0, s.count - 1);
  switch (a.type) {
    case "reset":
      return initialPlayer(a.count);
    case "first":
      return goTo(s, 0, false);
    case "restart":
      // Back to step 0 of the same trace, playing. The code does not run again. A jump: no diff.
      if (s.count === 0) return s;
      return { ...s, index: 0, cameFrom: null, playing: s.count > 1 };
    case "prev":
      return goTo(s, s.index - 1, false);
    case "next":
      return goTo(s, s.index + 1, false);
    case "last":
      return goTo(s, last, false);
    case "seek":
      return goTo(s, a.index, false);
    case "toggle":
      if (s.count === 0) return s;
      if (s.playing) return { ...s, playing: false };
      // Run at the last step restarts from step 0. Entering step 0 this way is a jump: no diff.
      if (s.index === last) return { ...s, index: 0, cameFrom: null, playing: s.count > 1 };
      return { ...s, playing: true };
    case "tick": {
      if (!s.playing) return s;
      if (s.index >= last) return { ...s, playing: false };
      const next = goTo(s, s.index + 1, true);
      // Stop by itself on reaching the last step.
      return next.index === last ? { ...next, playing: false } : next;
    }
  }
}

/** Milliseconds per step. 1× is 700 ms. */
export const BASE_TICK_MS = 700;
export const SPEEDS = [0.5, 1, 2] as const;
export type Speed = (typeof SPEEDS)[number];

export function tickMs(speed: Speed): number {
  return BASE_TICK_MS / speed;
}
