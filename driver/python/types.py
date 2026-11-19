"""Python type hints -> neutral type names (trace-format.md §4).

    List[int]                       array<int>
    List[List[str]]                 array<array<string>>
    Optional[TreeNode]              TreeNode
    Dict[str, int]                  map<string, int>
    Set[int], Tuple[int, str]       set<int>, tuple<int, string>
    Deque[int]                      deque<int>
    'Node', Optional['Node']        Node
    None (a return hint)            void

The lowercase spellings (list[int], dict[str, int], int | None) and typing.List are read
the same way. Python has no char: a one-letter string is a string.
"""

import ast

from ..errors import DriverError

_PLAIN = {"int": "int", "float": "float", "bool": "bool", "str": "string"}
_ONE = {"List": "array", "list": "array", "Sequence": "array", "Set": "set", "set": "set", "FrozenSet": "set",
        "frozenset": "set", "Deque": "deque", "deque": "deque"}
_TWO = {"Dict": "map", "dict": "map", "DefaultDict": "map", "defaultdict": "map", "Mapping": "map"}


def neutral(hint, node_types, where, returns=False):
    """The neutral name for a type hint (an ast expression)."""
    try:
        return _neutral(hint, set(node_types), returns)
    except _Unreadable:
        raise DriverError(f"{where}: the driver cannot read the type hint {ast.unparse(hint)!r} yet.") from None


class _Unreadable(Exception):
    pass


def _name(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr  # typing.List, collections.deque
    return None


def _without_none(items):
    rest = [i for i in items if not (isinstance(i, ast.Constant) and i.value is None)]
    if len(rest) != 1:
        raise _Unreadable()
    return rest[0]


def _neutral(node, nodes, returns):
    if isinstance(node, ast.Constant):
        if node.value is None:
            if returns:
                return "void"
            raise _Unreadable()
        if isinstance(node.value, str):  # a forward reference: 'Node'
            try:
                return _neutral(ast.parse(node.value, mode="eval").body, nodes, returns)
            except SyntaxError:
                raise _Unreadable() from None
        raise _Unreadable()
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):  # TreeNode | None
        return _neutral(_without_none([node.left, node.right]), nodes, returns)
    name = _name(node)
    if name is not None:
        if name in _PLAIN:
            return _PLAIN[name]
        if name in nodes:
            return name
        raise _Unreadable()
    if isinstance(node, ast.Subscript):
        base = _name(node.value)
        args = node.slice.elts if isinstance(node.slice, ast.Tuple) else [node.slice]
        if base == "Optional" and len(args) == 1:
            return _neutral(args[0], nodes, returns)
        if base == "Union":
            return _neutral(_without_none(args), nodes, returns)
        if base in _ONE and len(args) == 1:
            return f"{_ONE[base]}<{_neutral(args[0], nodes, False)}>"
        if base in _TWO and len(args) == 2:
            return f"map<{_neutral(args[0], nodes, False)}, {_neutral(args[1], nodes, False)}>"
        if base in ("Tuple", "tuple") and args and not any(isinstance(a, ast.Constant) and a.value is Ellipsis for a in args):
            return "tuple<" + ", ".join(_neutral(a, nodes, False) for a in args) + ">"
    raise _Unreadable()
