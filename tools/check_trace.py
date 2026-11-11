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
  - checked for dangling refs, which the schema cannot express: every ref in
    a step must name an object in that step's heap, and every ref in the
    result must name an object in result_heap

Options add checks:
  --equals FIXTURE    the parsed trace must equal the parsed fixture. The
                      items of set and multiset and the entries of map and
                      multimap are compared in any order, because their
                      order is unspecified (trace-format.md). Everything
                      else, including types (1 is not 1.0 or true), must match.
  --expect-truncated  "truncated" is true, "result" is absent, and there are
                      exactly 2000 steps numbered 0 to 1999.
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
except ImportError:
    sys.exit("check_trace: the jsonschema package is missing (pip install jsonschema)")

SCHEMA_PATH = Path(__file__).resolve().parent.parent / "schema" / "trace.schema.json"
STEP_CAP = 2000
# Kinds whose list holds no meaningful order, and the field that holds it.
UNORDERED = {"set": "items", "multiset": "items", "map": "entries", "multimap": "entries"}
# At most this many schema errors are printed per file.
MAX_ERRORS = 10


class CheckError(Exception):
    """A file failed a check. The message is the reason."""


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
        missing(step["locals"], step["heap"], f"$.steps[{i}]")
    if "result" in doc:
        missing(doc["result"], doc.get("result_heap", {}), "$.result")


def check_truncated(doc):
    if "truncated" not in doc:
        raise CheckError('"truncated" is absent, expected true')
    if doc["truncated"] is not True:
        raise CheckError(f'"truncated" is {json.dumps(doc["truncated"])}, expected true')
    if "result" in doc:
        raise CheckError('"result" is present in a truncated trace')
    steps = doc["steps"]
    if len(steps) != STEP_CAP:
        raise CheckError(f"{len(steps)} steps, expected exactly {STEP_CAP}")
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


def check_file(path, validator, fixture, expect):
    doc = load(path)

    errors = sorted(validator.iter_errors(doc), key=lambda e: list(e.absolute_path))
    if errors:
        lines = [f"{location(list(e.absolute_path))}: {e.message}" for e in errors[:MAX_ERRORS]]
        if len(errors) > MAX_ERRORS:
            lines.append(f"... and {len(errors) - MAX_ERRORS} more")
        raise CheckError(f"{len(errors)} schema error(s)\n" + "\n".join("    " + l for l in lines))

    check_refs(doc)

    if fixture is not None:
        diff = first_difference(doc, fixture[1], [])
        if diff:
            raise CheckError(f"differs from {fixture[0]} at {diff}")

    for check in expect:
        check(doc)


def main():
    parser = argparse.ArgumentParser(description="Check trace files against the trace format.")
    parser.add_argument("traces", nargs="+", metavar="TRACE", help="trace files to check")
    parser.add_argument("--equals", metavar="FIXTURE", help="also require equality with this fixture")
    parser.add_argument("--expect-truncated", action="store_true",
                        help=f"also require a trace cut off at the {STEP_CAP}-step cap")
    parser.add_argument("--expect-result-heap", action="store_true",
                        help="also require a ref result with a result_heap")
    parser.add_argument("--expect-void", action="store_true",
                        help="also require a void method's null result")
    args = parser.parse_args()
    expect = [check for flag, check in ((args.expect_truncated, check_truncated),
                                        (args.expect_result_heap, check_result_heap),
                                        (args.expect_void, check_void)) if flag]

    try:
        with open(SCHEMA_PATH, encoding="utf-8") as f:
            schema = json.load(f)
        Draft202012Validator.check_schema(schema)
    except Exception as e:
        sys.exit(f"check_trace: cannot load the schema {SCHEMA_PATH}: {e}")
    validator = Draft202012Validator(schema)

    fixture = None
    if args.equals:
        try:
            fixture = (args.equals, load(args.equals))
        except CheckError as e:
            sys.exit(f"check_trace: fixture {args.equals}: {e}")

    failed = 0
    for path in args.traces:
        try:
            check_file(path, validator, fixture, expect)
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
