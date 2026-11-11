// TypeScript mirror of schema/trace.schema.json (trace format v0.4).
// Spec: docs/trace-format.md. When the spec changes, this file changes with it.

export type Primitive = string | number | boolean | null;

export interface TaggedInt {
  kind: "int";
  /** Decimal digits, outside ±(2^53 − 1). Never pass to Number(). */
  value: string;
}

export interface TaggedFloat {
  kind: "float";
  value: "NaN" | "Infinity" | "-Infinity";
}

/**
 * Kinds whose payload is `items`, a list of values. For set and multiset the order of
 * the list is unspecified (spec §8): nothing may depend on it.
 */
export type ItemsKind = "array" | "list" | "stack" | "queue" | "deque" | "tuple" | "set" | "multiset";

export interface ItemsValue {
  kind: ItemsKind;
  items: Value[];
}

export interface PriorityQueueValue {
  kind: "priority-queue";
  items: Value[];
  order: "max" | "min" | "custom";
}

/** map has unique keys; multimap may repeat them. Entry order is unspecified for both. */
export interface MapValue {
  kind: "map" | "multimap";
  entries: [Value, Value][];
}

export interface ObjectValue {
  kind: "object";
  type: string;
  fields: Record<string, Value>;
}

export interface RefValue {
  kind: "ref";
  id: string;
}

export type Tagged =
  | TaggedInt
  | TaggedFloat
  | ItemsValue
  | PriorityQueueValue
  | MapValue
  | ObjectValue
  | RefValue;

export type Value = Primitive | Tagged;

export type Kind = Tagged["kind"];

export type Hint =
  | "grid"
  | "adjacency-matrix"
  | "adjacency-list"
  | "edge-list"
  | "intervals"
  | "tree"
  | "linked-list"
  | "graph"
  | "priority-queue"
  | "stack"
  | "queue";

export interface Param {
  name: string;
  type: string;
  hint?: Hint;
}

export interface Problem {
  name?: string;
  method: string;
  params: Param[];
  input: Record<string, unknown>;
}

export interface Step {
  step: number;
  line: number;
  locals: Record<string, Value>;
  heap: Record<string, ObjectValue>;
}

export interface Trace {
  version: string;
  /** Informational only. Nothing in the frontend may read it (CLAUDE.md invariant 2). */
  language: string;
  problem: Problem;
  steps: Step[];
  /** Present only when the method returned. Absent means the run did not finish, never a wrong answer. */
  result?: Value;
  /** Present only as true. Absent means false. */
  truncated?: boolean;
}

/**
 * How the run ended (spec §3, Unfinished runs):
 *   returned   the method returned, so `result` is present (it may also be truncated)
 *   truncated  recording stopped at the step limit before the method returned
 *   stopped    the run ended early for another reason, such as a crash
 */
export type RunEnd = "returned" | "truncated" | "stopped";

export function runEnd(trace: Trace): RunEnd {
  if ("result" in trace && trace.result !== undefined) return "returned";
  return trace.truncated === true ? "truncated" : "stopped";
}

/** The page title: the problem's name when the trace has one, else its method name. */
export function problemTitle(problem: Problem): string {
  return typeof problem.name === "string" && problem.name.trim() !== "" ? problem.name : problem.method;
}

/** Kinds whose list order means nothing, and the field that holds the list. */
export const UNORDERED_KINDS = { set: "items", multiset: "items", map: "entries", multimap: "entries" } as const;

export function isUnorderedKind(kind: unknown): kind is keyof typeof UNORDERED_KINDS {
  return typeof kind === "string" && Object.hasOwn(UNORDERED_KINDS, kind);
}

export function isTagged(v: Value): v is Tagged {
  return typeof v === "object" && v !== null;
}

/** A container is any tagged value that is not a tagged number. These get drawn in the visual panel. */
export function isContainer(v: Value): v is Exclude<Tagged, TaggedInt | TaggedFloat> {
  return isTagged(v) && v.kind !== "int" && v.kind !== "float";
}

/** True for every kind whose payload is `items` (including priority-queue). */
export function hasItems(v: Value): v is ItemsValue | PriorityQueueValue {
  return isTagged(v) && "items" in v && Array.isArray(v.items);
}
