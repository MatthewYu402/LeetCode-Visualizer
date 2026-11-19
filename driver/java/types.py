"""Java types -> neutral type names (trace-format.md §4), and the parsed form generate() builds from.

    int, long, short, byte, Integer, Long     int
    double, float, Double, Float              float
    boolean, Boolean                          bool
    char, Character                           char
    String                                    string
    int[], char[][]                           array<int>, array<array<char>>
    List<T>, ArrayList<T>                     array<T>
    LinkedList<T>                             list<T>
    Set<T>, HashSet<T>, TreeSet<T>            set<T>
    Map<K, V>, HashMap<K, V>, TreeMap<K, V>   map<K, V>
    Queue<T>, Deque<T>, Stack<T>              queue<T>, deque<T>, stack<T>
    PriorityQueue<T>                          priority-queue<T>
    ListNode, TreeNode, Node                  that name
    void (a return type)                      void
"""

import re
from dataclasses import dataclass, field

from ..cpp.source import split_top_level
from ..errors import DriverError

INTS = {"int", "long", "short", "byte", "Integer", "Long", "Short", "Byte"}
FLOATS = {"double", "float", "Double", "Float"}
ONE = {"List": "array", "ArrayList": "array", "Collection": "array", "Iterable": "array", "LinkedList": "list",
       "Set": "set", "HashSet": "set", "TreeSet": "set", "LinkedHashSet": "set", "SortedSet": "set",
       "Queue": "queue", "Deque": "deque", "ArrayDeque": "deque", "Stack": "stack", "PriorityQueue": "priority-queue"}
TWO = {"Map", "HashMap", "TreeMap", "LinkedHashMap", "SortedMap"}
BOXED = {"int": "Integer", "long": "Long", "short": "Short", "byte": "Byte", "double": "Double", "float": "Float",
         "boolean": "Boolean", "char": "Character"}


@dataclass
class JType:
    base: str                                  # "int", "List", "ListNode"
    args: list = field(default_factory=list)   # type arguments, as JTypes
    dims: int = 0                              # [] count
    text: str = ""                             # as written, without spaces around it

    def element(self):
        """The type one array level down."""
        return JType(self.base, self.args, self.dims - 1, re.sub(r"\[\s*\]\s*$", "", self.text).strip())


def parse(text):
    """`List<List<Integer>>` -> JType. Raises ValueError when it is not a type."""
    t = re.sub(r"@\w+(\([^)]*\))?\s*", "", text).strip()
    t = re.sub(r"^final\s+", "", t)
    dims = 0
    while True:
        m = re.search(r"\[\s*\]\s*$", t)
        if not m:
            break
        dims += 1
        t = t[:m.start()].rstrip()
    if t.endswith("..."):
        dims += 1
        t = t[:-3].rstrip()
    args = []
    lt = t.find("<")
    if lt >= 0:
        if not t.endswith(">"):
            raise ValueError(text)
        inner = t[lt + 1:-1]
        args = [parse(a) for a in split_top_level(inner)] if inner.strip() else []
        t = t[:lt].strip()
    if not re.fullmatch(r"[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*", t):
        raise ValueError(text)
    base = t.rsplit(".", 1)[-1]
    return JType(base, args, dims, " ".join(text.split()))


def neutral(text, node_types, where, returns=False):
    try:
        return _neutral(parse(text), set(node_types), returns)
    except (ValueError, _Unreadable):
        raise DriverError(f"{where}: the driver cannot read the type {text.strip()!r} yet.") from None


class _Unreadable(Exception):
    pass


def _neutral(t, nodes, returns):
    if t.dims:
        return f"array<{_neutral(JType(t.base, t.args, t.dims - 1), nodes, False)}>"
    b = t.base
    if b == "void":
        if returns:
            return "void"
        raise _Unreadable()
    if b in INTS:
        return "int"
    if b in FLOATS:
        return "float"
    if b in ("boolean", "Boolean"):
        return "bool"
    if b in ("char", "Character"):
        return "char"
    if b in ("String", "CharSequence"):
        return "string"
    if b in nodes:
        return b
    if b in ONE:
        if len(t.args) != 1:
            raise _Unreadable()
        return f"{ONE[b]}<{_neutral(t.args[0], nodes, False)}>"
    if b in TWO:
        if len(t.args) != 2:
            raise _Unreadable()
        return f"map<{_neutral(t.args[0], nodes, False)}, {_neutral(t.args[1], nodes, False)}>"
    raise _Unreadable()
