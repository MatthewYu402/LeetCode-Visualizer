import { hasItems, isTagged, type Hint, type Value } from "../trace/types";

/**
 * "View as" (docs/frontend.md §5.3): the drawings a 2D array can be switched between. `kind` is
 * the drawing by kind (a grid, or rows), always available; the others are hints the frontend can
 * draw, each only when the value's shape allows it. Which one a card starts on is the parameter's
 * hint from the adapter when it fits, else `kind`; the reader picks another in the card's menu.
 */
export type View = "kind" | "adjacency-list" | "edge-list" | "adjacency-matrix" | "intervals";

/** Which way an edge list's pairs point: [a, b] as a → b, as b → a, or no direction. */
export type Direction = "forward" | "backward" | "none";

export interface ViewChoice {
  view: View;
  direction?: Direction;
}

export interface ViewOption {
  view: View;
  label: string;
  /** What the drawing shows when it fits, or why it does not. */
  note: string;
  fits: boolean;
}

/** A tuple of plain numbers (a C++ pair<int, int>), as its numbers, or null. */
function tupleNumbers(v: Value): number[] | null {
  if (!isTagged(v) || v.kind !== "tuple" || !v.items.every((x) => typeof x === "number")) return null;
  return v.items as number[];
}

/**
 * A value read as an adjacency list: for each row, its entries as a node it points to and an
 * optional weight. A row's entries are all plain numbers (`graph[u] = [v, ...]`) or all pairs
 * (`graph[u] = [(v, w), ...]`, Network Delay Time's weighted graph). Null for anything else.
 */
export function adjacencyOf(value: Value): { to: number; weight?: number }[][] | null {
  if (!hasItems(value) || !isTagged(value) || value.kind !== "array" || value.items.length === 0) return null;
  const out: { to: number; weight?: number }[][] = [];
  for (const row of value.items) {
    if (!isTagged(row) || row.kind !== "array") return null;
    const entries: { to: number; weight?: number }[] = [];
    for (const item of row.items) {
      if (typeof item === "number") entries.push({ to: item });
      else {
        const t = tupleNumbers(item);
        if (!t || t.length !== 2) return null;
        entries.push({ to: t[0], weight: t[1] });
      }
    }
    out.push(entries);
  }
  return out;
}

/** A value read as an edge list: rows of numbers, or a 1D array of pairs or triples (`vector<pair<int, int>> edges`). */
export function pairsOf(value: Value): number[][] | null {
  const rows = numberRows(value);
  if (rows) return rows;
  if (!hasItems(value) || !isTagged(value) || value.kind !== "array" || value.items.length === 0) return null;
  const out: number[][] = [];
  for (const item of value.items) {
    const t = tupleNumbers(item);
    if (!t) return null;
    out.push(t);
  }
  return out;
}

/** The rows of a 2D array of plain numbers, or null. */
export function numberRows(value: Value): number[][] | null {
  if (!hasItems(value) || !isTagged(value) || value.kind !== "array" || value.items.length === 0) return null;
  const rows: number[][] = [];
  for (const item of value.items) {
    if (!isTagged(item) || item.kind !== "array") return null;
    if (!item.items.every((v) => typeof v === "number")) return null;
    rows.push(item.items as number[]);
  }
  return rows;
}

function isNode(v: number, n?: number): boolean {
  return Number.isInteger(v) && v >= 0 && (n === undefined || v < n);
}

/** Whether `view` can draw `value` at this step. `kind` always can. */
export function fits(view: View, value: Value): boolean {
  if (view === "kind") return true;
  if (view === "adjacency-list") {
    const adj = adjacencyOf(value);
    return adj !== null && adj.every((r) => r.every((e) => isNode(e.to, adj.length)));
  }
  if (view === "edge-list") {
    const pairs = pairsOf(value);
    if (!pairs) return false;
    const width = pairs[0].length;
    return (width === 2 || width === 3) && pairs.every((r) => r.length === width && isNode(r[0]) && isNode(r[1]));
  }
  const rows = numberRows(value);
  if (!rows) return false;
  const n = rows.length;
  if (view === "adjacency-matrix") return rows.every((r) => r.length === n && r.every((v) => v === 0 || v === 1));
  return rows.every((r) => r.length === 2 && r[0] <= r[1]);
}

/** The view a hint asks for, when the frontend has a drawing for it. */
export function viewOfHint(hint: Hint | undefined): View | null {
  return hint === "adjacency-list" || hint === "edge-list" || hint === "adjacency-matrix" || hint === "intervals" ? hint : null;
}

/** The view a card starts on: the hint's when it fits this value, else the drawing by kind. */
export function autoView(value: Value, hint: Hint | undefined): View {
  const fromHint = viewOfHint(hint);
  return fromHint && fits(fromHint, value) ? fromHint : "kind";
}

/**
 * The menu's options for a value: every drawing, with whether it fits and why. Empty for a value
 * that is not a 2D array of numbers, and for one only the drawing by kind fits, so such a card
 * gets no View button (docs/frontend.md §5.3).
 */
export function viewOptions(value: Value, kindLabel: string): ViewOption[] {
  if (!numberRows(value) && !adjacencyOf(value) && !pairsOf(value)) return [];
  const options: ViewOption[] = [
    { view: "kind", label: kindLabel, note: kindLabel === "Grid" ? "Rows and columns, as the array is" : kindLabel === "Rows" ? "One strip per row, as the array is" : "One strip, as the array is", fits: true },
    { view: "adjacency-list", label: "Graph (adjacency list)", note: "Row i lists the nodes i points to, or (node, weight) pairs", fits: fits("adjacency-list", value) },
    { view: "edge-list", label: "Graph (edge list)", note: "Each row is an edge [u, v], or [u, v, weight]", fits: fits("edge-list", value) },
    { view: "adjacency-matrix", label: "Graph (adjacency matrix)", note: "A cell [i][j] that is 1 is an edge i to j", fits: fits("adjacency-matrix", value) },
    { view: "intervals", label: "Intervals", note: "Each row is [start, end] on a number line", fits: fits("intervals", value) },
  ];
  const why: Record<View, string> = {
    kind: "",
    "adjacency-list": "Needs every value to be a row's index",
    "edge-list": "Needs every row to be [u, v] or [u, v, w]",
    "adjacency-matrix": "Needs a square of 0s and 1s",
    intervals: "Needs every row to be [start, end]",
  };
  for (const o of options) if (!o.fits) o.note = why[o.view];
  return options.filter((o) => o.fits).length > 1 ? options : [];
}

/** The hint a view draws with: what the registry picks a renderer by. */
export function hintOfView(view: View): Hint | undefined {
  return view === "kind" ? undefined : view;
}
