# The Java sandbox image: everything a Java run needs inside the container, and
# nothing else. docs/sandboxing.md §6. C++ and Python have their own.
#
#   a JDK 21 (Eclipse Temurin)     javac, which the rewriter runs in-process, and java
#   /opt/trace/java/               the adapter, compiled: the runtime (lvtrace.Trace)
#                                  and the rewriter and build step (lvtrace.Build)
#
# No driver and no checker: the driver runs before the container and the checker
# after it, both outside (CLAUDE.md invariant 9). The rewriter reads untrusted
# source, so it runs inside, as the C++ rewriter does.
#
# Build from the repository root:
#   docker build -f sandbox/java.Dockerfile -t leetcode-visualizer-sandbox-java .
# sandbox/java.Dockerfile.dockerignore keeps the build context to the files below.

ARG BASE=eclipse-temurin:21-jdk

# ---- 1. Compile the adapter ----
FROM ${BASE} AS build
COPY adapters/java/src/ /src/
RUN mkdir -p /opt/trace/java && javac -nowarn -encoding UTF-8 -d /opt/trace/java /src/lvtrace/*.java

# ---- 2. The image a run uses ----
FROM ${BASE}
COPY --from=build /opt/trace/java/ /opt/trace/java/
# Every run gets a fresh tmpfs at /work (docs/sandboxing.md §4). The directory
# exists so the image also works without one, for debugging.
RUN mkdir -m 1777 /work
# The pipeline passes --user too; this is the default for anything else.
USER 65534:65534
WORKDIR /work
CMD ["sleep", "infinity"]
