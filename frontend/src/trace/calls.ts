// The recursion tree: every call of the run, and who called it (docs/frontend.md §6.6).
//
// A frame id belongs to one call for the whole run (spec §6), and the frame below a
// frame on the stack is its caller, so the whole call tree can be read from the
// steps once, when a trace is loaded. Drawing step N uses only what the tree says
// about step N: which calls had started by then, which are on the stack, and which
// had returned. Like the layout, this is computed from the whole trace once
// (frontend/CLAUDE.md rule 2); no step's drawing replays earlier steps.

import { nodeLabel, isRef } from "./heap";
import { formatValue } from "./format";
import { isReturning, type ObjectValue, type Trace, type Value } from "./types";

export interface Call {
  /** The frame id: one call. */
  id: string;
  fn: string;
  parent: string | null;
  children: string[];
  depth: number;
  /** The first and last step this call is on the stack. */
  first: number;
  last: number;
  /** The call's arguments: its locals on its first step, before any statement has run. */
  args: string;
  /** The step where it returns (its return step), and what it returns. */
  returnStep?: number;
  returned?: string;
}

export interface CallTree {
  calls: Map<string, Call>;
  roots: string[];
  /** Calls in the order they began. */
  order: string[];
}

/** Pure: a function of the whole trace, computed once when a trace is loaded. */
export function callTree(trace: Trace): CallTree {
  const calls = new Map<string, Call>();
  const roots: string[] = [];
  const order: string[] = [];
  trace.steps.forEach((step, i) => {
    step.frames.forEach((f, k) => {
      let c = calls.get(f.id);
      if (!c) {
        const parent = k > 0 ? step.frames[k - 1].id : null;
        c = {
          id: f.id,
          fn: f.function,
          parent,
          children: [],
          depth: k,
          first: i,
          last: i,
          args: Object.values(f.locals).map((v) => shortValue(v, step.heap)).join(", "),
        };
        calls.set(f.id, c);
        order.push(f.id);
        if (parent && calls.has(parent)) calls.get(parent)!.children.push(f.id);
        else roots.push(f.id);
      }
      c.last = i;
      if (isReturning(f) && c.returnStep === undefined) {
        c.returnStep = i;
        c.returned = f.return_value === null && trace.problem.returns?.type === "void" && k === 0 ? "void" : shortValue(f.return_value ?? null, step.heap);
      }
    });
  });
  return { calls, roots, order };
}

/** A value in a few characters: a ref shows its node's value, a container its size. */
export function shortValue(v: Value, heap: Record<string, ObjectValue>): string {
  if (isRef(v)) return heap[v.id] ? nodeLabel(heap[v.id]) : v.id;
  if (v !== null && typeof v === "object" && "items" in v) return `[${v.items.length}]`;
  if (v !== null && typeof v === "object" && "entries" in v) return `{${v.entries.length}}`;
  const text = formatValue(v);
  return text.length > 12 ? `${text.slice(0, 11)}…` : text;
}

export type CallState = "current" | "returning" | "waiting" | "returned" | "base";

/**
 * Where a call stands at step `index`, or null if it has not begun yet.
 *   current    the running call
 *   returning  the running call, in its return step
 *   waiting    on the stack, waiting for a call it made
 *   returned   finished, after calling others
 *   base       finished without calling anything: a base case
 */
export function callState(c: Call, tree: CallTree, index: number, runningId: string): CallState | null {
  if (c.first > index) return null;
  if (c.id === runningId) return c.returnStep === index ? "returning" : "current";
  if (c.last >= index) return "waiting";
  const madeCalls = c.children.some((id) => tree.calls.get(id)!.first <= index);
  return madeCalls ? "returned" : "base";
}

/** True when the trace has a call made by another call: the recursion tree has something to show. */
export function hasNestedCalls(tree: CallTree): boolean {
  return [...tree.calls.values()].some((c) => c.parent !== null);
}
