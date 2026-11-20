# Local testing on the Mac

Every command, in order, to set up, test everything CI tests, run the page, and tear it all down. Run from the repository root unless a step says otherwise. zsh: no trailing `#` comments in pasted commands, so each command stands alone.

## 1. Once per machine

Tools:

```
brew install colima llvm node python python@3.12
```

`python@3.12` is the interpreter the Python sandbox image runs, so the virtual environment below uses it too: the Python adapter's tests and Python runs without the sandbox then use the same version.

The gVisor VM (Colima profile `gvisor`):

```
colima start --profile gvisor --vm-type vz --cpu 2 --memory 4
colima stop --profile gvisor
colima start --profile gvisor --edit
```

In the editor, replace `docker: {}` and `provision: []` with the two sections from `sandbox/colima-gvisor.yaml` (the `docker:` section registers `runsc`; the `provision:` script installs it). Save and close; the VM starts. If `--edit` does not save, stop the VM, edit `~/.colima/gvisor/colima.yaml` directly, and start it again.

Python environment and the rewriter:

```
rm -rf .venv
python3.12 -m venv .venv
source .venv/bin/activate
python3 -m pip install jsonschema sortedcontainers==2.4.0 -r backend/requirements.txt
make -C adapters/cpp/rewriter LLVM_CONFIG=$(brew --prefix llvm)/bin/llvm-config
```

`rm -rf .venv` only matters once, to replace a venv made with another Python. `sortedcontainers` is for the Python adapter's test of `SortedList`; the sandbox image has its own copy.

Frontend packages (again whenever `package.json` changes):

```
cd frontend && npm install && cd ..
```

## 2. Every session

```
source .venv/bin/activate
colima start --profile gvisor
export DOCKER_CONTEXT=colima-gvisor
docker info --format '{{json .Runtimes}}' | grep -o runsc
docker build -f sandbox/cpp.Dockerfile -t leetcode-visualizer-sandbox-cpp .
docker build -f sandbox/python.Dockerfile -t leetcode-visualizer-sandbox-python .
```

`grep` must print `runsc`. Rebuild the C++ image whenever `adapters/cpp/runtime/`, `adapters/cpp/rewriter/`, or `sandbox/cpp.Dockerfile` changes, and the Python image whenever `adapters/python/` or `sandbox/python.Dockerfile` changes: each image holds its own copy of its adapter. `DOCKER_CONTEXT` lasts only for that terminal, so export it in every terminal that runs Docker or the backend.

The old single image (`leetcode-visualizer-sandbox`, from `sandbox/Dockerfile`) is no longer used; remove it with `docker image rm leetcode-visualizer-sandbox`.

## 3. Everything CI tests

```
python3 -I tools/check_trace.py fixtures/*.trace.json
make -C adapters/cpp both
make -C adapters/cpp header
make -C adapters/cpp e2e
python3 -m unittest discover -s driver/tests -t .
python3 -m unittest discover -s adapters/python/tests -v
make -C adapters/cpp/rewriter LLVM_CONFIG=$(brew --prefix llvm)/bin/llvm-config
make -C adapters/cpp/rewriter test
python3 -m unittest discover -s pipeline/tests -t .
TRACE_SANDBOX=docker python3 -m unittest pipeline.tests.test_sandbox -v
TRACE_SANDBOX=gvisor python3 -m unittest pipeline.tests.test_sandbox -v
python3 -m unittest discover -s backend/tests -t .
cd frontend && npm test && npm run build && cd ..
```

In order: fixtures against the schema (C++ and Python goldens); adapter tests, header check, end-to-end; driver (both languages); the Python adapter (every Python fixture `--equals` its golden and `--like` the C++ one); rewriter build and every fixture from its plain source; the pipeline end to end (C++ and Python); the sandbox's limits under Docker, then under gVisor, for both images (`PythonIsolation`); the API; the frontend. On the Mac, `g++` is Apple Clang, so `both` runs one compiler twice; CI runs real GCC on Linux.

Idle memory of a pooled container, per image (for choosing `TRACE_POOL` and `TRACE_POOL_PYTHON`), with the backend running and after one run of each language:

```
docker stats --no-stream --filter label=org.leetcode-visualizer.sandbox
```

## 4. Run the page

Terminal 1:

```
source .venv/bin/activate
export DOCKER_CONTEXT=colima-gvisor
python3 -m backend
```

Terminal 2:

```
cd frontend && npm run dev
```

Open http://localhost:5173. Choose C++ or Python in the top bar, paste a full Solution into the editor, paste the LeetCode example into the box under the fields, then Run code (or ⌘ Enter). For your own code without gVisor: `TRACE_SANDBOX=docker python3 -m backend`. Python cases to try are 71 to 84 in `docs/manual-test-suite.md`.

## 5. Tear down

Stop the backend and the dev server with Ctrl-C in their terminals. Then:

```
docker ps -a --filter label=org.leetcode-visualizer.sandbox
docker rm -f $(docker ps -aq --filter label=org.leetcode-visualizer.sandbox)
colima stop --profile gvisor
unset DOCKER_CONTEXT
```

The first lists any sandbox containers left behind (the backend's pools, or a crashed run; every sandbox container carries that label); the second removes them (it errors harmlessly when there are none). Stopping the VM keeps `runsc`, the config, and the images for next time.

To reclaim disk (images and build cache), before stopping the VM:

```
docker image rm leetcode-visualizer-sandbox-cpp leetcode-visualizer-sandbox-python
docker builder prune -f
```

To remove the VM completely (runsc, its images, everything in it), and start over from section 1:

```
colima delete --profile gvisor
```

## 6. When something is off

| Symptom | Cause | Fix |
|---|---|---|
| `Docker has no runtime named 'runsc'`, or the page answers 503 | The terminal is not on the Colima context, or the profile has no `docker: runtimes:` section | `export DOCKER_CONTEXT=colima-gvisor`; `grep -n -A3 runsc ~/.colima/gvisor/colima.yaml` must print the section; then `colima restart --profile gvisor` |
| `context "colima-gvisor": context not found` or `no builder "colima-gvisor" found` | Colima removed its context when the VM stopped, and a start was skipped as "already running" | `unset DOCKER_CONTEXT`, `colima restart --profile gvisor`, `docker context ls` (or `docker context create colima-gvisor --docker "host=unix://$HOME/.colima/gvisor/docker.sock"`) |
| `The sandbox image 'leetcode-visualizer-sandbox-python' is not built` (or `-cpp`) | That language's image is missing | Build it (section 2) |
| Fixture tests: `trace has "0.7", fixture has "0.8"` | The image was built from an older runtime | Rebuild the image (section 2) |
| The page rejects every run with a version error | Same: the image's runtime writes an older version | Rebuild the image |
| Python tests: `These tests need Python 3.12 or later` | The venv was made with an older Python and no `python3.12` is on PATH | `brew install python@3.12`, then remake the venv (section 1), or set `TRACE_PYTHON` to a 3.12 interpreter |
| `npm run dev` fails to resolve `@fontsource-variable/geist` | Packages not installed | `cd frontend && npm install` |
