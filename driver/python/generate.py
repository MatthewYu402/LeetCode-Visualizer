"""The Python driver: a Solution and an example in, what run.py needs out.

    generate(source, example) -> Program(problem, spec)

- `problem` is the trace's problem object (trace-format.md, Section 4).
- `spec` is run.json for adapters/python/run.py: the method to call, each argument as a
  JSON value (or as node records for a linked structure, decoded here by driver/shapes.py),
  the problem, and the node classes from LeetCode's comments.

Nothing is generated as code: run.py builds the arguments from the JSON, so no value is
ever pasted into a program's text.
"""

import ast
import json
from dataclasses import dataclass, field

from .. import shapes
from ..cpp.signature import choose_method
from ..cpp.types import parse_neutral
from ..errors import DriverError
from ..example import parse_example
from ..hints import infer_hint
from .nodes import node_types
from .signature import parse, read_methods
from .types import neutral


@dataclass
class Program:
    problem: dict
    spec: dict
    warnings: list = field(default_factory=list)

    def run_json(self):
        return json.dumps(self.spec, ensure_ascii=False, indent=1) + "\n"


def generate(source, example, method_name=None):
    tree = parse(source)
    types = node_types(source, tree)
    values = parse_example(example)

    def has_list_param(m):
        return any(getattr(p, "hint", None) is not None and _is(p.hint, "ListNode") for p in m.params)

    method, mapping = choose_method(read_methods(tree), list(values), has_list_param, method_name)
    warnings = []
    if any(e != p for e, p in mapping.items()):
        renamed = ", ".join(f"{e} -> {p}" for e, p in mapping.items() if e != p)
        warnings.append(f"The example's names do not match {method.name}'s parameters, so the values were passed in order ({renamed}).")

    names = list(types)
    params = [{"name": p.name, "type": neutral(p.hint, names, f"parameter {p.name!r}")} for p in method.params]
    returns = (neutral(method.returns_hint, names, f"the return type of {method.name}", returns=True)
               if method.returns_hint is not None else None)

    by_param = {mapping[name]: value for name, value in values.items() if name in mapping}
    for p in params:
        hint = infer_hint(p["name"], p["type"], by_param.get(p["name"]))
        if hint:
            p["hint"] = hint
    pos = values.get("pos", -1) if "pos" in values and "pos" not in mapping else -1
    if pos != -1 and not any(p["type"] == "ListNode" for p in params):
        raise DriverError("pos is only used with a ListNode parameter.")

    problem = {"method": method.name, "params": params}
    if returns:
        problem["returns"] = {"type": returns}
    problem["input"] = {p["name"]: by_param[p["name"]] for p in params}

    args = []
    for p in params:
        value = by_param[p["name"]]
        ntype = parse_neutral(p["type"])
        if ntype[0] in types:
            args.append({"name": p["name"], "type": p["type"],
                         "nodes": _nodes(value, types[ntype[0]], p["name"], pos if p["type"] == "ListNode" else -1)})
        else:
            _check(value, ntype, p["name"])
            args.append({"name": p["name"], "type": p["type"], "value": value})

    classes = "\n\n".join(t.definition for t in types.values() if t.definition)
    spec = {"method": method.name, "problem": problem, "args": args, "classes": classes}
    return Program(problem, spec, warnings)


def _is(hint, name):
    return any(isinstance(n, ast.Name) and n.id == name or isinstance(n, ast.Constant) and n.value == name
               for n in ast.walk(hint))


def _nodes(value, t, where, pos):
    shape = t.shape
    if shape == "linked-list":
        decoded = shapes.linked_list(value, where, pos)
    elif shape == "binary-tree":
        decoded = shapes.binary_tree(value, where)
    elif shape == "binary-tree-with-next":
        decoded = shapes.binary_tree(value, where, extra=("next",))
    elif shape == "graph":
        decoded = shapes.graph(value, where)
    elif shape == "random-list":
        decoded = shapes.random_list(value, where)
    elif shape == "nary-tree":
        decoded = shapes.nary_tree(value, where)
    else:
        raise DriverError(f"{where}: the driver does not know how LeetCode writes a {t.name} with fields "
                          f"{t.fields} in an example, so it cannot build it yet.")
    return {"class": t.name, "fields": t.fields, "records": decoded.nodes, "root": decoded.root}


def _check(value, ntype, where):
    """The example's value has the shape its type asks for (the same messages as the C++ driver)."""
    kind, args = ntype
    if kind == "int":
        if isinstance(value, bool) or not isinstance(value, int):
            raise DriverError(f"{where} should be an integer, found {value!r}.")
    elif kind == "float":
        if isinstance(value, bool) or not isinstance(value, (int, float)):
            raise DriverError(f"{where} should be a number, found {value!r}.")
    elif kind == "bool":
        if not isinstance(value, bool):
            raise DriverError(f"{where} should be true or false, found {value!r}.")
    elif kind == "string":
        if not isinstance(value, str):
            raise DriverError(f"{where} should be a string in double quotes, found {value!r}.")
    elif kind in ("array", "set", "deque"):
        if not isinstance(value, list):
            raise DriverError(f"{where} should be an array, found {value!r}.")
        for i, item in enumerate(value):
            _check(item, args[0], f"{where}[{i}]")
    elif kind == "tuple":
        if not isinstance(value, list) or len(value) != len(args):
            raise DriverError(f"{where} should be an array of {len(args)} values, found {value!r}.")
        for i, (item, a) in enumerate(zip(value, args)):
            _check(item, a, f"{where}[{i}]")
    else:
        raise DriverError(f"{where}: the driver cannot build an input of type {kind} from an example yet.")
