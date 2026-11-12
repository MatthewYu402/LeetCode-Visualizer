"""Stage 1: example text -> neutral JSON. Shared by every language.

LeetCode writes an example as named arguments:

    Input: nums = [2,7,11,15], target = 9

parse_example() turns that into {"nums": [2, 7, 11, 15], "target": 9}. The
values are kept exactly as written: a tree stays a level-order array here.
What a value *means* (an array, a linked list, a tree) depends on the
parameter's type, and is decided in Stage 2.

LeetCode's values are JSON literals: numbers, true, false, null, and strings in
double quotes. So each value is read with json.loads once the text has been
split into `name = value` parts.
"""

import json
import re

from .errors import DriverError

_NAME = re.compile(r"[A-Za-z_][A-Za-z0-9_]*\Z")


def parse_example(text: str) -> dict:
    """Parses one example's input into {name: value}, in the order written.

    Accepts the input alone (`nums = [1,2], target = 3`) or a pasted block that
    starts with `Input:`. Anything from `Output:` onward is ignored, so the
    whole example block from a problem page can be pasted as is.
    """
    body = _input_part(text)
    if not body.strip():
        raise DriverError("The example is empty. Write it as name = value pairs, such as: nums = [2,7,11,15], target = 9")

    values = {}
    for part in _split_top_level(body):
        if "=" not in part:
            raise DriverError(f"Cannot read {part.strip()!r} in the example: expected name = value.")
        name, _, raw = part.partition("=")
        name = name.strip()
        if not _NAME.match(name):
            raise DriverError(f"{name!r} in the example is not a parameter name.")
        if name in values:
            raise DriverError(f"{name!r} appears twice in the example.")
        try:
            values[name] = json.loads(raw.strip(), parse_constant=_reject_constant)
        except (json.JSONDecodeError, ValueError) as error:
            raise DriverError(f"The value of {name!r} is not valid: {raw.strip()!r} ({error}).") from None
    return values


def _input_part(text: str) -> str:
    """The text between an optional `Input:` and an optional `Output:`."""
    start = re.search(r"\bInput\s*:", text)
    if start:
        text = text[start.end():]
    end = re.search(r"\bOutput\s*:", text)
    if end:
        text = text[:end.start()]
    return text


def _split_top_level(text: str) -> list:
    """Splits at commas that are outside brackets, braces, and strings.

    `nums = [1,2], s = "a,b"` -> ['nums = [1,2]', ' s = "a,b"'].
    """
    parts, depth, start, i = [], 0, 0, 0
    in_string = False
    while i < len(text):
        c = text[i]
        if in_string:
            if c == "\\":
                i += 1  # skip the escaped character
            elif c == '"':
                in_string = False
        elif c == '"':
            in_string = True
        elif c in "[{":
            depth += 1
        elif c in "]}":
            depth -= 1
            if depth < 0:
                raise DriverError(f"The example has an unmatched {c!r}.")
        elif c == "," and depth == 0:
            parts.append(text[start:i])
            start = i + 1
        i += 1
    if in_string:
        raise DriverError("The example has a string with no closing quote.")
    if depth != 0:
        raise DriverError("The example has an unclosed '[' or '{'.")
    parts.append(text[start:])
    return [p for p in parts if p.strip()]


def _reject_constant(token):
    # json.loads accepts NaN and Infinity by default. They are not JSON, and
    # LeetCode never writes them.
    raise ValueError(f"{token} is not a JSON value")
