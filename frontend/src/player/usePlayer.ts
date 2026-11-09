import { useEffect, useReducer, useState } from "react";
import { initialPlayer, playerReducer, tickMs, type Speed } from "./playback";

/** Playback for a trace with `count` steps. Resets to step 0 whenever `count` or `resetKey` changes. */
export function usePlayer(count: number, resetKey: unknown) {
  const [state, dispatch] = useReducer(playerReducer, count, initialPlayer);
  const [speed, setSpeed] = useState<Speed>(1);

  useEffect(() => {
    dispatch({ type: "reset", count });
  }, [count, resetKey]);

  // One timeout per displayed step while playing. Re-armed on every index or speed change.
  useEffect(() => {
    if (!state.playing) return;
    const id = window.setTimeout(() => dispatch({ type: "tick" }), tickMs(speed));
    return () => window.clearTimeout(id);
  }, [state.playing, state.index, speed]);

  return { state, dispatch, speed, setSpeed };
}
