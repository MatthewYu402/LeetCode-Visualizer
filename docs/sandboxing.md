# Sandboxing

> **Status:** Draft v0.2. The sandbox exists (`sandbox/`, `pipeline/runners.py`, `python3 -m pipeline --sandbox`). The API service does not yet.
> **Related:** [`trace-format.md`](trace-format.md) (the contract), [`adapters/cpp.md`](adapters/cpp.md) §7 (how the C++ runtime writes a trace), [`native-tracing.md`](native-tracing.md) §6 (why tracer output is untrusted)

This document describes how the system runs a stranger's code safely: where the code runs, what it is allowed to use, how files get in and out, and what comes back for each way a run can end.

---

## 1. What the sandbox is for

The product runs code that anyone on the internet typed in. That code must not be able to read other users' data, reach the network, take over the host, or use up the machine.

The sandbox also protects the frontend from the trace itself. The tracer runs in the same process as the user's code, so the code can write a forged or broken trace. Nothing that comes out of the sandbox is trusted until it has been validated outside it.

> **Key insight 1: the sandbox contains the code, and schema validation contains the output.** Both are needed. Isolation stops the code from harming the host. Validation stops its output from harming the frontend.

## 2. One run, start to finish

```
outside (this machine)          inside (one container per run)          outside
1. driver: prelude + main  ──►  2. rewriter  3. compile  4. run   ──►  5. validate
   (never runs user code)          (all three see untrusted input)        (out of the code's reach)
```

1. **Driver, outside.** `generate()` reads the Solution and the example as text and writes the prelude and `main`. It never runs or compiles the user's code, so it needs no sandbox, and a bad example fails fast.
2. **One container starts** from the sandbox image, with every limit in §3. It runs `sleep infinity` and waits.
3. **Files go in** through `docker exec` on stdin: `prelude.hpp` and `solution.cpp`.
4. **Rewrite, compile, run**, each a separate `docker exec` with its own time limit. The program writes its trace to `/work/trace.json`, and its output to `/work/output.txt`.
5. **Files come out** through `docker exec` on stdout, each read up to a cap (§4).
6. **The container is removed.** It is also removed at once whenever any step runs out of time.
7. **Validation, outside.** `tools/check_trace.py` checks the trace bytes. Only then does anything read them as a trace.

This is `pipeline.run(..., sandbox="docker")` or `sandbox="gvisor"` (`pipeline/runners.py`, class `Container`). The same run with `sandbox=None` does stages 2 to 4 on the host instead (class `Local`), for your own code.

> **Key insight 2: the rewriter runs inside too.** It is Clang parsing untrusted source. A pasted `#include "/etc/passwd"`, or a template that takes gigabytes to instantiate, is as dangerous to a parser as to a compiler.

## 3. Limits on the container

The values are starting points (`pipeline/runners.py`, `Limits`). §8 lists them as open until measured on real solutions.

| Limit | Setting | What it stops |
|---|---|---|
| Network | `--network none` | Sending data out, attacking other machines |
| Memory | `--memory 1g --memory-swap 1g` (no swap) | A huge allocation taking down the host |
| CPU | `--cpus 1` | One run starving the others |
| Processes | 64 processes and threads. Docker's runtime: `--pids-limit 64`. gVisor: `--ulimit nproc=64`, enforced by gVisor's kernel, plus `--pids-limit 1024` on gVisor itself (§6.1) | Fork bombs |
| Open files | `--ulimit nofile=256`, `core=0` | Descriptor exhaustion, core dumps |
| Wall-clock time | Per step, from outside: 60 s for rewrite and compile each, 10 s for the run (`--timeout`). The container is killed at the limit | A loop that never reaches the tracer, a compile that never ends |
| Filesystem | `--read-only` image. The only writable places are two tmpfs mounts: `/work` (64 MB) and `/tmp` (64 MB) | Changing the image, filling the host's disk, leaving files behind |
| Output size | The trace is read up to 16 MB, the program's output up to 64 KB | A program that writes without end |
| Users | Never root: the tools (rewriter, compiler) run as uid 65534, and the program as uid 65533, a user of its own. `--cap-drop ALL`, `--security-opt no-new-privileges` | Using root inside the container to attack the kernel; the program signalling or tracing anything but itself |
| Processes left behind | `--init` (an init process at PID 1 that reaps orphans), and `kill -9 -1` as the program's user when it ends | A forked child that keeps running, or stays as a zombie holding a process slot |
| Kernel | gVisor's `runsc` runtime (`--sandbox gvisor`) | An escape through a kernel bug (§6) |

Two rules are easy to miss:

- **Compilation happens inside the container too** (Key insight 2).
- **The container never gets the container runtime's control socket.** Access to it is the same as control of the host.

`pipeline/tests/test_sandbox.py` proves each limit with a Solution that tries to break it: a `connect()` to a public address, a write to the image and to `/etc`, a 512 MB allocation under a 256 MB cap, a loop of 200 `fork()`s, an empty endless loop, 1 MB of output, and a forged trace.

## 4. Getting files in and out

**No bind mounts.** Files go in on the stdin of `docker exec ... sh -c 'cat > /work/NAME'` and come out on the stdout of `docker exec ... head -c CAP /work/NAME`. So no host path is ever visible inside the container, and the same code works with a Docker daemon in a VM (Colima on macOS, §6) or on another machine. A bind mount there would silently show an empty folder, because such a VM shares only some host folders.

**The run folder is a tmpfs.** `/work` lives in the container's memory and is gone when the container is. Its size cap is also the disk cap.

**The program's output goes to a file, not through Docker.** The run step is `./program > output.txt 2>&1`, and the output is then read up to 64 KB. A program that prints without end fills the 64 MB tmpfs and gets write errors; it cannot fill the memory of the process that started it.

**Bytes, not text.** The trace comes back as raw bytes, and only the checker decodes it. Decoding it earlier, with replacement characters, could turn invalid UTF-8 into valid text and hide it from validation.

**Leftover processes are killed.** The run step ends with `kill -9 -1`, run as the program's own user, which stops every process the program left behind (a forked child, say) before the trace is read, and nothing else. Because the program has a user of its own, that cannot reach the container's own processes. `--init` then reaps them, so none stays as a zombie.

The runtime already behaves the way the sandbox needs ([`adapters/cpp.md` §7](adapters/cpp.md#7-writing-the-trace)):

- **It writes to the path in `TRACE_OUT`**, so the pipeline chooses where the trace lands.
- **It never writes the trace to stdout**, so the user's own prints cannot corrupt or forge it.
- **The write is atomic.** A container killed at the time limit leaves a complete trace or no file, never half of one.
- **At the step cap it writes the trace and exits.** An infinite loop that calls `record` ends in about 2,000 steps with a truncated trace, long before the time limit.

## 5. How a run can end

| What happened | Trace file | Stage, exit code | What comes back |
|---|---|---|---|
| The method returned | Valid, with `result` | (none), 0 | The trace |
| The step cap was reached | Valid, with `"truncated": true` and no `result` | (none), 0 | The trace. The frontend says it was cut off |
| The example cannot be used | None | `driver`, 2 | What is wrong with it |
| The source does not compile | None | `rewriter`, 2 | The compiler's message, naming the user's file |
| The generated program does not compile | None | `compile`, 3 | A build bug: in the driver or the rewriter, not the user's code |
| The program crashed | None | `run`, 4 | The signal, and the last 20 lines it printed. `SIGKILL` in the sandbox is reported as most likely the memory limit |
| The sandbox itself ended (under gVisor, the memory limit) | None | `run`, 4 | "The sandbox was stopped", with the memory limit when Docker reports it ran out of memory (§6.1) |
| The time limit was reached | None | `run`, 4 | A timeout error |
| The trace is larger than 16 MB | Not read | `run`, 4 | An error |
| The trace failed validation | Present but rejected | `validate`, 5 | An error. The trace is never forwarded |
| The sandbox could not run | None | `sandbox`, 6 | What is missing: Docker, the image, or the `runsc` runtime |

A crash currently loses the steps recorded before it ([`adapters/cpp.md` §10](adapters/cpp.md#10-known-limitations)). Whether to save them is an open decision (§8).

## 6. Docker, gVisor, and macOS

**Decision:** one image (`sandbox/Dockerfile`) and one short-lived container per run, with gVisor underneath for anyone's code.

A plain Docker container shares the host's kernel, so on its own it is not a strong barrier against code that is trying to escape. gVisor puts a kernel written in user space between the code and the host, and plugs into Docker as a runtime, so the image and every command stay the same: only `--runtime runsc` is added.

| Option | Isolation | Cost | Used for |
|---|---|---|---|
| Docker with the limits in §3 | Shared kernel | Lowest | `--sandbox docker`: development, and tests where gVisor is missing |
| gVisor (`runsc`) | A user-space kernel between the code and the host | A slower start and slower system calls | `--sandbox gvisor`: the backend, and local runs that should match it |
| Firecracker | A small virtual machine per run | Strongest, and the most work to operate | Not used |

**The image** (`sandbox/Dockerfile`) has two stages. The first builds the rewriter against Clang 18. The second holds only what a run needs: `trace-rewrite`, the runtime headers, and `clang++-18` with libstdc++. It has no Python, no driver, and no checker, since those run outside. The same image builds natively on x86-64 Linux and on Apple Silicon.

**macOS.** gVisor runs only on Linux. Docker on a Mac already runs containers in a Linux VM, so gVisor goes in that VM. Docker Desktop's VM does not officially support extra runtimes, so the supported setup is **Colima**, a Docker VM you control: `sandbox/colima-gvisor.yaml` installs `runsc` in it and registers it on every start. Colima runs alongside Docker Desktop as a separate Docker context, `colima-gvisor`. The Mac then runs exactly what the backend runs, under the same libstdc++, so a run that passes locally behaves the same on the server.

```bash
export DOCKER_CONTEXT=colima-gvisor
docker build -f sandbox/Dockerfile -t leetcode-visualizer-sandbox .
python3 -m pipeline fixtures/two_sum_trace.cpp --example "nums = [2,7,11,15], target = 9" --sandbox gvisor
TRACE_SANDBOX=gvisor python3 -m unittest pipeline.tests.test_sandbox -v
```

CI's `sandbox-linux` job installs gVisor on Ubuntu, builds the image, and runs `test_sandbox.py` under both runtimes.

### 6.1 Where a limit lands under gVisor

Docker applies its limits to the host processes of a container. Under Docker's own runtime those are the program's processes. Under gVisor they are gVisor's: its kernel, written in user space, holds the program's memory and runs its processes as its own tasks. Measured on macOS (Colima, gVisor on arm64):

| Limit | Docker's runtime | gVisor |
|---|---|---|
| `--memory 256m`, 512 MB touched | The program is killed (status 137). The container keeps running, with `OOMKilled` set | The whole sandbox ends (container exit 137, `OOMKilled` set) |
| `--pids-limit 64`, 200 forks | Forks fail with "Cannot fork". The container keeps running | The whole sandbox ends: gVisor's own threads count against the limit |
| `--ulimit nproc=64` with `--pids-limit 1024`, 200 forks | (not used: it would count the user's processes on the whole host) | Forks fail. The container keeps running |

So the pipeline uses `--ulimit nproc` for the process limit under gVisor, and keeps `--pids-limit` only as a ceiling on gVisor's threads. For memory, the sandbox ending is acceptable: the run had to stop anyway. After every run the pipeline asks Docker whether the container is still running. If not, the error says the sandbox was stopped, and names the memory limit when Docker reports `OOMKilled`, so the user sees why instead of "status 128".

## 7. What is not here yet

- **The API service** (`backend/`, planned). It will call `pipeline.run(..., sandbox="gvisor")` and return the trace or the error. It must cap the size of the pasted source and the example before calling it.
- **Abuse limits**: how many runs one visitor may start, and how many run at once on one machine.
- **Image updates**: the image is built by hand; the backend's deployment will need to build it.

## 8. Open decisions

1. **The actual numbers** (§3): memory, CPU, time, process count, output size. They need measuring on real solutions. Measured for Two Sum under Docker on Linux: starting the container 0.2 s, rewriting 1.4 s, compiling 1.7 s, running 0.1 s. Rewriting and compiling both spend their time parsing the standard headers and `trace.hpp`, so a precompiled header would cut both. gVisor adds to every step.
2. **Crashes.** Should the runtime catch fatal signals and write the steps recorded so far? The spec already allows a trace with no `result` and no `truncated`.
3. **What the user's stdout is for.** The pipeline returns it (up to 64 KB). It could be shown next to the trace, or dropped.
4. **Where the backend is hosted.** The frontend is a static site. The API service and the sandbox need a Linux server that can run containers under gVisor, which a static host cannot do.
5. **Warm containers.** A container starts in about 0.2 s under Docker, more under gVisor. A pool of ready containers would be faster but must be shown to leak nothing between runs (Q2).

## 9. Design questions

**Q1. Why validate outside the sandbox when the adapter is our own code?** The adapter shares a process with the user's code. Code that can run can also write any file the adapter can, including a trace that looks real. Only a check outside the container is out of its reach. `test_a_forged_trace_is_rejected_outside` proves it.

**Q2. Why a new container per run instead of a pool of warm ones?** A fresh container cannot carry anything over from the last user's run. Reuse is faster and is a possible later optimization, but it must be shown to leak nothing first.

**Q3. Why is the time limit still needed if the step cap ends infinite loops?** The step cap only fires inside `record`. A loop with an empty body, a loop in library code, or a compile that never finishes never calls it.

**Q4. Why one container for all three steps, and not one for compiling and another for running?** Two would be stricter: the run could get less memory and an image with no compiler in it. But each container costs a start, which gVisor makes slower. Everything inside is already untrusted and limited, and nothing inside is trusted afterwards, so one container per run is the simpler start. Splitting it later changes only `Container`.

**Q5. Why move files with `docker exec` instead of mounting a folder?** A mount needs the host path to exist where the Docker daemon runs. With Colima, the daemon is in a VM that shares only the home folder, and Python's temporary folders on macOS are elsewhere, so the mount would be silently empty. `docker exec` works wherever `docker` does, and it never shows a host path to the code.

**Q6. Why Colima on macOS and not Docker Desktop?** Both run Docker in a Linux VM. Colima's VM is yours to configure, and its config can install and register `runsc` on every start. Adding a runtime to Docker Desktop's VM works only by an unsupported change that an update or a settings change can undo.

**Q7. Why does the rewriter's error name the user's file, when it ran on `/work/solution.cpp`?** The message is rewritten after the run: the run folder's copy is replaced by the name the user gave, so no path from inside the container reaches the user.
