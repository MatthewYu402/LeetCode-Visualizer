import Editor, { type OnMount } from "@monaco-editor/react";
import type * as monacoNs from "monaco-editor";
import { useEffect, useRef } from "react";
import { cssVarHex, defineTheme, MONO_FONT, THEME } from "../editor/monaco";

interface Props {
  source: string;
  /** Monaco language id. */
  language: string;
  /** 1-based line about to execute, or null when there is no trace. */
  line: number | null;
  onChange: (source: string) => void;
  /** Cmd/Ctrl + Enter inside the editor runs the code, as it does anywhere on the page. */
  onRun: () => void;
}

/** Monaco with the current step's line highlighted (background + gutter marker) and kept in view. */
export function CodePanel({ source, language, line, onChange, onRun }: Props) {
  const editorRef = useRef<monacoNs.editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<typeof monacoNs | null>(null);
  const decorations = useRef<monacoNs.editor.IEditorDecorationsCollection | null>(null);
  // The command is registered once, so it calls the latest onRun through a ref.
  const runRef = useRef(onRun);
  runRef.current = onRun;

  const highlight = () => {
    const ed = editorRef.current;
    const m = monacoRef.current;
    if (!ed || !m) return;
    decorations.current ??= ed.createDecorationsCollection();
    const lineCount = ed.getModel()?.getLineCount() ?? 0;
    if (line === null || line < 1 || line > lineCount) {
      decorations.current.clear();
      return;
    }
    decorations.current.set([
      {
        range: new m.Range(line, 1, line, 1),
        options: {
          isWholeLine: true,
          className: "trace-line",
          linesDecorationsClassName: "trace-line-gutter",
          overviewRuler: { color: cssVarHex("--accent"), position: m.editor.OverviewRulerLane.Full },
        },
      },
    ]);
    ed.revealLineInCenterIfOutsideViewport(line, m.editor.ScrollType.Smooth);
  };

  const onMount: OnMount = (ed, m) => {
    editorRef.current = ed;
    monacoRef.current = m;
    // Monaco's own Ctrl+Enter inserts a line; on this page it runs the code.
    ed.addCommand(m.KeyMod.CtrlCmd | m.KeyCode.Enter, () => runRef.current());
    // Geist Mono loads after the editor measured its glyphs; measure again so the cursor lines up.
    void document.fonts?.ready.then(() => m.editor.remeasureFonts());
    highlight();
  };

  // Re-apply on every step, and after the source changes (a language switch replaces the model's text).
  useEffect(highlight, [line, source]);

  return (
    <div className="code-panel">
      <Editor
        value={source}
        language={language}
        theme={THEME}
        beforeMount={defineTheme}
        onMount={onMount}
        onChange={(v) => onChange(v ?? "")}
        options={{
          fontFamily: MONO_FONT,
          fontSize: 13,
          lineHeight: 22,
          minimap: { enabled: false },
          // Calm code: one highlighted line, no coloured bracket pairs, no ruler border.
          bracketPairColorization: { enabled: false },
          guides: { bracketPairs: false, indentation: true },
          overviewRulerBorder: false,
          hideCursorInOverviewRuler: true,
          scrollBeyondLastLine: false,
          automaticLayout: true,
          renderLineHighlight: "none",
          glyphMargin: false,
          lineDecorationsWidth: 10,
          padding: { top: 10 },
          tabSize: 4,
        }}
        loading={<div className="notice">Loading editor…</div>}
      />
    </div>
  );
}
