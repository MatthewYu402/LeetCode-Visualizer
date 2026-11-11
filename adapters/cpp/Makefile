# Build and run the C++ adapter's tests.
#
# Run from adapters/cpp/, or from the repository root with `make -C adapters/cpp ...`.
#
#   make                       build and run every test
#   make test T=serialize      run only tests/test_serialize.cpp
#   make test T="serialize x"  run several (space-separated names)
#   make both                  run the tests with clang++ and with g++
#   make header                check that trace.hpp compiles on its own
#   make e2e                   run the end-to-end checks (needs python3 and jsonschema):
#                                fixtures/two_sum_hand_inst.cpp must write a trace equal
#                                to fixtures/two-sum.trace.json,
#                                tests/programs/loop_forever.cpp must exit 0 at the step
#                                cap with a truncated trace, and return_pointer.cpp and
#                                void_method.cpp must write valid traces whose refs all
#                                name an object. Traces go to build/traces/.
#   make list                  list the available test names
#   make clean                 delete build output
#
# Options:  CXX=g++   EXTRA=-Werror   (EXTRA is appended to the flags)
#
# A test is any tests/test_<name>.cpp. Its name is <name>. Programs in
# tests/programs/ are not tests: they only run under `make e2e`.

# make predefines CXX as g++, so `CXX ?= ...` would never apply.
ifeq ($(origin CXX),default)
  CXX := clang++
endif

CXXFLAGS := -std=c++20 -Wall -Wextra -Wpedantic $(EXTRA)

RUNTIME := runtime
TESTDIR := tests
# One folder per compiler, so clang++ and g++ builds don't mix. (The comment
# is on its own line because make keeps spaces before a trailing comment.)
BUILD   := build/$(notdir $(CXX))

ALL_TESTS := $(patsubst $(TESTDIR)/test_%.cpp,%,$(wildcard $(TESTDIR)/test_*.cpp))
T ?= $(ALL_TESTS)
BINS := $(addprefix $(BUILD)/test_,$(T))

$(foreach t,$(T),$(if $(wildcard $(TESTDIR)/test_$(t).cpp),,\
  $(error Unknown test '$(t)'. Run 'make list' to see the available tests)))

.PHONY: all test both header e2e list clean
all: test

# Runs every selected test even if one fails, then exits nonzero if any did.
test: $(BINS)
	@status=0; \
	for bin in $(BINS); do \
	  echo "== $$bin ($(CXX))"; \
	  ./$$bin || status=1; \
	done; \
	exit $$status

# -MMD -MP records which headers each test includes, so editing trace.hpp
# rebuilds the tests that use it.
$(BUILD)/test_%: $(TESTDIR)/test_%.cpp | $(BUILD)
	$(CXX) $(CXXFLAGS) -I $(RUNTIME) -MMD -MP $< -o $@

$(BUILD):
	@mkdir -p $@

-include $(wildcard $(BUILD)/*.d)

both:
	@$(MAKE) --no-print-directory test CXX=clang++ T="$(T)"
	@$(MAKE) --no-print-directory test CXX=g++ T="$(T)"

# Compiles a file that contains only `#include "trace.hpp"`. Catches a header
# that only builds because some test happened to include <thing> first.
header:
	@echo '#include "trace.hpp"' | $(CXX) $(CXXFLAGS) -I $(RUNTIME) -x c++ -fsyntax-only - \
	  && echo "trace.hpp compiles on its own ($(CXX))"

# ---- End-to-end ----
# Each program runs with TRACE_OUT pointing into build/traces/<compiler>/, and
# tools/check_trace.py checks what it wrote. The old trace is deleted first,
# so a program that writes nothing cannot pass on a stale file.
ROOT      := ../..
TRACES    := build/traces/$(notdir $(CXX))
CHECK     := python3 -I $(ROOT)/tools/check_trace.py
# Seconds a program may run. Both finish in well under one, so hitting this
# means the step cap stopped ending the run.
E2E_TIMEOUT := 20
# coreutils `timeout` is not on macOS by default, but perl is on both macOS
# and Linux. alarm() survives exec, so SIGALRM kills the program when the
# time is up and the shell sees exit code 142.
RUN_LIMITED := perl -e 'alarm shift; exec @ARGV or die "cannot run $$ARGV[0]: $$!\n"' $(E2E_TIMEOUT)

$(BUILD)/two_sum_hand_inst: $(ROOT)/fixtures/two_sum_hand_inst.cpp | $(BUILD)
	$(CXX) $(CXXFLAGS) -I $(RUNTIME) -MMD -MP $< -o $@

# Every program under tests/programs/ builds the same way.
PROGRAMS := loop_forever return_pointer void_method
$(addprefix $(BUILD)/,$(PROGRAMS)): $(BUILD)/%: $(TESTDIR)/programs/%.cpp | $(BUILD)
	$(CXX) $(CXXFLAGS) -I $(RUNTIME) -MMD -MP $< -o $@

e2e: $(BUILD)/two_sum_hand_inst $(addprefix $(BUILD)/,$(PROGRAMS))
	@mkdir -p $(TRACES)
	@echo "== e2e: two_sum_hand_inst ($(CXX))"
	@rm -f $(TRACES)/two-sum.trace.json
	@TRACE_OUT=$(TRACES)/two-sum.trace.json $(RUN_LIMITED) ./$(BUILD)/two_sum_hand_inst
	@$(CHECK) --equals $(ROOT)/fixtures/two-sum.trace.json $(TRACES)/two-sum.trace.json
	@echo "== e2e: loop_forever ($(CXX))"
	@rm -f $(TRACES)/loop-forever.trace.json
	@TRACE_OUT=$(TRACES)/loop-forever.trace.json $(RUN_LIMITED) ./$(BUILD)/loop_forever; \
	  status=$$?; \
	  if [ $$status -ne 0 ]; then \
	    echo "FAIL  loop_forever exited with code $$status, expected 0 (142 means it hit the $(E2E_TIMEOUT)s limit)"; \
	    exit 1; \
	  fi
	@$(CHECK) --expect-truncated $(TRACES)/loop-forever.trace.json
	@echo "== e2e: return_pointer ($(CXX))"
	@rm -f $(TRACES)/return-pointer.trace.json
	@TRACE_OUT=$(TRACES)/return-pointer.trace.json $(RUN_LIMITED) ./$(BUILD)/return_pointer
	@$(CHECK) --expect-result-heap $(TRACES)/return-pointer.trace.json
	@echo "== e2e: void_method ($(CXX))"
	@rm -f $(TRACES)/void-method.trace.json
	@TRACE_OUT=$(TRACES)/void-method.trace.json $(RUN_LIMITED) ./$(BUILD)/void_method
	@$(CHECK) --expect-void $(TRACES)/void-method.trace.json

list:
	@printf '%s\n' $(ALL_TESTS)

clean:
	rm -rf build