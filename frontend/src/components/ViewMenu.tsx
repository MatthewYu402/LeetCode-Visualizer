import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import type { Direction, View, ViewChoice, ViewOption } from "../render/views";

const DIRECTIONS: { id: Direction; label: string }[] = [
  { id: "none", label: "No direction" },
  { id: "forward", label: "[a, b] is a → b" },
  { id: "backward", label: "[a, b] is b → a" },
];

/**
 * The card header's "View" button and its menu (docs/frontend.md §5.3). Lists every drawing for
 * the value, the ones its shape does not allow dimmed with the reason; an edge list also gets the
 * direction of its pairs. The menu is fixed to the viewport, placed under the button, because a
 * card scrolls sideways and would clip it. Escape, Tab, or a click outside closes it.
 */
export function ViewMenu({ name, options, current, auto, fromHint, onPick }: { name: string; options: ViewOption[]; current: ViewChoice; auto: View; fromHint: boolean; onPick: (c: ViewChoice) => void }) {
  const [open, setOpen] = useState(false);
  const [place, setPlace] = useState<{ top: number; right: number } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const shown = options.find((o) => o.view === current.view) ?? options[0];

  useLayoutEffect(() => {
    if (!open || !button.current) return;
    const r = button.current.getBoundingClientRect();
    setPlace({ top: r.bottom + 6, right: Math.max(8, window.innerWidth - r.right) });
    menu.current?.querySelector<HTMLButtonElement>('[aria-checked="true"]:not([aria-disabled="true"])')?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (e.type === "mousedown" && (menu.current?.contains(e.target as Node) || button.current?.contains(e.target as Node))) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [open]);

  const pick = (c: ViewChoice) => {
    onPick(c);
    setOpen(false);
    button.current?.focus();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" || e.key === "Tab") {
      if (e.key === "Escape") e.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role^="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length]?.focus();
  };

  return (
    <>
      {current.view === auto && <span className="view-auto">{fromHint ? "auto, from the name" : "auto"}</span>}
      <button ref={button} type="button" className="view-button" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen((o) => !o)} aria-label={`View ${name} as: ${shown.label}`}>
        <span className="view-button-label">View</span>
        <span className="view-button-value">{shown.view === "kind" ? shown.label : shown.label.replace(/ \(.*\)$/, "")}</span>
        <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10">
          <path d="M2 3.5 5 6.5 8 3.5" />
        </svg>
      </button>
      {open && (
        <div ref={menu} id={id} role="menu" aria-label={`View ${name} as`} className="view-menu" style={place ? { top: place.top, right: place.right } : { visibility: "hidden" }} onKeyDown={onKey}>
          <span className="view-menu-title">View as</span>
          {options.map((o) => (
            <button
              key={o.view}
              type="button"
              role="menuitemradio"
              aria-checked={o.view === current.view}
              aria-disabled={!o.fits}
              className="view-item"
              onClick={() => o.fits && pick({ view: o.view, direction: current.direction })}
            >
              <span className="view-item-check" aria-hidden="true">
                {o.view === current.view ? "✓" : ""}
              </span>
              <span className="view-item-text">
                <span className="view-item-label">
                  {o.label}
                  {o.view === auto && <span className="view-item-auto"> · auto</span>}
                </span>
                <span className="view-item-note">{o.note}</span>
              </span>
            </button>
          ))}
          {current.view === "edge-list" && (
            <>
              <span className="view-menu-title">Direction</span>
              {DIRECTIONS.map((d) => (
                <button key={d.id} type="button" role="menuitemradio" aria-checked={(current.direction ?? "none") === d.id} className="view-item" onClick={() => pick({ view: "edge-list", direction: d.id })}>
                  <span className="view-item-check" aria-hidden="true">
                    {(current.direction ?? "none") === d.id ? "✓" : ""}
                  </span>
                  <span className="view-item-text">
                    <span className="view-item-label">{d.label}</span>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </>
  );
}
