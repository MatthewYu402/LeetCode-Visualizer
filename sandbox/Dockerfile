# The sandbox image: everything a run needs inside the container, and nothing
# else. docs/sandboxing.md §6.
#
#   /opt/trace/bin/trace-rewrite   the rewriter (stage 2)
#   /opt/trace/runtime/            trace.hpp and leetcode_types.hpp (stage 3)
#   clang++-18 with libstdc++      the compiler (stage 3)
#
# No Python, no driver, no checker: the driver runs before the container and
# the checker after it, both outside (CLAUDE.md invariant 9).
#
# Build from the repository root:
#   docker build -f sandbox/Dockerfile -t leetcode-visualizer-sandbox .
# sandbox/Dockerfile.dockerignore keeps the build context to the files below.

ARG BASE=ubuntu:24.04

# ---- 1. Build the rewriter ----
FROM ${BASE} AS build
RUN apt-get update \
 && apt-get install -y --no-install-recommends clang-18 libclang-18-dev libclang-cpp18-dev llvm-18-dev make \
 && rm -rf /var/lib/apt/lists/*
COPY adapters/cpp/rewriter/Makefile adapters/cpp/rewriter/*.cpp adapters/cpp/rewriter/*.hpp /src/rewriter/
RUN make -C /src/rewriter LLVM_CONFIG=llvm-config-18 CXX=clang++-18

# ---- 2. The image a run uses ----
FROM ${BASE}
# clang-18 brings libclang-cpp18 and libllvm18 (the rewriter's libraries) and
# Clang's own headers at the resource directory the rewriter was built with.
# libstdc++-14-dev and binutils are the standard library and the linker for the
# user's program.
RUN apt-get update \
 && apt-get install -y --no-install-recommends clang-18 libstdc++-14-dev binutils \
 && rm -rf /var/lib/apt/lists/*
COPY --from=build /src/rewriter/build/trace-rewrite /opt/trace/bin/trace-rewrite
COPY adapters/cpp/runtime/ /opt/trace/runtime/
# Every run gets a fresh tmpfs at /work (docs/sandboxing.md §4). The directory
# exists so the image also works without one, for debugging.
RUN mkdir -m 1777 /work
# The pipeline passes --user too; this is the default for anything else.
USER 65534:65534
WORKDIR /work
CMD ["sleep", "infinity"]
