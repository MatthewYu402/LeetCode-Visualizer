# The Java adapter: the runtime and the rewriter, compiled to build/classes (docs/adapters/java.md).
#   make -C adapters/java          build
#   make -C adapters/java clean
JAVAC ?= javac
SOURCES := $(wildcard src/lvtrace/*.java)

build/classes/lvtrace/Trace.class: $(SOURCES)
	@mkdir -p build/classes
	$(JAVAC) -nowarn -encoding UTF-8 -d build/classes $(SOURCES)

clean:
	rm -rf build

.PHONY: clean
