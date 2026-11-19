#!/usr/bin/env python3
"""Compare traces of the same Solution in different languages, call by call.

Usage (from the repository root):
  python3 tools/compare_traces.py fixtures/two-sum.trace.json fixtures/two-sum.python.trace.json
  python3 tools/compare_traces.py --all            every fixture that has a twin in another language

`check_trace.py --like` says two traces have the same shape. This says how close
they are along the way. Steps cannot be paired one to one (C++ has declaration
lines and a step for each loop increment; Python has neither), so each trace is
read as calls: the nth call of each function, in the order the calls began. For
each pair of matching calls it compares

  values     each local's history: the values it took, in order, with repeats
             removed. A ref is shown as its object's type and `val` field
             (`ListNode(3)`, `null`), so ids do not matter; sets and maps are
             sorted; a stack and an array, and a queue and a deque, read the same
  reads      the cells and keys the call read: (target, at or key, value), in order
  stores     each store target's values, in order
  returns    the call's return value
  members    the history of each member of the Solution, over the whole run
  indexes    the trace's `indexes`

and the trace's calls (which functions, in which order). Every difference is
printed, with the first point where the two histories part. Some differences
come from the language, not the adapter: a local that exists in one language
only (a C++ iterator), a condition on a loop header that Python's `for` does
not have. Those are listed too; telling them from adapter bugs is the reader's
job, and docs/adapters/*.md records the ones that are expected.

Differences are of two sorts. Core ones must not happen between two adapters
tracing the same algorithm: the calls, each shared local's history, each call's
return value, `indexes`, and members. Details may come from how each language
writes the algorithm: a local in one language only, the stores and conditions a
loop's form makes (`for (int i = 0; i < n; ++i)` against `for i in range(n)`),
a store that a declaration without an initializer does not make, the reads that
different code makes. With --core, only core differences fail.

Exits 0 when nothing differs (with --core: nothing core), 1 otherwise.
"""

import argparse
import json
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
FIXTURES = ROOT / "fixtures"
SAME_KIND = {"stack": "array", "queue": "deque"}


def label(value, heap):
    """A value, comparable across languages: refs as `Type(val)`, ids dropped, unordered kinds sorted."""
    if not isinstance(value, dict):
        return value
    kind = value.get("kind")
    if kind == "ref":
        obj = heap.get(value["id"], {})
        fields = obj.get("fields", {})
        val = fields.get("val")
        return f"{obj.get('type', '?')}({json.dumps(label(val, {}))})"
    if kind in ("int", "float"):
        return f"{kind}:{value['value']}"
    if kind == "iterator":
        where = value.get("index", value.get("key", "end"))
        return f"iterator({value['container']}@{json.dumps(label(where, heap))})"
    if "entries" in value:
        entries = [[label(k, heap), label(v, heap)] for k, v in value["entries"]]
        if kind in ("map", "multimap"):
            entries.sort(key=json.dumps)
        return {"kind": "map", "entries": entries}
    if "items" in value:
        items = [label(x, heap) for x in value["items"]]
        if kind in ("set", "multiset"):
            items.sort(key=json.dumps)
        if kind == "priority-queue":
            items.sort(key=json.dumps)  # storage order is a heap's, not the language's
        return {"kind": SAME_KIND.get(kind, kind), "items": items}
    return {k: label(v, heap) for k, v in value.items() if k != "id"}


def target_name(text):
    """A store's target, spelled the same in every language: `curr->next` and `curr.next` are one,
    and so are `this->memo[n]`, `self.memo[n]`, and `memo[n]`."""
    text = text.replace("->", ".").replace(" ", "")
    for prefix in ("this.", "self."):
        if text.startswith(prefix):
            text = text[len(prefix):]
    return text


def history(values):
    out = []
    for v in values:
        if not out or out[-1] != v:
            out.append(v)
    return out


class Calls:
    """A trace, read as calls: (function, n) -> what that call did."""

    def __init__(self, doc):
        self.doc = doc
        self.order = []                      # (function, n), in the order calls began
        self.locals = defaultdict(lambda: defaultdict(list))
        self.reads = defaultdict(list)
        self.stores = defaultdict(lambda: defaultdict(list))
        self.conditions = defaultdict(list)
        self.returns = {}
        self.members = defaultdict(list)
        key_of = {}
        count = defaultdict(int)
        for step in doc["steps"]:
            heap = step.get("heap", {})
            for frame in step["frames"]:
                if frame["id"] not in key_of:
                    key = (frame["function"], count[frame["function"]])
                    count[frame["function"]] += 1
                    key_of[frame["id"]] = key
                    self.order.append(key)
            top = step["frames"][-1]
            key = key_of[top["id"]]
            for name, value in top["locals"].items():
                self.locals[key][name].append(label(value, heap))
            for o in top.get("outcomes", []):
                if o["kind"] == "read":
                    where = ("at", o["at"]) if "at" in o else ("key", label(o.get("key"), heap))
                    self.reads[key].append((o["target"], where, label(o["value"], heap)))
                elif o["kind"] == "store":
                    self.stores[key][target_name(o["target"])].append(label(o["value"], heap))
                elif o["kind"] == "condition":
                    self.conditions[key].append(o["value"])
            if "return_value" in top:
                self.returns[key] = label(top["return_value"], heap)
            for name, value in step.get("members", {}).items():
                self.members[name].append(label(value, heap))


def first_split(a, b):
    for i, (x, y) in enumerate(zip(a, b)):
        if x != y:
            return i
    return min(len(a), len(b))


def short(v, width=90):
    text = json.dumps(v, separators=(",", ":")) if not isinstance(v, str) else v
    return text if len(text) <= width else text[:width - 1] + "…"


def compare(path_a, path_b, out, core_only=False):
    a_doc = json.loads(Path(path_a).read_text(encoding="utf-8"))
    b_doc = json.loads(Path(path_b).read_text(encoding="utf-8"))
    a, b = Calls(a_doc), Calls(b_doc)
    la, lb = a_doc["language"], b_doc["language"]
    diffs = []
    core = []

    def note(where, what, is_core=False):
        diffs.append(f"  {'CORE ' if is_core else ''}{where}: {what}")
        if is_core:
            core.append(what)

    if a.order != b.order:
        i = first_split(a.order, b.order)
        note("calls", f"{la} {len(a.order)} calls, {lb} {len(b.order)}; first different call #{i}: "
                      f"{a.order[i] if i < len(a.order) else '-'} vs {b.order[i] if i < len(b.order) else '-'}", True)
    if a_doc.get("indexes", {}) != b_doc.get("indexes", {}):
        note("indexes", f"{la} {short(a_doc.get('indexes', {}))} vs {lb} {short(b_doc.get('indexes', {}))}", True)

    for key in [k for k in a.order if k in set(b.order)]:
        call = f"{key[0]}#{key[1]}"
        names_a, names_b = set(a.locals[key]), set(b.locals[key])
        for name in sorted(names_a - names_b):
            note(call, f"local {name!r} only in {la}")
        for name in sorted(names_b - names_a):
            note(call, f"local {name!r} only in {lb}")
        for name in sorted(names_a & names_b):
            ha, hb = history(a.locals[key][name]), history(b.locals[key][name])
            if ha != hb:
                i = first_split(ha, hb)
                note(call, f"{name} history differs at value {i}: {la} {short(ha[i] if i < len(ha) else '(ends)')} "
                           f"vs {lb} {short(hb[i] if i < len(hb) else '(ends)')}", True)
        if a.reads[key] != b.reads[key]:
            i = first_split(a.reads[key], b.reads[key])
            note(call, f"reads differ at read {i} ({len(a.reads[key])} in {la}, {len(b.reads[key])} in {lb}): "
                       f"{la} {short(a.reads[key][i] if i < len(a.reads[key]) else '(none)')} vs "
                       f"{lb} {short(b.reads[key][i] if i < len(b.reads[key]) else '(none)')}")
        for target in sorted(set(a.stores[key]) | set(b.stores[key])):
            sa, sb = a.stores[key].get(target, []), b.stores[key].get(target, [])
            if sa != sb:
                note(call, f"stores to {target!r}: {la} {short(sa)} vs {lb} {short(sb)}")
        if a.returns.get(key) != b.returns.get(key):
            note(call, f"returns {la} {short(a.returns.get(key))} vs {lb} {short(b.returns.get(key))}", True)
        if a.conditions[key] != b.conditions[key]:
            note(call, f"conditions: {la} {short(a.conditions[key])} vs {lb} {short(b.conditions[key])}")

    for name in sorted(set(a.members) | set(b.members)):
        ha, hb = history(a.members.get(name, [])), history(b.members.get(name, []))
        if ha != hb:
            note("members", f"{name}: {la} {short(ha)} vs {lb} {short(hb)}", True)

    title = f"{Path(path_a).name} ({la}, {len(a_doc['steps'])} steps) vs {Path(path_b).name} ({lb}, {len(b_doc['steps'])} steps)"
    print(title, file=out)
    print("\n".join(diffs) if diffs else "  no differences", file=out)
    return not core if core_only else not diffs


def twins():
    for golden in sorted(FIXTURES.glob("*.trace.json")):
        if golden.name.count(".") != 2:
            continue  # a twin, not the C++ golden
        stem = golden.name[:-len(".trace.json")]
        others = sorted(FIXTURES.glob(f"{stem}.*.trace.json"))
        for other in others:
            yield golden, other


def main():
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("traces", nargs="*", type=Path, help="two traces of the same Solution")
    parser.add_argument("--all", action="store_true", help="every fixture against its twins in other languages")
    parser.add_argument("--core", action="store_true", help="fail only on core differences (see above)")
    args = parser.parse_args()
    pairs = list(twins()) if args.all else [tuple(args.traces)]
    if not args.all and len(args.traces) != 2:
        parser.error("give two traces, or --all")
    ok = True
    for a, b in pairs:
        ok = compare(a, b, sys.stdout, args.core) and ok
        print()
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
