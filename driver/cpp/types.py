"""C++ types -> neutral type names (trace-format.md, Section 4).

A neutral name says what kind the value will have in the trace: vector<int>
is serialized as an `array`, so its neutral type is `array<int>`. Inside a
type name, arguments are separated by ", " (one comma, one space), which is
the one spelling everywhere.

    int, long, long long, unsigned ...   int
    float, double                        float
    bool, char, string                   bool, char, string
    vector<T>, array<T, N>               array<T>
    list<T>, forward_list<T>             list<T>
    deque, stack, queue                  deque<T>, stack<T>, queue<T>
    priority_queue<T, ...>               priority-queue<T>
    set / unordered_set                  set<T>       (multiset<T> for the multi forms)
    map / unordered_map<K, V>            map<K, V>    (multimap<K, V>)
    pair<A, B>, tuple<...>               tuple<A, B, ...>
    bitset<N>                            array<bool>
    X* for a node type X                 X
    void (return types only)             void
"""

import re

from ..errors import DriverError
from .source import split_top_level

INTEGERS = {
    "int", "long", "short", "signed", "unsigned", "long long", "long int", "long long int", "short int",
    "unsigned int", "unsigned long", "unsigned long long", "unsigned short", "signed int", "signed long",
    "signed long long", "unsigned long int", "unsigned long long int", "size_t", "ptrdiff_t",
    "int8_t", "int16_t", "int32_t", "int64_t", "uint8_t", "uint16_t", "uint32_t", "uint64_t",
    "signed char", "unsigned char",  # numbers, as in trace.hpp: only plain char is text
}
FLOATS = {"float", "double", "long double"}
SIMPLE = {"bool": "bool", "char": "char", "string": "string", "string_view": "string", "void": "void"}

ONE_ARG = {"vector": "array", "array": "array", "list": "list", "forward_list": "list", "deque": "deque",
           "stack": "stack", "queue": "queue", "priority_queue": "priority-queue",
           "set": "set", "unordered_set": "set", "multiset": "multiset", "unordered_multiset": "multiset"}
TWO_ARGS = {"map": "map", "unordered_map": "map", "multimap": "multimap", "unordered_multimap": "multimap"}


def clean(ctype):
    """Removes what does not change the kind: std::, const, volatile, & and &&,
    typename, and extra spaces. Keeps * and template arguments."""
    t = re.sub(r"\bstd\s*::\s*", "", ctype)
    t = re.sub(r"\b(const|volatile|typename|struct|class)\b", " ", t)
    t = t.replace("&", " ")
    t = re.sub(r"\s+", " ", t).strip()
    t = re.sub(r"\s*([<>,*])\s*", r"\1", t)
    return t


def declared_type(ctype):
    """The type to declare a variable with, for passing to a parameter of this
    type: a reference and a top-level const removed, the rest as written.
    `const vector<int>&` -> `vector<int>`."""
    t = ctype.strip()
    t = re.sub(r"&+\s*$", "", t).strip()
    t = re.sub(r"^const\s+", "", t)
    t = re.sub(r"\s+const\s*$", "", t)
    return t


def neutral(ctype, node_types, where):
    """The neutral name for a C++ type. `node_types` are the struct names that
    have a Fields table (ListNode, TreeNode, and nodes from comments)."""
    return _neutral(clean(ctype), set(node_types), where, ctype)


def _neutral(t, nodes, where, original):
    if t.endswith("*"):
        base = t[:-1]
        if base in nodes:
            return base
        raise DriverError(f"{where}: {original.strip()!r} is a pointer to {base!r}, which has no definition the driver knows "
                          f"(ListNode, TreeNode, or a node class in a comment).")
    if t in INTEGERS:
        return "int"
    if t in FLOATS:
        return "float"
    if t in SIMPLE:
        return SIMPLE[t]
    m = re.fullmatch(r"([A-Za-z_][A-Za-z0-9_]*)<(.*)>", t)
    if m:
        name, args = m.group(1), [a for a in split_top_level(m.group(2))]
        if name in ONE_ARG:
            return f"{ONE_ARG[name]}<{_neutral(args[0], nodes, where, original)}>"
        if name in TWO_ARGS and len(args) >= 2:
            return f"{TWO_ARGS[name]}<{_neutral(args[0], nodes, where, original)}, {_neutral(args[1], nodes, where, original)}>"
        if name in ("pair", "tuple"):
            return "tuple<" + ", ".join(_neutral(a, nodes, where, original) for a in args) + ">"
        if name == "bitset":
            return "array<bool>"
    if t in nodes:
        raise DriverError(f"{where}: {original.strip()!r} holds a {t} by value. LeetCode passes nodes as pointers ({t}*).")
    raise DriverError(f"{where}: the type {original.strip()!r} has no neutral name yet.")


def parse_neutral(ntype):
    """'array<array<int>>' -> ('array', [('array', [('int', [])])]). Used by
    Stage 2 to walk a type alongside its value."""
    m = re.fullmatch(r"([A-Za-z_-]+)(?:<(.*)>)?", ntype)
    if not m:
        raise ValueError(ntype)
    args = [parse_neutral(a.strip()) for a in split_top_level(m.group(2))] if m.group(2) else []
    return m.group(1), args
