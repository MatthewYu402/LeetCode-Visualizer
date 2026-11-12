"""Reading C++ source text without a compiler.

blank_comments_and_literals() replaces every comment, string literal, and
character literal with spaces, keeping newlines, so each character stays at
its position. Later stages then scan for braces and declarations without being
fooled by a `{` inside a string or a method written in a comment.

comments() returns the text of each comment, which is where LeetCode puts the
node definitions (`Definition for a Node.`).

This reads only declarations: the Solution class's method signatures and the
node classes. Statements are the rewriter's job, which uses Clang's real parser
(docs/driver-generation.md, Section 2).
"""

import re


def _scan(text):
    """Yields (kind, start, end) for every comment and literal in text.

    kind is "line", "block", "string", or "char". Raw strings R"x(...)x" are
    "string". A ' between two digits is a digit separator (1'000), not a char.
    """
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if text.startswith("//", i):
            end = text.find("\n", i)
            end = n if end == -1 else end
            yield "line", i, end
            i = end
        elif text.startswith("/*", i):
            end = text.find("*/", i + 2)
            end = n if end == -1 else end + 2
            yield "block", i, end
            i = end
        elif c == "R" and text.startswith('R"', i) and (i == 0 or not (text[i - 1].isalnum() or text[i - 1] == "_")):
            m = re.match(r'R"([^ ()\\\t\n]{0,16})\(', text[i:])
            if not m:
                i += 1
                continue
            close = ")" + m.group(1) + '"'
            end = text.find(close, i + m.end())
            end = n if end == -1 else end + len(close)
            yield "string", i, end
            i = end
        elif c == '"' or (c == "'" and not (i > 0 and text[i - 1].isalnum() and i + 1 < n and text[i + 1].isalnum())):
            j = i + 1
            while j < n and text[j] != c and text[j] != "\n":
                j += 2 if text[j] == "\\" else 1
            end = min(j + 1, n)
            yield ("string" if c == '"' else "char"), i, end
            i = end
        else:
            i += 1


def blank_comments_and_literals(text):
    out = list(text)
    for _, start, end in _scan(text):
        for k in range(start, end):
            if out[k] != "\n":
                out[k] = " "
    return "".join(out)


def comments(text):
    """The text of each comment, without the comment markers."""
    found = []
    for kind, start, end in _scan(text):
        if kind == "line":
            found.append(text[start + 2:end])
        elif kind == "block":
            found.append(text[start + 2:end - 2] if text[start:end].endswith("*/") else text[start + 2:end])
    return found


def matching(text, open_index, opener="{", closer="}"):
    """Index of the bracket that closes the one at open_index, or -1."""
    depth = 0
    for k in range(open_index, len(text)):
        if text[k] == opener:
            depth += 1
        elif text[k] == closer:
            depth -= 1
            if depth == 0:
                return k
    return -1


def split_top_level(text, sep=","):
    """Splits at `sep` outside <>, (), [], {}.

    `map<int, int> m, int k` -> ['map<int, int> m', ' int k']. A `<` counts
    as a bracket here, which is right for declarations (the only thing this
    reads), where `<` is never a comparison.
    """
    parts, depth, start = [], 0, 0
    for k, c in enumerate(text):
        if c in "<([{":
            depth += 1
        elif c in ">)]}":
            depth -= 1
        elif c == sep and depth == 0:
            parts.append(text[start:k])
            start = k + 1
    parts.append(text[start:])
    return parts


def find_class(stripped, name):
    """(body_start, body_end) of `class name {...}` or `struct name {...}`
    in stripped source, and the keyword used. body_start is just after `{`."""
    m = re.search(r"\b(class|struct)\s+" + re.escape(name) + r"\b[^;{]*\{", stripped)
    if not m:
        return None
    open_brace = m.end() - 1
    close = matching(stripped, open_brace)
    if close == -1:
        return None
    return open_brace + 1, close, m.group(1)
