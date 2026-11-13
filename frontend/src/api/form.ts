// The input form's logic, kept out of the component so it can be tested in Node.
//
// A form shows one field per parameter of the chosen method, plus one per
// extra (such as `pos`), which may stay empty. The backend joins the values
// into LeetCode's example text, so the form sends them as typed.

import type { Method, RunRequest, Signature } from "./client";

export interface Field {
  name: string;
  /** The neutral type, such as "array<int>"; "" for an extra. */
  type: string;
  /** Extras may be left empty. */
  optional: boolean;
  /** An example of LeetCode's notation for this type, shown when the field is empty. */
  placeholder: string;
}

export function fieldsFor(method: Method | null): Field[] {
  if (!method || !method.readable) return [];
  return [
    ...method.params.map((p) => ({ name: p.name, type: p.type, optional: false, placeholder: placeholderFor(p.type) })),
    ...method.extras.map((name) => ({
      name,
      type: "",
      optional: true,
      placeholder: name === "pos" ? "-1 (index the tail links to; -1 for no cycle)" : "",
    })),
  ];
}

/** The method to show: the one chosen, if the Solution still has it, else the backend's pick. */
export function chooseMethod(signature: Signature, chosen: string | null): Method | null {
  const byName = (name: string | null) => signature.methods.find((m) => m.name === name) ?? null;
  return byName(chosen) ?? byName(signature.method);
}

/**
 * Values for a new set of fields: a value typed earlier is kept when a field of
 * the same name still exists, so editing the Solution does not clear the form.
 */
export function keepValues(fields: Field[], previous: Record<string, string>): Record<string, string> {
  return Object.fromEntries(fields.map((f) => [f.name, previous[f.name] ?? ""]));
}

/** What is still missing before Run can be pressed, or null when nothing is. */
export function missing(fields: Field[], values: Record<string, string>): string | null {
  const empty = fields.filter((f) => !f.optional && !(values[f.name] ?? "").trim()).map((f) => f.name);
  if (fields.length === 0) return "No method to run. Paste a Solution class.";
  return empty.length ? `Fill in ${empty.join(", ")}.` : null;
}

export function runRequest(source: string, method: Method, fields: Field[], values: Record<string, string>): RunRequest {
  return { source, method: method.name, fields: Object.fromEntries(fields.map((f) => [f.name, values[f.name] ?? ""])) };
}

/** LeetCode's notation for a value of this neutral type. */
export function placeholderFor(type: string): string {
  if (type === "int") return "9";
  if (type === "float") return "2.5";
  if (type === "bool") return "true";
  if (type === "char") return '"a"';
  if (type === "string") return '"abc"';
  if (type === "ListNode") return "[1,2,3,4,5]";
  if (type === "TreeNode") return "[3,9,20,null,null,15,7]";
  const inner = /^(array|list|deque|stack|queue|set|multiset|priority-queue)<(.*)>$/.exec(type);
  if (inner) {
    const item = inner[2];
    if (item.startsWith("array<")) return `[${placeholderFor(item)},${placeholderFor(item)}]`;
    if (item === "string") return '["ab","cd"]';
    if (item === "char") return '["a","b"]';
    if (item === "bool") return "[true,false]";
    if (item === "float") return "[1.5,2.5]";
    return "[1,2,3]";
  }
  // A commented node class (Node, ...): LeetCode's notation depends on the problem.
  return "";
}

/**
 * A pasted example's values, placed in the fields. By name when the names
 * match; otherwise, when none of the names match a parameter and the counts
 * are equal, in order (as the driver does for Clone Graph, whose example says
 * `adjList` but whose parameter is `node`).
 */
export function valuesFromExample(fields: Field[], example: Record<string, string>): Record<string, string> {
  const names = Object.keys(example);
  const params = fields.filter((f) => !f.optional);
  const byName = Object.fromEntries(fields.filter((f) => f.name in example).map((f) => [f.name, example[f.name]]));
  const anyMatch = params.some((f) => f.name in example);
  const extras = names.filter((n) => fields.some((f) => f.optional && f.name === n));
  const rest = names.filter((n) => !extras.includes(n));
  if (!anyMatch && rest.length === params.length) {
    return { ...byName, ...Object.fromEntries(params.map((f, i) => [f.name, example[rest[i]]])) };
  }
  return byName;
}
