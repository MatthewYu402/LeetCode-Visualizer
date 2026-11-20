"""The sandbox (docs/sandboxing.md): every limit, proven by a Solution that tries to break it.

These run the pipeline with sandbox=$TRACE_SANDBOX ("docker" by default, or
"gvisor" for runsc). They need Docker and each language's image, and the tests
for a language are skipped without its image:

    docker build -f sandbox/cpp.Dockerfile -t visi-sandbox-cpp .
    docker build -f sandbox/python.Dockerfile -t visi-sandbox-python .
    docker build -f sandbox/java.Dockerfile -t visi-sandbox-java .
    python3 -m unittest pipeline.tests.test_sandbox
    TRACE_SANDBOX=gvisor python3 -m unittest pipeline.tests.test_sandbox

On macOS, point Docker at the Colima VM that has gVisor first:
DOCKER_CONTEXT=colima-gvisor (sandbox/colima.yaml).
"""

import json
import os
import shutil
import subprocess
import tempfile
import threading
import time
import unittest
from pathlib import Path

from driver.cpp import generate
from driver.tests.support import check_trace
from driver.tests.test_fixtures import CASES, FIXTURES
from pipeline import EXIT_INVALID, EXIT_RUN, EXIT_SANDBOX, PipelineError, run
from pipeline.runners import IMAGES, PROGRAM_USER, Container, Limits, Pool, SandboxError

SANDBOX = os.environ.get("TRACE_SANDBOX", "docker")


def _image_ready(image):
    docker = shutil.which("docker")
    if not docker:
        return False
    try:
        return subprocess.run([docker, "image", "inspect", image], capture_output=True, timeout=30).returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False


needs_sandbox = unittest.skipUnless(_image_ready(IMAGES["cpp"]),
                                    f"no Docker, or the image {IMAGES['cpp']!r} is not built (see sandbox/cpp.Dockerfile)")
needs_java_sandbox = unittest.skipUnless(_image_ready(IMAGES["java"]),
                                         f"no Docker, or the image {IMAGES['java']!r} is not built (see sandbox/java.Dockerfile)")
needs_python_sandbox = unittest.skipUnless(_image_ready(IMAGES["python"]),
                                           f"no Docker, or the image {IMAGES['python']!r} is not built (see sandbox/python.Dockerfile)")
PYTHON_CASES = {
    "two-sum": ("two_sum", "nums = [2,7,11,15], target = 9"),
    "clone-graph": ("clone_graph", "adjList = [[2,4],[1,3],[2,4],[1,3]]"),
    "subsets": ("subsets", "nums = [1,2,3]"),
}


def solution(body, includes=""):
    return f"{includes}class Solution {{\npublic:\n    int f(int n) {{\n{body}\n    }}\n}};\n"


def containers():
    """Names of this pipeline's containers that still exist."""
    r = subprocess.run(["docker", "ps", "--all", "--filter", "name=trace-run-", "--format", "{{.Names}}"],
                       capture_output=True, text=True, timeout=30)
    return set(r.stdout.split())


def new_containers_after(before, seconds=15):
    """The containers not in `before` that still exist after waiting up to
    `seconds`: a run's container is removed in the background, right after it."""
    deadline = time.monotonic() + seconds
    while True:
        left = containers() - before
        if not left or time.monotonic() > deadline:
            return left
        time.sleep(0.2)


@needs_sandbox
class Fixtures(unittest.TestCase):
    def test_every_fixture_gives_its_golden_trace(self):
        for golden, (stem, example, prefix) in CASES.items():
            if prefix:
                continue  # the pasted Node comment moves the lines; test_pipeline covers it
            with self.subTest(fixture=golden):
                trace = run((FIXTURES / f"{stem}_trace.cpp").read_text(encoding="utf-8"), example, sandbox=SANDBOX).trace
                with tempfile.TemporaryDirectory() as work:
                    path = Path(work) / "trace.json"
                    path.write_text(json.dumps(trace), encoding="utf-8")
                    status, output = check_trace("--equals", FIXTURES / f"{golden}.trace.json", path)
                self.assertEqual(status, 0, output)


@needs_sandbox
class Isolation(unittest.TestCase):
    def fails(self, source, **options):
        with self.assertRaises(PipelineError) as caught:
            run(source, "n = 3", sandbox=SANDBOX, **options)
        return caught.exception

    def test_no_network(self):
        # connect() to a public address fails: the container has no network at all.
        source = solution("""        int s = socket(AF_INET, SOCK_STREAM, 0);
        sockaddr_in a{};
        a.sin_family = AF_INET;
        a.sin_port = htons(53);
        inet_pton(AF_INET, "1.1.1.1", &a.sin_addr);
        int r = connect(s, reinterpret_cast<sockaddr*>(&a), sizeof a);
        return r;""", "#include <arpa/inet.h>\n#include <netinet/in.h>\n#include <sys/socket.h>\n")
        self.assertEqual(run(source, "n = 3", sandbox=SANDBOX).trace["result"], -1)

    def test_not_root_and_read_only(self):
        # Runs as its own unprivileged user, cannot write to the image, and can write only to its run folder.
        source = solution("""        int uid = getuid();
        int image = fopen("/opt/trace/runtime/x", "w") != nullptr;
        int etc = fopen("/etc/passwd", "a") != nullptr;
        int work = fopen("scratch.txt", "w") != nullptr;
        return uid * 1000 + image * 100 + etc * 10 + work;""", "#include <cstdio>\n#include <unistd.h>\n")
        uid = int(PROGRAM_USER.split(":")[0])
        self.assertEqual(run(source, "n = 3", sandbox=SANDBOX).trace["result"], uid * 1000 + 1)

    def test_memory_limit(self):
        # Touching 512 MB under a 256 MB cap. Under Docker's runtime the kernel
        # kills the program; under gVisor the limit is on gVisor's kernel, which
        # can end the whole sandbox. Either way the run stops, and says why.
        source = solution("        std::vector<char> big(512u << 20, 1);\n        return big[n];", "#include <vector>\n")
        error = self.fails(source, limits=Limits(memory="256m"))
        self.assertEqual((error.stage, error.exit_code), ("run", EXIT_RUN), str(error))
        self.assertIn("memory limit (256m)", str(error))

    def test_process_limit(self):
        # A fork loop: at most `pids` processes exist at once, so most forks fail.
        source = solution("""        int made = 0;
        for (int i = 0; i < 200; i++) {
            pid_t child = fork();
            if (child == 0) { sleep(5); _exit(0); }
            if (child > 0) made++;
        }
        return made;""", "#include <unistd.h>\n")
        made = run(source, "n = 3", sandbox=SANDBOX).trace["result"]
        self.assertGreater(made, 0)
        self.assertLess(made, Limits().pids)

    def test_time_limit_removes_the_container(self):
        # The loop is in a lambda, which is not instrumented, so it records no step and only
        # the time limit stops it. A loop in the Solution itself would reach the step cap
        # instead (test_pipeline.py's test_an_empty_infinite_loop_reaches_the_step_cap).
        before = containers()
        error = self.fails(solution("        [&] { while (n > 0) {} }();\n        return n;"), timeout=2)
        self.assertEqual((error.stage, error.exit_code), ("run", EXIT_RUN), str(error))
        self.assertIn("did not finish within 2 seconds", str(error))
        self.assertEqual(new_containers_after(before), set())

    def test_output_is_capped(self):
        # 1 MB of output: the run still succeeds, and only the first 64 KB come back.
        # The loop is in a lambda, which is not instrumented, so it takes no steps.
        source = solution("        auto print = [] { for (int i = 0; i < (1 << 20) / 16; i++) std::fputs(\"0123456789abcde\\n\", stdout); };\n"
                          "        print();\n        return n;", "#include <cstdio>\n")
        result = run(source, "n = 3", sandbox=SANDBOX)
        self.assertEqual(result.trace["result"], 3)
        self.assertEqual(len(result.output), Limits().output_cap)

    def test_a_forged_trace_is_rejected_outside(self):
        # The user's code can write anything to TRACE_OUT. Validation runs outside and rejects it.
        source = solution("""        FILE* out = std::fopen(std::getenv("TRACE_OUT"), "w");
        std::fputs("{\\"version\\": \\"0.7\\", \\"forged\\": true}", out);
        std::fclose(out);
        std::_Exit(0);""", "#include <cstdio>\n#include <cstdlib>\n")
        error = self.fails(source)
        self.assertEqual((error.stage, error.exit_code), ("validate", EXIT_INVALID), str(error))

    def test_leftover_processes_are_stopped(self):
        # Children the program forks and leaves running are killed when it ends,
        # and reaped (no zombies), before the trace is read.
        source = solution("        for (int i = 0; i < 5; i++) { if (fork() == 0) { sleep(30); _exit(0); } }\n        return n;",
                          "#include <unistd.h>\n")
        program = generate(source, "n = 3", None)
        container = Container(runtime="runsc" if SANDBOX == "gvisor" else None)
        try:
            self.assertEqual(container.build(program.prelude, source, program.main).stage, "")
            self.assertEqual(container.execute(10).returncode, 0)
            _, listing, _ = container._exec(["sh", "-c", "for p in /proc/[0-9]*; do cat $p/comm; done"], timeout=10)
            self.assertNotIn("program", listing.decode().split())
            trace, _ = container.collect(1 << 20)
            self.assertIsNotNone(trace)
        finally:
            container.close()

    def test_a_sandbox_that_dies_is_reported(self):
        # The container is killed from outside while the program runs, as gVisor
        # is when a limit on its own kernel is exceeded. The error says so.
        before = containers()

        def kill_new_containers():
            for name in containers() - before:
                subprocess.run(["docker", "kill", name], capture_output=True, timeout=30)

        source = solution("        sleep(20);\n        return n;", "#include <unistd.h>\n")
        killer = threading.Timer(0, lambda: None)
        original = Container.execute

        def execute_then_kill(container, timeout):
            nonlocal killer
            killer = threading.Timer(1.5, kill_new_containers)
            killer.start()
            return original(container, timeout)

        Container.execute = execute_then_kill
        try:
            error = self.fails(source, timeout=15)
        finally:
            Container.execute = original
            killer.cancel()
        self.assertEqual((error.stage, error.exit_code), ("run", EXIT_RUN), str(error))
        self.assertIn("The sandbox was stopped while the program ran", str(error))
        self.assertEqual(new_containers_after(before), set())

    def test_compile_errors_name_the_users_file(self):
        with self.assertRaises(PipelineError) as caught:
            run(solution("        int x = n\n        return x;"), "n = 3", source_name="mine.cpp", sandbox=SANDBOX)
        self.assertEqual(caught.exception.stage, "rewriter")
        self.assertIn("mine.cpp:4:", str(caught.exception))
        self.assertNotIn("/work/", str(caught.exception))


class Settings(unittest.TestCase):
    def test_limits_come_from_the_environment(self):
        saved = {k: os.environ.pop(k, None) for k in ("TRACE_RUN_MEMORY", "TRACE_RUN_CPUS", "TRACE_RUN_PIDS")}
        try:
            self.assertEqual((Limits().memory, Limits().cpus, Limits().pids), ("1g", "1", 64))
            os.environ.update(TRACE_RUN_MEMORY="512m", TRACE_RUN_CPUS="0.5", TRACE_RUN_PIDS="32")
            self.assertEqual((Limits().memory, Limits().cpus, Limits().pids), ("512m", "0.5", 32))
        finally:
            for k, v in saved.items():
                os.environ.pop(k, None)
                if v is not None:
                    os.environ[k] = v


@needs_sandbox
class PoolOfContainers(unittest.TestCase):
    def test_each_pooled_container_is_used_once(self):
        # A pool only starts containers earlier: two runs get two different
        # containers, each removed after its run, and closing the pool leaves none.
        before = containers()
        pool = Pool(1)
        seen = []
        original = Container.build

        def build_and_note(container, *args):
            seen.append(container.name)
            return original(container, *args)

        Container.build = build_and_note
        try:
            for _ in range(2):
                run(solution("        return n;"), "n = 3", sandbox=SANDBOX, pool=pool)
                time.sleep(2)  # the pool starts a replacement in the background
        finally:
            Container.build = original
            pool.close()
        self.assertEqual(len(set(seen)), 2)
        self.assertEqual(new_containers_after(before), set())


def py(body, signature="def f(self, n: int) -> int:"):
    return f"class Solution:\n    {signature}\n{body}\n"


@needs_python_sandbox
class PythonIsolation(unittest.TestCase):
    """The same limits for the Python image: run.py and the user's code run as PROGRAM_USER."""

    def fails(self, source, **options):
        with self.assertRaises(PipelineError) as caught:
            run(source, "n = 3", language="python", sandbox=SANDBOX, **options)
        return caught.exception

    def result(self, source, **options):
        return run(source, "n = 3", language="python", sandbox=SANDBOX, **options).trace["result"]

    def test_fixtures(self):
        for golden, (stem, example) in PYTHON_CASES.items():
            with self.subTest(fixture=golden):
                trace = run((FIXTURES / f"{stem}_trace.py").read_text(encoding="utf-8"), example, language="python",
                            sandbox=SANDBOX).trace
                with tempfile.TemporaryDirectory() as work:
                    path = Path(work) / "trace.json"
                    path.write_text(json.dumps(trace), encoding="utf-8")
                    status, output = check_trace("--equals", FIXTURES / f"{golden}.python.trace.json", path)
                self.assertEqual(status, 0, output)

    def test_sortedcontainers_is_installed(self):
        self.assertEqual(self.result(py("        s = SortedList([3, 1, 2])\n        return s[0]")), 1)

    def test_no_network(self):
        source = py("""        import socket
        try:
            socket.create_connection(("1.1.1.1", 53), timeout=3)
            return 0
        except OSError:
            return -1""")
        self.assertEqual(self.result(source), -1)

    def test_not_root_and_read_only(self):
        source = py("""        import os
        def can_write(path):
            try:
                open(path, "a").close()
                return 1
            except OSError:
                return 0
        return os.getuid() * 1000 + can_write("/opt/trace/python/tracer.py") * 100 + can_write("/etc/passwd") * 10 + can_write("scratch.txt")""")
        self.assertEqual(self.result(source), int(PROGRAM_USER.split(":")[0]) * 1000 + 1)

    def test_memory_limit(self):
        error = self.fails(py("        big = bytearray(512 << 20)\n        return big[n]"), limits=Limits(memory="256m"))
        self.assertEqual((error.stage, error.exit_code), ("run", EXIT_RUN), str(error))

    def test_time_limit_removes_the_container(self):
        before = containers()
        error = self.fails(py("        x = sum(range(10 ** 12))\n        return n"), timeout=2)
        self.assertIn("did not finish within 2 seconds", str(error))
        self.assertEqual(new_containers_after(before), set())

    def test_a_forged_trace_is_rejected_outside(self):
        source = py("""        import os
        with open(os.environ["TRACE_OUT"], "w") as out:
            out.write('{"version": "0.7", "forged": true}')
        os._exit(0)""")
        error = self.fails(source)
        self.assertEqual((error.stage, error.exit_code), ("validate", EXIT_INVALID), str(error))

    def test_pool_size_per_image(self):
        # sizes overrides the pool's size for one image: here, no Python container is kept waiting.
        before = containers()
        pool = Pool(1, sizes={IMAGES["python"]: 0})
        try:
            self.assertEqual(self.result(py("        return n"), pool=pool), 3)
            time.sleep(2)
            self.assertEqual(sum(len(v) for v in pool._ready.values()), 0)
        finally:
            pool.close()
        self.assertEqual(new_containers_after(before), set())


def jv(body, signature="public int f(int n)", extra=""):
    return f"class Solution {{\n    {signature} {{\n{body}\n    }}\n{extra}}}\n"


@needs_java_sandbox
class JavaIsolation(unittest.TestCase):
    """The same limits for the Java image: lvtrace.Build as the tools' user, LvMain as the program's."""

    def fails(self, source, **options):
        with self.assertRaises(PipelineError) as caught:
            run(source, "n = 3", language="java", sandbox=SANDBOX, **options)
        return caught.exception

    def result(self, source, **options):
        return run(source, "n = 3", language="java", sandbox=SANDBOX, **options).trace["result"]

    def test_fixtures(self):
        for golden, (stem, example) in PYTHON_CASES.items():
            with self.subTest(fixture=golden):
                trace = run((FIXTURES / f"{stem}_trace.java").read_text(encoding="utf-8"), example, language="java",
                            sandbox=SANDBOX).trace
                with tempfile.TemporaryDirectory() as work:
                    path = Path(work) / "trace.json"
                    path.write_text(json.dumps(trace), encoding="utf-8")
                    status, output = check_trace("--equals", FIXTURES / f"{golden}.java.trace.json", path)
                self.assertEqual(status, 0, output)

    def test_no_network(self):
        source = jv("""        try (java.net.Socket s = new java.net.Socket()) {
            s.connect(new java.net.InetSocketAddress("1.1.1.1", 53), 3000);
            return 0;
        } catch (Exception e) {
            return -1;
        }""")
        self.assertEqual(self.result(source), -1)

    def test_not_root_and_read_only(self):
        source = jv("""        long uid = -1;
        try {
            for (String l : java.nio.file.Files.readAllLines(java.nio.file.Path.of("/proc/self/status"))) {
                if (l.startsWith("Uid:")) uid = Long.parseLong(l.trim().split("[ \\t]+")[1]);
            }
        } catch (Exception e) {
            uid = -1;
        }
        return (int) uid * 1000 + w("/opt/trace/java/lvtrace/Trace.class") * 100 + w("/etc/passwd") * 10 + w("scratch.txt");""",
                    extra="""    static int w(String p) {
        try (java.io.FileOutputStream f = new java.io.FileOutputStream(p, true)) {
            return 1;
        } catch (Exception e) {
            return 0;
        }
    }
""")
        self.assertEqual(self.result(source), int(PROGRAM_USER.split(":")[0]) * 1000 + 1)

    def test_memory_limit(self):
        # In a class the rewriter does not trace: as a local of the Solution, every step would write
        # the arrays, and the size budget would stop the trace before the memory ran out.
        error = self.fails(jv("        return Helper.big();") + "class Helper {\n    static int big() {\n"
                           "        byte[][] big = new byte[512][];\n        for (int i = 0; i < 512; i++) big[i] = new byte[1 << 20];\n"
                           "        return big.length;\n    }\n}\n", limits=Limits(memory="256m"))
        self.assertEqual((error.stage, error.exit_code), ("run", EXIT_RUN), str(error))

    def test_time_limit_removes_the_container(self):
        before = containers()
        error = self.fails(jv("        return Helper.spin();", extra="") + "class Helper { static int spin() { while (true) {} } }\n", timeout=3)
        self.assertIn("did not finish within 3 seconds", str(error))
        self.assertEqual(new_containers_after(before), set())

    def test_a_forged_trace_is_rejected_outside(self):
        source = jv("""        try {
            java.nio.file.Files.writeString(java.nio.file.Path.of(System.getenv("TRACE_OUT")), "{\\"version\\": \\"0.7\\", \\"forged\\": true}");
        } catch (Exception e) {
            return 1;
        }
        Runtime.getRuntime().halt(0);
        return 0;""")
        error = self.fails(source)
        self.assertEqual((error.stage, error.exit_code), ("validate", EXIT_INVALID), str(error))

    def test_compile_errors_name_the_users_file(self):
        with self.assertRaises(PipelineError) as caught:
            run(jv("        int x = n\n        return x;"), "n = 3", language="java", source_name="Mine.java", sandbox=SANDBOX)
        self.assertEqual(caught.exception.stage, "rewriter")
        self.assertIn("Mine.java:3:", str(caught.exception))


@unittest.skipUnless(shutil.which("docker"), "no Docker")
class Setup(unittest.TestCase):
    def test_missing_image_is_a_sandbox_error(self):
        with self.assertRaises(SandboxError) as caught:
            Container(image="visi-no-such-image")
        self.assertIn("docker build -f sandbox/cpp.Dockerfile", str(caught.exception))
        with self.assertRaises(SandboxError) as caught:
            Container(image="visi-no-such-image", language="python")
        self.assertIn("docker build -f sandbox/python.Dockerfile", str(caught.exception))
        with self.assertRaises(SandboxError) as caught:
            Container(image="visi-no-such-image", language="java")
        self.assertIn("docker build -f sandbox/java.Dockerfile", str(caught.exception))

    def test_missing_runtime_is_a_sandbox_error(self):
        if "runsc" in _runtimes():
            self.skipTest("this Docker has runsc; the gvisor tests cover it")
        with self.assertRaises(PipelineError) as caught:
            run(solution("        return n;"), "n = 3", sandbox="gvisor")
        self.assertEqual((caught.exception.stage, caught.exception.exit_code), ("sandbox", EXIT_SANDBOX))
        self.assertIn("runsc", str(caught.exception))


def _runtimes():
    r = subprocess.run(["docker", "info", "--format", "{{json .Runtimes}}"], capture_output=True, text=True, timeout=30)
    return json.loads(r.stdout or "{}") if r.returncode == 0 else {}


if __name__ == "__main__":
    unittest.main()
