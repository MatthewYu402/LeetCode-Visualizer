"""What an input form needs to know about a pasted Java Solution, before any run.

    describe(source) -> {"methods": [...], "method": name or None}

The same answer as the C++ describe() (driver/cpp/describe.py): each public method of class
Solution, its parameters' names and neutral types, its neutral return type, and `extras`
(`pos`). Only declarations are read; nothing is compiled or run.
"""

from ..errors import DriverError
from .nodes import node_types
from .signature import read_methods
from .types import neutral, parse


def describe(source):
    names = list(node_types(source))
    methods = [m for m in read_methods(source) if m.public]
    if not methods:
        raise DriverError("Solution has no public method to call.")
    described = []
    for m in methods:
        entry = {"name": m.name, "params": [], "returns": None, "extras": [], "readable": m.readable, "note": m.note}
        if m.readable:
            try:
                entry["params"] = [{"name": p.name, "type": neutral(p.ctype, names, f"parameter {p.name!r}")} for p in m.params]
                entry["returns"] = neutral(m.return_ctype, names, f"the return type of {m.name}", returns=True)
            except DriverError as error:
                entry.update(params=[], returns=None, readable=False, note=str(error))
        if entry["readable"] and any(p["type"] == "ListNode" for p in entry["params"]) \
                and "pos" not in {p.name for p in m.params}:
            entry["extras"] = ["pos"]
        described.append(entry)
    readable = [m["name"] for m in described if m["readable"]]
    return {"methods": described, "method": readable[0] if readable else None}
