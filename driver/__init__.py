"""The driver: rebuilds LeetCode's hidden harness.

Given a pasted Solution and an example input, it produces what is needed to
run the Solution and trace it: the trace's `problem` object, a prelude header
(standard headers and node types), and a `main` that builds the inputs, calls
the method, and writes the trace. See docs/driver-generation.md.

Layout:
  errors.py   DriverError, the one exception every stage raises
  example.py  Stage 1, shared by every language: example text -> neutral JSON
  shapes.py   language-neutral decoding of LeetCode's notations for linked
              structures (linked lists, level-order trees, graphs, ...)
  cpp/        everything C++-specific: reading the signature and the node
              definitions, and generating the prelude and main
"""

from .errors import DriverError

__all__ = ["DriverError"]
