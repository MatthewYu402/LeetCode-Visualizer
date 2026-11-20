#!/usr/bin/env python3
"""Check one or more trace files against the trace format.

Usage (from the repository root):
  python3 tools/check_trace.py fixtures/*.trace.json
  python3 tools/check_trace.py --equals fixtures/two-sum.trace.json out.json
  python3 tools/check_trace.py --expect-truncated out.json
  python3 tools/check_trace.py --expect-result-heap out.json
  python3 tools/check_trace.py --expect-void out.json

Every file is always:
  - loaded as JSON, rejecting the bare tokens NaN, Infinity and -Infinity,
    which Python's json module accepts by default
  - validated against schema/trace.schema.json
  - checked for what the schema cannot express:
      refs: every ref in a step (in any frame's locals or return_value) names
        an object in that step's heap, and every ref in the result names an
        object in result_heap
      iterators: an iterator's container names a local of its frame, and its
        position fits it (an index inside an array, list, deque, or string; a
        key present in a map, multimap, set, or multiset)
      frames: only the top frame has return_value or outcomes, and never
        both; frame ids are unique in a step; an id keeps one function name
        for the whole run, and never comes back after its call returned
      reads: a read outcome names a local of its frame, of a kind that is read
        that way: `at` on an array or deque at every level, or a string at the
        last level (`s[i]`, `words[i][j]`), `key` on a map, multimap, set, or
        multiset. The target is a local of the frame or, when no local has its
        name, one of the step's members. Positions and keys are not checked against the
        step's locals, which are from before the line ran: a line can read a cell
        it made (`m[k]` inserts a missing key)
      indexes: every function named in "indexes" ran (a frame has that
        function), unless the trace is truncated, and no local is listed as
        indexing itself. Whether the locals appear in its frames is not
        checked: an index declared in a loop that never runs never does
      shared containers (since v0.14): a container id appears at two or more
        places in its step (frames' locals and return values, members, inside
        other values, objects' fields in the heap), or in the result and
        result_heap; every place has the same kind and contents; it is never
        an object's id there; it keeps one kind for the whole run; and no
        outcome's value carries one

Options add checks:
  --equals FIXTURE    the parsed trace must equal the parsed fixture. The
                      items of set and multiset and the entries of map and
                      multimap are compared in any order, because their
                      order is unspecified (trace-format.md). Everything
                      else, including types (1 is not 1.0 or true), must match.
  --like FIXTURE      the trace is structurally equivalent to FIXTURE, a trace of
                      the same solution in another language: the same problem
                      (method, parameters, types), the same result (refs followed,
                      object ids and container ids ignored, sets and maps in any
                      order), the same ending, the same functions and object types,
                      and, for each local both traces have in a function, kinds
                      that agree. A Python list may stand for a C++ stack, and a
                      deque or list for a queue. Steps, lines, and values differ.
  --expect-truncated  "truncated" is true, "truncated_by" is "steps", "result" is
                      absent, and there are exactly 2000 steps numbered 0 to 1999.
  --expect-truncated-size
                      "truncated" is true, "truncated_by" is "size", "result" is
                      absent, and fewer steps, numbered from 0, whose JSON text
                      fits in the 10 MB budget.
  --expect-result-heap  "result" contains a ref and "result_heap" is present.
  --expect-void       problem.returns.type is "void" and "result" is null.

Prints one verdict line per file (OK or FAIL, with the reason) and a summary.
Exits 0 if every file passed, 1 if any failed, 2 on bad arguments.
Needs the jsonschema package (pip install jsonschema).
"""

import argparse
import json
import sys
from pathlib import Path

try:
    from jsonschema import Draft202012Validator
    from jsonschema.validators import extend
except ImportError:
    sys.exit("check_trace: the jsonschema package is missing (pip install jsonschema)")

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema" / "trace.schema.json"
STEP_CAP = 2000
SIZE_BUDGET = 10 * 1024 * 1024   # characters of the steps' JSON text (spec §6, Limits)
# Kinds whose list holds no meaningful order, and the field that holds it.
UNORDERED = {"set": "items", "multiset": "items", "map": "entries", "multimap": "entries"}
# At most this many schema errors are printed per file.
MAX_ERRORS = 10


class CheckError(Exception):
    """A file failed a check. The message is the reason."""


# ---- fast schema validation ----------------------------------------------------------
#
# Every step repeats every value (snapshots), so a trace of a large input holds the same
# 3,000-number array hundreds of times, and validating it value by value took minutes
# (jsonschema resolves a $ref per value). Two things make it fast without changing what
# is checked:
#   - share(): equal subtrees of the document become one object, bottom up, in one pass.
#   - the validator remembers which objects it already found to be a valid `value`, and
#     skips them; and $refs into $defs are replaced by the definitions themselves.
# A value's validity depends only on the value (the `value` definition has no context),
# so checking each distinct value once checks them all.


def share(doc):
    """Makes equal lists and dicts in `doc` one object each (in place), and returns it."""
    seen = {}

    def walk(v):
        if isinstance(v, list):
            for i, x in enumerate(v):
                v[i] = walk(x)
            key = ("L", tuple(_key(x) for x in v))
        elif isinstance(v, dict):
            for k in v:
                v[k] = walk(v[k])
            key = ("D", tuple((k, _key(x)) for k, x in v.items()))
        else:
            return v
        return seen.setdefault(key, v)

    return walk(doc)


def _key(x):
    # A shared list or dict is named by its identity; a primitive by its type and value,
    # so 1, 1.0, and True stay apart.
    return id(x) if isinstance(x, (list, dict)) else (type(x).__name__, x)


def _inline(schema):
    """The schema with each bare {"$ref": "#/$defs/x"} replaced by the definition object."""
    defs = schema.get("$defs", {})
    done = set()

    def target(v):
        if isinstance(v, dict) and set(v) == {"$ref"} and isinstance(v["$ref"], str) and v["$ref"].startswith("#/$defs/"):
            return defs.get(v["$ref"][len("#/$defs/"):])
        return None

    def walk(node):
        if id(node) in done:
            return
        done.add(id(node))
        pairs = node.items() if isinstance(node, dict) else enumerate(node) if isinstance(node, list) else ()
        for k, v in list(pairs):
            t = target(v)
            if t is not None:
                node[k] = t
                v = t
            walk(v)

    walk(schema)
    return schema


def make_validator(schema):
    """A validator for `schema` that checks each distinct value once (see share())."""
    schema = _inline(json.loads(json.dumps(schema)))
    value = schema.get("$defs", {}).get("value")
    base = Draft202012Validator.VALIDATORS
    valid = set()

    def remembering(keyword):
        check = base[keyword]

        def run(validator, argument, instance, sub):
            if sub is not value or not isinstance(instance, (list, dict)):
                yield from check(validator, argument, instance, sub)
                return
            if id(instance) in valid:
                return
            errors = list(check(validator, argument, instance, sub))
            if not errors:
                valid.add(id(instance))
            yield from errors

        return run

    keywords = [k for k in ("oneOf", "anyOf") if isinstance(value, dict) and k in value]
    cls = extend(Draft202012Validator, {k: remembering(k) for k in keywords})
    return cls(schema)


def no_constants(token):
    raise ValueError(f"bare {token} is not JSON")


def load(path):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f, parse_constant=no_constants)
    except OSError as e:
        raise CheckError(f"cannot read: {e.strerror}")
    except ValueError as e:  # includes json.JSONDecodeError
        raise CheckError(f"not valid JSON: {e}")


def location(parts):
    """A readable path into the document, such as $.steps[3].locals.i."""
    out = "$"
    for p in parts:
        out += f"[{p}]" if isinstance(p, int) else f".{p}"
    return out


def same(a, b):
    """Strict equality: bool, int and float are distinct, and the unordered
    kinds compare as multisets."""
    return first_difference(a, b, []) is None


def first_difference(a, b, path):
    """None if a equals b, otherwise a message naming the first difference."""
    if type(a) is not type(b):
        return f"{location(path)}: trace has {json.dumps(a)}, fixture has {json.dumps(b)}"
    if isinstance(a, dict):
        if a.keys() != b.keys():
            only_a = sorted(a.keys() - b.keys())
            only_b = sorted(b.keys() - a.keys())
            return f"{location(path)}: keys differ (only in trace: {only_a}, only in fixture: {only_b})"
        field = UNORDERED.get(a.get("kind")) if isinstance(a.get("kind"), str) else None
        for key in a:
            if key == field and isinstance(a[key], list) and isinstance(b[key], list):
                diff = unordered_difference(a[key], b[key], path + [key])
            else:
                diff = first_difference(a[key], b[key], path + [key])
            if diff:
                return diff
        return None
    if isinstance(a, list):
        if len(a) != len(b):
            return f"{location(path)}: trace has {len(a)} items, fixture has {len(b)}"
        for i, (x, y) in enumerate(zip(a, b)):
            diff = first_difference(x, y, path + [i])
            if diff:
                return diff
        return None
    if a != b:
        return f"{location(path)}: trace has {json.dumps(a)}, fixture has {json.dumps(b)}"
    return None


def unordered_difference(a, b, path):
    if len(a) != len(b):
        return f"{location(path)}: trace has {len(a)} items, fixture has {len(b)}"
    unmatched = list(b)
    for x in a:
        for i, y in enumerate(unmatched):
            if same(x, y):
                del unmatched[i]
                break
        else:
            return f"{location(path)}: {json.dumps(x)} is not in the fixture (order ignored)"
    return None


def ref_ids(value):
    """Every id that a ref inside this value names, in the order met."""
    if isinstance(value, dict):
        if value.get("kind") == "ref" and isinstance(value.get("id"), str):
            yield value["id"]
            return
        for v in value.values():
            yield from ref_ids(v)
    elif isinstance(value, list):
        for v in value:
            yield from ref_ids(v)


def check_refs(doc):
    """Every ref must point at an object in the heap that travels with it. The
    objects in a heap are searched too, since their fields hold refs."""
    def missing(values, heap, where):
        for ref in list(ref_ids(values)) + list(ref_ids(heap)):
            if ref not in heap:
                raise CheckError(f'{where}: ref "{ref}" names no object in {"its heap" if heap else "any heap (there is none)"}')

    for i, step in enumerate(doc["steps"]):
        missing([step["frames"], step.get("members", {})], step["heap"], f"$.steps[{i}]")
    if "result" in doc:
        missing(doc["result"], doc.get("result_heap", {}), "$.result")


def same_value(a, b):
    """Equality of two normalized values, ignoring set and map order."""
    return canonical(a) == canonical(b)


def canonical(v):
    if isinstance(v, dict):
        kind = v.get("kind")
        if kind in ("set", "multiset"):
            return (kind, sorted(json.dumps(canonical(x), sort_keys=True) for x in v["items"]))
        if kind in ("map", "multimap"):
            return (kind, sorted(json.dumps(canonical(e), sort_keys=True) for e in v["entries"]))
        return tuple(sorted((k, canonical(x)) for k, x in v.items()))
    if isinstance(v, list):
        return [canonical(x) for x in v]
    return (type(v).__name__, v)


def a_kind(kind):
    """'an array', 'a map'."""
    return f"{'an' if kind[0] in 'aeiou' else 'a'} {kind}"


CONTAINER_KINDS = {"array", "list", "stack", "queue", "deque", "priority-queue", "set", "multiset", "map", "multimap"}


def shared_places(value, path, out):
    """Collect every container with an `id` inside a value: out[id] gets (path, value).
    Objects are not entered here; their fields are walked from the heap."""
    if isinstance(value, dict):
        if value.get("kind") in CONTAINER_KINDS and "id" in value:
            out.setdefault(value["id"], []).append((path, value))
        for key, v in value.items():
            if key != "id":
                shared_places(v, f"{path}.{key}", out)
    elif isinstance(value, list):
        for i, v in enumerate(value):
            shared_places(v, f"{path}[{i}]", out)


def check_shared(doc):
    """Shared containers (spec §5, since v0.14): an `id` is written at every place one
    container is reached from, and only when there are two or more such places."""
    kinds = {}

    def scope(places_of, heap, where):
        for cid, places in places_of.items():
            first = places[0][0]
            if len(places) < 2:
                raise CheckError(f'{first}: container id "{cid}" appears at only one place in {where}; an id is written only on a shared container')
            if cid in heap:
                raise CheckError(f'{first}: container id "{cid}" is also the id of an object in the heap')
            for path, value in places[1:]:
                if value["kind"] != places[0][1]["kind"]:
                    raise CheckError(f'{path}: container id "{cid}" is {a_kind(value["kind"])} here and {a_kind(places[0][1]["kind"])} at {first}')
                if not same_value(value, places[0][1]):
                    raise CheckError(f'{path}: container id "{cid}" has different contents here than at {first}; one container has one value in a step')
            kind = places[0][1]["kind"]
            if kinds.setdefault(cid, (kind, first))[0] != kind:
                raise CheckError(f'{first}: container id "{cid}" is {a_kind(kind)} here and {a_kind(kinds[cid][0])} at {kinds[cid][1]}; an id names one container for the run')

    for i, step in enumerate(doc["steps"]):
        places = {}
        for depth, frame in enumerate(step["frames"]):
            base = f"$.steps[{i}].frames[{depth}]"
            shared_places(frame["locals"], f"{base}.locals", places)
            if "return_value" in frame:
                shared_places(frame["return_value"], f"{base}.return_value", places)
            for k, outcome in enumerate(frame.get("outcomes", [])):
                found = {}
                shared_places(outcome, f"{base}.outcomes[{k}]", found)
                for cid, at in found.items():
                    raise CheckError(f'{at[0][0]}: an outcome\'s value carries container id "{cid}"; it is a copy taken when the line ran, never a place')
        shared_places(step.get("members", {}), f"$.steps[{i}].members", places)
        for oid, obj in step["heap"].items():
            shared_places(obj.get("fields", {}), f"$.steps[{i}].heap.{oid}.fields", places)
        scope(places, step["heap"], f"step {i}")
    if "result" in doc:
        places = {}
        shared_places(doc["result"], "$.result", places)
        heap = doc.get("result_heap", {})
        for oid, obj in heap.items():
            shared_places(obj.get("fields", {}), f"$.result_heap.{oid}.fields", places)
        scope(places, heap, "the result")


def check_iterators(doc):
    """Each iterator names a local of its own frame, at a position that local has."""
    for i, step in enumerate(doc["steps"]):
        for depth, frame in enumerate(step["frames"]):
            local_values = frame["locals"]
            for name, value in local_values.items():
                if not (isinstance(value, dict) and value.get("kind") == "iterator"):
                    continue
                where = f"$.steps[{i}].frames[{depth}].locals.{name}"
                container = value["container"]
                if container not in local_values:
                    raise CheckError(f'{where}: container "{container}" is not a local of this frame')
                target = local_values[container]
                kind = target.get("kind") if isinstance(target, dict) else ("string" if isinstance(target, str) else None)
                described = kind or type(target).__name__
                described = ("an " if described[0] in "aeiou" else "a ") + described
                if "index" in value:
                    if kind in ("array", "list", "deque"):
                        size = len(target["items"])
                    elif kind == "string":
                        size = len(target)
                    else:
                        raise CheckError(f'{where}: an index into "{container}", which is {described}, not an array, list, deque, or string')
                    if value["index"] >= size:
                        raise CheckError(f'{where}: index {value["index"]} is outside "{container}" (length {size}); end() is written "end": true')
                elif "key" in value:
                    if kind in ("map", "multimap"):
                        keys = [entry[0] for entry in target["entries"]]
                    elif kind in ("set", "multiset"):
                        keys = target["items"]
                    else:
                        raise CheckError(f'{where}: a key into "{container}", which is {described}, not a map or set')
                    if not any(same_value(value["key"], k) for k in keys):
                        raise CheckError(f'{where}: key {json.dumps(value["key"])} is not in "{container}"')


def check_frames(doc):
    """Frame rules from trace-format.md section 6: Frames, Return steps, and Outcomes."""
    function_of = {}   # frame id -> function name, for the whole run
    returned = set()   # ids whose call has ended: they must never appear again
    previous = []
    for i, step in enumerate(doc["steps"]):
        frames = step["frames"]
        ids = [f["id"] for f in frames]
        where = f"$.steps[{i}].frames"
        if len(set(ids)) != len(ids):
            raise CheckError(f"{where}: a frame id appears twice in one step")
        for depth, f in enumerate(frames):
            if "return_value" in f and depth != len(frames) - 1:
                raise CheckError(f'{where}[{depth}]: "return_value" on a frame that is not the top one')
            if "outcomes" in f and depth != len(frames) - 1:
                raise CheckError(f'{where}[{depth}]: "outcomes" on a frame that is not the top one')
            if "outcomes" in f and "return_value" in f:
                raise CheckError(f'{where}[{depth}]: "outcomes" in a return step')
            if f["id"] in returned:
                raise CheckError(f'{where}[{depth}]: frame "{f["id"]}" appears again after its call returned')
            known = function_of.setdefault(f["id"], f["function"])
            if known != f["function"]:
                raise CheckError(f'{where}[{depth}]: frame "{f["id"]}" was {json.dumps(known)}, now {json.dumps(f["function"])}')
        returned |= set(previous) - set(ids)
        previous = ids


POSITIONED = {"array", "deque"}
KEYED = {"map", "multimap", "set", "multiset"}


def check_reads(doc):
    """trace-format.md, Outcomes: what the schema cannot say about a read."""
    for s, step in enumerate(doc["steps"]):
        for f, frame in enumerate(step["frames"]):
            for o, outcome in enumerate(frame.get("outcomes", [])):
                if outcome["kind"] != "read":
                    continue
                where = f"$.steps[{s}].frames[{f}].outcomes[{o}]"
                # a local of the frame, else a member (since v0.12): a local hides a member of the same name
                name = outcome["target"]
                target = frame["locals"][name] if name in frame["locals"] else step.get("members", {}).get(name)
                is_string = isinstance(target, str)
                if not is_string and (not isinstance(target, dict) or "kind" not in target):
                    raise CheckError(f"{where}: {json.dumps(name)} is not a container or string local of its frame, or a member")
                if "at" in outcome:
                    value = target
                    last = len(outcome["at"]) - 1
                    for level in range(len(outcome["at"])):
                        if isinstance(value, str):
                            # a string's characters (since v0.11): only as the last level, s[i] or words[i][j]
                            if level != last:
                                raise CheckError(f"{where}: level {level} of {json.dumps(outcome['target'])} is a character, so it has no position")
                            break
                        if not isinstance(value, dict) or value.get("kind") not in POSITIONED:
                            raise CheckError(f"{where}: level {level} of {json.dumps(outcome['target'])} is not an array, deque, or string, so it has no position")
                        items = value["items"]
                        k = outcome["at"][level]
                        value = items[k] if k < len(items) else None
                elif is_string or target["kind"] not in KEYED:
                    kind = "string" if is_string else target["kind"]
                    raise CheckError(f"{where}: {json.dumps(outcome['target'])} is a {kind}, so it has no key")


def check_indexes(doc):
    """trace-format.md section 3, Indexes: what the schema cannot say about "indexes"."""
    indexes = doc.get("indexes", {})
    ran = {f["function"] for step in doc["steps"] for f in step["frames"]}
    for function, uses in indexes.items():
        where = f"$.indexes.{function}"
        if function not in ran and not doc.get("truncated"):
            raise CheckError(f"{where}: no frame runs {json.dumps(function)}")
        for local, containers in uses.items():
            if local in containers:
                raise CheckError(f"{where}.{local}: a local cannot index itself")


def check_truncated(doc, limit="steps"):
    if "truncated" not in doc:
        raise CheckError('"truncated" is absent, expected true')
    if doc["truncated"] is not True:
        raise CheckError(f'"truncated" is {json.dumps(doc["truncated"])}, expected true')
    if "result" in doc:
        raise CheckError('"result" is present in a truncated trace')
    if doc.get("truncated_by") != limit:
        raise CheckError(f'"truncated_by" is {json.dumps(doc.get("truncated_by"))}, expected "{limit}"')
    steps = doc["steps"]
    if limit == "steps" and len(steps) != STEP_CAP:
        raise CheckError(f"{len(steps)} steps, expected exactly {STEP_CAP}")
    if limit == "size":
        if not 0 < len(steps) < STEP_CAP:
            raise CheckError(f"{len(steps)} steps, expected between 1 and {STEP_CAP - 1}")
        size = len(json.dumps(steps, separators=(",", ":"), ensure_ascii=False))
        if size > SIZE_BUDGET:
            raise CheckError(f"the steps are {size} characters of JSON, over the {SIZE_BUDGET} budget")
    for i, step in enumerate(steps):
        if step["step"] != i:
            raise CheckError(f"steps[{i}] is numbered {step['step']}, expected {i}")


def check_result_heap(doc):
    if "result" not in doc:
        raise CheckError('"result" is absent, expected a ref')
    if not list(ref_ids(doc["result"])):
        raise CheckError('"result" contains no ref')
    if "result_heap" not in doc:
        raise CheckError('"result_heap" is absent')


def check_void(doc):
    returns = doc["problem"].get("returns", {}).get("type")
    if returns != "void":
        raise CheckError(f'problem.returns.type is {json.dumps(returns)}, expected "void"')
    if "result" not in doc:
        raise CheckError('"result" is absent, expected null: the method returned')
    if doc["result"] is not None:
        raise CheckError(f'"result" is {json.dumps(doc["result"])}, expected null')


# Kinds two languages may write for one concept, because one language has no type for it:
# Python has no stack or queue type, so a list used as a stack is an array, and a deque or
# list used as a queue is a deque or an array (trace-format.md §8, "the type decides the kind").
LIKE = [{"stack", "array"}, {"queue", "deque", "array"}]


def kind_of(v):
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int):
        return "int"
    if isinstance(v, float):
        return "float"
    if isinstance(v, str):
        return "string"
    if isinstance(v, dict) and v.get("kind") in ("int", "float"):
        return v["kind"]
    return v.get("kind", "?") if isinstance(v, dict) else "?"


def compatible(a, b):
    return a == b or any({a, b} <= group for group in LIKE)


def expand(value, heap, order):
    """A value with its refs followed into the heap, for comparing answers across
    languages: objects are numbered in the order met (so ids may differ), containers
    lose their `id`, and set and map members are compared in any order."""
    if isinstance(value, list):
        return [expand(v, heap, order) for v in value]
    if not isinstance(value, dict):
        return value
    kind = value.get("kind")
    if kind == "ref":
        oid = value["id"]
        if oid in order:
            return {"node": order[oid]}
        order[oid] = len(order)
        obj = heap.get(oid, {})
        return {"node": order[oid], "type": obj.get("type"),
                "fields": {k: expand(v, heap, order) for k, v in sorted(obj.get("fields", {}).items())}}
    out = {k: expand(v, heap, order) for k, v in value.items() if k != "id"}
    field = UNORDERED.get(kind)
    if field and isinstance(out.get(field), list):
        out[field] = sorted(out[field], key=lambda x: json.dumps(x, sort_keys=True))
    if kind in ("stack", "queue", "deque"):
        out["kind"] = "array" if kind == "stack" else "deque"
    return out


def like_difference(doc, other):
    """None when two traces are structurally equivalent (`--like`): the same problem, the
    same answer and ending, the same functions and object types, and compatible kinds for
    every local both have. Steps, lines, and values along the way may differ."""
    def problem(d):
        p = d["problem"]
        return (p["method"], [(q["name"], q["type"]) for q in p["params"]], p.get("returns", {}).get("type"))
    if problem(doc) != problem(other):
        return f"the problems differ: {problem(doc)} and {problem(other)}"
    for key in ("result", "truncated", "truncated_by"):
        if (key in doc) != (key in other):
            return f'"{key}" is in one trace and not the other'
    if "result" in doc:
        a = expand(doc["result"], doc.get("result_heap", {}), {})
        b = expand(other["result"], other.get("result_heap", {}), {})
        if a != b:
            return f"the results differ: {json.dumps(a)[:300]} and {json.dumps(b)[:300]}"

    def summary(d):
        functions, types, kinds = set(), set(), {}
        for step in d["steps"]:
            for frame in step["frames"]:
                functions.add(frame["function"])
                for name, v in frame["locals"].items():
                    kinds.setdefault((frame["function"], name), set()).add(kind_of(v))
            types |= {obj["type"] for obj in step["heap"].values()}
        return functions, types, kinds
    fa, ta, ka = summary(doc)
    fb, tb, kb = summary(other)
    if fa != fb:
        return f"the functions differ: {sorted(fa)} and {sorted(fb)}"
    if ta != tb:
        return f"the object types differ: {sorted(ta)} and {sorted(tb)}"
    for key in sorted(ka.keys() & kb.keys()):
        for mine, theirs in ((ka[key], kb[key]), (kb[key], ka[key])):
            for k in mine:
                if not any(compatible(k, t) for t in theirs):
                    return f"local {key[1]!r} in {key[0]} is {sorted(ka[key])} in one trace and {sorted(kb[key])} in the other"
    return None


def check_file(path, validator, fixture, expect, like=None):
    doc = share(load(path))

    errors = sorted(validator.iter_errors(doc), key=lambda e: list(e.absolute_path))
    if errors:
        lines = [f"{location(list(e.absolute_path))}: {e.message}" for e in errors[:MAX_ERRORS]]
        if len(errors) > MAX_ERRORS:
            lines.append(f"... and {len(errors) - MAX_ERRORS} more")
        raise CheckError(f"{len(errors)} schema error(s)\n" + "\n".join("    " + l for l in lines))

    check_refs(doc)
    check_frames(doc)
    check_iterators(doc)
    check_indexes(doc)
    check_reads(doc)
    check_shared(doc)

    if fixture is not None:
        diff = first_difference(doc, fixture[1], [])
        if diff:
            raise CheckError(f"differs from {fixture[0]} at {diff}")
    if like is not None:
        diff = like_difference(doc, like[1])
        if diff:
            raise CheckError(f"is not like {like[0]}: {diff}")

    for check in expect:
        check(doc)


def main():
    parser = argparse.ArgumentParser(description="Check trace files against the trace format.")
    parser.add_argument("traces", nargs="+", metavar="TRACE", help="trace files to check")
    parser.add_argument("--equals", metavar="FIXTURE", help="also require equality with this fixture")
    parser.add_argument("--like", metavar="FIXTURE",
                        help="also require structural equivalence with this trace, from another language: the same "
                             "problem, answer, ending, functions, and object types, and compatible kinds for shared locals")
    parser.add_argument("--expect-truncated", action="store_true",
                        help=f"also require a trace cut off at the {STEP_CAP}-step cap")
    parser.add_argument("--expect-truncated-size", action="store_true",
                        help="also require a trace cut off at the size budget")
    parser.add_argument("--expect-result-heap", action="store_true",
                        help="also require a ref result with a result_heap")
    parser.add_argument("--expect-void", action="store_true",
                        help="also require a void method's null result")
    args = parser.parse_args()
    expect = [check for flag, check in ((args.expect_truncated, check_truncated),
                                        (args.expect_truncated_size, lambda doc: check_truncated(doc, "size")),
                                        (args.expect_result_heap, check_result_heap),
                                        (args.expect_void, check_void)) if flag]

    try:
        with open(SCHEMA_PATH, encoding="utf-8") as f:
            schema = json.load(f)
        Draft202012Validator.check_schema(schema)
    except Exception as e:
        sys.exit(f"check_trace: cannot load the schema {SCHEMA_PATH}: {e}")
    validator = make_validator(schema)

    like = None
    if args.like:
        try:
            like = (args.like, load(args.like))
        except CheckError as e:
            sys.exit(f"check_trace: {args.like}: {e}")
    fixture = None
    if args.equals:
        try:
            fixture = (args.equals, load(args.equals))
        except CheckError as e:
            sys.exit(f"check_trace: fixture {args.equals}: {e}")

    failed = 0
    for path in args.traces:
        try:
            check_file(path, validator, fixture, expect, like)
            print(f"OK    {path}")
        except CheckError as e:
            failed += 1
            print(f"FAIL  {path}: {e}")

    total = len(args.traces)
    if failed:
        print(f"check_trace: {failed} of {total} trace(s) failed")
        return 1
    print(f"check_trace: all {total} trace(s) passed")
    return 0


if __name__ == "__main__":
    sys.exit(main())
