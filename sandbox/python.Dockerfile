# The Python sandbox image: everything a Python run needs inside the container,
# and nothing else. docs/sandboxing.md §6. C++ has its own (cpp.Dockerfile).
#
#   python3 (3.12)                       the interpreter the user's code runs on
#   /opt/trace/python/                   run.py, tracer.py, instrument.py (the adapter)
#   sortedcontainers                     SortedList, SortedDict, SortedSet, which
#                                        LeetCode's Python 3 also offers
#
# No driver and no checker: the driver runs before the container and the
# checker after it, both outside (CLAUDE.md invariant 9). The adapter is the
# tracer, so it runs inside, beside the user's code, like the C++ runtime.
#
# Build from the repository root:
#   docker build -f sandbox/python.Dockerfile -t leetcode-visualizer-sandbox-python .
# sandbox/python.Dockerfile.dockerignore keeps the build context to the files below.

ARG BASE=python:3.12-slim-bookworm

FROM ${BASE}
RUN python3 -m pip install --no-cache-dir --root-user-action=ignore sortedcontainers==2.4.0
COPY adapters/python/run.py adapters/python/tracer.py adapters/python/instrument.py /opt/trace/python/
# The image is read-only at run time: no bytecode cache to write, and none to
# leave behind for the next run (each run gets a fresh container anyway).
ENV PYTHONDONTWRITEBYTECODE=1
# Every run gets a fresh tmpfs at /work (docs/sandboxing.md §4). The directory
# exists so the image also works without one, for debugging.
RUN mkdir -m 1777 /work
# The pipeline passes --user too; this is the default for anything else.
USER 65534:65534
WORKDIR /work
CMD ["sleep", "infinity"]
