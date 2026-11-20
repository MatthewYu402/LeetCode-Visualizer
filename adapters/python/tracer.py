"""The Python tracer: runs a Solution under sys.settrace and writes a trace (docs/trace-format.md, v0.15).

The runtime calls `_global` when a function starts and `_local` before each of its
lines, on an exception, and when it returns. Only the user's own functions are followed
(the Solution's methods, functions defined at the top of its file, and functions nested
in them); the driver, this module, the standard library, lambdas, comprehensions, and
generators are not. For each line of a followed function a step is recorded: the whole
call stack, every frame's locals as they are at that instant, the Solution's members,
and one heap of objects. A call ends with a return step that carries its return value.

Values are normalized here, once, into the kinds of the trace (`_Snapshot.value`):

    bool, int, float, str, None       bare JSON, or the tagged `int` and `float` kinds
    list                              array, or a min priority-queue for a list the code
                                      passes to heapq (the rewriter finds those, instrument.py)
    tuple                             tuple
    dict, defaultdict, Counter, ...   map
    set, frozenset                    set
    collections.deque                 deque
    SortedList / SortedSet / SortedDict   multiset / set / map
    an instance of a class from the user's file (ListNode, TreeNode, Node, ...)
                                      an object in the heap, written as a ref

Anything else (a function, a module, an iterator, a range) is not data: a local or
member holding one is left out of the step, and a container holding one makes that whole
local left out. A container reached from two or more places in a step carries the same
`id` at every place (Shared containers, since v0.14). A container that contains itself
cannot be written, and stops the run with an error.

The outcomes of a line (what a condition decided, what a store left, which cells were
read) come from calls the rewriter inserted (instrument.py): `cond`, `store`, `rd`, `has`,
and `get` below. Each adds to the step its frame recorded for that line.
"""

import json
import math
import os
import sys
from collections import deque

VERSION = "0.15"
LANGUAGE = "python"
MAX_STEPS = 2000
MAX_SIZE = 10 * 1024 * 1024  # characters of the steps' JSON text (spec §6, Limits)
MAX_READS = 16
SAFE = 2 ** 53 - 1
EXIT_ADAPTER = 3   # a bug in this adapter, not in the user's code
RECURSION_HINT = ("Python stops at about 1,000 nested calls. The example may be too deep for recursion, "
                  "or the recursion may never reach its base case.")

_SKIPPED_FLAGS = 0x20 | 0x80 | 0x200  # CO_GENERATOR, CO_COROUTINE, CO_ASYNC_GENERATOR


class TraceError(Exception):
    """The run cannot be traced (a list that contains itself). The message is for the user."""


class _Unshowable(Exception):
    """A value with no kind in the trace, deep inside a local: the local is left out."""


class _Frame:
    __slots__ = ("id", "frame", "function", "last_step", "last_line", "unwinding", "reads")

    def __init__(self, fid, frame):
        self.id, self.frame, self.function = fid, frame, frame.f_code.co_name
        self.last_step, self.last_line, self.unwinding, self.reads = None, None, False, 0


def _sorted_kind(v):
    """The kind of a sortedcontainers value, without importing the package."""
    t = type(v)
    if not t.__module__.startswith("sortedcontainers"):
        return None
    for base in t.__mro__:
        name = base.__name__
        if name == "SortedDict":
            return "map"
        if name == "SortedSet":
            return "set"
        if name == "SortedList":
            return "multiset"
    return None


class Tracer:
    def __init__(self, filename, problem, *, module="__solution__", traced_roots=(), heaps=None, member_heaps=(),
                 index_candidates=None, out=None, max_steps=MAX_STEPS, comprehensions=None, max_size=MAX_SIZE):
        self.filename, self.problem, self.module = filename, problem, module
        self.traced_roots = set(traced_roots)        # first part of a followed function's qualified name
        self.heaps = heaps or {}                     # function -> local names the code passes to heapq
        self.member_heaps = set(member_heaps)        # member names the code passes to heapq
        self.comprehensions = comprehensions or {}   # line -> (group, statement line), from instrument.py
        self.index_candidates = index_candidates or {}   # function -> [(local, container, is_member)]
        self.out = out or os.environ.get("TRACE_OUT", "trace.json")
        self.max_steps = max_steps
        self.max_size = max_size
        self.sizes = []  # characters of each step's JSON text, the last one measured again once it is final
        self.steps, self.stack = [], []
        self.solution = None
        self.next_frame = 1
        self.object_ids, self.container_ids, self.alive = {}, {}, []
        self.ints, self.indexable, self.indexable_members, self.ran = {}, {}, set(), set()

    # ------------------------------------------------------------------ settrace

    def start(self, solution):
        self.solution = solution
        sys.settrace(self._global)

    def stop(self):
        sys.settrace(None)

    def _followed(self, code):
        if code.co_filename != self.filename or code.co_name.startswith("<") or code.co_flags & _SKIPPED_FLAGS:
            return False
        return code.co_qualname.split(".")[0] in self.traced_roots

    def _global(self, frame, event, arg):
        if event != "call" or not self._followed(frame.f_code):
            return None
        self.stack.append(_Frame(f"f{self.next_frame}", frame))
        self.next_frame += 1
        self.ran.add(frame.f_code.co_name)
        return self._local

    def _local(self, frame, event, arg):
        try:
            self._event(frame, event, arg)
        except TraceError as error:
            self._fail(str(error), 1)
        except RecursionError:  # the user's calls left the tracer no room: the same limit their code would hit
            self._fail("RecursionError: maximum recursion depth exceeded\n" + RECURSION_HINT, 1)
        except Exception as error:  # a bug here: an exception escaping would silently turn tracing off
            self._fail(f"Internal error in the Python tracer: {type(error).__name__}: {error}", EXIT_ADAPTER)
        return self._local

    def _fail(self, message, status):
        self.stop()
        sys.stdout.flush()
        print(message, file=sys.stderr)
        sys.stderr.flush()
        os._exit(status)

    def _event(self, frame, event, arg):
        f = self._find(frame)
        if f is None:
            return
        if event == "line":
            f.unwinding = False
            if self._same_comprehension(f, frame.f_lineno):
                return  # an item of a comprehension: the line already has its step
            self._record(f, self._statement_line(frame.f_lineno))
        elif event == "exception":
            f.unwinding = True  # cleared by the next line, if the frame catches it
        elif event == "return":
            if not f.unwinding:  # a call that ends by an exception has no return step (spec §6)
                self._record(f, self._statement_line(frame.f_lineno), returning=True, value=arg)
            self.stack.remove(f)

    def _same_comprehension(self, f, line):
        group = self.comprehensions.get(line)
        if group is None or f.last_step is None:
            return False
        before = self.comprehensions.get(f.last_line)
        return (before is not None and before[0] == group[0]) or f.last_line == group[1]

    def _statement_line(self, line):
        """A line inside a comprehension that spans lines is reported as its statement's first line."""
        group = self.comprehensions.get(line)
        return group[1] if group else line

    def _find(self, frame):
        for f in reversed(self.stack):
            if f.frame is frame:
                return f
        return None

    # ------------------------------------------------------------------ steps

    def _record(self, top, line, returning=False, value=None):
        if len(self.steps) >= self.max_steps:
            self._cap("steps")
        snap = _Snapshot(self)
        frames = []
        roots = []
        for f in self.stack:
            roots.append(("locals", f))
        if returning:
            roots.append(("return", value))
        members = self._members()
        if members is not None:
            roots.append(("members", members))
        snap.count(roots)
        for f in self.stack:
            entry = {"id": f.id, "function": f.function, "line": line if f is top else f.frame.f_lineno,
                     "locals": snap.locals(f)}
            frames.append(entry)
        if returning:
            frames[-1]["return_value"] = snap.value(value, place=True, fallback_null=True)
        step = {"step": len(self.steps), "frames": frames}
        if members is not None:
            written = {name: v for name, v in ((n, snap.member(n, v)) for n, v in members.items()) if v is not _OMIT}
            if written:
                step["members"] = written
        step["heap"] = snap.heap
        # The size budget: a step that would take the steps past it is not recorded. The
        # previous step is measured again first, since outcomes were added to it after it was taken.
        if self.steps:
            self.sizes[-1] = len(_text(self.steps[-1]))
        size = len(_text(step))
        if sum(self.sizes) + 2 * len(self.sizes) + size > self.max_size:
            self._cap("size")
        self.sizes.append(size)
        self.steps.append(step)
        top.last_step, top.last_line, top.reads = (None if returning else step), line, 0

    def _members(self):
        obj = self.solution
        if obj is None:
            return None
        try:
            attrs = vars(obj)
        except TypeError:
            return None
        return {k: v for k, v in attrs.items() if not k.startswith("__")}

    def _cap(self, limit):
        """A limit (`steps` or `size`): write the trace now, without a result, and end the program (spec §6, Limits)."""
        self.stop()
        self.write(truncated=limit)
        sys.stdout.flush()
        sys.stderr.flush()
        os._exit(0)

    # ------------------------------------------------------------------ outcomes

    def _outcome_frame(self, line):
        """The running frame, when its last step is on `line` and can take an outcome."""
        if not self.stack:
            return None
        f = self.stack[-1]
        if f.last_step is None or f.last_line != line:
            return None
        return f

    def _add(self, f, outcome):
        f.last_step["frames"][-1].setdefault("outcomes", []).append(outcome)

    def _outcome_value(self, f, v):
        snap = _Snapshot(self, heap=f.last_step["heap"])
        return snap.value(v, place=False)

    def cond(self, line, code, value):
        """A condition: records which way it went, and returns that as a bool."""
        result = bool(value)
        f = self._outcome_frame(line)
        if f is not None:
            self._add(f, {"kind": "condition", "code": code, "value": result})
        return result

    def store(self, line, code, target, value):
        f = self._outcome_frame(line)
        if f is not None:
            try:
                written = self._outcome_value(f, value)
            except (_Unshowable, TraceError, RecursionError):
                return
            self._add(f, {"kind": "store", "code": code, "target": target, "value": written})

    def rd(self, line, code, target, member, container, keys):
        """`container[k1][k2]...`, evaluated as written, and recorded as a read of `target`."""
        values = [container]
        for k in keys:
            values.append(values[-1][k])
        try:
            self._read_at(line, code, target, member, values, keys)
        except (_Unshowable, TraceError, RecursionError):
            pass
        return values[-1]

    def has(self, line, code, target, member, container, key, negate):
        """`key in container` (or `not in`): a read of the entry it found, in a map or set."""
        found = key in container
        if found:
            try:
                self._read_key(line, code, target, member, container, key)
            except (_Unshowable, TraceError, RecursionError, TypeError):
                pass
        return not found if negate else found

    def get(self, line, code, target, member, container, *args):
        """`container.get(key[, default])`: a read of the entry, when the map has it."""
        result = container.get(*args)
        if args and isinstance(container, dict):
            try:
                if args[0] in container:
                    self._read_key(line, code, target, member, container, args[0])
            except (_Unshowable, TraceError, RecursionError, TypeError):
                pass
        return result

    def _target_kind(self, f, target, member):
        """The kind the step wrote for the read's target, or None when the read cannot name it."""
        locals_ = f.last_step["frames"][-1]["locals"]
        if member:
            if target in f.frame.f_locals:  # a local hides the member (spec §6, Members)
                return None
            v = f.last_step.get("members", {}).get(target)
        else:
            v = locals_.get(target)
        if isinstance(v, str):
            return "string"
        return v.get("kind") if isinstance(v, dict) else None

    def _read_at(self, line, code, target, member, values, keys):
        f = self._outcome_frame(line)
        if f is None or f.reads >= MAX_READS:
            return
        kind = self._target_kind(f, target, member)
        if kind in ("map", "multimap") and isinstance(values[0], dict) and keys:
            return self._read_key(line, code, target, member, values[0], keys[0])
        if kind not in ("array", "deque", "string"):
            return
        at = []
        for depth, k in enumerate(keys):
            c = values[depth]
            if isinstance(k, bool) or not isinstance(k, int):
                break
            if isinstance(c, (list, deque)):
                at.append(k if k >= 0 else len(c) + k)
            elif isinstance(c, str) and depth == len(keys) - 1:
                at.append(k if k >= 0 else len(c) + k)
            else:
                break
        if not at:
            return
        value = self._outcome_value(f, values[len(at)])
        self._add(f, {"kind": "read", "code": code, "target": target, "at": at, "value": value})
        f.reads += 1

    def _read_key(self, line, code, target, member, container, key):
        f = self._outcome_frame(line)
        if f is None or f.reads >= MAX_READS:
            return
        kind = self._target_kind(f, target, member)
        if kind in ("map", "multimap") and isinstance(container, dict):
            value = container[key]  # present (the caller checked), so even a defaultdict inserts nothing
        elif kind in ("set", "multiset"):
            value = key
        else:
            return
        self._add(f, {"kind": "read", "code": code, "target": target, "key": self._outcome_value(f, key),
                      "value": self._outcome_value(f, value)})
        f.reads += 1

    # ------------------------------------------------------------------ the document

    def _indexes(self):
        """The rewriter's pairs, kept where the run showed an integer local and a container
        a position counts into (spec §3, Indexes): which they are is known only at run time."""
        out = {}
        for function, pairs in self.index_candidates.items():
            if function not in self.ran:
                continue
            ints = self.ints.get(function, set())
            indexable = self.indexable.get(function, set())
            for local, container, member in pairs:
                if local == container or local not in ints:
                    continue
                if (container in indexable) or (member and container in self.indexable_members):
                    entry = out.setdefault(function, {}).setdefault(local, [])
                    if container not in entry:
                        entry.append(container)
        return out

    def write(self, *, truncated=False, result=None, returned=False):
        """truncated: False, or the limit that stopped recording ("steps" or "size")."""
        doc = {"version": VERSION, "language": LANGUAGE, "problem": self.problem}
        indexes = self._indexes()
        if indexes:
            doc["indexes"] = indexes
        doc["steps"] = self.steps
        if returned:
            snap = _Snapshot(self, heap={})
            snap.count([("return", result)])
            doc["result"] = snap.value(result, place=True, fallback_null=True)
            if snap.heap:
                doc["result_heap"] = snap.heap
        if truncated:
            doc["truncated"] = True
            doc["truncated_by"] = truncated if isinstance(truncated, str) else "steps"
        text = _text(doc)
        with open(self.out, "w", encoding="utf-8") as fh:
            fh.write(text)

    # ------------------------------------------------------------------ ids

    def object_id(self, v):
        key = id(v)
        if key not in self.object_ids:
            self.object_ids[key] = f"n{len(self.object_ids) + 1}"
            self.alive.append(v)  # kept alive, so its id() is never reused by another object
        return self.object_ids[key]

    def container_id(self, v):
        key = id(v)
        if key not in self.container_ids:
            self.container_ids[key] = f"c{len(self.container_ids) + 1}"
            self.alive.append(v)
        return self.container_ids[key]


_OMIT = object()

_CONTAINERS = ("array", "deque", "map", "set", "multiset", "priority-queue")


class _Snapshot:
    """One step's (or one outcome's, or the result's) normalization: its heap, and which
    containers are reached from more than one place."""

    def __init__(self, tracer, heap=None):
        self.t = tracer
        self.heap = {} if heap is None else heap
        self.counts = None            # id(container) -> places, for shared ids; None: write no ids
        self.showable = {}            # id -> bool, for containers
        self.pending, self.draining = [], False   # objects whose fields are still to be written

    # ---- kinds

    def kind(self, v):
        if v is None or isinstance(v, (bool, int, float, str)):
            return "plain"
        if isinstance(v, list):
            return "array"
        if isinstance(v, tuple):
            return "tuple"
        sk = _sorted_kind(v)
        if sk:
            return sk
        if isinstance(v, dict):
            return "map"
        if isinstance(v, (set, frozenset)):
            return "set"
        if isinstance(v, deque):
            return "deque"
        t = type(v)
        if t.__module__ == self.t.module and not isinstance(v, type):
            return "object"
        return None

    def children(self, v, kind):
        if kind in ("array", "tuple", "deque", "set", "multiset"):
            return list(v)
        if kind == "map":
            return [x for pair in v.items() for x in pair]
        return []

    def fields(self, obj):
        try:
            items = list(vars(obj).items())
        except TypeError:
            items = [(n, getattr(obj, n)) for n in getattr(type(obj), "__slots__", ()) if hasattr(obj, n)]
        return [(n, v) for n, v in items if not n.startswith("__")]

    def can_show(self, v, path=None):
        """Whether a value has a kind all the way down (objects always do: a field that
        does not is left out of the object)."""
        kind = self.kind(v)
        if kind is None:
            return False
        if kind in ("plain", "object"):
            return True
        key = id(v)
        if key in self.showable:
            return self.showable[key]
        path = path if path is not None else set()
        if key in path:
            return True  # a cycle: reported by count() as a container that contains itself
        path.add(key)
        ok = all(self.can_show(c, path) for c in self.children(v, kind))
        path.discard(key)
        if kind != "tuple":
            self.showable[key] = ok
        return ok

    # ---- shared containers (spec §5, since v0.14)

    def count(self, roots):
        """Counts the places each container is reached from in the step: every place a
        value is written, and an object's fields once (its one heap entry)."""
        self.counts = {}
        seen, objects = set(), []

        def walk(v, path):
            kind = self.kind(v)
            if kind in (None, "plain"):
                return
            if kind == "object":
                if id(v) not in seen:  # its fields are walked from the worklist, not here: a long
                    seen.add(id(v))    # list of nodes would otherwise nest one call per node
                    objects.append(v)
                return
            key = id(v)
            if kind != "tuple":
                if key in path:
                    raise TraceError(f"A {type(v).__name__} contains itself, so it cannot be drawn. "
                                     "The trace stops here.")
                self.counts[key] = self.counts.get(key, 0) + 1
            path.add(key)
            for c in self.children(v, kind):
                walk(c, path)
            path.discard(key)

        for what, root in roots:
            if what == "locals":
                for name, v in self._frame_locals(root):
                    walk(v, set())
            elif what == "members":
                for name, v in root.items():
                    if self.can_show(v):
                        walk(v, set())
            elif self.can_show(root):
                walk(root, set())
            while objects:
                for _, field in self.fields(objects.pop()):
                    if self.can_show(field):
                        walk(field, set())

    # ---- values

    def _frame_locals(self, f):
        for name, v in f.frame.f_locals.items():
            if name.startswith("__") or (name == "self" and v is self.t.solution):
                continue
            if self.can_show(v):
                yield name, v

    def locals(self, f):
        out = {}
        function = f.function
        heaps = self.t.heaps.get(function, ())
        for name, v in self._frame_locals(f):
            out[name] = self.value(v, place=True, heap_list=name in heaps)
            if isinstance(v, int) and not isinstance(v, bool):
                self.t.ints.setdefault(function, set()).add(name)
            elif (isinstance(v, (list, deque)) and name not in heaps) or isinstance(v, str):
                self.t.indexable.setdefault(function, set()).add(name)
        return out

    def member(self, name, v):
        if not self.can_show(v):
            return _OMIT
        if (isinstance(v, (list, deque)) and name not in self.t.member_heaps) or isinstance(v, str):
            self.t.indexable_members.add(name)
        return self.value(v, place=True, heap_list=name in self.t.member_heaps)

    def value(self, v, place, heap_list=False, fallback_null=False):
        """A normalized value. `place`: written at a place of the step, so a shared
        container gets its id; an outcome's value never does."""
        if fallback_null and not self.can_show(v):
            return None
        kind = self.kind(v)
        if kind is None:
            raise _Unshowable(type(v).__name__)
        if kind == "plain":
            return self.plain(v)
        if kind == "object":
            return self.ref(v)
        if kind == "tuple":
            return {"kind": "tuple", "items": [self.value(x, place) for x in v]}
        out = {"kind": kind}
        if kind == "array" and heap_list:
            out["kind"] = "priority-queue"
        if place and self.counts is not None and self.counts.get(id(v), 0) >= 2:
            out["id"] = self.t.container_id(v)
        if kind == "map":
            out["entries"] = [[self.value(k, place), self.value(x, place)] for k, x in v.items()]
        else:
            out["items"] = [self.value(x, place) for x in v]
        if out["kind"] == "priority-queue":
            out["order"] = "min"
        return out

    def plain(self, v):
        if v is None or isinstance(v, (bool, str)):
            return v
        if isinstance(v, int):
            return v if -SAFE <= v <= SAFE else {"kind": "int", "value": str(v)}
        if math.isnan(v):
            return {"kind": "float", "value": "NaN"}
        if math.isinf(v):
            return {"kind": "float", "value": "Infinity" if v > 0 else "-Infinity"}
        text = repr(v)
        if "e" not in text and "inf" not in text and text.endswith(".0"):
            return {"kind": "float", "value": text}  # a whole float, so 3.0 is not read as 3 (since v0.13)
        return v

    def ref(self, obj):
        oid = self.t.object_id(obj)
        if oid not in self.heap:
            entry = {"kind": "object", "type": type(obj).__name__, "fields": {}}
            self.heap[oid] = entry  # in the heap before its fields, so cycles end (invariant 6)
            self.pending.append((obj, entry["fields"]))
        if not self.draining:
            # Fields are written from a worklist, not by recursion: a list of many nodes would
            # otherwise nest one call per node inside the user's own calls.
            self.draining = True
            try:
                while self.pending:
                    o, fields = self.pending.pop(0)
                    for name, v in self.fields(o):
                        if self.can_show(v):
                            fields[name] = self.value(v, place=True)
            finally:
                self.draining = False
        return {"kind": "ref", "id": oid}


def _text(value):
    """JSON text as the trace is written: one spelling for the document and for measuring steps."""
    return json.dumps(value, ensure_ascii=False, allow_nan=False, separators=(", ", ": "))
