"""Node classes: the ones we supply, and the ones LeetCode shows in a comment.

LeetCode's Python stubs show the node class above the Solution, as `#` comments or inside
a triple-quoted string; both are read:

    # Definition for a Node.
    # class Node:
    #     def __init__(self, val = 0, neighbors = None):
    #         self.val = val
    #         self.neighbors = neighbors if neighbors is not None else []

ListNode and TreeNode are the same in every problem, so we supply them
(adapters/python/run.py, PRELUDE). Any other class is taken from its comment: the
comment marks are removed, the class is read with the ast module for its fields (the
`self.x = ...` in __init__), and run as written before the Solution. A node class the
user wrote out, uncommented, is read the same way and runs as part of their code.

Each node class gets a shape, which of LeetCode's notations its example values use,
from its fields, by the C++ driver's table (driver/cpp/nodes.py, SHAPES).
"""

import ast
import re
from dataclasses import dataclass, field

from ..cpp.nodes import SHAPES

SUPPLIED = {"ListNode": ["val", "next"], "TreeNode": ["val", "left", "right"]}


@dataclass
class NodeType:
    name: str
    fields: list = field(default_factory=list)   # attributes set in __init__, in order
    definition: str = ""                          # the class, uncommented; empty when supplied or in the user's code
    supplied: bool = False

    @property
    def shape(self):
        if "val" not in self.fields:
            return None
        return SHAPES.get(frozenset(f for f in self.fields if f != "val"))


def node_types(source, tree):
    """{name: NodeType}: ListNode, TreeNode, classes from comments, and classes in the code."""
    types = {name: NodeType(name, list(fields), supplied=True) for name, fields in SUPPLIED.items()}
    for text in _commented_classes(source) + _string_classes(tree):
        try:
            cls = ast.parse(text).body[0]
        except (SyntaxError, IndexError):
            continue  # prose that only looks like a class
        fields = _fields(cls) if isinstance(cls, ast.ClassDef) else []
        if fields and cls.name not in SUPPLIED and cls.name != "Solution":  # no fields: prose, not a node class
            types[cls.name] = NodeType(cls.name, fields, definition=text)
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name != "Solution":
            fields = _fields(node)
            if node.name in SUPPLIED:
                types[node.name] = NodeType(node.name, fields or list(SUPPLIED[node.name]), supplied=True)
            elif fields:
                types[node.name] = NodeType(node.name, fields)  # defined in the user's code: nothing to add
    return types


def _fields(cls):
    init = next((n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name == "__init__"), None)
    if init is None:
        return []
    names = []
    for node in ast.walk(init):
        targets = node.targets if isinstance(node, ast.Assign) else [node.target] if isinstance(node, (ast.AnnAssign, ast.AugAssign)) else []
        for t in targets:
            if isinstance(t, ast.Attribute) and isinstance(t.value, ast.Name) and t.value.id == "self" and t.attr not in names:
                names.append(t.attr)
    return names


def _string_classes(tree):
    """Classes written inside a string at the top of the file, as LeetCode shows Node."""
    import textwrap
    out = []
    for node in tree.body:
        if isinstance(node, ast.Expr) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            text = node.value.value
            lines = [line for line in text.splitlines() if not line.strip().startswith("#")]
            body = textwrap.dedent("\n".join(lines))
            try:
                parsed = ast.parse(body)
            except SyntaxError:
                continue
            out += [ast.get_source_segment(body, c) + "\n" for c in parsed.body if isinstance(c, ast.ClassDef)]
    return out


_CLASS = re.compile(r"^(\s*)#\s?class\s+[A-Za-z_]\w*\s*[:(]")


def _commented_classes(source):
    """Each `# class X:` block in the comments, with the comment marks removed."""
    lines = source.splitlines()
    out = []
    i = 0
    while i < len(lines):
        m = _CLASS.match(lines[i])
        if not m:
            i += 1
            continue
        block = [_uncomment(lines[i])]
        j = i + 1
        while j < len(lines) and lines[j].strip().startswith("#"):
            text = _uncomment(lines[j])
            if text.strip() and not text[:1].isspace():
                break  # back at the left edge: the class has ended (prose, or another class)
            block.append(text)
            j += 1
        out.append("\n".join(block).rstrip() + "\n")
        i = j
    return out


def _uncomment(line):
    stripped = line.lstrip()
    stripped = stripped[1:] if stripped.startswith("#") else stripped
    return stripped[1:] if stripped.startswith(" ") else stripped
