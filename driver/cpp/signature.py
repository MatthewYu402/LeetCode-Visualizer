"""Reads the Solution class: its methods, their parameters, and return types.

Only declarations are read, never statements. LeetCode generates the method's
signature itself, so it always has the plain shape `ReturnType name(Type a, Type& b)`.
Helper methods the user adds can be anything, so a method that cannot be read
is kept with `readable = False` and only causes an error if it is the one to call.
"""

import re
from dataclasses import dataclass, field

from ..errors import DriverError
from .source import blank_comments_and_literals, find_class, matching, split_top_level

_SPECIFIERS = r"\b(static|inline|virtual|constexpr|consteval|explicit|friend)\b"


@dataclass
class Param:
    name: str
    ctype: str          # as written, such as "vector<int>&"


@dataclass
class Method:
    name: str
    return_ctype: str
    params: list = field(default_factory=list)
    public: bool = True
    readable: bool = True
    note: str = ""      # why it is not readable


def read_methods(source):
    """Every method declared directly in class (or struct) Solution, in order."""
    stripped = blank_comments_and_literals(source)
    found = find_class(stripped, "Solution")
    if not found:
        raise DriverError("No `class Solution { ... };` found. Paste the whole Solution class.")
    start, end, keyword = found
    access = "private" if keyword == "class" else "public"
    methods, k, chunk_start = [], start, start

    while k < end:
        c = stripped[k]
        if c == "{":
            # A body: a method definition (or a nested type / initializer).
            close = matching(stripped, k)
            head = stripped[chunk_start:k]
            access, head = _take_access(access, head)
            method = _read_head(head)
            if method:
                method.public = access == "public"
                methods.append(method)
            k = close + 1
            # A nested class or struct ends with `};`; skip that `;`.
            while k < end and stripped[k] in " \t\n;":
                k += 1
            chunk_start = k
            continue
        if c == ";":
            head = stripped[chunk_start:k]
            access, head = _take_access(access, head)
            method = _read_head(head)  # a declaration without a body
            if method:
                method.public = access == "public"
                methods.append(method)
            chunk_start = k + 1
        elif c == ":" and re.search(r"\b(public|private|protected)\s*$", stripped[chunk_start:k]) and stripped[k + 1:k + 2] != ":":
            access = re.search(r"(public|private|protected)\s*$", stripped[chunk_start:k]).group(1)
            chunk_start = k + 1
        k += 1
    return methods


def _take_access(access, head):
    while True:
        m = re.match(r"\s*(public|private|protected)\s*:(?!:)", head)
        if not m:
            return access, head
        access, head = m.group(1), head[m.end():]


def _read_head(head):
    """A Method for `int f(vector<int>& a, int b) const`, or None when the
    text is not a method (a data member, a type, a using-declaration)."""
    text = " ".join(head.split())
    if not text or "(" not in text:
        return None
    if re.match(r"(using|typedef|enum|struct|class|union)\b", text):
        return None
    text = re.sub(r"\[\[[^\]]*\]\]", " ", text).strip()  # attributes
    if text.startswith("template"):
        name = re.search(r"([A-Za-z_]\w*)\s*\(", text)
        return Method(name.group(1) if name else "?", "", [], readable=False, note="it is a template")
    if re.match(r"friend\b", text):
        return None

    open_paren = _first_call_paren(text)
    if open_paren == -1:
        return None
    m = re.search(r"(~?[A-Za-z_]\w*)\s*$", text[:open_paren])
    if not m:
        return None  # operator(), or not a function
    name = m.group(1)
    if name in ("Solution", "~Solution") or "operator" in text[:open_paren]:
        return None
    prefix = re.sub(_SPECIFIERS, " ", text[:m.start()]).strip()
    close = matching(text, open_paren, "(", ")")
    if close == -1:
        return None
    if "=" in text[:open_paren]:
        return None  # a data member with an initializer, such as `int x = f(1)`
    rest = text[close + 1:]
    if prefix == "auto" and "->" in rest:
        prefix = rest.split("->", 1)[1].split("{")[0].strip()
        prefix = re.sub(r"\b(override|final|noexcept)\b", "", prefix).strip()
    if not prefix:
        return None  # a call, not a declaration

    method = Method(name, prefix)
    inner = text[open_paren + 1:close].strip()
    if inner and inner != "void":
        for raw in split_top_level(inner):
            raw = split_top_level(raw, "=")[0].strip()  # drop a default argument
            pm = re.match(r"(.*?)([A-Za-z_]\w*)\s*(\[\s*\d*\s*\])?$", raw)
            if not pm or not pm.group(1).strip():
                method.readable = False
                method.note = f"its parameter {raw!r} has no name"
                break
            method.params.append(Param(pm.group(2), pm.group(1).strip() + (pm.group(3) or "")))
    return method


def _first_call_paren(text):
    """Index of the `(` that starts the parameter list: the first one outside <>."""
    depth = 0
    for k, c in enumerate(text):
        if c == "<":
            depth += 1
        elif c == ">":
            depth -= 1
        elif c == "(" and depth == 0:
            return k
    return -1


def choose_method(methods, example_names, node_params_ok, method_name=None):
    """The method to call, and how the example's names map to its parameters.

    1. `method_name`, when given (the --method option), must name one public method.
    2. Otherwise, the public method whose parameter names are exactly the
       example's names. LeetCode's example names the parameters, and a helper
       rarely takes exactly the same ones.
    3. Otherwise, if exactly one public method has as many parameters as the
       example has values, and *none* of the example's names is one of its
       parameter names, it is called with the values in order. Clone Graph
       needs this: its example says `adjList = ...` but the parameter is `node`.
       When some names match and others do not, the others are a typo, and
       that is an error instead.

    `pos` (Linked List Cycle) is allowed as an extra name when the method has
    a ListNode parameter: it describes the input list, it is not passed.

    Returns (method, {example_name: param_name}).
    """
    public = [m for m in methods if m.public]
    if not public:
        raise DriverError("Solution has no public method to call.")

    def describe(ms):
        return "; ".join(f"{m.name}({', '.join(p.name for p in m.params)})" for m in ms)

    if method_name is not None:
        chosen = [m for m in public if m.name == method_name]
        if not chosen:
            raise DriverError(f"Solution has no public method named {method_name!r}. Public methods: {describe(public)}.")
        if len(chosen) > 1:
            raise DriverError(f"Solution has {len(chosen)} public methods named {method_name!r} (overloads), so the driver cannot tell which to call.")
        return _mapping(chosen[0], example_names, node_params_ok, by_name=True)

    def extra_ok(m):
        return {"pos"} if node_params_ok(m) and "pos" not in {p.name for p in m.params} else set()

    by_name = [m for m in public if {p.name for p in m.params} == set(example_names) - extra_ok(m)
               and len(m.params) == len(set(example_names) - extra_ok(m))]
    if len(by_name) == 1:
        return _mapping(by_name[0], example_names, node_params_ok, by_name=True)
    if len(by_name) > 1:
        raise DriverError(f"Several public methods take the example's parameters ({', '.join(example_names)}): {describe(by_name)}. "
                          f"Choose one with --method.")

    count = [m for m in public if len(m.params) == len([n for n in example_names if n not in extra_ok(m)])]
    if len(count) == 1 and not {p.name for p in count[0].params} & set(example_names):
        return _mapping(count[0], example_names, node_params_ok, by_name=False)
    if len(public) == 1:
        return _mapping(public[0], example_names, node_params_ok, by_name=True)  # its error names the difference
    raise DriverError(f"No public method takes the example's parameters ({', '.join(example_names)}). "
                      f"Public methods: {describe(public)}.")


def _mapping(method, example_names, node_params_ok, by_name):
    if not method.readable:
        raise DriverError(f"The driver cannot read the method {method.name!r}: {method.note}.")
    extras = {"pos"} if node_params_ok(method) and "pos" not in {p.name for p in method.params} else set()
    values = [n for n in example_names if n not in extras]
    if by_name:
        missing = [p.name for p in method.params if p.name not in values]
        unknown = [n for n in values if n not in {p.name for p in method.params}]
        if missing or unknown:
            raise DriverError(f"{method.name} takes ({', '.join(p.name for p in method.params)}), but the example gives "
                              f"({', '.join(example_names)})." + (f" Missing: {', '.join(missing)}." if missing else "")
                              + (f" Not a parameter: {', '.join(unknown)}." if unknown else ""))
        return method, {n: n for n in values}
    if len(values) != len(method.params):
        raise DriverError(f"{method.name} takes {len(method.params)} parameters, but the example gives {len(values)} values.")
    return method, {n: p.name for n, p in zip(values, method.params)}
