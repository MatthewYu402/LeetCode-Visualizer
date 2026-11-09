// Monaco setup: bundle it locally (no CDN), give it its base worker, and build the theme
// from the CSS variables in styles/theme.css so the editor and the page cannot drift apart.

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";
import EditorWorker from "monaco-editor/editor/editor.worker?worker";

// C++, Java and Python use Monarch tokenizers on the main thread. Only the base editor
// worker is needed (TypeScript, CSS, JSON, HTML language services are never started).
self.MonacoEnvironment = { getWorker: () => new EditorWorker() };
loader.config({ monaco });

export const THEME = "github-dark";
const TRANSPARENT = "#00000000";
export const MONO_FONT = "ui-monospace, SFMono-Regular, Menlo, monospace";

let defined = false;

/** A :root CSS variable from styles/theme.css, as hex (the only colour format Monaco accepts). */
export function cssVarHex(name: string): string {
  return toHex(getComputedStyle(document.documentElement).getPropertyValue(name));
}

/** Define the GitHub dark theme from the :root CSS variables. Safe to call more than once. */
export function defineTheme(m: typeof monaco): void {
  if (defined) return;
  defined = true;
  const v = cssVarHex;
  const bare = (name: string) => v(name).slice(1); // token rules take hex without '#'

  m.editor.defineTheme(THEME, {
    base: "vs-dark",
    inherit: true,
    rules: [
      { token: "", foreground: bare("--fg") },
      { token: "keyword", foreground: bare("--syntax-keyword") },
      { token: "string", foreground: bare("--syntax-string") },
      { token: "number", foreground: bare("--syntax-number") },
      { token: "comment", foreground: bare("--syntax-comment"), fontStyle: "italic" },
      { token: "type", foreground: bare("--syntax-type") },
      { token: "type.identifier", foreground: bare("--syntax-type") },
    ],
    colors: {
      "editor.background": v("--bg"),
      "editor.foreground": v("--fg"),
      "editorLineNumber.foreground": v("--fg-muted"),
      "editorLineNumber.activeForeground": v("--fg"),
      "editorCursor.foreground": v("--accent"),
      // Monaco's own cursor-line highlight is switched off: the only highlighted line is the trace's.
      "editor.lineHighlightBackground": TRANSPARENT,
      "editor.lineHighlightBorder": TRANSPARENT,
      "editor.selectionBackground": `${v("--accent")}55`,
      "editorIndentGuide.background1": v("--border"),
      "editorWidget.background": v("--bg-subtle"),
      "editorWidget.border": v("--border"),
      "scrollbarSlider.background": `${v("--border")}aa`,
    },
  });
}

/**
 * Monaco accepts only hex colours. Converts `#rgb`, `#rrggbb`, `#rrggbbaa`, and
 * `rgb(...)` / `rgba(...)` to `#rrggbb` or `#rrggbbaa`.
 */
export function toHex(color: string): string {
  const c = color.trim().toLowerCase();
  if (/^#[0-9a-f]{3}$/.test(c)) return `#${[...c.slice(1)].map((ch) => ch + ch).join("")}`;
  if (/^#[0-9a-f]{6}([0-9a-f]{2})?$/.test(c)) return c;
  const m = c.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (m) {
    const hex = (n: number) => Math.round(Math.min(255, Math.max(0, n))).toString(16).padStart(2, "0");
    const rgb = hex(+m[1]) + hex(+m[2]) + hex(+m[3]);
    if (m[4] === undefined) return `#${rgb}`;
    const a = m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
    return `#${rgb}${hex(a * 255)}`;
  }
  throw new Error(`Theme colour "${color}" is not hex or rgb(a). Check styles/theme.css.`);
}
