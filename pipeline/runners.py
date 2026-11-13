"""Where stages 2 to 4 (rewrite, compile, run) happen: on this machine, or in a container.

    Local       runs the rewriter, the compiler, and the program directly, with
                only time limits. For your own code.
    Container   runs all three inside one locked-down container per run
                (docs/sandboxing.md): no network, capped memory, CPU, processes,
                and disk, a read-only image, not root, and an optional gVisor
                runtime underneath. For anyone's code.

Both have the same methods, so pipeline._run() does not know which it has:

    put(name, text)          a file into the run folder
    rewrite(name)            -> Done     the instrumented Solution on stdout
    compile()                -> Done     prelude.hpp + program.cpp -> program
    execute(timeout)         -> Ran      the program, with TRACE_OUT set
    take(name, cap)          -> bytes, or None when the file is missing
    shown(text, name, user)  the user's file name in place of the run folder's copy
    close()

Driver and validation are not here: they run outside, before and after
(CLAUDE.md invariant 9). Whatever comes back from execute() and take() was
produced next to the user's code, so it is untrusted until validated.
"""

import os
import shutil
import signal
import subprocess
import uuid
from dataclasses import dataclass
from pathlib import Path


class SandboxError(Exception):
    """The sandbox itself could not do its job: no Docker, no image, no gVisor."""


class SandboxStopped(Exception):
    """The container itself ended while the program ran: under gVisor, a limit
    that is enforced on gVisor's kernel (memory, say) ends the whole sandbox,
    not only the program. oom is True when Docker reports it ran out of memory."""

    def __init__(self, oom, detail=""):
        super().__init__(detail or "the sandbox stopped")
        self.oom, self.detail = oom, detail


class StageTimeout(Exception):
    def __init__(self, seconds, output=""):
        super().__init__(f"timed out after {seconds:g} s")
        self.seconds, self.output = seconds, output


@dataclass
class Done:
    returncode: int
    stdout: str
    stderr: str


@dataclass
class Ran:
    returncode: int     # 0 when it exited normally with 0
    signal: str         # "SIGSEGV", ... when a signal ended it, else ""
    output: str         # stdout and stderr


def _signal_name(number):
    try:
        return signal.Signals(number).name
    except ValueError:
        return f"signal {number}"


# ======================================================================
# Local: this machine
# ======================================================================

class Local:
    def __init__(self, work, rewriter, cxx, runtime, compile_timeout):
        self.work, self.rewriter, self.cxx, self.runtime = Path(work), Path(rewriter), cxx, Path(runtime)
        self.compile_timeout = compile_timeout

    def put(self, name, text):
        (self.work / name).write_text(text, encoding="utf-8")

    def _tool(self, command):
        try:
            r = subprocess.run(command, capture_output=True, text=True, timeout=self.compile_timeout)
        except subprocess.TimeoutExpired:
            raise StageTimeout(self.compile_timeout) from None
        return Done(r.returncode, r.stdout, r.stderr)

    def rewrite(self, name):
        return self._tool([str(self.rewriter), str(self.work / name), "--", "-std=c++20",
                           "-I", str(self.runtime), "-include", str(self.work / "prelude.hpp")])

    def compile(self):
        return self._tool([self.cxx, "-std=c++20", "-O0", "-w", "-I", str(self.runtime), "-include", str(self.work / "prelude.hpp"),
                           str(self.work / "program.cpp"), "-o", str(self.work / "program")])

    def execute(self, timeout):
        env = {**os.environ, "TRACE_OUT": str(self.work / "trace.json")}
        try:
            r = subprocess.run([str(self.work / "program")], env=env, capture_output=True, text=True, timeout=timeout)
        except subprocess.TimeoutExpired as expired:
            raise StageTimeout(timeout, _text(expired.stdout) + _text(expired.stderr)) from None
        output = (r.stdout or "") + (r.stderr or "")
        if r.returncode < 0:
            return Ran(r.returncode, _signal_name(-r.returncode), output)
        return Ran(r.returncode, "", output)

    def take(self, name, cap):
        path = self.work / name
        if not path.is_file():
            return None
        with path.open("rb") as f:
            return f.read(cap + 1)

    def shown(self, text, name, user_name):
        return text.replace(str(self.work / name), user_name)

    def close(self):
        pass


def _text(part):
    if isinstance(part, bytes):
        return part.decode("utf-8", "replace")
    return part or ""


# ======================================================================
# Container: one per run
# ======================================================================

IMAGE = os.environ.get("TRACE_SANDBOX_IMAGE", "leetcode-visualizer-sandbox")

# Inside the image (sandbox/Dockerfile).
REWRITER_IN = "/opt/trace/bin/trace-rewrite"
RUNTIME_IN = "/opt/trace/runtime"
CXX_IN = "clang++-18"
WORK_IN = "/work"

# Two unprivileged users with no names. The tools (cat, the rewriter, the
# compiler) run as TOOLS_USER; the user's program runs as PROGRAM_USER, a user
# of its own, so it cannot signal or trace anything else in the container, and
# `kill -9 -1` at the end of its run reaches exactly what it left behind.
TOOLS_USER = "65534:65534"
PROGRAM_USER = "65533:65533"


@dataclass(frozen=True)
class Limits:
    """docs/sandboxing.md §3. Starting values, to be measured on real solutions."""
    memory: str = "1g"          # RAM, and the same as RAM+swap: no swap
    cpus: str = "1"
    pids: int = 64              # the program's processes and threads together
    gvisor_threads: int = 1024  # under gVisor: gVisor's own host threads (see Container)
    work_size: str = "64m"      # the run folder, a tmpfs: source, binary, trace, output
    tmp_size: str = "64m"       # /tmp, a tmpfs: the compiler's scratch files
    open_files: int = 256
    output_cap: int = 64 * 1024  # bytes of the program's output kept


class Container:
    """One container, started in __init__, removed in close().

    Files go in and out through `docker exec` (stdin and stdout), never a bind
    mount: the container then works the same with a remote Docker daemon or a
    VM that shares only some host folders (Colima on macOS), and no host path
    is ever visible inside it.

    The container's only writable places are two tmpfs mounts, so it has no
    disk to fill and leaves nothing behind. Every docker command it runs
    has a time limit; when one is exceeded the whole container is killed.
    """

    def __init__(self, runtime=None, limits=Limits(), image=IMAGE, compile_timeout=60.0, docker=None):
        self.docker = docker or shutil.which("docker")
        if not self.docker:
            raise SandboxError("Docker is not installed or not on PATH. The sandbox needs it (docs/sandboxing.md).")
        self.limits, self.compile_timeout = limits, compile_timeout
        self.name = f"trace-run-{uuid.uuid4().hex[:12]}"
        self._check_image(image, runtime)
        # No --rm: when the container dies, `docker inspect` can still tell
        # how (out of memory, say). close() removes it in every case.
        command = [self.docker, "run", "--detach", "--name", self.name,
                   "--init",  # PID 1 reaps orphans, so killed processes do not stay as zombies
                   "--network", "none",
                   "--memory", limits.memory, "--memory-swap", limits.memory,
                   "--cpus", limits.cpus,
                   *self._process_limit(runtime, limits),
                   "--ulimit", f"nofile={limits.open_files}:{limits.open_files}",
                   "--ulimit", "core=0",
                   "--read-only",
                   "--tmpfs", f"{WORK_IN}:rw,exec,nosuid,nodev,size={limits.work_size},mode=1777",
                   "--tmpfs", f"/tmp:rw,nosuid,nodev,size={limits.tmp_size},mode=1777",
                   "--user", TOOLS_USER,
                   "--cap-drop", "ALL",
                   "--security-opt", "no-new-privileges"]
        if runtime:
            command += ["--runtime", runtime]
        command += [image, "sleep", "infinity"]
        started = self._docker(command, timeout=60)
        if started.returncode != 0:
            raise SandboxError("Could not start the sandbox container:\n" + started.stderr.strip())

    @staticmethod
    def _process_limit(runtime, limits):
        """Under Docker's runtime, --pids-limit counts the container's processes.

        Under gVisor it counts gVisor's own host threads instead: the program's
        processes live inside gVisor's kernel and are not host processes, and a
        fork loop that pushes gVisor past the limit ends the whole sandbox. So
        under gVisor the program's limit is RLIMIT_NPROC, which gVisor's kernel
        enforces per user inside the sandbox (fork fails with EAGAIN), and
        --pids-limit only keeps gVisor itself from taking the host's threads.
        (Under Docker's runtime, RLIMIT_NPROC would instead count every process
        of that user on the whole host, across containers.)
        """
        if runtime == "runsc":
            return ["--ulimit", f"nproc={limits.pids}:{limits.pids}", "--pids-limit", str(limits.gvisor_threads)]
        return ["--pids-limit", str(limits.pids)]

    def _check_image(self, image, runtime):
        info = self._docker([self.docker, "info", "--format", "{{json .Runtimes}}"], timeout=30)
        if info.returncode != 0:
            raise SandboxError("Docker is installed but not running (docker info failed):\n" + info.stderr.strip())
        if runtime and f'"{runtime}"' not in info.stdout:
            raise SandboxError(f"Docker has no runtime named {runtime!r}. Install gVisor and register it "
                               "(docs/sandboxing.md §6), or use --sandbox docker.")
        found = self._docker([self.docker, "image", "inspect", "--format", "{{.Id}}", image], timeout=30)
        if found.returncode != 0:
            raise SandboxError(f"The sandbox image {image!r} is not built. From the repository root, run:\n"
                               f"  docker build -f sandbox/Dockerfile -t {image} .")

    def _docker(self, command, timeout, input=None):
        try:
            r = subprocess.run(command, input=input, capture_output=True, timeout=timeout)
        except subprocess.TimeoutExpired as expired:
            raise StageTimeout(timeout, _text(expired.stdout)) from None
        return Done(r.returncode, _text(r.stdout), _text(r.stderr))

    def _exec(self, args, timeout, input=None):
        """Runs a command in the container. On a timeout, kills the container: a
        docker exec client that is stopped does not stop what it started."""
        try:
            return self._docker([self.docker, "exec", *(["-i"] if input is not None else []), self.name, *args],
                                timeout=timeout, input=input)
        except StageTimeout:
            self.close()
            raise

    def put(self, name, text):
        _check_name(name)
        r = self._exec(["sh", "-c", f"cat > {WORK_IN}/{name}"], timeout=30, input=text.encode("utf-8"))
        if r.returncode != 0:
            raise SandboxError(f"Could not copy {name} into the sandbox:\n" + r.stderr.strip())

    def rewrite(self, name):
        _check_name(name)
        return self._exec([REWRITER_IN, f"{WORK_IN}/{name}", "--", "-std=c++20",
                           "-I", RUNTIME_IN, "-include", f"{WORK_IN}/prelude.hpp"], timeout=self.compile_timeout)

    def compile(self):
        return self._exec([CXX_IN, "-std=c++20", "-O0", "-w", "-I", RUNTIME_IN, "-include", f"{WORK_IN}/prelude.hpp",
                           f"{WORK_IN}/program.cpp", "-o", f"{WORK_IN}/program"], timeout=self.compile_timeout)

    def execute(self, timeout):
        # The program's output goes to a file in the run folder (a size-capped
        # tmpfs), not through docker, so printing without end cannot fill this
        # process's memory. sh reports a signal as 128 + its number. Then
        # `kill -9 -1`, as the program's own user, ends every process the
        # program left behind (a forked child, say) before anything is read.
        script = (f"cd {WORK_IN} && TRACE_OUT={WORK_IN}/trace.json ./program > output.txt 2>&1 < /dev/null; "
                  "status=$?; kill -9 -1 2>/dev/null; exit $status")
        try:
            r = self._docker([self.docker, "exec", "--user", PROGRAM_USER, self.name, "sh", "-c", script], timeout=timeout)
        except StageTimeout as timed_out:
            output = self._output()  # what it printed before it was stopped, if the container still answers
            self.close()
            raise StageTimeout(timed_out.seconds, output) from None
        output = self._output()
        self._still_running()
        if r.returncode > 128:
            return Ran(r.returncode, _signal_name(r.returncode - 128), output)
        return Ran(r.returncode, "", output)

    def _output(self):
        try:
            r = self._docker([self.docker, "exec", self.name, "head", "-c", str(self.limits.output_cap), f"{WORK_IN}/output.txt"],
                             timeout=10)
        except StageTimeout:
            return ""
        return r.stdout if r.returncode == 0 else ""

    def _still_running(self):
        """Raises SandboxStopped when the container is no longer running."""
        try:
            r = self._docker([self.docker, "inspect", "--format", "{{.State.Running}} {{.State.OOMKilled}} {{.State.ExitCode}}",
                              self.name], timeout=30)
        except StageTimeout:
            return
        fields = r.stdout.split()
        if r.returncode == 0 and len(fields) == 3 and fields[0] == "false":
            raise SandboxStopped(fields[1] == "true", f"the container exited with status {fields[2]}")

    def take(self, name, cap):
        # The bytes as they are: decoding here could turn invalid UTF-8 into
        # valid text and hide it from validation.
        _check_name(name)
        command = [self.docker, "exec", self.name, "sh", "-c", f"test -f {WORK_IN}/{name} && head -c {cap + 1} {WORK_IN}/{name}"]
        try:
            r = subprocess.run(command, capture_output=True, timeout=30)
        except subprocess.TimeoutExpired:
            self.close()
            raise StageTimeout(30) from None
        return r.stdout if r.returncode == 0 else None

    def shown(self, text, name, user_name):
        return text.replace(f"{WORK_IN}/{name}", user_name)

    def close(self):
        if self.name:
            subprocess.run([self.docker, "rm", "--force", self.name], capture_output=True, timeout=60)
            self.name = None


def _check_name(name):
    # Names are the pipeline's own (prelude.hpp, solution.cpp, ...), never the
    # user's, but they go into a shell command, so make sure.
    if not name or not all(c.isalnum() or c in "._-" for c in name) or name.startswith("."):
        raise ValueError(f"bad file name for the run folder: {name!r}")
