import { useLayoutEffect, useRef, type ReactNode } from "react";
import type { Change } from "../trace/diff";
import { readsOf, type Trace } from "../trace/types";
import { diffClass, PointerRow } from "./ArrayRenderer";
import { CardHeader, Empty } from "./Card";
import { pointersFor } from "./pointers";
import { readsFrom } from "./reads";
import type { RendererProps } from "./types";

/** A string's cell width, in px: narrower than an array's, so Valid Palindrome's 30 characters fit on most canvases. */
export const CHAR_PX = 26;

/** What a character looks like in its cell. A space and the other blanks get a visible mark, dimmed, so a cell is never empty. */
const MARKS: Record<string, string> = { " ": "␣", "\t": "⇥", "\n": "↵", "\r": "␍" };

/**
 * string (docs/frontend.md §5.1, Strings). A string local is a bare JSON string in the trace; it is
 * drawn like a 1D array of characters: one joined strip of bare letters, the index under each, and
 * the locals that index it (`left`, `right`) as pointer tags under those. A character the running
 * line read (`s[left]`, a v0.11 `read` outcome) is outlined. Long strings scroll sideways, and the
 * strip scrolls itself to keep the pointers and the read characters in view.
 */
export function StringRenderer({ name, value, diff, ctx }: RendererProps) {
  if (typeof value !== "string") throw new Error(`StringRenderer got a ${typeof value} value for ${name}`);
  const chars = [...value];
  const reads = readsFrom(ctx.reads);
  const pointers = pointersFor(ctx.locals, chars.length, name, ctx.indexes, ctx.steady);
  const changes = charChanges(chars, diff?.prev);
  const removed = typeof diff?.prev === "string" ? [...diff.prev].slice(chars.length) : [];
  const read = chars.flatMap((_, i) => (reads.at(i) ? [i] : []));
  const focus = [...pointers.map((p) => p.index), ...read];
  return (
    <section className="structure structure-string" aria-label={`${name}: string`}>
      <CardHeader name={name} meta={`string · ${chars.length}`} op={ctx.op} />
      {chars.length === 0 && removed.length === 0 ? (
        <Empty />
      ) : (
        <FollowScroll focus={focus} read={read}>
          <div className="array string" style={{ ["--cell" as string]: `${CHAR_PX}px` }}>
            <div className="array-strip">
              {chars.map((c, i) => (
                <Char key={i} c={c} className={`${diffClass(changes[i])}${reads.at(i) ? " is-read" : ""}`} title={`${name}[${i}] = ${JSON.stringify(c)}`} />
              ))}
              {removed.map((c, k) => (
                <Char key={`removed-${k}`} c={c} className="diff-removed" />
              ))}
            </div>
            <div className="array-indexes" aria-hidden="true">
              {[...chars, ...removed].map((_, i) => (
                <span key={i} className="cell-index">
                  {i}
                </span>
              ))}
            </div>
            <PointerRow pointers={pointers} step={CHAR_PX} />
          </div>
        </FollowScroll>
      )}
    </section>
  );
}

function Char({ c, className, title }: { c: string; className: string; title?: string }) {
  const mark = MARKS[c];
  return (
    <div className={`cell ${className}`} title={title}>
      {mark ? <span className="char-mark">{mark}</span> : c}
    </div>
  );
}

/** Per character, from the diff's previous string: added past its end, changed where it differs. */
function charChanges(chars: string[], prev: unknown): (Change | undefined)[] {
  if (typeof prev !== "string") return [];
  const before = [...prev];
  return chars.map((c, i) => (i >= before.length ? "added" : before[i] !== c ? "changed" : undefined));
}

/**
 * A strip that scrolls sideways when it is wider than the card, and scrolls itself to keep in view
 * the pointers and the characters read (`focus`). When they do not all fit (`left` at 0 and `right`
 * at 29 on a narrow canvas), the characters the line read win, since they are what it looks at.
 * Only the scroll position is touched: what is drawn is still the step alone.
 */
function FollowScroll({ focus, read, children }: { focus: number[]; read: number[]; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = `${focus.join(",")}|${read.join(",")}`;
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || focus.length === 0 || el.scrollWidth <= el.clientWidth) return;
    const margin = CHAR_PX * 2;
    const span = (cells: number[]) => ({ lo: Math.min(...cells) * CHAR_PX - margin, hi: (Math.max(...cells) + 1) * CHAR_PX + margin });
    const fits = (cells: number[]) => cells.length > 0 && span(cells).hi - span(cells).lo <= el.clientWidth;
    const target = fits(focus) ? focus : fits(read) ? read : read.length > 0 ? [read[0]] : [focus[0]];
    const { lo, hi } = span(target);
    if (lo >= el.scrollLeft && hi <= el.scrollLeft + el.clientWidth) return;
    const reduce = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    el.scrollTo({ left: Math.max(0, (lo + hi) / 2 - el.clientWidth / 2), behavior: reduce ? "auto" : "smooth" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return (
    <div className="string-scroll" ref={ref}>
      {children}
    </div>
  );
}

/**
 * The locals, as "function/name", that are strings and get a card. A trace writes a `char` and a
 * one-character string the same way (spec §4: only the type tells them apart), so a bare string is
 * a string local when the trace shows it is one at some step of the run: its length is not 1, a
 * parameter of type `string`, a local that `indexes` says some integer subscripts, or the target of
 * a `read`. Computed once per trace, like raggedLocals, so a string keeps its card when it is
 * one character long for a while ("" then "a" then "ab"). A char is never any of these.
 */
export function stringLocals(trace: Trace): Set<string> {
  const out = new Set<string>();
  // Members are keyed "#members/name": a member string is a string by the same rules, minus the parameter one.
  for (const step of trace.steps) {
    const indexed = new Set(step.frames.flatMap((f) => Object.values(trace.indexes?.[f.function] ?? {}).flat()));
    const read = new Set(step.frames.flatMap((f) => [...readsOf(f).keys()]));
    for (const [name, v] of Object.entries(step.members ?? {}))
      if (typeof v === "string" && ([...v].length !== 1 || indexed.has(name) || read.has(name))) out.add(`#members/${name}`);
  }
  const stringParams = new Set(trace.problem.params.filter((p) => p.type === "string").map((p) => p.name));
  for (const step of trace.steps) {
    for (const frame of step.frames) {
      const indexed = new Set(Object.values(trace.indexes?.[frame.function] ?? {}).flat());
      const read = readsOf(frame);
      for (const [name, v] of Object.entries(frame.locals)) {
        if (typeof v !== "string") continue;
        const isParam = frame.function === trace.problem.method && stringParams.has(name);
        if ([...v].length !== 1 || isParam || indexed.has(name) || read.has(name)) out.add(`${frame.function}/${name}`);
      }
    }
  }
  return out;
}
