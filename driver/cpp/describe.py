"""What an input form needs to know about a pasted Solution, before any run.

    describe(source) -> {"methods": [...], "method": name or None}

Each public method of `class Solution`, with its parameters' names and neutral
types (trace-format.md §4, the same names the trace's `problem` uses), its
neutral return type, and `extras`: names the example may give that are not
parameters (`pos`, for a linked list's cycle). A form shows one field per
parameter, plus one per extra, and joins them back into LeetCode's example
text, `name = value, name = value`, which generate() reads as usual.

`method` is the one to preselect: the first public method the driver can read.
LeetCode's generated method comes first in the class; helpers the user adds
usually come after it. The form lets the user choose another.

Only declarations are read. Nothing is compiled or run, so this is safe to call
outside the sandbox on any text.
"""

import json

from ..errors import DriverError
from ..example import _NAME, _reject_constant, parse_example
from .nodes import node_types
from .signature import read_methods
from .types import clean, neutral


def describe(source):
    types = node_types(source)
    node_names = list(types)
    methods = [m for m in read_methods(source) if m.public]
    if not methods:
        raise DriverError("Solution has no public method to call.")

    described = []
    for m in methods:
        entry = {"name": m.name, "params": [], "returns": None, "extras": [], "readable": m.readable, "note": m.note}
        if m.readable:
            try:
                entry["params"] = [{"name": p.name, "type": neutral(p.ctype, node_names, f"parameter {p.name!r}")}
                                   for p in m.params]
                entry["returns"] = neutral(m.return_ctype, node_names, f"the return type of {m.name}")
            except DriverError as error:
                entry.update(params=[], returns=None, readable=False, note=str(error))
        if entry["readable"] and any(clean(p.ctype) == "ListNode*" for p in m.params) \
                and "pos" not in {p.name for p in m.params}:
            entry["extras"] = ["pos"]  # Linked List Cycle: describes the list, is not passed
        described.append(entry)

    readable = [m["name"] for m in described if m["readable"]]
    return {"methods": described, "method": readable[0] if readable else None}


def example_fields(text):
    """A pasted example, split into {name: value text}, for filling a form's fields.

    `nums = [2,7,11,15], target = 9` -> {"nums": "[2,7,11,15]", "target": "9"}.
    Values are rewritten compactly from the parsed JSON, so what the form shows
    is exactly what the driver read. Raises DriverError as parse_example does.
    """
    return {name: json.dumps(value, ensure_ascii=False, separators=(",", ":"))
            for name, value in parse_example(text).items()}


def example_text(fields):
    """The inverse: {name: value text} -> `name = value, name = value`.

    Empty values are left out, so an optional extra such as `pos` can stay blank.
    Each value is checked here, so an error names the field it came from.
    """
    parts = []
    for name, value in fields.items():
        if not isinstance(name, str) or not _NAME.match(name):
            raise DriverError(f"{name!r} is not a parameter name.")
        value = (value or "").strip()
        if not value:
            continue
        try:
            json.loads(value, parse_constant=_reject_constant)  # also stops `1, target = 5` posing as one value
        except ValueError as error:
            raise DriverError(f"The value of {name!r} is not valid: {value!r} ({error}). "
                              "Write it as LeetCode does: [1,2,3], 9, \"abc\", true, null.") from None
        parts.append(f"{name} = {value}")
    if not parts:
        raise DriverError("Every field is empty. Fill in a value for each parameter.")
    return ", ".join(parts)
