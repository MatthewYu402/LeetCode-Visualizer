"""Node types: the ones we supply, and the ones LeetCode defines in a comment.

LeetCode's harness defines the node types, and shows the definition to the
user as a comment above the Solution:

    /*
    // Definition for a Node.
    class Node {
    public:
        int val;
        vector<Node*> neighbors;
        Node(int _val) { ... }
    };
    */

ListNode and TreeNode are the same in every problem, so we supply them
(adapters/cpp/runtime/leetcode_types.hpp) and only check that a commented
definition agrees. Any other node type (usually called Node, but it is a
graph node in one problem and a list node with `random` in another) is taken
from its comment: the class is compiled as written, and a Fields table is
generated from its data members.

Each node type also gets a *shape*: which of LeetCode's notations its example
values use. It is chosen from the type's fields (see SHAPES).
"""

import re
from dataclasses import dataclass, field

from ..errors import DriverError
from .source import blank_comments_and_literals, comments, find_class, split_top_level

SUPPLIED = {"ListNode": ["val", "next"], "TreeNode": ["val", "left", "right"]}

# Shape by link fields (every field but `val`). Notations are in driver/shapes.py.
SHAPES = {
    frozenset({"next"}): "linked-list",
    frozenset({"left", "right"}): "binary-tree",
    frozenset({"left", "right", "next"}): "binary-tree-with-next",   # Populating Next Right Pointers
    frozenset({"neighbors"}): "graph",                              # Clone Graph
    frozenset({"next", "random"}): "random-list",                   # Copy List with Random Pointer
    frozenset({"children"}): "nary-tree",                           # N-ary Tree problems
}


@dataclass
class NodeType:
    name: str
    fields: list                  # data member names, in declaration order
    definition: str = ""          # C++ class text from the comment; empty for supplied types
    supplied: bool = False
    int_constructor: bool = True  # has a constructor taking one value: new Node(5)
    vector_fields: set = field(default_factory=set)

    @property
    def shape(self):
        if "val" not in self.fields:
            return None
        return SHAPES.get(frozenset(f for f in self.fields if f != "val"))

    def fields_table(self):
        """The trace::Fields specialization that lets trace.hpp serialize it."""
        pairs = ",\n".join(f'    std::pair{{"{f}", &{self.name}::{f}}}' for f in self.fields)
        return (f"template <> struct trace::Fields<{self.name}> {{\n"
                f'  static constexpr const char *type = "{self.name}";\n'
                f"  static constexpr auto fields = std::make_tuple(\n{pairs});\n}};")


def node_types(source):
    """{name: NodeType} for ListNode, TreeNode, and every class or struct
    defined inside a comment of the source."""
    types = {name: NodeType(name, list(fields), supplied=True) for name, fields in SUPPLIED.items()}
    stripped = blank_comments_and_literals(source)

    for name in SUPPLIED:
        if find_class(stripped, name):
            raise DriverError(f"The code defines {name} itself. LeetCode supplies {name}, so its definition belongs "
                              f"in a comment, as on the problem page. Remove it or comment it out.")

    for text in comments(source):
        code = _uncomment(text)
        for m in re.finditer(r"\b(class|struct)\s+([A-Za-z_]\w*)\s*\{", code):
            name = m.group(2)
            found = find_class(code, name)
            if not found:
                continue
            body_start, body_end, keyword = found
            definition = code[m.start():body_end + 1] + ";"
            fields, vectors = _data_members(code[body_start:body_end])
            if name in SUPPLIED:
                if fields != SUPPLIED[name]:
                    raise DriverError(f"The commented {name} has fields {fields}, but the {name} the driver supplies has "
                                      f"{SUPPLIED[name]}. The driver cannot run this problem's {name} yet.")
                continue
            if find_class(stripped, name):
                raise DriverError(f"{name} is defined both in a comment and in the code. Keep one.")
            ctor = re.search(r"\b" + name + r"\s*\(\s*(int|long|long long|bool|char|double)\s+\w+\s*\)", code[body_start:body_end])
            types[name] = NodeType(name, fields, definition, int_constructor=bool(ctor), vector_fields=vectors)
    return types


def _uncomment(text):
    """A comment's text as code: drops leading ` * ` on each line and any
    `// ...` inside it, the way LeetCode writes its definitions."""
    lines = []
    for line in text.split("\n"):
        line = re.sub(r"^\s*\*(?!/)", "", line)
        line = re.sub(r"//.*", "", line)
        lines.append(line)
    return "\n".join(lines)


def _data_members(body):
    """Names of the data members in a class body: declarations at depth 0
    with no parentheses. `Node *left, *right;` declares two."""
    names, vectors, depth, start = [], set(), 0, 0
    for k, c in enumerate(body):
        if c == "{":
            depth += 1
        elif c == "}":
            depth -= 1
            if depth == 0:
                start = k + 1  # a method body ended
        elif c == ";" and depth == 0:
            decl = body[start:k]
            start = k + 1
            decl = re.sub(r"\b(public|private|protected)\s*:(?!:)", " ", decl).strip()
            if not decl or "(" in decl or re.match(r"(using|typedef|static|friend|enum)\b", decl):
                continue
            first, *more = split_top_level(decl)
            tm = re.match(r"(.*?)([A-Za-z_]\w*)\s*(=.*)?$", first.strip(), re.S)
            if not tm:
                continue
            base = tm.group(1).replace("*", "").strip()
            for part in [first] + more:
                pm = re.search(r"([A-Za-z_]\w*)\s*(=.*)?$", part.strip(), re.S)
                if pm:
                    names.append(pm.group(1))
                    if re.match(r"(std\s*::\s*)?vector\s*<", base):
                        vectors.add(pm.group(1))
    return names, vectors
