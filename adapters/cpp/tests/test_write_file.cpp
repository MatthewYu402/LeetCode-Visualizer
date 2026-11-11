// Tests for trace::output_path and trace::write_file.
//
// Run from the repository root:
//   make -C adapters/cpp test T=write_file
//
// Covers the three ways write_file can end:
//   success        the file holds exactly the text, and no .tmp is left
//   failed open    the directory does not exist
//   failed write   the file is opened, but the bytes cannot be written
//   failed rename  the .tmp is written, but cannot be moved onto the path
// After every failure the old file must be unchanged and the .tmp gone.
//
// The failure tests print "trace: ..." lines to stderr. That is write_file
// reporting the error it was made to hit, so those lines are expected.
//
// POSIX only (macOS, Linux): uses setenv and setrlimit.

#include "trace.hpp"

#include <csignal>
#include <cstdlib>
#include <filesystem>
#include <fstream>
#include <iostream>
#include <iterator>
#include <string>

#include <sys/resource.h>
#include <unistd.h>

namespace {

  namespace fs = std::filesystem;

  int passed = 0;
  int failed = 0;

  void check(const std::string& name, bool ok) {
    if (ok) {
      ++passed;
      std::cout << "  PASS  " << name << "\n";
    } else {
      ++failed;
      std::cout << "  FAIL  " << name << "\n";
    }
  }

  void check_eq(const std::string& name, const std::string& actual, const std::string& expected) {
    if (actual == expected) {
      ++passed;
      std::cout << "  PASS  " << name << "\n";
    } else {
      ++failed;
      std::cout << "  FAIL  " << name << "\n"
                << "          expected: " << expected << "\n"
                << "          actual:   " << actual << "\n";
    }
  }

  // The whole file as bytes, with no newline translation.
  std::string read_file(const fs::path& path) {
    std::ifstream in(path, std::ios::binary);
    return std::string(std::istreambuf_iterator<char>(in), std::istreambuf_iterator<char>());
  }

  // Calls write_file while the process may not grow any file past `limit`
  // bytes, then restores the old limit. This is how the test makes a write
  // fail on purpose: the file opens, but the operating system refuses the
  // bytes, the same way it would on a full disk.
  int write_file_with_size_limit(const std::string& path, const std::string& text, rlim_t limit) {
    // Going over the limit also sends SIGXFSZ, which would kill the test.
    // Ignored, the write simply fails instead.
    std::cout.flush();
    auto old_handler = std::signal(SIGXFSZ, SIG_IGN);

    rlimit old_limit{};
    getrlimit(RLIMIT_FSIZE, &old_limit);
    rlimit small = old_limit;
    small.rlim_cur = limit;
    setrlimit(RLIMIT_FSIZE, &small);

    const int status = trace::write_file(path, text);

    setrlimit(RLIMIT_FSIZE, &old_limit);
    std::signal(SIGXFSZ, old_handler);
    // If stderr is redirected to a file, the limit also blocked write_file's
    // error message and left std::cerr in a failed state. Clear it so later
    // messages still appear.
    std::cerr.clear();
    std::cout.clear();
    return status;
  }

} // namespace

int main() {
  using trace::output_path;
  using trace::write_file;

  // A private folder for this run, removed at the end.
  const fs::path dir = fs::temp_directory_path() / ("trace_write_file_" + std::to_string(getpid()));
  fs::remove_all(dir);
  fs::create_directories(dir);

  std::cout << "output_path\n";
  unsetenv("TRACE_OUT");
  check_eq("unset -> trace.json", output_path(), "trace.json");
  setenv("TRACE_OUT", "", 1);
  check_eq("empty -> trace.json", output_path(), "trace.json");
  setenv("TRACE_OUT", "out/two-sum.json", 1);
  check_eq("set -> its value", output_path(), "out/two-sum.json");
  unsetenv("TRACE_OUT");

  std::cout << "success\n";
  {
    const fs::path path = dir / "ok.json";
    const std::string text = R"({"version": "0.4", "steps": []})";

    check("returns 0", write_file(path.string(), text) == 0);
    check_eq("file holds exactly the text", read_file(path), text);
    check("no .tmp left behind", !fs::exists(path.string() + ".tmp"));

    const std::string second = R"({"version": "0.4", "steps": [], "truncated": true})";
    check("second write returns 0", write_file(path.string(), second) == 0);
    check_eq("second write replaces the first", read_file(path), second);
    check("no .tmp after replacing", !fs::exists(path.string() + ".tmp"));

    // Bytes must arrive untouched: newlines, UTF-8, and an embedded NUL.
    const std::string bytes = std::string("a\nb\r\ncaf\xc3\xa9") + std::string(1, '\0') + "z";
    check("awkward bytes return 0", write_file(path.string(), bytes) == 0);
    check("awkward bytes are unchanged", read_file(path) == bytes);

    check("empty text returns 0", write_file(path.string(), "") == 0);
    check_eq("empty text gives an empty file", read_file(path), "");

    // A stale .tmp from an earlier killed run must not leak into the result.
    std::ofstream(path.string() + ".tmp") << "stale leftovers that are longer than the new text";
    check("stale .tmp: returns 0", write_file(path.string(), text) == 0);
    check_eq("stale .tmp: file holds only the new text", read_file(path), text);
  }

  std::cout << "failed open (the directory does not exist)\n";
  {
    const fs::path path = dir / "no_such_dir" / "trace.json";
    check("returns 1", write_file(path.string(), "{}") == 1);
    check("no file created", !fs::exists(path));
    check("no .tmp created", !fs::exists(path.string() + ".tmp"));
  }

  std::cout << "failed write (the file may not grow past 16 bytes)\n";
  {
    const fs::path path = dir / "full.json";
    const std::string old_text = R"({"old": true})";
    check("setup: old file written", write_file(path.string(), old_text) == 0);

    const std::string big(64 * 1024, 'x'); // far larger than any stream buffer
    check("returns 1", write_file_with_size_limit(path.string(), big, 16) == 1);
    check_eq("old file is unchanged", read_file(path), old_text);
    check("partial .tmp was removed", !fs::exists(path.string() + ".tmp"));

    check("works again once the limit is lifted", write_file(path.string(), big) == 0);
    check("and the big text arrived whole", read_file(path) == big);
  }

  std::cout << "failed rename (the path is a non-empty directory)\n";
  {
    // A file cannot be renamed onto a directory, so the .tmp is written
    // successfully and then the rename fails.
    const fs::path path = dir / "is_a_dir";
    fs::create_directories(path / "inner");

    check("returns 1", write_file(path.string(), "{}") == 1);
    check("the directory is still there", fs::is_directory(path));
    check("and still has its contents", fs::exists(path / "inner"));
    check(".tmp was removed", !fs::exists(path.string() + ".tmp"));
  }

  fs::remove_all(dir);

  std::cout << "\n"
            << passed << " passed, " << failed << " failed\n";
  return failed == 0 ? 0 : 1;
}