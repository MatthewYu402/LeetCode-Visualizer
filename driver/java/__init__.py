"""The Java driver. See generate.py, and describe.py for what an input form needs.

example_fields and example_text are the C++ driver's: they only split and join LeetCode's
example text, which is the same in every language.
"""

from ..cpp.describe import example_fields, example_text
from .describe import describe
from .generate import Program, generate

__all__ = ["Program", "describe", "example_fields", "example_text", "generate"]
