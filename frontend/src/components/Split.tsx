import { useRef, useState, type ReactNode, type PointerEvent, type KeyboardEvent } from "react";

interface Props {
  direction: "row" | "column";
  /** Initial size of the first pane, in percent. */
  initial: number;
  min?: number;
  max?: number;
  first: ReactNode;
  second: ReactNode;
  label: string;
}

/** Two panes with a draggable border between them. Size is UI state only and is not saved. */
export function Split({ direction, initial, min = 20, max = 80, first, second, label }: Props) {
  const [pct, setPct] = useState(initial);
  const box = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const clamp = (v: number) => Math.min(max, Math.max(min, v));

  const onDown = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = true;
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent<HTMLDivElement>) => {
    if (!dragging.current || !box.current) return;
    const r = box.current.getBoundingClientRect();
    const v = direction === "row" ? ((e.clientX - r.left) / r.width) * 100 : ((e.clientY - r.top) / r.height) * 100;
    setPct(clamp(v));
  };
  const onUp = (e: PointerEvent<HTMLDivElement>) => {
    dragging.current = false;
    e.currentTarget.releasePointerCapture(e.pointerId);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const dec = direction === "row" ? "ArrowLeft" : "ArrowUp";
    const inc = direction === "row" ? "ArrowRight" : "ArrowDown";
    if (e.key === dec || e.key === inc) {
      e.preventDefault();
      e.stopPropagation();
      setPct((p) => clamp(p + (e.key === inc ? 2 : -2)));
    }
  };

  return (
    <div ref={box} className={`split split-${direction}`}>
      <div className="split-pane" style={{ flexBasis: `${pct}%` }}>
        {first}
      </div>
      <div
        className="split-handle"
        role="separator"
        aria-orientation={direction === "row" ? "vertical" : "horizontal"}
        aria-label={label}
        aria-valuenow={Math.round(pct)}
        aria-valuemin={min}
        aria-valuemax={max}
        tabIndex={0}
        title="Drag to resize"
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={onUp}
        onKeyDown={onKey}
      />
      <div className="split-pane split-pane-rest">{second}</div>
    </div>
  );
}
