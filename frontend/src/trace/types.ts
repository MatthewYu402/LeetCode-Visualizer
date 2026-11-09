// TypeScript mirror of schema/trace.schema.json (trace format v0.2).
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

/** Kinds whose payload is `items`, an ordered list of values. */
export type ItemsKind = "array" | "list" | "stack" | "queue" | "deque" | "tuple" | "set";

export interface ItemsValue {
  kind: ItemsKind;
  items: Value[];
}

export interface PriorityQueueValue {
  kind: "priority-queue";
  items: Value[];
  order: "max" | "min" | "custom";
}

export interface MapValue {
  kind: "map";
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
  result: Value;
  truncated?: boolean;
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
