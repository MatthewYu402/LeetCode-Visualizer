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
  /** The names of those locals: the call's parameters. */
  params: string[];
  /** The arguments with their names: "root = 3, depth = 0". */
  named: string;
  /** The arguments a call-stack row shows: every one that is not a container (containers have cards of their own). */
  brief: string;
  /** The step where it returns (its return step), and what it returns. */
  returnStep?: number;
  returned?: string;
  /** True when its return step's return_value is null: a void call (or a null pointer returned). */
  returnedNull?: boolean;
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
          params: Object.keys(f.locals),
          named: Object.entries(f.locals).map(([n, v]) => `${n} = ${shortValue(v, step.heap)}`).join(", "),
          brief: Object.values(f.locals)
            .filter((v) => !isHolder(v))
            .map((v) => shortValue(v, step.heap))
            .join(", "),
        };
        calls.set(f.id, c);
        order.push(f.id);
        if (parent && calls.has(parent)) calls.get(parent)!.children.push(f.id);
        else roots.push(f.id);
      }
      c.last = i;
      if (isReturning(f) && c.returnStep === undefined) {
        c.returnStep = i;
        c.returnedNull = f.return_value === null;
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

/** A container: drawn as its own card, so a call-stack row leaves it out. */
function isHolder(v: Value): boolean {
  return v !== null && typeof v === "object" && ("items" in v || "entries" in v);
}

export type CallState = "current" | "returning" | "waiting" | "returned" | "base";

/**
 * Where a call stands at step `index`, or null if it has not begun yet.
 *   current    the running call
 *   returning  the running call, in its return step, after making calls of its own
 *   base       the running call, in its return step, having made none: a base case
 *   waiting    on the stack, waiting for a call it made
 *   returned   finished
 */
export function callState(c: Call, tree: CallTree, index: number, runningId: string): CallState | null {
  if (c.first > index) return null;
  if (c.id === runningId) {
    if (c.returnStep !== index) return "current";
    return c.children.some((id) => tree.calls.get(id)!.first <= index) ? "returning" : "base";
  }
  if (c.last >= index) return "waiting";
  return "returned";
}

/** True when the trace has a call made by another call: the recursion tree has something to show. */
export function hasNestedCalls(tree: CallTree): boolean {
  return [...tree.calls.values()].some((c) => c.parent !== null);
}

/**
 * Which card shows the calls (docs/frontend.md §6.6), or null when no call is made by another.
 *   "tree"   the calls return values their callers use (maxDepth, fib): the recursion card
 *   "stack"  every nested call returns nothing (a void dfs or backtrack that changes data
 *            structures instead): the call-stack card
 * A call returns nothing when its return step's return_value is null (spec §6, return steps).
 * Calls that never returned (a truncated run) say nothing either way.
 */
export function callsCardKind(tree: CallTree): "tree" | "stack" | null {
  const nested = [...tree.calls.values()].filter((c) => c.parent !== null);
  if (nested.length === 0) return null;
  const returned = nested.filter((c) => c.returnStep !== undefined);
  return returned.length > 0 && returned.every((c) => c.returnedNull) ? "stack" : "tree";
}

/**
 * The functions that return nothing: every one of their return steps has return_value null,
 * and, for the traced method, problem.returns says void when it says anything. A function that
 * returns a null pointer every time looks the same; that is rare enough to accept. Pure; a
 * function of the whole trace, computed once.
 */
export function voidFunctions(trace: Trace): Set<string> {
  const seen = new Map<string, boolean>();
  for (const step of trace.steps) {
    const f = step.frames[step.frames.length - 1];
    if (!isReturning(f)) continue;
    seen.set(f.function, (seen.get(f.function) ?? true) && f.return_value === null);
  }
  const declared = trace.problem.returns?.type;
  if (declared !== undefined) seen.set(trace.problem.method, declared === "void");
  return new Set([...seen].filter(([, v]) => v).map(([fn]) => fn));
}
