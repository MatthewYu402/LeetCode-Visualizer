"""Node classes: the ones we supply, and the ones LeetCode shows in a comment.

LeetCode's Java stubs show the node class above the Solution in a comment:

    /*
    // Definition for a Node.
    class Node {
        public int val;
        public List<Node> neighbors;
        public Node() { ... }
        public Node(int _val) { ... }
    }
    */

ListNode and TreeNode are the same in every problem, so we supply them (SUPPLIED_SOURCE,
written to Nodes.java). Any other class is taken from its comment, the comment marks removed,
and compiled as written into Nodes.java. Its fields are its field declarations; its shape
(which of LeetCode's notations its example values use) comes from them, by the C++ driver's
table (driver/cpp/nodes.py, SHAPES). A class the user wrote out, uncommented, is read the same
way and is part of their own code.
"""

import re
from dataclasses import dataclass, field

from ..cpp.nodes import SHAPES
from ..cpp.source import blank_comments_and_literals, comments, find_class, matching, split_top_level

SUPPLIED = {"ListNode": ["val", "next"], "TreeNode": ["val", "left", "right"]}
SUPPLIED_SOURCE = {
    "ListNode": "class ListNode { int val; ListNode next; ListNode() {} ListNode(int val) { this.val = val; } "
                "ListNode(int val, ListNode next) { this.val = val; this.next = next; } }",
    "TreeNode": "class TreeNode { int val; TreeNode left; TreeNode right; TreeNode() {} TreeNode(int val) { this.val = val; } "
                "TreeNode(int val, TreeNode left, TreeNode right) { this.val = val; this.left = left; this.right = right; } }",
}


@dataclass
class NodeType:
    name: str
    fields: list = field(default_factory=list)       # field names, in order
    field_types: dict = field(default_factory=dict)  # name -> declared type text
    definition: str = ""                             # the class from the comment; empty when supplied or in the user's code
    supplied: bool = False
    in_code: bool = False
    no_arg_constructor: bool = True
    int_constructor: bool = True

    @property
    def shape(self):
        if "val" not in self.fields:
            return None
        return SHAPES.get(frozenset(f for f in self.fields if f != "val"))


def node_types(source):
    """{name: NodeType}: ListNode, TreeNode, classes from comments, and classes in the code."""
    types = {name: NodeType(name, list(fields), {"val": "int"}, supplied=True) for name, fields in SUPPLIED.items()}
    for text in comments(source):
        lines = [re.sub(r"^\s*\*\s?", "", l) for l in text.splitlines()]
        body = "\n".join(l for l in lines if not l.strip().startswith("//"))
        for t in _classes(body):
            if t.name not in SUPPLIED and t.name != "Solution":
                types[t.name] = t
    for t in _classes(source):
        if t.name == "Solution":
            continue
        t.definition, t.in_code = "", True
        if t.name in SUPPLIED:
            t.supplied = True
        if t.fields:
            types[t.name] = t
    return types


def _classes(text):
    stripped = blank_comments_and_literals(text)
    out = []
    for m in re.finditer(r"\bclass\s+([A-Za-z_$][\w$]*)[^{;]*\{", stripped):
        open_brace = m.end() - 1
        close = matching(stripped, open_brace)
        if close == -1:
            continue
        name = m.group(1)
        fields, types, ctors = [], {}, []
        body = stripped[open_brace + 1:close]
        k, chunk = 0, 0
        while k < len(body):
            c = body[k]
            if c == "{":
                head = body[chunk:k]
                cm = re.search(r"\b" + re.escape(name) + r"\s*\(([^)]*)\)\s*$", head)
                if cm:
                    ctors.append([p for p in split_top_level(cm.group(1)) if p.strip()])
                end = matching(body, k)
                k = (end if end != -1 else len(body)) + 1
                chunk = k
            elif c == ";":
                decl = body[chunk:k].split("=")[0].strip()
                fm = re.match(r"^(?:(?:public|private|protected|final|transient|volatile)\s+)*(.+?)\s+([A-Za-z_$][\w$]*)$", decl, re.S)
                if fm and "static" not in decl.split() and "(" not in decl:
                    fields.append(fm.group(2))
                    types[fm.group(2)] = " ".join(fm.group(1).split())
                k += 1
                chunk = k
            else:
                k += 1
        t = NodeType(name, fields, types, definition=text[m.start():close + 1] + "\n")
        t.no_arg_constructor = not ctors or any(len(c) == 0 for c in ctors)
        t.int_constructor = any(len(c) == 1 for c in ctors)
        out.append(t)
    return out
