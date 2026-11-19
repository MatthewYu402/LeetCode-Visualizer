"""What an input form needs to know about a pasted Python Solution, before any run.

    describe(source) -> {"methods": [...], "method": name or None}

The same answer as the C++ describe() (driver/cpp/describe.py): each public method of
class Solution (a name that does not start with `_`), its parameters' names and neutral
types, its neutral return type, and `extras` (`pos`). Only the syntax tree is read;
nothing is run.
"""

from ..errors import DriverError
from .nodes import node_types
from .signature import parse, read_methods
from .types import neutral


def describe(source):
    tree = parse(source, empty_bodies=True)
    names = list(node_types(source, tree))
    methods = [m for m in read_methods(tree) if m.public]
    if not methods:
        raise DriverError("Solution has no public method to call.")
    described = []
    for m in methods:
        entry = {"name": m.name, "params": [], "returns": None, "extras": [], "readable": m.readable, "note": m.note}
        if m.readable:
            try:
                entry["params"] = [{"name": p.name, "type": neutral(p.hint, names, f"parameter {p.name!r}")} for p in m.params]
                if m.returns_hint is not None:
                    entry["returns"] = neutral(m.returns_hint, names, f"the return type of {m.name}", returns=True)
            except DriverError as error:
                entry.update(params=[], returns=None, readable=False, note=str(error))
        if entry["readable"] and any(p["type"] == "ListNode" for p in entry["params"]) \
                and "pos" not in {p["name"] for p in entry["params"]}:
            entry["extras"] = ["pos"]
        described.append(entry)
    readable = [m["name"] for m in described if m["readable"]]
    return {"methods": described, "method": readable[0] if readable else None}
