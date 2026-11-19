"""Runs one traced Python Solution. The entry point inside the sandbox (docs/adapters/python.md §6).

    TRACE_OUT=trace.json python3 -I run.py WORK

WORK holds what the driver wrote (driver/python): `solution.py`, the user's code as
pasted, and `run.json`, the method to call, its arguments, the trace's `problem`, and
the node classes from LeetCode's comments. This script rewrites the Solution
(instrument.py), defines what LeetCode's Python environment provides without an import,
builds the arguments, calls the method under the tracer (tracer.py), and writes the
trace to TRACE_OUT.

Exit status:
    0   the trace was written (with a result, or truncated at the step limit)
    1   the user's code raised an exception, or cannot be traced; the reason is printed
    3   a bug in this adapter, or input the driver should have refused
"""

import json
import linecache
import os
import sys
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # -I leaves the script's folder off the path

from instrument import TRACE, instrument  # noqa: E402
from tracer import EXIT_ADAPTER, RECURSION_HINT, TraceError, Tracer  # noqa: E402

FILENAME = "solution.py"
MODULE = "__solution__"

# What a Solution can use without importing it: the names LeetCode's own stubs use
# (List, Optional), and the modules that hold Python's counterparts of the C++ adapter's
# containers (deque, heapq, SortedList, ...) and common helpers. Our list, chosen to
# cover those; LeetCode's exact list is not published (docs/adapters/python.md §6).
# typing comes first, so collections' Counter and OrderedDict replace typing's aliases.
PRELUDE = """\
from typing import *
import collections, heapq, bisect, math, itertools, functools, operator, string, re, random
from collections import *
from heapq import *
from bisect import *
from itertools import *
from functools import *
try:
    from sortedcontainers import SortedList, SortedSet, SortedDict
except ImportError:
    pass


class ListNode:
    def __init__(self, val=0, next=None):
        self.val = val
        self.next = next


class TreeNode:
    def __init__(self, val=0, left=None, right=None):
        self.val = val
        self.left = left
        self.right = right
"""


def main(work):
    with open(os.path.join(work, "run.json"), encoding="utf-8") as fh:
        spec = json.load(fh)
    with open(os.path.join(work, FILENAME), encoding="utf-8") as fh:
        source = fh.read()
    linecache.cache[FILENAME] = (len(source), None, source.splitlines(True), FILENAME)  # for tracebacks

    try:
        code, info = instrument(source, FILENAME)
    except SyntaxError as error:
        print(f"The code is not valid Python: line {error.lineno}: {error.msg}", file=sys.stderr)
        return EXIT_ADAPTER  # the driver parses the code first, so this means a bug

    ns = {"__name__": MODULE, "__builtins__": __builtins__}
    exec(compile(PRELUDE, "<prelude>", "exec"), ns)
    if spec.get("classes"):
        exec(compile(spec["classes"], "<nodes>", "exec"), ns)  # Node, from LeetCode's comment
    tracer = Tracer(FILENAME, spec["problem"], module=MODULE, traced_roots=info.traced_roots, heaps=info.heaps,
                    member_heaps=info.member_heaps, index_candidates=info.index_candidates,
                    comprehensions=info.comprehensions)
    ns[TRACE] = tracer
    try:
        exec(code, ns)
        solution = ns["Solution"]()
        args = [build(a, ns) for a in spec["args"]]
        method = getattr(solution, spec["method"])
    except BaseException as error:
        return failed(error)

    tracer.start(solution)
    try:
        answer = method(*args)
    except BaseException as error:
        tracer.stop()
        return failed(error)
    tracer.stop()
    try:
        tracer.write(returned=True, result=None if spec["problem"].get("returns", {}).get("type") == "void" else answer)
    except TraceError as error:
        return failed(error)
    return 0


def failed(error):
    """Prints what the user's code raised, with the frames of their own code only."""
    sys.stdout.flush()
    if isinstance(error, TraceError):
        print(error, file=sys.stderr)
        return 1
    frames = [f for f in traceback.extract_tb(error.__traceback__) if f.filename == FILENAME]
    lines = ["Traceback (most recent call last):\n", *traceback.format_list(frames),
             *traceback.format_exception_only(type(error), error)]
    if isinstance(error, RecursionError):
        lines.append(RECURSION_HINT + "\n")
    print("".join(lines), end="", file=sys.stderr)
    return 1


# ---------------------------------------------------------------------- arguments

def build(arg, ns):
    """One argument, from the driver's description of it."""
    if "nodes" in arg:
        return nodes(arg["nodes"], ns)
    return convert(arg["value"], parse(arg["type"]))


def nodes(desc, ns):
    """A linked structure from the driver's node records (driver/shapes.py)."""
    if desc["root"] is None:
        return None
    cls = ns[desc["class"]]
    made = [cls(record["val"]) for record in desc["records"]]
    for obj, record in zip(made, desc["records"]):
        for name in desc["fields"]:
            if name == "val":
                continue
            link = record.get(name)
            if isinstance(link, list):
                setattr(obj, name, [made[i] for i in link])
            else:
                setattr(obj, name, made[link] if link is not None else None)
    return made[desc["root"]]


def parse(text):
    """A neutral type name ("array<array<float>>") as (kind, [arguments])."""
    text = text.strip()
    if "<" not in text:
        return text, []
    kind, inner = text.split("<", 1)
    inner = inner[:-1]
    args, depth, start = [], 0, 0
    for i, c in enumerate(inner):
        if c == "<":
            depth += 1
        elif c == ">":
            depth -= 1
        elif c == "," and depth == 0:
            args.append(parse(inner[start:i]))
            start = i + 1
    args.append(parse(inner[start:]))
    return kind, args


def convert(value, ntype):
    """A JSON value as the Python value its type asks for: 5 for a float is 5.0, a list
    for a tuple is a tuple, a list for a set is a set."""
    kind, args = ntype
    if value is None:
        return None
    if kind == "float" and not isinstance(value, bool):
        return float(value)
    if kind in ("array", "list", "deque", "stack", "queue", "priority-queue") and isinstance(value, list):
        items = [convert(v, args[0]) if args else v for v in value]
        if kind == "deque":
            from collections import deque
            return deque(items)
        return items
    if kind in ("set", "multiset") and isinstance(value, list):
        return set(convert(v, args[0]) if args else v for v in value)
    if kind == "tuple" and isinstance(value, list):
        return tuple(convert(v, a) for v, a in zip(value, args)) if len(args) == len(value) else tuple(value)
    return value


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("usage: python3 -I run.py WORK", file=sys.stderr)
        sys.exit(EXIT_ADAPTER)
    try:
        sys.exit(main(sys.argv[1]))
    except SystemExit:
        raise
    except BaseException as error:  # a bug here, not in the user's code
        print(f"Internal error in the Python adapter: {type(error).__name__}: {error}", file=sys.stderr)
        sys.exit(EXIT_ADAPTER)
