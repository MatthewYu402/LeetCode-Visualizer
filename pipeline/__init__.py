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

Where stages 2 to 4 run is chosen with `sandbox` (pipeline/runners.py):

    None, "none"   directly on this machine, with only time limits. Your own code only.
    "docker"       in a locked-down container, one per run (docs/sandboxing.md)
    "gvisor"       the same container under gVisor's runsc runtime. Anyone's code.

The driver (1) and validation (5) always run here, outside the container: the
driver never runs the user's code, and validation must be out of its reach.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from dataclasses import dataclass, field
from pathlib import Path

from driver import DriverError
from driver.cpp import generate

from .runners import Container, Limits, Local, SandboxError, SandboxStopped, StageTimeout

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ROOT / "adapters" / "cpp" / "runtime"
REWRITER = Path(os.environ.get("TRACE_REWRITE", ROOT / "adapters" / "cpp" / "rewriter" / "build" / "trace-rewrite"))
CHECK = ROOT / "tools" / "check_trace.py"

# Exit codes of the command line, one per stage that can fail.
EXIT_INPUT = 2      # the Solution or the example cannot be used (driver, or the code does not compile)
EXIT_BUILD = 3      # the generated program does not compile (a bug in the driver or the rewriter)
EXIT_RUN = 4        # the program crashed, ran out of time, or wrote no trace
EXIT_INVALID = 5    # the trace failed validation (a bug in the runtime)
EXIT_SANDBOX = 6    # the sandbox could not run: no Docker, no image, no gVisor runtime

SANDBOXES = (None, "none", "docker", "gvisor")
TRACE_CAP = 16 * 1024 * 1024        # bytes of trace read back; a larger trace is an error


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
        cxx=None, timeout=10.0, compile_timeout=120.0, keep=False, sandbox=None, limits=None, pool=None):
    """Runs every stage. Returns a Result, or raises PipelineError.

    sandbox: None (or "none") runs stages 2 to 4 on this machine; "docker" runs
    them in a locked-down container; "gvisor" does the same under gVisor's
    runsc runtime (docs/sandboxing.md). limits: a runners.Limits for the container.
    pool: a runners.Pool of containers started ahead of time (the API service keeps one).
    """
    if sandbox not in SANDBOXES:
        raise ValueError(f"sandbox must be one of {sorted(s for s in SANDBOXES if s)}, not {sandbox!r}")
    work = Path(tempfile.mkdtemp(prefix="trace-run-"))
    try:
        result = _run(work, source, example, source_name, method, Path(rewriter), cxx, timeout, compile_timeout,
                      sandbox, limits or Limits(), pool)
        if keep:
            result.work_dir = work
        return result
    finally:
        if not keep:
            shutil.rmtree(work, ignore_errors=True)


def _runner(work, sandbox, rewriter, cxx, compile_timeout, limits, pool):
    if sandbox in (None, "none"):
        if not rewriter.exists():
            raise PipelineError("rewriter", f"The rewriter is not built ({rewriter}). Run: make -C adapters/cpp/rewriter", EXIT_BUILD)
        return Local(work, rewriter, cxx or compiler(), RUNTIME, compile_timeout)
    try:
        return Container(runtime="runsc" if sandbox == "gvisor" else None, limits=limits, compile_timeout=compile_timeout, pool=pool)
    except SandboxError as error:
        raise PipelineError("sandbox", str(error), EXIT_SANDBOX) from None
    except StageTimeout:
        raise PipelineError("sandbox", "Docker did not answer in time.", EXIT_SANDBOX) from None


def _run(work, source, example, source_name, method, rewriter, cxx, timeout, compile_timeout, sandbox, limits, pool):
    # 1. driver (outside the sandbox: it reads text and never runs the user's code)
    try:
        program = generate(source, example, method)
    except DriverError as error:
        raise PipelineError("driver", str(error), EXIT_INPUT) from None
    # The work folder on this machine keeps a copy of every input (for --keep),
    # whether or not the stages below run here.
    (work / "prelude.hpp").write_text(program.prelude, encoding="utf-8")
    (work / "solution.cpp").write_text(source, encoding="utf-8")

    runner = _runner(work, sandbox, rewriter, cxx, compile_timeout, limits, pool)
    try:
        trace_bytes, output = _stages(runner, work, program, source, source_name, timeout, compile_timeout, limits, sandbox)
    except SandboxError as error:
        raise PipelineError("sandbox", str(error), EXIT_SANDBOX) from None
    except StageTimeout:
        raise PipelineError("sandbox", "The sandbox did not answer in time.", EXIT_SANDBOX) from None
    finally:
        runner.close()

    # 5. validate, outside whatever ran the code (CLAUDE.md invariant 9)
    trace_file = work / "trace.json"
    trace_file.write_bytes(trace_bytes)
    checked = subprocess.run([sys.executable, "-I", str(CHECK), str(trace_file)], capture_output=True, text=True)
    if checked.returncode != 0:
        raise PipelineError("validate", "The trace is not valid. This is a bug in the runtime:\n" + checked.stdout + checked.stderr, EXIT_INVALID)

    return Result(json.loads(trace_bytes.decode("utf-8")), output, program.warnings)


def _stages(runner, work, program, source, source_name, timeout, compile_timeout, limits, sandbox):
    """Stages 2 to 4. Returns (the trace file's bytes, what the program printed)."""
    # 2 and 3. rewrite, then compile. The rewriter parses the Solution exactly
    # as the compiler will, so it is also where the user's own compile errors
    # are found and reported.
    built = runner.build(program.prelude, source, program.main)
    if built.stage == "rewriter":
        if built.stopped:
            raise PipelineError("rewriter", f"Reading the code took longer than {compile_timeout:g} seconds or used more "
                                f"than {limits.memory} of memory, and was stopped.", EXIT_INPUT)
        raise PipelineError("rewriter", "The code does not compile:\n" + runner.shown(built.stderr, source_name), EXIT_INPUT)
    (work / "program.cpp").write_text(program.source(built.rewritten), encoding="utf-8")
    if built.stage == "compile":
        if built.stopped:
            raise PipelineError("compile", f"Compiling took longer than {compile_timeout:g} seconds or used more than "
                                f"{limits.memory} of memory, and was stopped.", EXIT_BUILD)
        raise PipelineError("compile", "The generated program does not compile. This is a bug in the driver or the "
                            f"rewriter, not in your code:\n{built.stderr}", EXIT_BUILD)

    # 4. run
    try:
        ran = runner.execute(timeout)
    except StageTimeout as timed_out:
        raise PipelineError("run", f"The program did not finish within {timeout:g} seconds, and was stopped. "
                            "A loop with no statements in its body never reaches the step limit, so it has no trace."
                            + _printed(timed_out.output), EXIT_RUN) from None
    except SandboxStopped as stopped:
        if stopped.oom:
            why = f"it used more than the memory limit ({limits.memory})"
        else:
            why = f"most likely by one of its limits, such as memory ({limits.memory}) or processes ({limits.pids})"
        raise PipelineError("run", f"The sandbox was stopped while the program ran: {why}. No trace was written "
                            f"({stopped.detail}).", EXIT_RUN) from None
    trace_bytes, collected = runner.collect(TRACE_CAP)
    output = ran.output if collected is None else collected
    if ran.signal:
        why = ""
        if ran.signal == "SIGKILL" and sandbox not in (None, "none"):
            why = f" It was most likely stopped for using more than the memory limit ({limits.memory})."
        elif ran.signal == "SIGXFSZ" or ran.signal == "SIGBUS":
            why = " It may have run out of space for its output."
        raise PipelineError("run", f"The program crashed ({ran.signal}) before writing a trace.{why}" + _printed(output), EXIT_RUN)
    if ran.returncode != 0 or trace_bytes is None:
        raise PipelineError("run", f"The program exited with status {ran.returncode} and wrote no trace." + _printed(output), EXIT_RUN)
    if len(trace_bytes) > TRACE_CAP:
        raise PipelineError("run", f"The trace is larger than {TRACE_CAP // (1024 * 1024)} MB, and was not read.", EXIT_RUN)
    return trace_bytes, output


def _printed(output):
    text = (output or "").strip()
    if not text:
        return ""
    lines = text.splitlines()
    shown = "\n".join(lines[-20:])
    return f"\nLast output from the program:\n{shown}"
