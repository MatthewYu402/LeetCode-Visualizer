# Sandboxing

> **Status:** Draft v0.1. A proposal: no part of the sandbox or the API service exists yet.
> **Related:** [`trace-format.md`](trace-format.md) (the contract), [`adapters/cpp.md`](adapters/cpp.md) §7 (how the C++ runtime writes a trace), [`native-tracing.md`](native-tracing.md) §6 (why tracer output is untrusted)

This document describes how the system will run a stranger's code safely: where the code runs, what it is allowed to use, how the trace gets out, and what the API service returns for each way a run can end.

---

## 1. What the sandbox is for

The product runs code that anyone on the internet typed in. That code must not be able to read other users' data, reach the network, take over the host, or use up the machine.

The sandbox also protects the frontend from the trace itself. The tracer runs in the same process as the user's code, so the code can write a forged or broken trace. Nothing that comes out of the sandbox is trusted until it has been validated outside it.

> **Key insight 1: the sandbox contains the code, and schema validation contains the output.** Both are needed. Isolation stops the code from harming the host. Validation stops its output from harming the frontend.

## 2. One run, start to finish

```
browser ──► API service ──► container (one per run) ──► API service ──► browser
            1. make a run folder      3. rewrite, compile   5. read the trace
            2. start the container    4. run                6. validate it
                                                            7. delete the folder
```

1. The API service creates an empty folder for this run only.
2. It starts a container from the language's image, with the folder mounted as the only writable location and `TRACE_OUT` pointing into it.
3. Inside the container, the adapter rewrites the source, adds the driver, and compiles.
4. The compiled program runs and writes its trace.
5. When the container exits or is killed, the service reads that one file, up to a size cap.
6. It validates the trace against `schema/trace.schema.json`.
7. It deletes the folder and returns the trace, or an error.

One folder per run is what keeps two users from overwriting each other's trace. It is why the path comes from an environment variable and is not fixed in the runtime.

## 3. Limits on the container

| Limit | Setting | What it stops |
|---|---|---|
| Network | None | Sending data out, attacking other machines |
| Memory | A fixed cap | A huge allocation taking down the host |
| CPU | A fixed share | One run starving the others |
| Processes | A small cap | Fork bombs |
| Wall-clock time | Enforced from outside: the service kills the container | A loop that never reaches the tracer |
| Filesystem | Read-only, except the run folder | Changing the image, filling the disk |
| Output size | A cap on the trace file and on stdout | A program that writes without end |
| User | Not root, all capabilities dropped, no privilege escalation | Using root inside the container to attack the kernel |

Two rules are easy to miss:

- **Compilation happens inside the container too.** The compiler is also processing untrusted input. A source file can `#include` any file the compiler can read, and some templates make it use huge amounts of memory and time.
- **The container never gets the container runtime's control socket.** Access to it is the same as control of the host.

## 4. Getting the trace out

The runtime already behaves the way the sandbox needs ([`adapters/cpp.md` §7](adapters/cpp.md#7-writing-the-trace)):

- **It writes to the path in `TRACE_OUT`**, so the service chooses where the trace lands.
- **It never writes the trace to stdout**, so the user's own prints cannot corrupt or forge it.
- **The write is atomic.** A container killed at the time limit leaves a complete trace or no file, never half of one.
- **At the step cap it writes the trace and exits.** An infinite loop that calls `record` ends in about 2,000 steps with a truncated trace, long before the time limit.

## 5. How a run can end

| What happened | Trace file | What the service returns |
|---|---|---|
| The method returned | Valid, with `result` | The trace |
| The step cap was reached | Valid, with `"truncated": true` and no `result` | The trace. The frontend says it was cut off |
| The source did not compile | None | A compile error, with the compiler's message |
| The program crashed | None | A runtime error |
| The time limit was reached | None | A timeout error |
| The trace failed validation | Present but rejected | An internal error. The trace is never forwarded |

A crash currently loses the steps recorded before it ([`adapters/cpp.md` §10](adapters/cpp.md#10-known-limitations)). Whether to save them is an open decision (§7).

## 6. Docker, and what goes under it

The plan is one image per language, holding the toolchain and the adapter, and one short-lived container per run. Docker fits that, and it is the right tool for local development.

A plain Docker container shares the host's kernel, so on its own it is not a strong barrier against code that is trying to escape. For a public site, a stronger layer goes underneath:

| Option | Isolation | Cost |
|---|---|---|
| Docker with the limits in §3 | Shared kernel | Lowest. Fine for local use and private demos |
| gVisor | A user-space kernel between the code and the host | Plugs into Docker as a runtime, so images and commands stay the same |
| Firecracker | A small virtual machine per run | Strongest, and the most work to operate |

The proposal is to build against Docker first and add gVisor before the site is public. This is not decided.

## 7. Open decisions

1. **The isolation layer for the public site** (§6).
2. **The actual numbers**: memory, CPU, time, process count, output size. They need measuring on real solutions.
3. **Crashes.** Should the runtime catch fatal signals and write the steps recorded so far? The spec already allows a trace with no `result` and no `truncated`.
4. **What the user's stdout is for.** It could be shown next to the trace, or dropped.
5. **Where the backend is hosted.** The frontend is a static site. The API service and the sandbox need a server that can run containers, which a static host cannot do.
6. **Abuse limits**: how many runs one visitor may start.

## 8. Design questions

**Q1. Why validate outside the sandbox when the adapter is our own code?** The adapter shares a process with the user's code. Code that can run can also write any file the adapter can, including a trace that looks real. Only a check outside the container is out of its reach.

**Q2. Why a new container per run instead of a pool of warm ones?** A fresh container cannot carry anything over from the last user's run. Reuse is faster and is a possible later optimization, but it must be shown to leak nothing first.

**Q3. Why is the time limit still needed if the step cap ends infinite loops?** The step cap only fires inside `record`. A loop in library code, or a compile that never finishes, never calls it.
