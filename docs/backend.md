# API service

> **Status:** Draft v0.2. Implemented in `backend/` (FastAPI). Not hosted anywhere yet.
> **Related:** [`sandboxing.md`](sandboxing.md) (where the code runs), [`driver-generation.md`](driver-generation.md) (what reads the Solution and the example), [`frontend.md`](frontend.md) (the page that calls this), [`trace-format.md`](trace-format.md) (what comes back)

The API service is the frontend's only way to run code. It is a thin layer over two things that already exist: the driver's `describe()`, which reads a Solution's declarations, and `pipeline.run()`, which runs the driver, then rewrites, compiles, and runs inside the sandbox, then validates the trace. The service itself never compiles or runs the user's code.

---

## 1. One run, from the page

```
page                         API service (this machine)                 sandbox (one container)
paste Solution  ──────────►  POST /api/signature: describe()
one field per parameter ◄──  methods, parameters, neutral types
fill fields, Run code ─────► POST /api/run: fields -> example text
                             pipeline.run(..., sandbox="gvisor") ─────► rewrite, compile, run
                             validate the trace (outside)        ◄───── trace bytes
replay the trace  ◄────────  {trace, output, warnings}
```

> **Key insight 1: the form's fields become LeetCode's example text on the server.** `{"nums": "[2,7,11,15]", "target": "9"}` becomes `nums = [2,7,11,15], target = 9`, which the driver already reads. So the form needs no parser of its own, and a value is checked once, by the same code that runs it.

## 2. Endpoints

All bodies are JSON. Errors have one shape, in §3.

### 2.1 `GET /api/health`

```json
{"ok": true, "sandbox": "gvisor"}
```

### 2.2 `POST /api/signature`

Reads the Solution's public methods. Nothing is compiled or run, so this is answered outside the sandbox.

```json
{"source": "class Solution { public: vector<int> twoSum(vector<int>& nums, int target) { ... } };",
 "example": "Input: nums = [2,7,11,15], target = 9\nOutput: [0,1]"}
```

`example` is optional. When present, the answer also has `fields`: the example's values by name, rewritten compactly, for filling the form.

```json
{"methods": [{"name": "twoSum",
              "params": [{"name": "nums", "type": "array<int>"}, {"name": "target", "type": "int"}],
              "returns": "array<int>", "extras": [], "readable": true, "note": ""}],
 "method": "twoSum",
 "fields": {"nums": "[2,7,11,15]", "target": "9"}}
```

- **`type`** is the neutral type name (spec §4), the same one the trace's `problem.params` will carry.
- **`extras`** are names the example may give that are not parameters. Today only `pos`, offered when a method takes a `ListNode*` (Linked List Cycle). It may be left empty.
- **`method`** is the one to preselect: the first public method the driver can read. LeetCode's method comes first in the class; helpers usually come after it.
- **`readable: false`** with a `note` marks a method the driver cannot read, such as a template, or one taking a node type with no commented definition. It is listed, so the user sees why, but never preselected.

### 2.3 `POST /api/run`

```json
{"source": "class Solution { ... };",
 "method": "twoSum",
 "fields": {"nums": "[2,7,11,15]", "target": "9"},
 "timeout": 10}
```

`method` is optional (the driver then chooses as it does for the CLI). `timeout` is optional, in seconds, and at most 10. An empty field is left out, so an optional extra can stay blank.

```json
{"trace": {"version": "0.8", "problem": {"method": "twoSum", ...}, "steps": [...], "result": {...}},
 "output": "what the program printed",
 "warnings": []}
```

The trace has passed `tools/check_trace.py` outside the sandbox. `output` is the program's stdout and stderr, up to 64 KB. `warnings` are the driver's notes, such as values passed in order because the example's names did not match.

## 3. Errors

Every error is `{"error": {"stage": ..., "message": ...}}`. The message is written for the user and never contains a path from inside the sandbox.

| Stage | Status | Meaning |
|---|---|---|
| `request` | 422 | The request itself is wrong: a field missing, a value too long, a timeout over 10 s |
| `driver` | 422 | The Solution or the inputs cannot be used: no `class Solution`, a value that is not valid JSON, names that do not match the method |
| `rewriter` | 422 | The code does not compile. The message is Clang's, naming `solution.cpp` and the line |
| `run` | 422 | The program crashed, ran out of time, used too much memory, or wrote no trace |
| `compile` | 500 | The generated program did not compile: a bug in the driver or the rewriter |
| `validate` | 500 | The trace failed validation: a bug in the runtime, or a trace the code forged |
| `sandbox` | 503 | The sandbox cannot run: no Docker, no image, no gVisor |
| `already-running` | 429 | This visitor already has a run waiting or in progress (a second tab, a double click) |
| `busy` | 503 | The line is full, so the run is refused at once; or it waited 30 s without getting a slot. The error has `retry_after` (seconds), also sent as the `Retry-After` header |

The frontend adds two of its own: `network` (the API cannot be reached, or answered without JSON) and `trace` (the frontend's loader cannot read the trace).

## 4. Limits

| Limit | Value | Why |
|---|---|---|
| Solution | 64 KB | A LeetCode Solution is a few KB. The rewriter and the compiler read all of it |
| One value, or a pasted example | 16 KB | LeetCode's constraints rarely go past 10^4 elements per input |
| Fields | 32 | No LeetCode method takes that many parameters |
| Time | 10 s per run, the same as the CLI's default; 60 s for rewriting and for compiling | The sandbox's own limits (§3 of `sandboxing.md`) apply on top |
| Runs at once (slots) | 2 (`TRACE_MAX_RUNS`) | Each run is a container with 1 CPU and 1 GB (`TRACE_RUN_MEMORY`) |
| Runs waiting | At most 10 per slot (`TRACE_MAX_WAITING`), and never more than can start within 30 s at the measured pace. Beyond that, `busy` at once, with an estimated wait | Nobody waits 30 s only to be refused |
| Runs per visitor | One waiting or in progress at a time (`already-running`) | One visitor cannot fill the line |

Limits per visitor (how many runs one person may start) are not here yet. They belong in front of the service, with the hosting decision ([`sandboxing.md` §8](sandboxing.md#8-open-decisions)).

### 4.1 Who a visitor is

The service has no accounts, so a visitor is an address. Behind a proxy on the same machine, such as Caddy for HTTPS, every request comes from `127.0.0.1`, and the proxy names the visitor in `X-Forwarded-For`. The service believes that header only from `TRACE_TRUSTED_PROXIES`: from anyone else it could be invented, which would let one person appear as many. `python3 -m backend` turns off Uvicorn's own handling of the header, so this is the only rule. A test sends a forged header from an untrusted peer and checks that it is ignored.

Limits per minute or per day per visitor are not here. They only matter against deliberate abuse; the line and one run per visitor already keep the slots fair.

## 5. Settings and running it

| Variable | Default | Meaning |
|---|---|---|
| `TRACE_SANDBOX` | `gvisor` | `gvisor` or `docker`. `none` runs code on this machine, and is refused unless `TRACE_ALLOW_UNSANDBOXED=1` is also set |
| `TRACE_MAX_RUNS` | `2` | Slots: runs in progress at once |
| `TRACE_MAX_WAITING` | 10 per slot | Most runs that may wait for a slot (fewer when runs are slow: see §4) |
| `TRACE_POOL` | `1` | Containers started ahead of time ([`sandboxing.md`](sandboxing.md) §4.1); `0` for none |
| `TRACE_RUN_MEMORY`, `TRACE_RUN_CPUS`, `TRACE_RUN_PIDS` | `1g`, `1`, `64` | Each run's limits ([`sandboxing.md`](sandboxing.md) §3) |
| `TRACE_TRUSTED_PROXIES` | `127.0.0.1,::1` | Peers whose `X-Forwarded-For` names the visitor (§4.1) |
| `TRACE_ALLOWED_ORIGINS` | (none) | Comma-separated origins for CORS. Unset is right in development, where the page's dev server proxies `/api` |

```bash
python3 -m venv .venv && source .venv/bin/activate
python3 -m pip install jsonschema -r backend/requirements.txt
export DOCKER_CONTEXT=colima-gvisor                    # macOS: the Colima VM that has gVisor
python3 -m backend                                    # 127.0.0.1:8000
cd frontend && npm run dev                            # http://localhost:5173, /api proxied to :8000
python3 -m unittest discover -s backend/tests -t .    # the API's tests
```

`python3 -m backend` listens on 127.0.0.1 only. FastAPI also serves its generated reference at `/docs`.

## 6. What runs

Algorithmic problems: one method of `Solution`, called once with arguments. **Design problems are not supported yet.** LRU Cache and Min Stack give their example as a sequence of calls on an object (`["LRUCache","put","get"]` with `[[2],[1,1],[1]]`), not as arguments to one method. One trace covering a whole sequence needs a change to the trace format ([`driver-generation.md` §8](driver-generation.md)). The input form cannot express such an example, and a design problem's code has no `class Solution` (it is `class LRUCache`), so the driver answers that it found no Solution class.

## 7. Design questions

**Q1. Why does the form send fields, and not the example text?** The fields are what the user typed; joining them is the server's job, so the check that each value is valid JSON, and that no value carries a second `name = value`, happens once, next to the driver that reads it. The form stays a list of text boxes.

**Q2. Why is `/api/signature` answered outside the sandbox?** It only reads declarations with the driver's text scanner. Nothing is compiled, linked, or run, and the size cap bounds the work. Starting a container for it would add a second or more to every pause in typing.

**Q3. Why does a run wait in the event loop, and not in a thread?** The first version waited for a slot inside a thread. A load test of 60 runs at once took all 40 of the server's threads with waiting runs, and `/api/signature` then waited 29 s for a thread, so every visitor's form froze. Now a waiting run is a paused coroutine, and only a run in a slot uses a thread. In the same test, a signature answers in under 10 ms, and of 46 refused runs, 43 are refused at once.

**Q4. Why refuse `TRACE_SANDBOX=none` by default?** It runs anyone's code on the server with only a time limit. It is useful for a quick local test without Docker, and dangerous anywhere else, so it takes two settings to turn on.

**Q5. Why are crashes and timeouts 422, while build and validation failures are 500?** A 4xx says the user's input caused it, which is true of code that crashes or never ends. A 5xx says the service failed: a generated program that does not compile, or a trace that fails validation, is our bug (or a forged trace), and should be noticed in logs.
