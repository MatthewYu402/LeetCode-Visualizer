"""Command line: python3 -m driver --lang cpp SOLUTION --example TEXT --out DIR

Writes three files into DIR:
  problem.json   the trace's problem object
  prelude.hpp    passed to the compiler with -include
  program.cpp    the code (the --code file if given, else SOLUTION) followed by main

and prints the commands that build and run it. Until the rewriter exists, pass
--code with a hand-instrumented copy of the Solution to get steps in the trace;
without it the program runs the plain Solution, and the trace has no steps.

Exit status: 0 on success, 2 when the input cannot be used (the message says why).
"""

import argparse
import json
import sys
from pathlib import Path

from .errors import DriverError


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python3 -m driver", description="Rebuild LeetCode's harness for a Solution and an example.")
    parser.add_argument("solution", type=Path, help="the Solution source, as pasted from LeetCode")
    parser.add_argument("--example", required=True, help='the example input, such as "nums = [2,7,11,15], target = 9"')
    parser.add_argument("--out", type=Path, required=True, help="directory to write problem.json, prelude.hpp, program.cpp")
    parser.add_argument("--lang", default="cpp", choices=["cpp"], help="the Solution's language (only cpp so far)")
    parser.add_argument("--method", help="the method to call, when the driver cannot tell")
    parser.add_argument("--code", type=Path, help="code to put in program.cpp instead of SOLUTION (an instrumented copy)")
    args = parser.parse_args(argv)

    from .cpp import generate

    try:
        source = args.solution.read_text(encoding="utf-8")
        program = generate(source, args.example, args.method)
    except DriverError as error:
        print(f"driver: {error}", file=sys.stderr)
        return 2
    except OSError as error:
        print(f"driver: {error}", file=sys.stderr)
        return 2

    code = args.code.read_text(encoding="utf-8") if args.code else source
    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "problem.json").write_text(json.dumps(program.problem, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (args.out / "prelude.hpp").write_text(program.prelude, encoding="utf-8")
    (args.out / "program.cpp").write_text(program.source(code), encoding="utf-8")

    for warning in program.warnings:
        print(f"driver: note: {warning}", file=sys.stderr)
    runtime = Path(__file__).resolve().parent.parent / "adapters" / "cpp" / "runtime"
    print(f"wrote {args.out}/problem.json, prelude.hpp, program.cpp")
    print(f"build: clang++ -std=c++20 -I {runtime} -include {args.out}/prelude.hpp {args.out}/program.cpp -o {args.out}/program")
    print(f"run:   TRACE_OUT={args.out}/trace.json {args.out}/program")
    return 0


if __name__ == "__main__":
    sys.exit(main())
