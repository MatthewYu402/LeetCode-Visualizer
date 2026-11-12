"""Command line: python3 -m driver --lang cpp SOLUTION --example TEXT --out DIR [--rewrite]

Writes three files into DIR:
  problem.json   the trace's problem object
  prelude.hpp    passed to the compiler with -include
  program.cpp    the code followed by main

and prints the commands that build and run it. The code in program.cpp is:
  --rewrite      SOLUTION instrumented by the rewriter (adapters/cpp/rewriter),
                 so the trace has steps. Needs the rewriter built
                 (make -C adapters/cpp/rewriter), or --rewriter PATH.
  --code FILE    FILE as it is, such as a hand-instrumented copy
  neither        SOLUTION as it is: the trace has a result but no steps

Exit status: 0 on success, 2 when the input cannot be used (the message says why).
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

from .errors import DriverError

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ROOT / "adapters" / "cpp" / "runtime"
REWRITER = ROOT / "adapters" / "cpp" / "rewriter" / "build" / "trace-rewrite"


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python3 -m driver", description="Rebuild LeetCode's harness for a Solution and an example.")
    parser.add_argument("solution", type=Path, help="the Solution source, as pasted from LeetCode")
    parser.add_argument("--example", required=True, help='the example input, such as "nums = [2,7,11,15], target = 9"')
    parser.add_argument("--out", type=Path, required=True, help="directory to write problem.json, prelude.hpp, program.cpp")
    parser.add_argument("--lang", default="cpp", choices=["cpp"], help="the Solution's language (only cpp so far)")
    parser.add_argument("--method", help="the method to call, when the driver cannot tell")
    code_source = parser.add_mutually_exclusive_group()
    code_source.add_argument("--rewrite", action="store_true", help="instrument SOLUTION with the rewriter")
    code_source.add_argument("--code", type=Path, help="code to put in program.cpp instead of SOLUTION (an instrumented copy)")
    parser.add_argument("--rewriter", type=Path, default=REWRITER, help=f"the rewriter binary (default: {REWRITER})")
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

    args.out.mkdir(parents=True, exist_ok=True)
    (args.out / "problem.json").write_text(json.dumps(program.problem, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    (args.out / "prelude.hpp").write_text(program.prelude, encoding="utf-8")

    if args.rewrite:
        # The rewriter parses SOLUTION with the same prelude the program will be built with.
        if not args.rewriter.exists():
            print(f"driver: the rewriter is not built ({args.rewriter}). Run: make -C adapters/cpp/rewriter", file=sys.stderr)
            return 2
        rewritten = subprocess.run([str(args.rewriter), str(args.solution), "--", "-std=c++20", "-I", str(RUNTIME),
                                    "-include", str(args.out / "prelude.hpp")], capture_output=True, text=True)
        if rewritten.returncode != 0:
            print(f"driver: the rewriter could not read {args.solution}:\n{rewritten.stderr}", file=sys.stderr, end="")
            return 2
        code = rewritten.stdout
    elif args.code:
        code = args.code.read_text(encoding="utf-8")
    else:
        code = source
    (args.out / "program.cpp").write_text(program.source(code), encoding="utf-8")

    for warning in program.warnings:
        print(f"driver: note: {warning}", file=sys.stderr)
    print(f"wrote {args.out}/problem.json, prelude.hpp, program.cpp")
    print(f"build: clang++ -std=c++20 -I {RUNTIME} -include {args.out}/prelude.hpp {args.out}/program.cpp -o {args.out}/program")
    print(f"run:   TRACE_OUT={args.out}/trace.json {args.out}/program")
    return 0


if __name__ == "__main__":
    sys.exit(main())
