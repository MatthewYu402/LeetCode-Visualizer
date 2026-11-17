import { useEffect, useState } from "react";

/** The trace line's points, rising left to right like the logo: a run stepping forward. */
const POINTS: [number, number][] = [
  [10, 46],
  [40, 26],
  [70, 38],
  [100, 14],
  [130, 24],
];

/**
 * The canvas while the sandbox makes a trace (docs/frontend.md §2): a line of trace points
 * drawing itself, point by point, on a loop; what the sandbox is doing; and the seconds since
 * Run code was pressed, so a slow run still visibly moves. The run is one request, so no stage
 * is named as current: the wording covers them all.
 */
export function RunningCanvas() {
  const seconds = useElapsedSeconds();
  const path = POINTS.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x} ${y}`).join(" ");
  return (
    <div className="canvas canvas-empty canvas-running" role="status">
      <svg className="running-trace" aria-hidden="true" width="140" height="60" viewBox="0 0 140 60">
        <path className="running-line" d={path} pathLength={100} />
        {POINTS.map(([x, y], i) => (
          <circle key={i} className="running-point" cx={x} cy={y} r={i === POINTS.length - 1 ? 5 : 4} style={{ animationDelay: `${i * 240}ms` }} />
        ))}
      </svg>
      <p className="empty-title">Running your code in the sandbox</p>
      <p className="empty-hint">
        Compiling it, tracing every step, and checking the trace
        {seconds >= 1 && (
          <span className="running-seconds" aria-hidden="true">
            {seconds} s
          </span>
        )}
      </p>
    </div>
  );
}

/** Whole seconds since the component mounted, updated each second. */
function useElapsedSeconds(): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const timer = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return seconds;
}
