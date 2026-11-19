"""Reads class Solution's methods from Python source, with the ast module.

LeetCode's Python 3 stubs always annotate the method, `def twoSum(self, nums: List[int],
target: int) -> List[int]:`, so a parameter's type comes from its hint. A method whose
parameters are not all annotated is kept with `readable = False`, and causes an error
only if it is the one to call. The Method and Param records are the C++ driver's, so
both languages choose a method by the same rules (driver/cpp/signature.py, choose_method).
"""

import ast
import re

from ..cpp.signature import Method, Param
from ..errors import DriverError

_EMPTY_BODY = re.compile(r"expected an indented block after function definition on line (\d+)")


def parse(source, empty_bodies=False):
    """The module's syntax tree, or a DriverError that names the line.

    empty_bodies: a method with no body yet, as LeetCode's Python template has
    (`def twoSum(...) -> List[int]:` and nothing under it), reads as if its body
    were `pass`. describe() uses it, so the form shows the parameters before the
    body is written; a run still needs valid code.
    """
    lines = source.splitlines()
    for _ in range(50):
        try:
            return ast.parse("\n".join(lines) + "\n" if empty_bodies else source)
        except SyntaxError as error:
            empty = _EMPTY_BODY.search(error.msg or "") if empty_bodies else None
            if empty is None or not 1 <= int(empty.group(1)) <= len(lines) or not error.lineno:
                where = f"line {error.lineno}: " if error.lineno else ""
                raise DriverError(f"The code is not valid Python 3: {where}{error.msg}.") from None
            header = lines[int(empty.group(1)) - 1]
            indent = header[:len(header) - len(header.lstrip())]
            at = max(error.lineno - 1, int(empty.group(1)))  # never above the header (at the end, lineno is the header's)
            lines.insert(min(at, len(lines)), indent + "    pass")
    raise DriverError("The code is not valid Python 3.")


def read_methods(tree):
    """Every method of class Solution, in order. `ctype` holds the hint's text, and
    `hint` (an extra attribute) the hint itself, for the type reader."""
    solution = next((n for n in tree.body if isinstance(n, ast.ClassDef) and n.name == "Solution"), None)
    if solution is None:
        other = next((n.name for n in tree.body if isinstance(n, ast.ClassDef)), None)
        if other:
            raise DriverError(f"No `class Solution` found, only `{other}`. If this is a design problem (LRU Cache, "
                              "Min Stack, ...), where the example is a sequence of calls, it is not supported yet: only "
                              "algorithmic problems, where Solution has a method to call with arguments.")
        raise DriverError("No `class Solution:` found. Paste the whole Solution class.")
    methods = []
    for node in solution.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            continue
        method = Method(node.name, ast.unparse(node.returns) if node.returns else "")
        method.public = not node.name.startswith("_")
        method.returns_hint = node.returns
        positional = node.args.posonlyargs + node.args.args
        if any(isinstance(d, ast.Name) and d.id in ("staticmethod", "classmethod") for d in node.decorator_list):
            method.readable, method.note = False, "it is a static or class method"
        elif not positional or positional[0].arg != "self":
            method.readable, method.note = False, "its first parameter is not self"
        else:
            for arg in positional[1:]:
                if arg.annotation is None:
                    method.readable, method.note = False, f"its parameter {arg.arg!r} has no type hint (LeetCode writes one, such as nums: List[int])"
                    break
                param = Param(arg.arg, ast.unparse(arg.annotation))
                param.hint = arg.annotation
                method.params.append(param)
            if node.args.vararg or node.args.kwarg or node.args.kwonlyargs:
                method.readable, method.note = False, "it takes *args, **kwargs, or keyword-only parameters"
        methods.append(method)
    return methods
