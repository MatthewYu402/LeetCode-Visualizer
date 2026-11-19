import { useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { LANGUAGES, type EditorLanguage } from "../editor/languages";
import { EXAMPLES, type Example } from "../home/examples";

interface Props {
  /** The editor's language: the tab the menu opens on. */
  language: EditorLanguage;
  /** The editor holds code the user changed: picking an example asks before replacing it. */
  dirty: boolean;
  onPick: (example: Example, language: EditorLanguage) => void;
}

/**
 * The top bar's Examples button and its menu (docs/frontend.md §10.2): C++, Python, and Java as
 * tabs, and under them the example problems, each labelled with its topic. Picking one opens it
 * in the sandbox in that tab's language, with its example in the inputs. When the editor holds
 * the user's own changes, a dialog asks before they are replaced. Escape or a click outside closes.
 */
export function ExamplesMenu({ language, dirty, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<EditorLanguage>(language);
  const [asking, setAsking] = useState<{ example: Example; language: EditorLanguage } | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();
  const tabs = LANGUAGES.filter((l) => l.runs);
  const tabLabel = tabs.find((l) => l.id === tab)?.label ?? "";

  useLayoutEffect(() => {
    if (!open) return;
    setTab(tabs.some((l) => l.id === language) ? language : "cpp");
    menu.current?.querySelector<HTMLButtonElement>('[role="tab"][aria-selected="true"]')?.focus();
  }, [open, language]); // `tabs` is the same list on every render

  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => {
      if (menu.current?.contains(e.target as Node) || button.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  const choose = (example: Example) => {
    setOpen(false);
    if (dirty) setAsking({ example, language: tab });
    else onPick(example, tab);
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      button.current?.focus();
      return;
    }
    const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight"];
    if (!keys.includes(e.key)) return;
    const target = e.target as HTMLElement;
    if (target.getAttribute("role") === "tab" && (e.key === "ArrowLeft" || e.key === "ArrowRight")) {
      e.preventDefault();
      const at = tabs.findIndex((l) => l.id === tab);
      const next = tabs[(at + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
      setTab(next.id);
      menu.current?.querySelector<HTMLButtonElement>(`[data-tab="${next.id}"]`)?.focus();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const items = [...(menu.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const at = items.indexOf(document.activeElement as HTMLButtonElement);
    items[(at + (e.key === "ArrowDown" ? 1 : items.length - 1 + (at < 0 ? 1 : 0))) % items.length]?.focus();
  };

  return (
    <div className="examples-wrap">
      <button
        ref={button}
        type="button"
        className={`control examples-button${open ? " is-open" : ""}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? id : undefined}
        title="Open an example problem in C++, Python, or Java"
        onClick={() => setOpen((o) => !o)}
      >
        <GridIcon />
        <span>Examples</span>
        <svg className="examples-chevron" aria-hidden="true" width="10" height="6" viewBox="0 0 10 6">
          <path d={open ? "M1 5l4-4 4 4" : "M1 1l4 4 4-4"} />
        </svg>
      </button>
      {open && (
        <div ref={menu} id={id} role="menu" aria-label="Examples" className="examples-menu" onKeyDown={onKey}>
          <div role="tablist" aria-label="Language" className="examples-tabs">
            {tabs.map((l) => (
              <button
                key={l.id}
                type="button"
                role="tab"
                data-tab={l.id}
                aria-selected={l.id === tab}
                tabIndex={l.id === tab ? 0 : -1}
                className="examples-tab"
                onClick={() => setTab(l.id)}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="examples-list">
            {EXAMPLES.map((e) => (
              <button key={e.slug} type="button" role="menuitem" className="examples-item" onClick={() => choose(e)}>
                <span className="examples-topic">{e.topic}</span>
                <span className="examples-name">{e.title}</span>
                <span className="examples-tags">{e.tags.join(" · ")}</span>
              </button>
            ))}
          </div>
          <p className="examples-foot">Opens the Solution in {tabLabel} with its example filled in.</p>
        </div>
      )}
      {asking && (
        <ReplaceDialog
          title={asking.example.title}
          onKeep={() => {
            setAsking(null);
            button.current?.focus();
          }}
          onReplace={() => {
            const a = asking;
            setAsking(null);
            onPick(a.example, a.language);
          }}
        />
      )}
    </div>
  );
}

/** Asks before an example replaces code the user changed. Escape keeps it. */
function ReplaceDialog({ title, onKeep, onReplace }: { title: string; onKeep: () => void; onReplace: () => void }) {
  const titleId = useId();
  const replace = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    replace.current?.focus();
  }, []);
  return (
    <div
      className="dialog-scrim"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onKeep();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="dialog"
        onKeyDown={(e) => {
          if (e.key === "Escape") {
            e.preventDefault();
            onKeep();
          }
        }}
      >
        <h2 id={titleId} className="dialog-title">
          Replace your code with {title}?
        </h2>
        <p className="dialog-text">The editor has code you changed. Opening the example replaces it and its inputs.</p>
        <div className="dialog-actions">
          <button type="button" className="control" onClick={onKeep}>
            Keep my code
          </button>
          <button ref={replace} type="button" className="control dialog-primary" onClick={onReplace}>
            Replace
          </button>
        </div>
      </div>
    </div>
  );
}

function GridIcon() {
  return (
    <svg className="icon-stroke" aria-hidden="true" width="15" height="15" viewBox="0 0 16 16">
      <rect x="2" y="2" width="5" height="5" rx="1.2" />
      <rect x="9" y="2" width="5" height="5" rx="1.2" />
      <rect x="2" y="9" width="5" height="5" rx="1.2" />
      <rect x="9" y="9" width="5" height="5" rx="1.2" />
    </svg>
  );
}
