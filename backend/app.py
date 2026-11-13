"""The API service: the frontend's only way to run code (docs/backend.md).

    GET  /api/health      is the service up, and which sandbox does it use
    POST /api/signature   a Solution -> its methods and parameters, for the input form
    POST /api/run         a Solution and its inputs -> a validated trace

It is a thin layer over two things that already exist: the driver's describe()
(reads declarations, runs nothing) and pipeline.run() (driver, then rewrite,
compile, and run inside the sandbox, then validation). The service itself
never compiles or runs the user's code.

Run it from the repository root:

    python3 -m backend                       # http://127.0.0.1:8000, sandbox from TRACE_SANDBOX (default gvisor)

Settings, from the environment (docs/backend.md §5):

    TRACE_SANDBOX            gvisor (default) or docker. `none` runs code on this
                             machine and is refused unless TRACE_ALLOW_UNSANDBOXED=1.
    TRACE_MAX_RUNS           slots: runs in progress at once (default 2).
    TRACE_MAX_WAITING        at most this many runs wait for a slot (default 10 per
                             slot), and never more than can start within 30 s at the
                             measured pace. Beyond that, a run is refused at once with "Busy".
    TRACE_POOL               containers started ahead of time (default 1; 0 for none).
    TRACE_RUN_MEMORY, TRACE_RUN_CPUS, TRACE_RUN_PIDS
                             each run's limits (pipeline/runners.py, Limits).
    TRACE_TRUSTED_PROXIES    peers whose X-Forwarded-For header names the visitor
                             (default 127.0.0.1 and ::1: a proxy on this machine).
    TRACE_ALLOWED_ORIGINS    comma-separated origins allowed by CORS. Unset: none,
                             which is right when the frontend's dev server proxies /api.
"""

import asyncio
import contextlib
import math
import os
import time

from fastapi import FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from driver import DriverError
from driver.cpp import describe, example_fields, example_text
from pipeline import EXIT_BUILD, EXIT_INPUT, EXIT_INVALID, EXIT_RUN, EXIT_SANDBOX, PipelineError
from pipeline import run as pipeline_run
from pipeline.runners import Limits, Pool

MAX_SOURCE = 64 * 1024      # characters of pasted Solution
MAX_VALUE = 16 * 1024       # characters of one input value, or of a pasted example
MAX_FIELDS = 32
WAIT_FOR_A_SLOT = 30.0      # seconds a run may wait in line before "Busy"

# How each way a run can end becomes an HTTP status (docs/backend.md §3).
STATUS = {
    EXIT_INPUT: 422,        # driver or rewriter: the Solution or the inputs cannot be used
    EXIT_RUN: 422,          # the program crashed, ran out of time, or wrote no trace
    EXIT_BUILD: 500,        # the generated program did not compile: our bug
    EXIT_INVALID: 500,      # the trace failed validation: our bug, or a forged trace
    EXIT_SANDBOX: 503,      # no Docker, no image, no gVisor
}


class SignatureRequest(BaseModel):
    source: str = Field(max_length=MAX_SOURCE)
    example: str | None = Field(default=None, max_length=MAX_VALUE)


class RunRequest(BaseModel):
    source: str = Field(max_length=MAX_SOURCE)
    method: str | None = Field(default=None, max_length=200)
    # One value per parameter, as LeetCode writes it: {"nums": "[2,7,11,15]", "target": "9"}.
    fields: dict[str, str] = Field(max_length=MAX_FIELDS)
    timeout: float = Field(default=10.0, gt=0, le=10.0)


def error(status, stage, message, retry_after=None):
    body = {"stage": stage, "message": message}
    headers = None
    if retry_after is not None:
        body["retry_after"] = retry_after
        headers = {"Retry-After": str(retry_after)}
    return JSONResponse(status_code=status, content={"error": body}, headers=headers)


class Line:
    """The slots and the line in front of them (docs/backend.md §4).

    It lives in the event loop: a run waiting for a slot is a paused coroutine,
    not a blocked thread, so waiting runs never take the threads that other
    requests (/api/signature) need. Only a run in a slot uses a thread.
    """

    def __init__(self, slots, max_waiting):
        self.slots, self.max_waiting = slots, max_waiting
        self.free = asyncio.Semaphore(slots)
        self.waiting = 0
        self.seconds_per_run = 4.0   # a running average of how long a run holds a slot
        self.active = set()          # addresses with a run waiting or in progress

    def room(self):
        """How many runs may wait: no more than can start within WAIT_FOR_A_SLOT
        at the measured pace, so nobody waits the whole time only to be refused,
        and never more than max_waiting."""
        can_start = int(self.slots * WAIT_FOR_A_SLOT / self.seconds_per_run)
        return max(1, min(self.max_waiting, can_start))

    def estimate(self, ahead):
        """Seconds until a run with `ahead` runs in front of it starts."""
        return max(1, math.ceil(self.seconds_per_run * (ahead + 1) / self.slots))

    def finished(self, seconds):
        self.seconds_per_run = 0.8 * self.seconds_per_run + 0.2 * seconds


def visitor_address(request, trusted):
    """The visitor's address. Behind a proxy on this machine (Caddy), every
    request comes from the proxy, which names the visitor in X-Forwarded-For.
    That header is believed only from a trusted peer: from anyone else it could
    be invented, so it is ignored. The last entry is the one the proxy added."""
    peer = request.client.host if request.client else ""
    if peer in trusted:
        forwarded = request.headers.get("x-forwarded-for", "")
        if forwarded.strip():
            return forwarded.split(",")[-1].strip()
    return peer


async def wait_for_slot(line, request, seconds):
    """True once a slot is ours; False if the visitor left or `seconds` passed.
    A visitor who closes the tab while waiting leaves the line. Whatever ends
    the wait, a slot that was granted is either kept (True) or given back."""
    acquire = asyncio.ensure_future(line.free.acquire())
    deadline = time.monotonic() + seconds
    try:
        gave_up = False
        while not acquire.done():
            await asyncio.wait({acquire}, timeout=0.25)
            if acquire.done():
                break
            if time.monotonic() > deadline or await request.is_disconnected():
                gave_up = True
                acquire.cancel()  # takes effect at the next await, unless the slot is granted first
                break
        if gave_up:
            try:
                await acquire
            except asyncio.CancelledError:
                if asyncio.current_task().cancelling():
                    raise  # this request itself is being cancelled, not only the wait
                return False
            line.free.release()  # granted in the same instant: give it back
            return False
        if await request.is_disconnected():  # granted, but nobody is waiting for the answer any more
            line.free.release()
            return False
        return True
    except BaseException:  # this request itself was cancelled while waiting
        if acquire.done() and not acquire.cancelled():
            line.free.release()
        else:
            acquire.cancel()
        raise


def create_app(sandbox=None, max_runs=None, max_waiting=None, run=pipeline_run, pool_size=None, limits=None):
    """The app. Tests pass a fake `run`; the real one is pipeline.run."""
    sandbox = sandbox or os.environ.get("TRACE_SANDBOX", "gvisor")
    if sandbox not in ("gvisor", "docker", "none"):
        raise ValueError(f"TRACE_SANDBOX must be gvisor, docker, or none, not {sandbox!r}")
    if sandbox == "none" and os.environ.get("TRACE_ALLOW_UNSANDBOXED") != "1":
        raise RuntimeError("TRACE_SANDBOX=none runs anyone's code directly on this machine. "
                           "Set TRACE_ALLOW_UNSANDBOXED=1 as well if that is really what you want.")
    slots = max_runs or int(os.environ.get("TRACE_MAX_RUNS", "2"))
    max_waiting = max_waiting if max_waiting is not None else int(os.environ.get("TRACE_MAX_WAITING", str(10 * slots)))
    trusted = {p.strip() for p in os.environ.get("TRACE_TRUSTED_PROXIES", "127.0.0.1,::1").split(",") if p.strip()}
    pool_size = pool_size if pool_size is not None else int(os.environ.get("TRACE_POOL", "1"))
    pool = Pool(pool_size) if sandbox != "none" and pool_size > 0 and run is pipeline_run else None
    limits = limits or Limits()
    lines = {}  # one Line per event loop (tests may run several)

    @contextlib.asynccontextmanager
    async def lifespan(_):
        yield
        if pool:
            await run_in_threadpool(pool.close)  # containers still waiting in the pool

    app = FastAPI(title="LeetCode Visualizer API", version="0.2", lifespan=lifespan)
    app.state.pool = pool

    origins = [o.strip() for o in os.environ.get("TRACE_ALLOWED_ORIGINS", "").split(",") if o.strip()]
    if origins:
        from fastapi.middleware.cors import CORSMiddleware
        app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST"], allow_headers=["Content-Type"])

    def line():
        loop = asyncio.get_running_loop()
        if loop not in lines:
            lines[loop] = Line(slots, max_waiting)
        return lines[loop]

    @app.exception_handler(RequestValidationError)
    def bad_request(_: Request, exc: RequestValidationError):
        first = exc.errors()[0] if exc.errors() else {}
        where = ".".join(str(p) for p in first.get("loc", ()) if p != "body")
        return error(422, "request", f"{where}: {first.get('msg', 'invalid request')}" if where else first.get("msg", "invalid request"))

    @app.get("/api/health")
    def health():
        return {"ok": True, "sandbox": sandbox}

    # A plain function: FastAPI runs it in a thread. Runs only hold threads while
    # they are in a slot, so this never waits behind a line of runs.
    @app.post("/api/signature")
    def signature(body: SignatureRequest):
        try:
            described = describe(body.source)
            if body.example is not None and body.example.strip():
                described["fields"] = example_fields(body.example)
        except DriverError as e:
            return error(422, "driver", str(e))
        return described

    @app.post("/api/run")
    async def run_endpoint(body: RunRequest, request: Request):
        oversized = [name for name, value in body.fields.items() if len(value) > MAX_VALUE or len(name) > 200]
        if oversized:
            return error(422, "request", f"The value of {oversized[0]!r} is longer than {MAX_VALUE} characters.")
        try:
            example = example_text(body.fields)
        except DriverError as e:
            return error(422, "driver", str(e))

        here = line()
        address = visitor_address(request, trusted)
        if address in here.active:
            return error(429, "already-running", "You already have a run in progress. Wait for it to finish, then run again.")
        if here.free.locked() and here.waiting >= here.room():
            wait = here.estimate(here.waiting)
            return error(503, "busy", f"Busy: {here.waiting} runs are waiting. Try again in about {wait} seconds.", retry_after=wait)

        here.active.add(address)
        here.waiting += 1
        try:
            got_slot = await wait_for_slot(here, request, WAIT_FOR_A_SLOT)
        finally:
            here.waiting -= 1
        if not got_slot:
            here.active.discard(address)
            wait = here.estimate(here.waiting)
            return error(503, "busy", f"Busy: the line did not move in {WAIT_FOR_A_SLOT:g} seconds. Try again in about {wait} seconds.",
                         retry_after=wait)
        started = time.monotonic()
        try:
            result = await run_in_threadpool(run, body.source, example, method=body.method or None, timeout=body.timeout,
                                             compile_timeout=60.0, sandbox=sandbox, limits=limits, pool=pool)
        except PipelineError as e:
            return error(STATUS.get(e.exit_code, 500), e.stage, str(e))
        finally:
            here.finished(time.monotonic() - started)
            here.free.release()
            here.active.discard(address)
        return {"trace": result.trace, "output": result.output, "warnings": result.warnings}

    return app


app = create_app()
