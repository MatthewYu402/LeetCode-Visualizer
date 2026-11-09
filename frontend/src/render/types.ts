import type { ReactElement } from "react";
import type { ValueDiff } from "../trace/diff";
import type { Hint, Value } from "../trace/types";

export interface RenderContext {
  /** Every local in the step being drawn. Used for pointer markers. */
  locals: Record<string, Value>;
  /** The hint for this local, if it is a parameter that has one. */
  hint?: Hint;
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
