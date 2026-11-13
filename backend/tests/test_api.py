"""The API (backend/app.py): each endpoint, each error, and one real run through the sandbox.

    python3 -m pip install -r backend/requirements.txt
    python3 -m unittest discover -s backend/tests -t .

Most tests use a fake pipeline, so they are fast and need no Docker. The last
class runs the real pipeline in the sandbox ($TRACE_SANDBOX, default docker)
and is skipped without Docker or the image.
"""

import contextlib
import json
import os
import tempfile
import threading
import time
import unittest
from pathlib import Path
from types import SimpleNamespace

try:
    from fastapi.testclient import TestClient
except ImportError:  # backend/requirements.txt not installed
    TestClient = None

if TestClient:
    import backend.app as api
    from backend.app import create_app

from driver.tests.support import check_trace
from driver.tests.test_fixtures import FIXTURES
from pipeline import EXIT_BUILD, EXIT_INPUT, EXIT_INVALID, EXIT_RUN, EXIT_SANDBOX, PipelineError
from pipeline.tests.test_sandbox import _image_ready

needs_fastapi = unittest.skipUnless(TestClient, "FastAPI is not installed (pip install -r backend/requirements.txt)")

TWO_SUM = (FIXTURES / "two_sum_trace.cpp").read_text(encoding="utf-8") if FIXTURES.exists() else ""
FIELDS = {"nums": "[2,7,11,15]", "target": "9"}


class FakeRun:
    """Records each call; returns a result, or raises what it is given."""

    def __init__(self, raises=None, gate=None):
        self.calls, self.raises, self.gate = [], raises, gate

    def __call__(self, source, example, **options):
        self.calls.append((source, example, options))
        if self.gate:
            self.gate.wait(10)
        if self.raises:
            raise self.raises
        return SimpleNamespace(trace={"version": "0.7", "steps": []}, output="hi\n", warnings=["a note"])


@needs_fastapi
class Health(unittest.TestCase):
    def test_health_names_the_sandbox(self):
        client = TestClient(create_app(sandbox="docker", run=FakeRun()))
        self.assertEqual(client.get("/api/health").json(), {"ok": True, "sandbox": "docker"})

    def test_no_sandbox_needs_an_explicit_opt_in(self):
        saved = os.environ.pop("TRACE_ALLOW_UNSANDBOXED", None)
        try:
            with self.assertRaises(RuntimeError):
                create_app(sandbox="none")
            os.environ["TRACE_ALLOW_UNSANDBOXED"] = "1"
            create_app(sandbox="none")
        finally:
            os.environ.pop("TRACE_ALLOW_UNSANDBOXED", None)
            if saved is not None:
                os.environ["TRACE_ALLOW_UNSANDBOXED"] = saved


@needs_fastapi
class Signature(unittest.TestCase):
    def setUp(self):
        self.client = TestClient(create_app(sandbox="docker", run=FakeRun()))

    def test_methods_and_params(self):
        r = self.client.post("/api/signature", json={"source": TWO_SUM})
        self.assertEqual(r.status_code, 200)
        body = r.json()
        self.assertEqual(body["method"], "twoSum")
        self.assertEqual(body["methods"][0]["params"], [{"name": "nums", "type": "array<int>"}, {"name": "target", "type": "int"}])
        self.assertNotIn("fields", body)

    def test_a_pasted_example_fills_the_fields(self):
        r = self.client.post("/api/signature", json={"source": TWO_SUM, "example": "Input: nums = [2, 7, 11, 15], target = 9\nOutput: [0,1]"})
        self.assertEqual(r.json()["fields"], FIELDS)

    def test_no_solution_is_a_driver_error(self):
        r = self.client.post("/api/signature", json={"source": "int main() {}"})
        self.assertEqual(r.status_code, 422)
        self.assertEqual(r.json()["error"]["stage"], "driver")

    def test_a_source_too_long_is_refused(self):
        r = self.client.post("/api/signature", json={"source": "x" * (api.MAX_SOURCE + 1)})
        self.assertEqual((r.status_code, r.json()["error"]["stage"]), (422, "request"))
        self.assertIn("source", r.json()["error"]["message"])


@needs_fastapi
class Run(unittest.TestCase):
    def test_fields_become_the_example_text(self):
        fake = FakeRun()
        client = TestClient(create_app(sandbox="gvisor", run=fake))
        r = client.post("/api/run", json={"source": TWO_SUM, "method": "twoSum", "fields": {**FIELDS, "pos": ""}})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertEqual(r.json(), {"trace": {"version": "0.7", "steps": []}, "output": "hi\n", "warnings": ["a note"]})
        [(source, example, options)] = fake.calls
        self.assertEqual(example, "nums = [2,7,11,15], target = 9")
        self.assertEqual((options["method"], options["sandbox"]), ("twoSum", "gvisor"))

    def test_a_bad_value_never_reaches_the_pipeline(self):
        fake = FakeRun()
        client = TestClient(create_app(sandbox="docker", run=fake))
        r = client.post("/api/run", json={"source": TWO_SUM, "fields": {"nums": "[2,7", "target": "9"}})
        self.assertEqual((r.status_code, r.json()["error"]["stage"]), (422, "driver"))
        self.assertIn("'nums'", r.json()["error"]["message"])
        self.assertEqual(fake.calls, [])

    def test_each_way_a_run_ends(self):
        cases = [(EXIT_INPUT, "rewriter", 422), (EXIT_RUN, "run", 422), (EXIT_BUILD, "compile", 500),
                 (EXIT_INVALID, "validate", 500), (EXIT_SANDBOX, "sandbox", 503)]
        for code, stage, status in cases:
            with self.subTest(stage=stage):
                client = TestClient(create_app(sandbox="docker", run=FakeRun(raises=PipelineError(stage, "what happened", code))))
                r = client.post("/api/run", json={"source": TWO_SUM, "fields": FIELDS})
                self.assertEqual(r.status_code, status)
                self.assertEqual(r.json(), {"error": {"stage": stage, "message": "what happened"}})

    def test_the_time_limit_cannot_be_raised(self):
        client = TestClient(create_app(sandbox="docker", run=FakeRun()))
        r = client.post("/api/run", json={"source": TWO_SUM, "fields": FIELDS, "timeout": 60})
        self.assertEqual((r.status_code, r.json()["error"]["stage"]), (422, "request"))



@needs_fastapi
class Line(unittest.TestCase):
    """The slots and the line (backend/app.py, Line): one run per address, a capped
    line refused at once, and the visitor's address taken only from a trusted proxy."""

    def setUp(self):
        self.gate = threading.Event()
        self.fake = FakeRun(gate=self.gate)
        self.threads = []

    def tearDown(self):
        self.gate.set()
        for t in self.threads:
            t.join(10)

    @contextlib.contextmanager
    def client(self, slots=1, waiting=5, peer="127.0.0.1"):
        # The peer 127.0.0.1 is a trusted proxy, so X-Forwarded-For names the visitor.
        # One TestClient context is one event loop, so every request shares the line.
        with TestClient(create_app(sandbox="docker", max_runs=slots, max_waiting=waiting, run=self.fake),
                        client=(peer, 40000)) as c:
            try:
                yield c
            finally:  # let blocked runs finish before the client waits for them
                self.gate.set()
                for t in self.threads:
                    t.join(10)

    def start(self, client, visitor):
        """A run from `visitor` in the background (it blocks on the gate)."""
        t = threading.Thread(target=client.post, args=("/api/run",),
                             kwargs={"json": {"source": TWO_SUM, "fields": FIELDS}, "headers": {"X-Forwarded-For": visitor}})
        t.start()
        self.threads.append(t)

    def wait_until(self, condition):
        deadline = time.monotonic() + 5
        while not condition() and time.monotonic() < deadline:
            time.sleep(0.01)

    def post(self, client, visitor):
        t = time.monotonic()
        r = client.post("/api/run", json={"source": TWO_SUM, "fields": FIELDS}, headers={"X-Forwarded-For": visitor})
        return r, time.monotonic() - t

    def test_one_run_per_address(self):
        with self.client(slots=2) as c:
            self.start(c, "203.0.113.7")
            self.wait_until(lambda: self.fake.calls)
            r, seconds = self.post(c, "203.0.113.7")
            self.assertEqual((r.status_code, r.json()["error"]["stage"]), (429, "already-running"))
            self.assertLess(seconds, 1)
            self.gate.set()
            for t in self.threads:
                t.join(10)
            r, _ = self.post(c, "203.0.113.7")  # once it is done, the same address may run again
            self.assertEqual(r.status_code, 200)

    def test_a_full_line_is_refused_at_once(self):
        with self.client(slots=1, waiting=1) as c:
            self.start(c, "203.0.113.1")                     # in the slot
            self.wait_until(lambda: self.fake.calls)
            self.start(c, "203.0.113.2")                     # waiting: the line is now full
            time.sleep(0.3)
            r, seconds = self.post(c, "203.0.113.3")
            self.assertEqual((r.status_code, r.json()["error"]["stage"]), (503, "busy"))
            self.assertLess(seconds, 1)
            self.assertGreaterEqual(r.json()["error"]["retry_after"], 1)
            self.assertEqual(r.headers["Retry-After"], str(r.json()["error"]["retry_after"]))
            self.gate.set()
            for t in self.threads:
                t.join(10)
            self.assertEqual(len(self.fake.calls), 2)       # the waiting run ran after the first

    def test_waiting_too_long_is_busy(self):
        saved, api.WAIT_FOR_A_SLOT = api.WAIT_FOR_A_SLOT, 0.3
        try:
            with self.client(slots=1, waiting=5) as c:
                self.start(c, "203.0.113.1")
                self.wait_until(lambda: self.fake.calls)
                r, seconds = self.post(c, "203.0.113.2")
                self.assertEqual((r.status_code, r.json()["error"]["stage"]), (503, "busy"))
                self.assertLess(seconds, 2)
        finally:
            api.WAIT_FOR_A_SLOT = saved

    def test_a_forwarded_address_is_ignored_from_anyone_but_the_proxy(self):
        # From an untrusted peer, X-Forwarded-For could be anything, so every
        # request is that peer, whatever the header says.
        with self.client(slots=2, peer="198.51.100.9") as c:
            self.start(c, "203.0.113.1")
            self.wait_until(lambda: self.fake.calls)
            r, _ = self.post(c, "203.0.113.2")
            self.assertEqual((r.status_code, r.json()["error"]["stage"]), (429, "already-running"))

    def test_signatures_never_wait_behind_runs(self):
        with self.client(slots=1, waiting=10) as c:
            for i in range(6):
                self.start(c, f"203.0.113.{i}")
            self.wait_until(lambda: self.fake.calls)
            t = time.monotonic()
            r = c.post("/api/signature", json={"source": TWO_SUM})
            self.assertEqual(r.status_code, 200)
            self.assertLess(time.monotonic() - t, 0.5)


@needs_fastapi
@unittest.skipUnless(_image_ready(), "no Docker, or the sandbox image is not built")
class RealRun(unittest.TestCase):
    def test_two_sum_through_the_sandbox(self):
        client = TestClient(create_app(sandbox=os.environ.get("TRACE_SANDBOX", "docker"), pool_size=0))
        r = client.post("/api/run", json={"source": TWO_SUM, "fields": FIELDS})
        self.assertEqual(r.status_code, 200, r.text)
        with tempfile.TemporaryDirectory() as work:
            path = Path(work) / "trace.json"
            path.write_text(json.dumps(r.json()["trace"]), encoding="utf-8")
            status, output = check_trace("--equals", FIXTURES / "two-sum.trace.json", path)
        self.assertEqual(status, 0, output)

    def test_a_compile_error_comes_back_as_422(self):
        client = TestClient(create_app(sandbox=os.environ.get("TRACE_SANDBOX", "docker"), pool_size=0))
        r = client.post("/api/run", json={"source": "class Solution {\npublic:\n    int f(int n) {\n        return m;\n    }\n};",
                                          "fields": {"n": "3"}})
        self.assertEqual((r.status_code, r.json()["error"]["stage"]), (422, "rewriter"))
        self.assertIn("solution.cpp:4:", r.json()["error"]["message"])


if __name__ == "__main__":
    unittest.main()
