import type { ReactElement } from "react";
import type { ValueDiff } from "../trace/diff";
import type { Hint, ObjectValue, Value } from "../trace/types";

export interface RenderContext {
  /** Every local in the step being drawn. Used for pointer markers. */
  locals: Record<string, Value>;
  /** The step's heap, so an item that is a ref can show its node's value. */
  heap?: Record<string, ObjectValue>;
  /** The hint for this local, if it is a parameter that has one. */
  hint?: Hint;
  /** What this step did to the value ("push 3"), from its diff, for the header's chip (render/ops.ts). */
  op?: string | null;
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
