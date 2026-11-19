"""Reads class Solution's methods from Java source, without a compiler.

LeetCode generates the method's signature itself, `public int[] twoSum(int[] nums, int target)`,
so only declarations are read: comments and literals are blanked (driver/cpp/source.py, which
reads Java's comments and literals the same way), then each `type name(params) {` directly in
the class body is a method. Statements are the rewriter's job (adapters/java), which uses the
JDK's own parser.

A method is public when it says `public`, or says nothing (package access, which LeetCode's
harness can call); `private` and `protected` helpers are left out of the form. A method that
cannot be read is kept with readable = False and only causes an error if it is the one to call.
"""

import re

from ..cpp.signature import Method, Param
from ..cpp.source import blank_comments_and_literals, find_class, matching, split_top_level
from ..errors import DriverError

_MODIFIERS = {"public", "private", "protected", "static", "final", "abstract", "synchronized", "native", "strictfp", "default"}


def read_methods(source):
    """Every method declared directly in class Solution, in order."""
    stripped = blank_comments_and_literals(source)
    found = find_class(stripped, "Solution")
    if not found:
        other = re.search(r"\b(?:class|interface|record|enum)\s+([A-Za-z_$][\w$]*)", stripped)
        if other:
            raise DriverError(f"No `class Solution` found, only `{other.group(1)}`. If this is a design problem (LRU Cache, "
                              "Min Stack, ...), where the example is a sequence of calls, it is not supported yet: only "
                              "algorithmic problems, where Solution has a method to call with arguments.")
        raise DriverError("No `class Solution { ... }` found. Paste the whole Solution class.")
    start, end, _ = found
    methods = []
    k, chunk = start, start
    while k < end:
        c = stripped[k]
        if c == "{":
            close = matching(stripped, k)
            if close == -1:
                raise DriverError("The braces of class Solution do not match.")
            method = _read_head(source, stripped, chunk, k)
            if method:
                methods.append(method)
            k = close + 1
            chunk = k
        elif c in ";}":
            k += 1
            chunk = k
        else:
            k += 1
    return methods


def _read_head(source, stripped, chunk, brace):
    """A method from the text before a `{`: `modifiers <T> Type name(params) throws X`. None for anything else."""
    head = stripped[chunk:brace]
    m = re.search(r"([A-Za-z_$][\w$]*)\s*\(", head)
    if not m:
        return None  # a nested class, an initializer block
    open_paren = chunk + m.end() - 1
    close_paren = matching(stripped, open_paren, "(", ")")
    if close_paren == -1 or close_paren > brace:
        return None
    if re.sub(r"throws\s+[\w$.,\s<>]+", "", stripped[close_paren + 1:brace]).strip():
        return None  # `new Comparator<>() {`, `= x -> {`: not a declaration
    name = m.group(1)
    if re.search(r"\b(class|interface|enum|record|new|return)\b|[=.]", head[:m.start()]):
        return None
    prefix = head[:m.start()].strip()
    modifiers = set()
    while True:
        mm = re.match(r"(\w+)\s+", prefix + " ")
        if mm and mm.group(1) in _MODIFIERS:
            modifiers.add(mm.group(1))
            prefix = prefix[mm.end():].strip() if mm.end() <= len(prefix) else ""
            continue
        if prefix.startswith("@"):
            prefix = re.sub(r"^@\w+(\([^)]*\))?\s*", "", prefix)
            continue
        break
    if prefix.startswith("<"):  # a generic method's type parameters
        close = matching(prefix, 0, "<", ">")
        prefix = prefix[close + 1:].strip() if close != -1 else prefix
    return_type = prefix
    if not return_type or name == "Solution":
        return None  # a constructor
    method = Method(name, return_type)
    method.public = "private" not in modifiers and "protected" not in modifiers
    method.static = "static" in modifiers
    params_text = source[open_paren + 1:close_paren]
    stripped_params = stripped[open_paren + 1:close_paren]
    if stripped_params.strip():
        offset = 0
        for part in split_top_level(stripped_params):
            original = params_text[offset:offset + len(part)]
            offset += len(part) + 1
            words = original.strip()
            pm = re.match(r"^(.*?)([A-Za-z_$][\w$]*)\s*((?:\[\s*\]\s*)*)$", words, re.S)
            if not pm or not pm.group(1).strip():
                method.readable, method.note = False, f"its parameter {words!r} cannot be read"
                break
            ptype = pm.group(1).strip() + pm.group(3).replace(" ", "")
            method.params.append(Param(pm.group(2), " ".join(ptype.split())))
    return method
