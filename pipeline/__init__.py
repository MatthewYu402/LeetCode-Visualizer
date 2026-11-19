"""The whole pipeline, as one call: a Solution and an example in, a validated trace out.

    run(source, example, language="cpp") -> Result(trace, output, steps, ...)

The stages for C++, in order (README "Pipeline", docs/driver-generation.md, docs/adapters/cpp.md §8):

    1. driver     generate(): the problem object, prelude.hpp, and main
    2. rewriter   trace-rewrite: the Solution with the runtime's calls inserted
    3. compile    $CXX -std=c++20 -include prelude.hpp program.cpp
    4. run        the program, with TRACE_OUT set and a time limit
    5. validate   tools/check_trace.py: the schema and the rules it cannot express

For Python (docs/adapters/python.md) stages 2 to 4 are one: the driver writes
run.json, and adapters/python/run.py instruments the Solution, runs it under
the tracer, and writes the trace. For Java (docs/adapters/java.md) stages 2 and
3 are one JVM (lvtrace.Build: the rewriter, then javac), and the driver writes
LvMain.java and Nodes.java instead of a main. Driver and validation are the same.

Every failure is a PipelineError that names the stage and says what went wrong
in the user's terms, with an exit code for the command line.

Where stages 2 to 4 run is chosen with `sandbox` (pipeline/runners.py), in the
image for the language:

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
from driver import cpp as cpp_driver
from driver import java as java_driver
from driver import python as python_driver

from .runners import Container, Limits, Local, LocalJava, LocalPython, SandboxError, SandboxStopped, StageTimeout

ROOT = Path(__file__).resolve().parent.parent
RUNTIME = ROOT / "adapters" / "cpp" / "runtime"
REWRITER = Path(os.environ.get("TRACE_REWRITE", ROOT / "adapters" / "cpp" / "rewriter" / "build" / "trace-rewrite"))
CHECK = ROOT / "tools" / "check_trace.py"
PYTHON_ADAPTER = ROOT / "adapters" / "python"
JAVA_CLASSES = Path(os.environ.get("TRACE_JAVA_CLASSES", ROOT / "adapters" / "java" / "build" / "classes"))

LANGUAGES = ("cpp", "python", "java")

# Exit codes of the command line, one per stage that can fail.
EXIT_INPUT = 2      # the Solution or the example cannot be used (driver, or the code does not compile)
EXIT_BUILD = 3      # the generated program does not compile, or the Python tracer failed (a bug here, not in the code)
EXIT_RUN = 4        # the program crashed, ran out of time, or wrote no trace
EXIT_INVALID = 5    # the trace failed validation (a bug in the runtime)
EXIT_SANDBOX = 6    # the sandbox could not run: no Docker, no image, no gVisor runtime

SANDBOXES = (None, "none", "docker", "gvisor")
TRACE_CAP = 16 * 1024 * 1024        # bytes of trace read back; a larger trace is an error
TOO_LARGE = (f"The trace is larger than {TRACE_CAP // (1024 * 1024)} MB, and was not read. Every step holds every call "
             "in progress, so a recursion thousands of calls deep (or one that never reaches its base case) makes a very "
             "large trace. Try a smaller example.")


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


def python():
    """Python 3.12 or later, for running Python Solutions on this machine: TRACE_PYTHON, else python3.12, else this one."""
    for candidate in (os.environ.get("TRACE_PYTHON"), "python3.12"):
        if candidate and shutil.which(candidate):
            return candidate
    if sys.version_info >= (3, 12):
        return sys.executable
    raise PipelineError("run", "Python Solutions run with Python 3.12 or later. Install python3.12, or set TRACE_PYTHON.", EXIT_BUILD)


def java():
    """`java` from a JDK 21 or later, for running Java Solutions on this machine: TRACE_JAVA, else java on PATH."""
    found = os.environ.get("TRACE_JAVA") or shutil.which("java")
    if not found:
        raise PipelineError("compile", "Java Solutions need a JDK (21 or later). Install one, or set TRACE_JAVA.", EXIT_BUILD)
    return found


def run(source, example, *, language="cpp", source_name=None, method=None, rewriter=REWRITER,
        cxx=None, timeout=10.0, compile_timeout=120.0, keep=False, sandbox=None, limits=None, pool=None):
    """Runs every stage. Returns a Result, or raises PipelineError.

    language: "cpp" or "python", the language of `source`.

    sandbox: None (or "none") runs stages 2 to 4 on this machine; "docker" runs
    them in a locked-down container; "gvisor" does the same under gVisor's
    runsc runtime (docs/sandboxing.md). limits: a runners.Limits for the container.
    pool: a runners.Pool of containers started ahead of time (the API service keeps one).
    """
    if sandbox not in SANDBOXES:
        raise ValueError(f"sandbox must be one of {sorted(s for s in SANDBOXES if s)}, not {sandbox!r}")
    if language not in LANGUAGES:
        raise ValueError(f"language must be one of {list(LANGUAGES)}, not {language!r}")
    work = Path(tempfile.mkdtemp(prefix="trace-run-"))
    try:
        if language == "python":
            result = _run_python(work, source, example, method, timeout, sandbox, limits or Limits(), pool)
        elif language == "java":
            result = _run_java(work, source, example, source_name or "Solution.java", method, timeout, compile_timeout,
                               sandbox, limits or Limits(), pool)
        else:
            result = _run(work, source, example, source_name or "solution.cpp", method, Path(rewriter), cxx, timeout,
                          compile_timeout, sandbox, limits or Limits(), pool)
        if keep:
            result.work_dir = work
        return result
    finally:
        if not keep:
            shutil.rmtree(work, ignore_errors=True)


def _runner(work, sandbox, rewriter, cxx, compile_timeout, limits, pool, language="cpp"):
    if sandbox in (None, "none"):
        if language == "python":
            return LocalPython(work, python(), PYTHON_ADAPTER)
        if language == "java":
            if not (JAVA_CLASSES / "lvtrace" / "Build.class").exists():
                raise PipelineError("compile", f"The Java adapter is not built ({JAVA_CLASSES}). Run: make -C adapters/java", EXIT_BUILD)
            return LocalJava(work, java(), JAVA_CLASSES, compile_timeout)
        if not rewriter.exists():
            raise PipelineError("rewriter", f"The rewriter is not built ({rewriter}). Run: make -C adapters/cpp/rewriter", EXIT_BUILD)
        return Local(work, rewriter, cxx or compiler(), RUNTIME, compile_timeout)
    try:
        return Container(runtime="runsc" if sandbox == "gvisor" else None, limits=limits, compile_timeout=compile_timeout,
                         pool=pool, language=language)
    except SandboxError as error:
        raise PipelineError("sandbox", str(error), EXIT_SANDBOX) from None
    except StageTimeout:
        raise PipelineError("sandbox", "Docker did not answer in time.", EXIT_SANDBOX) from None


def _run(work, source, example, source_name, method, rewriter, cxx, timeout, compile_timeout, sandbox, limits, pool):
    # 1. driver (outside the sandbox: it reads text and never runs the user's code)
    try:
        program = cpp_driver.generate(source, example, method)
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

    return _validated(work, trace_bytes, output, program.warnings)


def _validated(work, trace_bytes, output, warnings, who="the runtime"):
    """5. validate, outside whatever ran the code (CLAUDE.md invariant 9)."""
    trace_file = work / "trace.json"
    trace_file.write_bytes(trace_bytes)
    checked = subprocess.run([sys.executable, "-I", str(CHECK), str(trace_file)], capture_output=True, text=True)
    if checked.returncode != 0:
        raise PipelineError("validate", f"The trace is not valid. This is a bug in {who}:\n" + checked.stdout + checked.stderr, EXIT_INVALID)
    return Result(json.loads(trace_bytes.decode("utf-8")), output, warnings)


# run.py's exit statuses (adapters/python/run.py)
PYTHON_RAISED = 1    # the user's code raised, or holds a value the trace cannot show (the message says which)
PYTHON_ADAPTER_BUG = 3


def _run_python(work, source, example, method, timeout, sandbox, limits, pool):
    # 1. driver: the problem and run.json (outside the sandbox; it only parses the code)
    try:
        program = python_driver.generate(source, example, method)
    except DriverError as error:
        raise PipelineError("driver", str(error), EXIT_INPUT) from None
    files = {"solution.py": source, "run.json": program.run_json()}
    for name, text in files.items():
        (work / name).write_text(text, encoding="utf-8")

    # 2 to 4. run.py: instrument, run under the tracer, write the trace
    runner = _runner(work, sandbox, None, None, 60.0, limits, pool, language="python")
    try:
        runner.prepare(files)
        ran = _execute(runner, timeout, limits, sandbox)
        trace_bytes, collected = runner.collect(TRACE_CAP)
    except SandboxError as error:
        raise PipelineError("sandbox", str(error), EXIT_SANDBOX) from None
    except StageTimeout:
        raise PipelineError("sandbox", "The sandbox did not answer in time.", EXIT_SANDBOX) from None
    finally:
        runner.close()
    output = ran.output if collected is None else collected
    _check_ran(ran, output, limits, sandbox)
    if ran.returncode == PYTHON_ADAPTER_BUG:
        raise PipelineError("adapter", "The Python tracer failed. This is a bug in the adapter, not in your code:\n"
                            + output.strip(), EXIT_BUILD)
    if ran.returncode == PYTHON_RAISED:
        raise PipelineError("run", "The code stopped with an error before it returned, so no trace was written:\n"
                            + _tail(output), EXIT_RUN)
    if ran.returncode != 0 or trace_bytes is None:
        raise PipelineError("run", f"The program exited with status {ran.returncode} and wrote no trace." + _printed(output), EXIT_RUN)
    if len(trace_bytes) > TRACE_CAP:
        raise PipelineError("run", TOO_LARGE, EXIT_RUN)
    return _validated(work, trace_bytes, output, program.warnings, who="the Python adapter")


# The Java program's exit statuses (adapters/java/src/lvtrace/Trace.java)
JAVA_RAISED = 1      # the user's code threw (the message has the exception and the user's frames)
JAVA_ADAPTER_BUG = 3


def _run_java(work, source, example, source_name, method, timeout, compile_timeout, sandbox, limits, pool):
    # 1. driver: the problem, LvMain.java, and Nodes.java (outside the sandbox; it only reads the code)
    try:
        program = java_driver.generate(source, example, method)
    except DriverError as error:
        raise PipelineError("driver", str(error), EXIT_INPUT) from None
    files = {"Solution.java": source, "LvMain.java": program.main, "Nodes.java": program.nodes,
             "problem.json": program.problem_json()}
    for name, text in files.items():
        (work / name).write_text(text, encoding="utf-8")

    runner = _runner(work, sandbox, None, None, compile_timeout, limits, pool, language="java")
    try:
        # 2 and 3. lvtrace.Build: the rewriter, then javac, in one JVM
        built = runner.build_java(files)
        if built.stage == "rewriter":
            if built.stopped:
                raise PipelineError("rewriter", f"Compiling took longer than {compile_timeout:g} seconds or used more "
                                    f"than {limits.memory} of memory, and was stopped.", EXIT_INPUT)
            raise PipelineError("rewriter", "The code does not compile:\n" + runner.shown(built.stderr, source_name), EXIT_INPUT)
        if built.rewritten:
            (work / "Solution.rewritten.java").write_text(built.rewritten, encoding="utf-8")
        if built.stage == "compile":
            raise PipelineError("compile", "The rewritten program does not compile. This is a bug in the Java rewriter or "
                                f"the driver, not in your code:\n{built.stderr}", EXIT_BUILD)
        # 4. run
        ran = _execute(runner, timeout, limits, sandbox)
        trace_bytes, collected = runner.collect(TRACE_CAP)
    except SandboxError as error:
        raise PipelineError("sandbox", str(error), EXIT_SANDBOX) from None
    except StageTimeout:
        raise PipelineError("sandbox", "The sandbox did not answer in time.", EXIT_SANDBOX) from None
    finally:
        runner.close()
    output = ran.output if collected is None else collected
    _check_ran(ran, output, limits, sandbox)
    if ran.returncode == JAVA_ADAPTER_BUG:
        raise PipelineError("adapter", "The Java tracer failed. This is a bug in the adapter, not in your code:\n"
                            + output.strip(), EXIT_BUILD)
    if ran.returncode == JAVA_RAISED:
        raise PipelineError("run", "The code stopped with an error before it returned, so no trace was written:\n"
                            + _tail(output), EXIT_RUN)
    if ran.returncode != 0 or trace_bytes is None:
        raise PipelineError("run", f"The program exited with status {ran.returncode} and wrote no trace." + _printed(output), EXIT_RUN)
    if len(trace_bytes) > TRACE_CAP:
        raise PipelineError("run", TOO_LARGE, EXIT_RUN)
    return _validated(work, trace_bytes, output, program.warnings, who="the Java adapter")


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
    ran = _execute(runner, timeout, limits, sandbox,
                   " A loop with no statements in its body never reaches the step limit, so it has no trace.")
    trace_bytes, collected = runner.collect(TRACE_CAP)
    output = ran.output if collected is None else collected
    _check_ran(ran, output, limits, sandbox)
    if ran.returncode != 0 or trace_bytes is None:
        raise PipelineError("run", f"The program exited with status {ran.returncode} and wrote no trace." + _printed(output), EXIT_RUN)
    if len(trace_bytes) > TRACE_CAP:
        raise PipelineError("run", TOO_LARGE, EXIT_RUN)
    return trace_bytes, output


def _execute(runner, timeout, limits, sandbox, why_no_trace=""):
    try:
        return runner.execute(timeout)
    except StageTimeout as timed_out:
        raise PipelineError("run", f"The program did not finish within {timeout:g} seconds, and was stopped."
                            + why_no_trace + _printed(timed_out.output), EXIT_RUN) from None
    except SandboxStopped as stopped:
        if stopped.oom:
            why = f"it used more than the memory limit ({limits.memory})"
        else:
            why = f"most likely by one of its limits, such as memory ({limits.memory}) or processes ({limits.pids})"
        raise PipelineError("run", f"The sandbox was stopped while the program ran: {why}. No trace was written "
                            f"({stopped.detail}).", EXIT_RUN) from None


def _check_ran(ran, output, limits, sandbox):
    """Raises for a program that was stopped or ended by a signal."""
    if ran.stopped:
        raise PipelineError("run", "The sandbox stopped the program before it wrote a trace, most likely for using more "
                            f"than the memory limit ({limits.memory})." + _printed(output), EXIT_RUN)
    if ran.signal:
        why = ""
        if ran.signal == "SIGKILL" and sandbox not in (None, "none"):
            why = f" It was most likely stopped for using more than the memory limit ({limits.memory})."
        elif ran.signal == "SIGXFSZ" or ran.signal == "SIGBUS":
            why = " It may have run out of space for its output."
        raise PipelineError("run", f"The program crashed ({ran.signal}) before writing a trace.{why}" + _printed(output), EXIT_RUN)


def _tail(output, lines=30):
    """The last lines of what the program printed: for Python, the traceback is at the end."""
    return "\n".join((output or "").strip().splitlines()[-lines:])


def _printed(output):
    text = (output or "").strip()
    if not text:
        return ""
    lines = text.splitlines()
    shown = "\n".join(lines[-20:])
    return f"\nLast output from the program:\n{shown}"
