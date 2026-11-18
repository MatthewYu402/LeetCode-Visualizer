import type { ReactElement } from "react";
import type { ValueDiff } from "../trace/diff";
import type { Hint, ObjectValue, Value } from "../trace/types";

export interface RenderContext {
  /** Every local in the step being drawn. Used for pointer markers. */
  locals: Record<string, Value>;
  /** The running function's entry in the trace's `indexes`: which locals index which containers. For pointer markers. */
  indexes?: Readonly<Record<string, readonly string[]>>;
  /** The step's heap, so an item that is a ref can show its node's value. */
  heap?: Record<string, ObjectValue>;
  /** The hint for this local, if it is a parameter that has one. */
  hint?: Hint;
  /** What this step did to the value ("push 3"), from its diff, for the header's chip (render/ops.ts). */
  op?: string | null;
  /**
   * Whether this local's 2D array has rows of different lengths at some step of the run
   * (raggedLocals, computed once per trace): then it is drawn as rows the whole time, never
   * switching between a grid and rows as it grows.
   */
  ragged?: boolean;
}

export interface RendererProps {
  name: string;
  value: Value;
  /** null on step 0, after a jump, and whenever no diff applies. Renderers must draw correctly without it. */
  diff: ValueDiff | null;
  ctx: RenderContext;
}

/** A pure function of its props for one step: no state, no access to other steps. */
export type Renderer = (props: RendererProps) => ReactElement;
