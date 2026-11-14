"""Where stages 2 to 4 (rewrite, compile, run) happen: on this machine, or in a container.

    Local       runs the rewriter, the compiler, and the program directly, with
                only time limits. For your own code.
    Container   runs all three inside one locked-down container per run
                (docs/sandboxing.md): no network, capped memory, CPU, processes,
                and disk, a read-only image, not root, and an optional gVisor
                runtime underneath. For anyone's code.

Both have the same methods, so pipeline._run() does not know which it has:

    build(prelude, source, main)  -> Built   rewrite the Solution, then compile it with main
    execute(timeout)              -> Ran     the program, with TRACE_OUT set
    collect(trace_cap)            -> (trace bytes or None, output or None)
    shown(text, user_name)        the user's file name in place of the run folder's copy
    close()

A Container does each of build, execute, and collect in one `docker exec`
(docs/sandboxing.md §4.1). It can come from a Pool of containers started ahead
of time; each is still used for exactly one run.

Driver and validation are not here: they run outside, before and after
(CLAUDE.md invariant 9). Whatever comes back from execute() and collect() was
produced next to the user's code, so it is untrusted until validated.
"""

import io
import os
import shutil
import signal
import subprocess
import tarfile
import threading
import uuid
from dataclasses import dataclass, field
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
class Built:
    """What build() did. stage is "" when both steps worked, else the one that failed."""
    stage: str              # "", "rewriter", or "compile"
    rewritten: str          # the instrumented Solution ("" when the rewriter failed)
    stderr: str             # the failing step's messages
    stopped: bool = False   # the failing step was stopped: out of time (or, in a container, memory)


@dataclass
class Ran:
    returncode: int     # 0 when it exited normally with 0
    signal: str         # "SIGSEGV", ... when a signal ended it, else ""
    output: str         # stdout and stderr ("" in a container: collect() reads it)
    stopped: bool = False  # in a container: ended from outside its shell (gVisor's memory limit)


def _signal_name(number):
    try:
        return signal.Signals(number).name
    except ValueError:
        return f"signal {number}"


def _text(part):
    if isinstance(part, bytes):
        return part.decode("utf-8", "replace")
    return part or ""


# ======================================================================
# Local: this machine
# ======================================================================

class Local:
    def __init__(self, work, rewriter, cxx, runtime, compile_timeout):
        self.work, self.rewriter, self.cxx, self.runtime = Path(work), Path(rewriter), cxx, Path(runtime)
        self.compile_timeout = compile_timeout

    def _tool(self, command):
        """(returncode, stdout, stderr), or None when it ran out of time."""
        try:
            r = subprocess.run(command, capture_output=True, text=True, timeout=self.compile_timeout)
        except subprocess.TimeoutExpired:
            return None
        return r.returncode, r.stdout, r.stderr

    def build(self, prelude, source, main):
        w = self.work
        (w / "prelude.hpp").write_text(prelude, encoding="utf-8")
        (w / "solution.cpp").write_text(source, encoding="utf-8")
        include = ["-I", str(self.runtime), "-include", str(w / "prelude.hpp")]
        rewrite = self._tool([str(self.rewriter), str(w / "solution.cpp"), "--", "-std=c++20", *include])
        if rewrite is None:
            return Built("rewriter", "", "", stopped=True)
        if rewrite[0] != 0:
            return Built("rewriter", "", rewrite[2])
        rewritten = rewrite[1]
        (w / "program.cpp").write_text(rewritten.rstrip("\n") + "\n\n" + main, encoding="utf-8")
        compiled = self._tool([self.cxx, "-std=c++20", "-O0", "-w", *include, str(w / "program.cpp"), "-o", str(w / "program")])
        if compiled is None:
            return Built("compile", rewritten, "", stopped=True)
        if compiled[0] != 0:
            return Built("compile", rewritten, compiled[2])
        return Built("", rewritten, "")

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

    def collect(self, trace_cap):
        path = self.work / "trace.json"
        if not path.is_file():
            return None, None
        with path.open("rb") as f:
            return f.read(trace_cap + 1), None  # None: the output is the one execute() captured

    def shown(self, text, user_name):
        return text.replace(str(self.work / "solution.cpp"), user_name)

    def close(self):
        pass


# ======================================================================
# Container: one per run
# ======================================================================

IMAGE = os.environ.get("TRACE_SANDBOX_IMAGE", "leetcode-visualizer-sandbox")
LABEL = "org.leetcode-visualizer.sandbox"   # on every sandbox container, for cleaning up after a crash
PCH_LABEL = "org.leetcode-visualizer.pch"   # on the image: where the precompiled header is

# Inside the image (sandbox/Dockerfile).
REWRITER_IN = "/opt/trace/bin/trace-rewrite"
RUNTIME_IN = "/opt/trace/runtime"
CXX_IN = "clang++-18"
WORK_IN = "/work"

# Two unprivileged users with no names. The tools (tar, the rewriter, the
# compiler) run as TOOLS_USER; the user's program runs as PROGRAM_USER, a user
# of its own, so it cannot signal or trace anything else in the container, and
# `kill -9 -1` at the end of its run reaches exactly what it left behind.
TOOLS_USER = "65534:65534"
PROGRAM_USER = "65533:65533"


def _env_int(name, default):
    try:
        return int(os.environ.get(name, default))
    except ValueError:
        return default


@dataclass(frozen=True)
class Limits:
    """docs/sandboxing.md §3. Each can be set from the environment, for a smaller
    or bigger server: TRACE_RUN_MEMORY (such as 512m), TRACE_RUN_CPUS, TRACE_RUN_PIDS."""
    memory: str = field(default_factory=lambda: os.environ.get("TRACE_RUN_MEMORY", "1g"))  # RAM, and RAM+swap: no swap
    cpus: str = field(default_factory=lambda: os.environ.get("TRACE_RUN_CPUS", "1"))
    pids: int = field(default_factory=lambda: _env_int("TRACE_RUN_PIDS", 64))  # the program's processes and threads
    gvisor_threads: int = 1024  # under gVisor: gVisor's own host threads (see _process_limit)
    work_size: str = "64m"      # the run folder, a tmpfs: source, binary, trace, output
    tmp_size: str = "64m"       # /tmp, a tmpfs: the compiler's scratch files
    open_files: int = 256
    output_cap: int = 64 * 1024  # bytes of the program's output kept


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


def _docker(command, timeout, input=None):
    """(returncode, stdout bytes, stderr text). Raises StageTimeout."""
    try:
        r = subprocess.run(command, input=input, capture_output=True, timeout=timeout)
    except subprocess.TimeoutExpired as expired:
        raise StageTimeout(timeout, _text(expired.stdout)) from None
    return r.returncode, r.stdout, _text(r.stderr)


# Docker, the runtime, and the image are checked once per process, not once per
# run: {(docker, context, image, runtime): path of the precompiled header, or ""}.
_checked = {}
_checked_lock = threading.Lock()


def _check(docker, image, runtime):
    key = (docker, os.environ.get("DOCKER_CONTEXT", ""), image, runtime or "")
    with _checked_lock:
        if key in _checked:
            return _checked[key]
    code, out, err = _docker([docker, "info", "--format", "{{json .Runtimes}}"], timeout=30)
    if code != 0:
        raise SandboxError("Docker is installed but not running (docker info failed):\n" + err.strip())
    if runtime and f'"{runtime}"' not in _text(out):
        raise SandboxError(f"Docker has no runtime named {runtime!r}. Install gVisor and register it "
                           "(docs/sandboxing.md §6), or use --sandbox docker.")
    code, out, _ = _docker([docker, "image", "inspect", "--format", "{{index .Config.Labels \"" + PCH_LABEL + "\"}}", image],
                           timeout=30)
    if code != 0:
        raise SandboxError(f"The sandbox image {image!r} is not built. From the repository root, run:\n"
                           f"  docker build -f sandbox/Dockerfile -t {image} .")
    pch = _text(out).strip()
    if pch == "<no value>":
        pch = ""  # an image built before the precompiled header: runs still work, only slower
    with _checked_lock:
        _checked[key] = pch
    return pch


def _start(docker, image, runtime, limits):
    """Starts one sandbox container and returns its name. It waits, running
    `sleep infinity`, until a run uses it."""
    name = f"trace-run-{uuid.uuid4().hex[:12]}"
    # No --rm: when the container dies, `docker inspect` can still tell how
    # (out of memory, say). Container.close() removes it in every case.
    command = [docker, "run", "--detach", "--name", name, "--label", f"{LABEL}=1",
               "--init",  # PID 1 reaps orphans, so killed processes do not stay as zombies
               "--network", "none",
               "--memory", limits.memory, "--memory-swap", limits.memory,
               "--cpus", limits.cpus,
               *_process_limit(runtime, limits),
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
    code, _, err = _docker(command, timeout=60)
    if code != 0:
        subprocess.run([docker, "rm", "--force", name], capture_output=True, timeout=60)
        raise SandboxError("Could not start the sandbox container:\n" + err.strip())
    return name


def _remove(docker, name, wait=False):
    """Removes a container. In the background unless wait: a run's answer does not wait for it."""
    command = [docker, "rm", "--force", name]
    if wait:
        subprocess.run(command, capture_output=True, timeout=60)
    else:
        threading.Thread(target=subprocess.run, args=(command,), kwargs={"capture_output": True, "timeout": 60},
                         daemon=True).start()


def remove_leftovers(docker=None):
    """Removes every sandbox container on this Docker daemon, such as those a
    crashed backend left behind. Call it only when no run is in progress:
    python3 -m backend does, at startup."""
    docker = docker or shutil.which("docker")
    if not docker:
        return 0
    code, out, _ = _docker([docker, "ps", "--all", "--quiet", "--filter", f"label={LABEL}"], timeout=60)
    ids = _text(out).split()
    if code == 0 and ids:
        subprocess.run([docker, "rm", "--force", *ids], capture_output=True, timeout=120)
    return len(ids)


class Pool:
    """Fresh containers started ahead of time, so a run does not wait for one to start.

    Each container is handed out once and removed after its run, exactly like
    one started on demand; the pool only moves the start earlier. A container
    is never returned to the pool. Containers are kept per configuration
    (runtime, limits, image), since each was started with its own limits.
    """

    def __init__(self, size=1):
        self.size = size
        self._ready = {}      # key -> [names]
        self._starting = {}   # key -> count
        self._lock = threading.Lock()
        self._closed = False
        self._threads = []    # starts in progress, which close() waits for

    def take(self, key):
        with self._lock:
            names = self._ready.get(key)
            return names.pop(0) if names else None

    def fill(self, key, start):
        """Starts containers in the background until `size` are ready or starting."""
        with self._lock:
            if self._closed:
                return
            missing = self.size - len(self._ready.get(key, [])) - self._starting.get(key, 0)
            self._starting[key] = self._starting.get(key, 0) + max(0, missing)
        for _ in range(max(0, missing)):
            thread = threading.Thread(target=self._start_one, args=(key, start), daemon=True)
            with self._lock:
                self._threads = [t for t in self._threads if t.is_alive()] + [thread]
            thread.start()

    def _start_one(self, key, start):
        name = None
        try:
            name = start()
        except Exception:  # Docker down, say: the next run starts its own and reports why
            pass
        with self._lock:
            self._starting[key] -= 1
            if name and not self._closed:
                self._ready.setdefault(key, []).append(name)
                return
        if name:
            _remove(key[0], name, wait=True)

    def close(self):
        """Removes every container still waiting in the pool. Waits for starts in
        progress first (each removes its own container once it sees the pool is
        closed), so none is left behind when the process exits right after."""
        with self._lock:
            self._closed = True
            starting = list(self._threads)
        for thread in starting:
            thread.join(90)
        with self._lock:
            waiting = [(key[0], n) for key, names in self._ready.items() for n in names]
            self._ready.clear()
        for docker, name in waiting:
            _remove(docker, name, wait=True)


class Container:
    """One container for one run, removed in close().

    Files go in and out through `docker exec` (stdin and stdout), never a bind
    mount: the container then works the same with a remote Docker daemon or a
    VM that shares only some host folders (Colima on macOS), and no host path
    is ever visible inside it.

    The container's only writable places are two tmpfs mounts, so it has no
    disk to fill and leaves nothing behind. Every docker command it runs
    has a time limit; when one is exceeded the whole container is killed.
    """

    def __init__(self, runtime=None, limits=None, image=IMAGE, compile_timeout=60.0, docker=None, pool=None):
        self.docker = docker or shutil.which("docker")
        if not self.docker:
            raise SandboxError("Docker is not installed or not on PATH. The sandbox needs it (docs/sandboxing.md).")
        self.limits, self.compile_timeout = limits or Limits(), compile_timeout
        self.pch = _check(self.docker, image, runtime)
        key = (self.docker, os.environ.get("DOCKER_CONTEXT", ""), image, runtime or "", self.limits)
        self.name = pool.take(key) if pool else None
        if self.name is None:
            self.name = _start(self.docker, image, runtime, self.limits)
        if pool:
            pool.fill(key, lambda: _start(self.docker, image, runtime, self.limits))

    def _exec(self, args, timeout, input=None, user=None):
        """Runs a command in the container. On a timeout, kills the container: a
        docker exec client that is stopped does not stop what it started."""
        command = [self.docker, "exec", *(["-i"] if input is not None else []), *(["--user", user] if user else []),
                   self.name, *args]
        try:
            return _docker(command, timeout=timeout, input=input)
        except StageTimeout:
            self.close()
            raise

    def build(self, prelude, source, main):
        """Copies the files in, rewrites, and compiles, in one `docker exec`.

        Each step has its own time limit inside the container (`timeout`), so
        the exit status says which step failed and whether it was stopped. The
        program file is assembled as Program.source() does: the instrumented
        Solution without its trailing newlines, a blank line, then main.
        """
        pch = f"-include-pch {self.pch} " if self.pch else ""
        include = f"-I {RUNTIME_IN} {pch}-include {WORK_IN}/prelude.hpp"
        t = max(1, int(self.compile_timeout))
        script = f"""cd {WORK_IN} && tar -x -f - || exit 2
timeout -s KILL {t} {REWRITER_IN} {WORK_IN}/solution.cpp -- -std=c++20 {include} > rewritten.cpp 2> stage.err
s=$?; if [ $s -ne 0 ]; then cat stage.err >&2; [ $s -eq 137 ] && exit 11; exit 10; fi
printf '%s\\n\\n' "$(cat rewritten.cpp)" > program.cpp && cat main.cpp >> program.cpp || exit 2
cat rewritten.cpp
timeout -s KILL {t} {CXX_IN} -std=c++20 -O0 -w {include} program.cpp -o program 2> stage.err
s=$?; if [ $s -ne 0 ]; then cat stage.err >&2; [ $s -eq 137 ] && exit 21; exit 20; fi
"""
        files = _tar({"prelude.hpp": prelude, "solution.cpp": source, "main.cpp": main})
        code, out, err = self._exec(["sh", "-c", script], timeout=2 * t + 30, input=files)
        rewritten = _text(out)
        if code in (10, 11):
            return Built("rewriter", "", err, stopped=code == 11)
        if code in (20, 21):
            return Built("compile", rewritten, err, stopped=code == 21)
        if code != 0:
            raise SandboxError(f"Could not prepare the run in the sandbox (status {code}):\n" + err.strip())
        return Built("", rewritten, "")

    def execute(self, timeout):
        # The program's output goes to a file in the run folder (a size-capped
        # tmpfs), not through docker, so printing without end cannot fill this
        # process's memory. sh reports a signal as 128 + its number. Then
        # `kill -9 -1`, as the program's own user, ends every process the
        # program left behind (a forked child, say) before anything is read.
        script = (f"cd {WORK_IN} && TRACE_OUT={WORK_IN}/trace.json ./program > output.txt 2>&1 < /dev/null; "
                  "status=$?; kill -9 -1 2>/dev/null; exit $status")
        try:
            code, _, _ = _docker([self.docker, "exec", "--user", PROGRAM_USER, self.name, "sh", "-c", script], timeout=timeout)
        except StageTimeout as timed_out:
            _, output = self._read(0)  # what it printed before it was stopped, if the container still answers
            self.close()
            raise StageTimeout(timed_out.seconds, output or "") from None
        if code >= 126:
            self._still_running()  # 126 and up: killed, or the container itself is gone (gVisor's limits)
        if code > 128:
            return Ran(code, _signal_name(code - 128), "")
        if code == 128:
            # Not 128 + a signal number: the shell itself was ended while the
            # container kept running. That is how gVisor's memory limit ends an
            # exec'd program, since the pooled container outlives the run.
            return Ran(code, "", "", stopped=True)
        return Ran(code, "", "")

    def _still_running(self):
        """Raises SandboxStopped when the container is no longer running."""
        try:
            code, out, _ = _docker([self.docker, "inspect", "--format",
                                    "{{.State.Running}} {{.State.OOMKilled}} {{.State.ExitCode}}", self.name], timeout=30)
        except StageTimeout:
            return
        fields = _text(out).split()
        if code == 0 and len(fields) == 3 and fields[0] == "false":
            raise SandboxStopped(fields[1] == "true", f"the container exited with status {fields[2]}")

    def collect(self, trace_cap):
        """The trace (raw bytes, at most trace_cap + 1 of them; None when there is
        none) and the program's output, in one `docker exec`."""
        return self._read(trace_cap + 1)

    def _read(self, trace_bytes):
        # Bytes as they are: decoding the trace here could turn invalid UTF-8
        # into valid text and hide it from validation. The first line gives
        # both lengths; -1 means no trace file. `-f` skips anything that is not
        # a regular file, such as a FIFO the program left in place of one.
        script = f"""cd {WORK_IN}
if [ {trace_bytes} -gt 0 ] && [ -f trace.json ]; then head -c {trace_bytes} trace.json > /tmp/t; t=$(wc -c < /tmp/t); else : > /tmp/t; t=-1; fi
if [ -f output.txt ]; then head -c {self.limits.output_cap} output.txt > /tmp/o; else : > /tmp/o; fi
printf '%s %s\\n' "$t" "$(wc -c < /tmp/o)"; cat /tmp/t /tmp/o"""
        try:
            code, out, _ = _docker([self.docker, "exec", self.name, "sh", "-c", script], timeout=30)
        except StageTimeout:
            return None, ""
        head, _, body = out.partition(b"\n")
        try:
            t, o = (int(x) for x in head.split())
        except ValueError:
            return None, ""
        trace = body[:t] if t >= 0 else None
        output = _text(body[max(t, 0):max(t, 0) + o])
        return (trace if code == 0 else None), output

    def shown(self, text, user_name):
        return text.replace(f"{WORK_IN}/solution.cpp", user_name)

    def close(self):
        if self.name:
            _remove(self.docker, self.name)
            self.name = None


def _tar(files):
    """An uncompressed tar of {name: text}, for `tar -x` in the run folder."""
    buffer = io.BytesIO()
    with tarfile.open(fileobj=buffer, mode="w", format=tarfile.USTAR_FORMAT) as archive:
        for name, text in files.items():
            data = text.encode("utf-8")
            info = tarfile.TarInfo(name)
            info.size, info.mode = len(data), 0o644
            archive.addfile(info, io.BytesIO(data))
    return buffer.getvalue()
