# The rewriter: trace-rewrite, a Clang LibTooling tool.
#
# Needs LLVM with Clang's development files:
#   macOS:  brew install llvm, then  make LLVM_CONFIG=$(brew --prefix llvm)/bin/llvm-config
#   Ubuntu: apt install libclang-18-dev libclang-cpp18-dev llvm-18-dev  (llvm-config is then on PATH)
#
# Targets:
#   make            build build/trace-rewrite
#   make test       build, then run the rewriter's tests (driver/tests/test_rewriter.py)
#   make clean      remove build/

LLVM_CONFIG ?= llvm-config
ROOT := $(abspath ../../..)

LLVM_INCLUDE := $(shell $(LLVM_CONFIG) --includedir)
LLVM_LIBDIR := $(shell $(LLVM_CONFIG) --libdir)
LLVM_BINDIR := $(shell $(LLVM_CONFIG) --bindir)

# llvm-config's flags, minus its -std (ours is C++20), with LLVM's headers as
# system headers so their warnings do not drown ours.
LLVM_CXXFLAGS := $(filter-out -std=% -I%,$(shell $(LLVM_CONFIG) --cxxflags)) -isystem $(LLVM_INCLUDE)
RESOURCE_DIR := $(shell $(LLVM_BINDIR)/clang -print-resource-dir)
DEFINES := -DTRACE_RESOURCE_DIR='"$(RESOURCE_DIR)"'
ifeq ($(shell uname),Darwin)
  DEFINES += -DTRACE_DEFAULT_SYSROOT='"$(shell xcrun --show-sdk-path)"'
endif

CXXFLAGS := -std=c++20 -Wall -Wextra $(LLVM_CXXFLAGS) $(DEFINES)
LDFLAGS := -L$(LLVM_LIBDIR) -Wl,-rpath,$(LLVM_LIBDIR)
# libclang-cpp is all of Clang's C++ libraries in one; --libs is libLLVM.
LDLIBS := -lclang-cpp $(shell $(LLVM_CONFIG) --libs --system-libs)

BUILD := build
OBJECTS := $(BUILD)/instrumenter.o $(BUILD)/main.o

.PHONY: all test clean
all: $(BUILD)/trace-rewrite

$(BUILD):
	mkdir -p $@

$(BUILD)/%.o: %.cpp instrumenter.hpp | $(BUILD)
	$(CXX) $(CXXFLAGS) -c $< -o $@

$(BUILD)/trace-rewrite: $(OBJECTS)
	$(CXX) $(OBJECTS) $(LDFLAGS) $(LDLIBS) -o $@

test: $(BUILD)/trace-rewrite
	cd $(ROOT) && TRACE_REWRITE=$(abspath $(BUILD)/trace-rewrite) python3 -m unittest driver.tests.test_rewriter -v

clean:
	rm -rf $(BUILD)
