"""python3 -m pipeline SOLUTION --example TEXT [-o trace.json]

One command from a pasted Solution and an example to a validated trace:
driver, rewriter, compile, run, validate (pipeline/__init__.py).

Writes the trace to -o, or to stdout. A summary, and anything the program
printed, go to stderr. Exit status: 0 when a valid trace was written; 2 when the
Solution or the example cannot be used; 3 when the generated program does not
build; 4 when the program crashed, timed out, or wrote no trace; 5 when the
trace is invalid.

The code runs directly on this machine, with only a time limit. Use it for your
own code; running other people's code needs the sandbox (docs/sandboxing.md).
"""

import argparse
import json
import sys
from pathlib import Path

from . import EXIT_INPUT, REWRITER, PipelineError, run


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python3 -m pipeline", description="Trace a LeetCode Solution on an example.")
    parser.add_argument("solution", type=Path, help="the Solution source, as pasted from LeetCode")
    parser.add_argument("--example", required=True, help='the example input, such as "nums = [2,7,11,15], target = 9"')
    parser.add_argument("-o", "--output", type=Path, help="write the trace here instead of stdout")
    parser.add_argument("--method", help="the method to call, when it cannot be told from the example")
    parser.add_argument("--timeout", type=float, default=10.0, help="seconds the program may run (default 10)")
    parser.add_argument("--rewriter", type=Path, default=REWRITER, help=f"the rewriter binary (default: {REWRITER})")
    parser.add_argument("--keep", action="store_true", help="keep the work folder (prelude, program.cpp, binary) and print its path")
    args = parser.parse_args(argv)

    try:
        source = args.solution.read_text(encoding="utf-8")
    except OSError as error:
        print(f"pipeline: {error}", file=sys.stderr)
        return EXIT_INPUT

    try:
        result = run(source, args.example, source_name=str(args.solution), method=args.method,
                     rewriter=args.rewriter, timeout=args.timeout, keep=args.keep)
    except PipelineError as error:
        print(f"pipeline: {error.stage}: {error}", file=sys.stderr)
        return error.exit_code

    text = json.dumps(result.trace, ensure_ascii=False)
    if args.output:
        args.output.write_text(text + "\n", encoding="utf-8")
    else:
        print(text)

    for warning in result.warnings:
        print(f"pipeline: note: {warning}", file=sys.stderr)
    trace = result.trace
    if trace.get("truncated"):
        ending = "stopped at the step limit (no result)"
    elif "result" in trace:
        ending = "result " + json.dumps(trace["result"])[:80]
    else:
        ending = "no result"
    where = f" -> {args.output}" if args.output else ""
    print(f"pipeline: {result.steps} steps, {ending}{where}", file=sys.stderr)
    if result.output.strip():
        print("pipeline: the program printed:\n" + result.output.rstrip(), file=sys.stderr)
    if result.work_dir:
        print(f"pipeline: work folder kept: {result.work_dir}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
