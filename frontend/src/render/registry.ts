import { isTagged, type Hint, type Kind, type Value } from "../trace/types";
import { ArrayRenderer } from "./ArrayRenderer";
import { FallbackRenderer } from "./FallbackRenderer";
import { GraphRowsRenderer } from "./GraphRowsRenderer";
import { IntervalsRenderer } from "./IntervalsRenderer";
import { HeapRenderer } from "./HeapRenderer";
import { MapRenderer, MultimapRenderer } from "./MapRenderer";
import { ListRenderer, SetRenderer, StackRenderer, TubeRenderer, TupleRenderer } from "./SequenceRenderer";
import { StringRenderer } from "./StringRenderer";
import type { Renderer } from "./types";
import { fits, viewOfHint } from "./views";

/** Renderers chosen by hint (docs/frontend.md §5.3). `grid` is drawn by kind: a 2D array whose rows match is a grid already. */
export const byHint: Partial<Record<Hint, Renderer>> = {
  "adjacency-list": GraphRowsRenderer,
  "edge-list": GraphRowsRenderer,
  "adjacency-matrix": GraphRowsRenderer,
  intervals: IntervalsRenderer,
};

/** Renderers chosen by kind. */
export const byKind: Partial<Record<Kind, Renderer>> = {
  array: ArrayRenderer,
  map: MapRenderer,
  multimap: MultimapRenderer,
  stack: StackRenderer,
  queue: TubeRenderer,
  deque: TubeRenderer,
  list: ListRenderer,
  tuple: TupleRenderer,
  "priority-queue": HeapRenderer,
  set: SetRenderer,
  multiset: SetRenderer,
};
// object and ref are not here: linked structures are drawn together, from the
// step's heap, by HeapView (render/HeapView.tsx), not one local at a time.

export const fallback: Renderer = FallbackRenderer;

/**
 * Selection order: hint, then kind, then the generic fallback. First match wins.
 * Never reads the trace's language.
 */
export function selectRenderer(value: Value, hint?: Hint): Renderer {
  // A hint draws only a value it fits at this step; otherwise the drawing by kind, never a crash.
  const view = viewOfHint(hint);
  if (hint && byHint[hint] && view && fits(view, value)) return byHint[hint];
  if (isTagged(value) && byKind[value.kind]) return byKind[value.kind]!;
  // A bare string reaches here only when VisualPanel decided it is a string local (stringLocals).
  if (typeof value === "string") return StringRenderer;
  return fallback;
}
