import { isTagged, type Hint, type Kind, type Value } from "../trace/types";
import { ArrayRenderer } from "./ArrayRenderer";
import { FallbackRenderer } from "./FallbackRenderer";
import { MapRenderer } from "./MapRenderer";
import { SequenceRenderer, SetRenderer } from "./SequenceRenderer";
import type { Renderer } from "./types";

/** Renderers chosen by hint. Empty in this version: grid, graph, intervals, ... come later. */
export const byHint: Partial<Record<Hint, Renderer>> = {};

/** Renderers chosen by kind. */
export const byKind: Partial<Record<Kind, Renderer>> = {
  array: ArrayRenderer,
  map: MapRenderer,
  multimap: MapRenderer,
  stack: SequenceRenderer,
  queue: SequenceRenderer,
  deque: SequenceRenderer,
  list: SequenceRenderer,
  tuple: SequenceRenderer,
  "priority-queue": SequenceRenderer,
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
  if (hint && byHint[hint]) return byHint[hint];
  if (isTagged(value) && byKind[value.kind]) return byKind[value.kind]!;
  return fallback;
}
