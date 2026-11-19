"""Helpers for the Python adapter's tests: run a Solution through the driver and run.py.

The traced program runs with Python 3.12 (TRACE_PYTHON, else python3.12, else this
interpreter when it is 3.12 or later), as the sandbox image does.
"""

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
RUN = ROOT / "adapters" / "python" / "run.py"
CHECK = ROOT / "tools" / "check_trace.py"
sys.path.insert(0, str(ROOT))

from driver.python import generate  # noqa: E402


def python():
    found = os.environ.get("TRACE_PYTHON") or shutil.which("python3.12")
    if found:
        return found
    if sys.version_info >= (3, 12):
        return sys.executable
    raise RuntimeError("These tests need Python 3.12 or later (set TRACE_PYTHON).")


class Run:
    def __init__(self, status, trace, output, path):
        self.status, self.trace, self.output, self.path = status, trace, output, path

    @property
    def steps(self):
        return self.trace["steps"]

    def top(self, i):
        return self.trace["steps"][i]["frames"][-1]

    def outcomes(self, kind=None):
        """(line, outcome) for every outcome, in order."""
        out = []
        for step in self.trace["steps"]:
            f = step["frames"][-1]
            for o in f.get("outcomes", []):
                if kind is None or o["kind"] == kind:
                    out.append((f["line"], o))
        return out

    def locals_at(self, line):
        """The top frame's locals at the first step on `line`."""
        for step in self.trace["steps"]:
            if step["frames"][-1]["line"] == line and "return_value" not in step["frames"][-1]:
                return step["frames"][-1]["locals"]
        raise AssertionError(f"no step on line {line}")

    def check(self, *flags):
        """tools/check_trace.py on the trace: (exit status, output)."""
        r = subprocess.run([sys.executable, "-I", str(CHECK), *flags, str(self.path)], capture_output=True, text=True)
        return r.returncode, r.stdout + r.stderr


def trace(source, example, method=None, keep=None):
    """Runs `source` on `example`. Returns a Run (trace None when none was written)."""
    work = Path(keep or tempfile.mkdtemp(prefix="py-trace-"))
    work.mkdir(parents=True, exist_ok=True)
    program = generate(source, example, method)
    (work / "solution.py").write_text(source, encoding="utf-8")
    (work / "run.json").write_text(program.run_json(), encoding="utf-8")
    out = work / "trace.json"
    r = subprocess.run([python(), "-I", str(RUN), str(work)], cwd=work, capture_output=True, text=True, timeout=60,
                       env={**os.environ, "TRACE_OUT": str(out)})
    doc = json.loads(out.read_text(encoding="utf-8")) if out.exists() else None
    return Run(r.returncode, doc, r.stdout + r.stderr, out)


def solution(body, signature="def f(self, nums: List[int]) -> int:"):
    """A Solution with one method, from its body (indented by the caller as written)."""
    return "class Solution:\n    " + signature + "\n" + body
