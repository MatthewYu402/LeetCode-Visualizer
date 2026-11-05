# Build and run the C++ adapter's tests.
#
# Run from adapters/cpp/, or from the repository root with `make -C adapters/cpp ...`.
#
#   make                       build and run every test
#   make test T=serialize      run only tests/test_serialize.cpp
#   make test T="serialize x"  run several (space-separated names)
#   make both                  run the tests with clang++ and with g++
#   make header                check that trace.hpp compiles on its own
#   make list                  list the available test names
#   make clean                 delete build output
#
# Options:  CXX=g++   EXTRA=-Werror   (EXTRA is appended to the flags)
#
# A test is any tests/test_<name>.cpp. Its name is <name>.

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

.PHONY: all test both header list clean
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

list:
	@printf '%s\n' $(ALL_TESTS)

clean:
	rm -rf build