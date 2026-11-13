"""The whole pipeline, as one call: a Solution and an example in, a validated trace out.

    run(source, example) -> Result(trace, output, steps, ...)

The stages, in order (README "Pipeline", docs/driver-generation.md, docs/adapters/cpp.md §8):

    1. driver     generate(): the problem object, prelude.hpp, and main
    2. rewriter   trace-rewrite: the Solution with the runtime's calls inserted
    3. compile    $CXX -std=c++20 -include prelude.hpp program.cpp
    4. run        the program, with TRACE_OUT set and a time limit
    5. validate   tools/check_trace.py: the schema and the rules it cannot express

Every failure is a PipelineError that names the stage and says what went wrong
in the user's terms, with an exit code for the command line.

There is no sandbox here: step 4 runs the code directly on this machine, with
only a time limit. That is fine for your own code. Running other people's code
needs the sandbox (docs/sandboxing.md), which wraps steps 3 and 4.
"""

import json
import os
import re
import shutil
import signal
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from driver import DriverError
from driver.cpp import generate

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ROOT / "adapters" / "cpp" / "runtime"
REWRITER = Path(os.environ.get("TRACE_REWRITE", ROOT / "adapters" / "cpp" / "rewriter" / "build" / "trace-rewrite"))
CHECK = ROOT / "tools" / "check_trace.py"

# Exit codes of the command line, one per stage that can fail.
EXIT_INPUT = 2      # the Solution or the example cannot be used (driver, or the code does not compile)
EXIT_BUILD = 3      # the generated program does not compile (a bug in the driver or the rewriter)
EXIT_RUN = 4        # the program crashed, ran out of time, or wrote no trace
EXIT_INVALID = 5    # the trace failed validation (a bug in the runtime)


class PipelineError(Exception):
    def __init__(self, stage, message, exit_code):
        super().__init__(message)
        self.stage, self.exit_code = stage, exit_code


@dataclass
class Result:
    trace: dict
    output: str                 # what the user's code printed (stdout and stderr)
    warnings: list = field(default_factory=list)
    work_dir: Path = None       # kept only when run(..., keep=True)

    @property
    def steps(self):
        return len(self.trace["steps"])


def compiler():
    for candidate in (os.environ.get("CXX"), "clang++", "g++"):
        if candidate and shutil.which(candidate):
            return candidate
    raise PipelineError("compile", "No C++ compiler found. Install clang++ or g++, or set CXX.", EXIT_BUILD)


def run(source, example, *, source_name="solution.cpp", method=None, rewriter=REWRITER,
        cxx=None, timeout=10.0, compile_timeout=120.0, keep=False):
    """Runs every stage. Returns a Result, or raises PipelineError."""
    work = Path(tempfile.mkdtemp(prefix="trace-run-"))
    try:
        result = _run(work, source, example, source_name, method, Path(rewriter), cxx or compiler(), timeout, compile_timeout)
        if keep:
            result.work_dir = work
        return result
    finally:
        if not keep:
            shutil.rmtree(work, ignore_errors=True)


def _run(work, source, example, source_name, method, rewriter, cxx, timeout, compile_timeout):
    # 1. driver
    try:
        program = generate(source, example, method)
    except DriverError as error:
        raise PipelineError("driver", str(error), EXIT_INPUT) from None
    prelude = work / "prelude.hpp"
    prelude.write_text(program.prelude, encoding="utf-8")

    # 2. rewriter. It parses the Solution exactly as the compiler will, so this
    # is also where the user's own compile errors are found and reported.
    if not rewriter.exists():
        raise PipelineError("rewriter", f"The rewriter is not built ({rewriter}). Run: make -C adapters/cpp/rewriter", EXIT_BUILD)
    solution = work / Path(source_name).name
    solution.write_text(source, encoding="utf-8")
    rewritten = subprocess.run([str(rewriter), str(solution), "--", "-std=c++20", "-I", str(RUNTIME), "-include", str(prelude)],
                               capture_output=True, text=True, timeout=compile_timeout)
    if rewritten.returncode != 0:
        raise PipelineError("rewriter", "The code does not compile:\n" + _user_paths(rewritten.stderr, work, source_name), EXIT_INPUT)

    # 3. compile
    program_file = work / "program.cpp"
    program_file.write_text(program.source(rewritten.stdout), encoding="utf-8")
    binary = work / "program"
    built = subprocess.run([cxx, "-std=c++20", "-O0", "-w", "-I", str(RUNTIME), "-include", str(prelude),
                            str(program_file), "-o", str(binary)], capture_output=True, text=True, timeout=compile_timeout)
    if built.returncode != 0:
        raise PipelineError("compile", "The generated program does not compile. This is a bug in the driver or the "
                            f"rewriter, not in your code:\n{built.stderr}", EXIT_BUILD)

    # 4. run
    trace_file = work / "trace.json"
    try:
        ran = subprocess.run([str(binary)], env={**os.environ, "TRACE_OUT": str(trace_file)},
                             capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired as expired:
        raise PipelineError("run", f"The program did not finish within {timeout:g} seconds, and was stopped. "
                            "A loop with no statements in its body never reaches the step limit, so it has no trace."
                            + _printed(expired.stdout, expired.stderr), EXIT_RUN) from None
    output = (ran.stdout or "") + (ran.stderr or "")
    if ran.returncode < 0:
        name = signal.Signals(-ran.returncode).name
        raise PipelineError("run", f"The program crashed ({name}) before writing a trace." + _printed(ran.stdout, ran.stderr), EXIT_RUN)
    if ran.returncode != 0 or not trace_file.exists():
        raise PipelineError("run", f"The program exited with status {ran.returncode} and wrote no trace." + _printed(ran.stdout, ran.stderr), EXIT_RUN)

    # 5. validate (outside the program, as the sandbox design requires)
    checked = subprocess.run([sys.executable, "-I", str(CHECK), str(trace_file)], capture_output=True, text=True)
    if checked.returncode != 0:
        raise PipelineError("validate", "The trace is not valid. This is a bug in the runtime:\n" + checked.stdout + checked.stderr, EXIT_INVALID)

    return Result(json.loads(trace_file.read_text(encoding="utf-8")), output, program.warnings)


def _user_paths(text, work, source_name):
    """Clang's messages name the copy in the work folder; show the user's file name instead."""
    return text.replace(str(work / Path(source_name).name), source_name)


def _printed(stdout, stderr):
    text = ""
    for part in (stdout, stderr):
        if isinstance(part, bytes):
            part = part.decode("utf-8", "replace")
        text += part or ""
    text = text.strip()
    if not text:
        return ""
    lines = text.splitlines()
    shown = "\n".join(lines[-20:])
    return f"\nLast output from the program:\n{shown}"
