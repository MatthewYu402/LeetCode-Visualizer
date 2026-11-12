"""Compiling and running generated programs, for the tests that need a compiler.

The compiler is $CXX, or clang++, or g++. Tests that need one are skipped when
none is found, so the pure-Python tests still run anywhere.
"""

import json
import os
import shutil
import subprocess
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNTIME = ROOT / "adapters" / "cpp" / "runtime"
CHECK = ROOT / "tools" / "check_trace.py"


def compiler():
    for candidate in (os.environ.get("CXX"), "clang++", "g++"):
        if candidate and shutil.which(candidate):
            return candidate
    return None


needs_compiler = unittest.skipUnless(compiler(), "no C++ compiler found (set CXX)")


def build_and_run(program, code):
    """Writes prelude.hpp and program.cpp (code + main) to a temporary folder,
    compiles with warnings as errors, runs it, and returns (trace dict, trace path)."""
    work = Path(tempfile.mkdtemp(prefix="driver-test-"))
    (work / "prelude.hpp").write_text(program.prelude, encoding="utf-8")
    (work / "program.cpp").write_text(program.source(code), encoding="utf-8")
    build = subprocess.run([compiler(), "-std=c++20", "-Wall", "-Wextra", "-Werror",
                            # Commented node classes are LeetCode's text, compiled as written.
                            "-Wno-unused-parameter", "-Wno-reorder", "-Wno-unknown-warning-option",
                            "-I", str(RUNTIME), "-include", str(work / "prelude.hpp"),
                            str(work / "program.cpp"), "-o", str(work / "program")],
                           capture_output=True, text=True)
    if build.returncode != 0:
        raise AssertionError(f"compile failed:\n{build.stderr}\n--- program.cpp ---\n{program.source(code)}")
    trace = work / "trace.json"
    run = subprocess.run([str(work / "program")], env={**os.environ, "TRACE_OUT": str(trace)},
                         capture_output=True, text=True, timeout=30)
    if run.returncode != 0:
        raise AssertionError(f"program exited with {run.returncode}:\n{run.stderr}")
    return json.loads(trace.read_text(encoding="utf-8")), trace


def check_trace(*args):
    """Runs tools/check_trace.py; returns (exit code, output)."""
    r = subprocess.run(["python3", "-I", str(CHECK), *map(str, args)], capture_output=True, text=True)
    return r.returncode, r.stdout + r.stderr
