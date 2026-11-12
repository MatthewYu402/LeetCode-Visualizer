// trace-rewrite: inserts the trace runtime's calls into a pasted Solution.
//
//   trace-rewrite solution.cpp [-o out.cpp] -- -std=c++20 -I adapters/cpp/runtime -include prelude.hpp
//
// Everything after `--` is the compiler command line used to parse the file.
// The prelude (from the driver, python3 -m driver) supplies the standard
// headers, ListNode, TreeNode, and any Node class, exactly as when the program
// is compiled, so the code parses the same way here as it will there.
//
// Writes the instrumented source to -o, or to stdout. Exit status: 0 on
// success; 1 when the code does not compile (Clang prints why, at the user's
// line numbers); 2 for a usage error.

#include "instrumenter.hpp"

#include "clang/AST/ASTConsumer.h"
#include "clang/Frontend/CompilerInstance.h"
#include "clang/Frontend/FrontendAction.h"
#include "clang/Tooling/ArgumentsAdjusters.h"
#include "clang/Tooling/CommonOptionsParser.h"
#include "clang/Tooling/Tooling.h"
#include "llvm/Support/CommandLine.h"
#include "llvm/Support/FileSystem.h"
#include "llvm/Support/raw_ostream.h"

#include <memory>
#include <string>

namespace {

  llvm::cl::OptionCategory category("trace-rewrite options");
  llvm::cl::opt<std::string> output("o", llvm::cl::desc("Write the instrumented source here instead of stdout"),
                                    llvm::cl::value_desc("file"), llvm::cl::cat(category));

  std::string result;     // the instrumented source of the one input file
  bool produced = false;

  // Runs the visitor over the whole translation unit once it is parsed.
  class Consumer : public clang::ASTConsumer {
  public:
    explicit Consumer(clang::Rewriter &rewriter) : rewriter_(rewriter) {}
    void HandleTranslationUnit(clang::ASTContext &context) override {
      rewriter::Instrumenter(rewriter_, context).TraverseDecl(context.getTranslationUnitDecl());
    }

  private:
    clang::Rewriter &rewriter_;
  };

  // One run of Clang's front end over the file: parse, build the AST, hand it
  // to the Consumer, then (if there were no errors) keep the edited text.
  class Action : public clang::ASTFrontendAction {
  public:
    std::unique_ptr<clang::ASTConsumer> CreateASTConsumer(clang::CompilerInstance &compiler, llvm::StringRef) override {
      rewriter_.setSourceMgr(compiler.getSourceManager(), compiler.getLangOpts());
      return std::make_unique<Consumer>(rewriter_);
    }

    void EndSourceFileAction() override {
      clang::CompilerInstance &compiler = getCompilerInstance();
      if (compiler.getDiagnostics().hasErrorOccurred()) return;  // never write half-understood code
      const clang::SourceManager &sources = rewriter_.getSourceMgr();
      const clang::FileID main = sources.getMainFileID();
      if (const auto *buffer = rewriter_.getRewriteBufferFor(main)) {
        result.assign(buffer->begin(), buffer->end());
      } else {
        result = sources.getBufferData(main).str();  // nothing to instrument
      }
      produced = true;
    }

  private:
    clang::Rewriter rewriter_;
  };

  // Adds `flag` to the parse command unless the user already gave `prefix`.
  clang::tooling::ArgumentsAdjuster addUnlessPresent(std::string prefix, std::string flag) {
    return [prefix, flag](const clang::tooling::CommandLineArguments &args, llvm::StringRef) {
      for (const std::string &arg : args)
        if (llvm::StringRef(arg).starts_with(prefix)) return args;
      clang::tooling::CommandLineArguments adjusted = args;
      adjusted.push_back(flag);
      return adjusted;
    };
  }

}  // namespace

int main(int argc, const char **argv) {
  auto parsed = clang::tooling::CommonOptionsParser::create(argc, argv, category, llvm::cl::Required,
                                                            "Insert trace calls into a LeetCode Solution.\n");
  if (!parsed) {
    llvm::errs() << llvm::toString(parsed.takeError());
    return 2;
  }
  if (parsed->getSourcePathList().size() != 1) {
    llvm::errs() << "trace-rewrite: give exactly one source file\n";
    return 2;
  }

  clang::tooling::ClangTool tool(parsed->getCompilations(), parsed->getSourcePathList());
  // Clang's own headers (stddef.h, ...) live in its resource directory. A
  // standalone tool does not know where that is, so the build records it.
  tool.appendArgumentsAdjuster(addUnlessPresent("-resource-dir", "-resource-dir=" TRACE_RESOURCE_DIR));
#ifdef TRACE_DEFAULT_SYSROOT
  // macOS: the SDK holds the C and C++ standard library headers.
  tool.appendArgumentsAdjuster(addUnlessPresent("-isysroot", "-isysroot" TRACE_DEFAULT_SYSROOT));
#endif

  const int status = tool.run(clang::tooling::newFrontendActionFactory<Action>().get());
  if (status != 0 || !produced) return 1;

  if (output.empty()) {
    llvm::outs() << result;
    return 0;
  }
  std::error_code error;
  llvm::raw_fd_ostream file(output, error, llvm::sys::fs::OF_Text);
  if (error) {
    llvm::errs() << "trace-rewrite: cannot write " << output << ": " << error.message() << "\n";
    return 2;
  }
  file << result;
  return 0;
}
