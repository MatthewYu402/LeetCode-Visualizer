#pragma once
// instrumenter.hpp: the rewriter's AST visitor.
//
// It walks the AST of the user's file and records edits in a clang::Rewriter.
// Every edit is made against a position in the ORIGINAL file, so line numbers
// come from the original source however much text is inserted. And no edit
// adds a newline, so each line of the output is the same line of the input:
// a compile error in the user's code still points at the user's line.
//
// What it inserts (docs/adapters/cpp.md, section 4):
//   - ::trace::Frame trace_frame_("name");    after the `{` of each instrumented function
//   - ::trace::record(LINE, vars...);         before each statement in a block. A loop's
//     header gets a step each time it is checked instead: a `for` before the loop
//     (first pass) and at the start of its increment (later passes), a `while` or
//     `do`-`while` in its condition, a range-`for` at the start of each iteration.
//     Each variable is ::trace::var("x", x), or ::trace::var_iter("it", it, "v", v)
//     when it was made from a call on a container v (v.begin(), m.find(k), ...).
//   - outcomes (trace-format.md, Outcomes), at statement level:
//       ::trace::cond(LINE, "code", (cond))          around the condition of if, while,
//                                                    do-while, for, and ?:
//       ::trace::store(LINE, "code", "x", x);        after a declaration with an initializer
//       ::trace::track(LINE, "code", "t", t) ... ; ::trace::flush();
//                                                    around the target of an assignment,
//                                                    compound assignment, or ++/-- statement
//       ::trace::stored<T>(LINE, "code", "i", init)  around a for loop's initializer
//   - ::trace::Scope trace_scope_(LINE);      after the `{` of every other block
//   - { ... }                                 around an unbraced body, so it has a block
//   - return ::trace::ret<T>(LINE, expr, vars...);   for each return with a value
//   - ::trace::ret_void(LINE, vars...);       before `return;` and at the closing brace of a void function
//
// Which functions: the methods of class Solution and free functions, defined
// in the main file. Not constructors, destructors, operators, other classes'
// methods, or lambdas (a lambda has its own call and captures, which this
// version does not model).

#include "clang/AST/ASTContext.h"
#include "clang/AST/DeclCXX.h"
#include "clang/AST/ExprCXX.h"
#include "clang/AST/RecursiveASTVisitor.h"
#include "clang/AST/Stmt.h"
#include "clang/AST/StmtCXX.h"
#include "clang/Basic/SourceManager.h"
#include "clang/Rewrite/Core/Rewriter.h"

#include <functional>
#include <string>
#include <vector>

namespace rewriter {

  class Instrumenter : public clang::RecursiveASTVisitor<Instrumenter> {
  public:
    using Base = clang::RecursiveASTVisitor<Instrumenter>;

    Instrumenter(clang::Rewriter &rewriter, clang::ASTContext &context);

    // Each Traverse function replaces the base class's walk of one kind of node
    // (the base finds them by name, through CRTP). Each either instruments the
    // node and walks its children itself, or hands it back to the base.
    bool TraverseFunctionDecl(clang::FunctionDecl *fn);
    bool TraverseCXXMethodDecl(clang::CXXMethodDecl *method);
    bool TraverseCXXRecordDecl(clang::CXXRecordDecl *record);
    bool TraverseLambdaExpr(clang::LambdaExpr *lambda);
    bool TraverseCompoundStmt(clang::CompoundStmt *block);
    bool TraverseIfStmt(clang::IfStmt *stmt);
    bool TraverseForStmt(clang::ForStmt *stmt);
    bool TraverseCXXForRangeStmt(clang::CXXForRangeStmt *stmt);
    bool TraverseWhileStmt(clang::WhileStmt *stmt);
    bool TraverseDoStmt(clang::DoStmt *stmt);
    bool TraverseSwitchStmt(clang::SwitchStmt *stmt);
    bool TraverseConditionalOperator(clang::ConditionalOperator *expr);

  private:
    // ---- the function being instrumented ----
    bool shouldInstrument(const clang::FunctionDecl *fn) const;
    bool traverseFunction(clang::FunctionDecl *fn, const std::function<bool()> &walk_normally);

    // ---- blocks and statements ----
    // Instruments a `{ ... }`: a Scope guard (unless guard_line is 0), then each statement.
    // `at_end` runs while the block's own variables are still in scope.
    // `prologue` goes right after the guard: a range-for's step for its header.
    bool traverseBlock(clang::CompoundStmt *block, unsigned guard_line, const std::function<void()> &at_end = nullptr,
                       const std::string &prologue = "");
    // The body of an if, else, for, while, or do: a block, or one statement that gets braces.
    bool traverseBody(clang::Stmt *body, unsigned owner_line, const std::string &prologue = "");
    // One statement of a block: its record, its return rewrite, a walk into it, then its declarations.
    bool traverseStatement(clang::Stmt *stmt);
    void rewriteReturn(clang::ReturnStmt *ret);

    // ---- outcomes ----
    // Wraps a condition in ::trace::cond. With `step`, a record goes first: the
    // loop header's step for this check.
    void wrapCondition(clang::Expr *cond, unsigned at, bool step);
    // The stores of an expression: itself, or each operand of a top-level comma.
    std::vector<clang::Expr *> storesIn(clang::Expr *expr) const;
    // The target an assignment, compound assignment, or ++/-- writes to, if it can be tracked.
    clang::Expr *storeTarget(clang::Expr *store) const;
    // Wraps each store target of `expr` in ::trace::track. Returns whether any was.
    bool trackStores(clang::Expr *expr, unsigned at);
    // After a declaration: one ::trace::store per variable it initializes.
    void storeDeclarations(clang::DeclStmt *decls, unsigned at);
    std::string sourceText(clang::SourceRange range) const;

    // ---- scopes ----
    // A visible variable, and the container it was made from, if any: the
    // `nums` of `auto it = nums.begin();`. That pairing is how an iterator is
    // written as a position in its container (var_iter).
    struct Var {
      std::string name;
      std::string container;
    };
    void declare(const clang::Stmt *stmt);
    void declare(const clang::VarDecl *var);
    void noteAssignment(const clang::Stmt *stmt);        // it = m.find(x); pairs it with m
    std::string containerOf(const clang::Stmt *expr) const;
    std::vector<std::string> visibleNames() const;
    std::string varArgs() const;  // ", ::trace::var("a", a), ..." for everything visible

    // ---- source positions ----
    bool editable(clang::SourceLocation loc) const;
    unsigned line(clang::SourceLocation loc) const;
    clang::SourceLocation afterStatement(const clang::Stmt *stmt) const;
    void insert(clang::SourceLocation loc, const std::string &text);

    clang::Rewriter &rewriter_;
    clang::ASTContext &context_;
    const clang::SourceManager &sources_;

    bool active_ = false;            // inside the body of a function being instrumented
    bool returns_void_ = false;
    std::string return_type_;        // spelled for ret<T>; empty when it cannot be spelled
    std::vector<std::vector<Var>> scopes_;  // innermost last; variables in declaration order
    unsigned step_line_ = 0;         // the line of the step the code being walked belongs to (0: none)
  };

}  // namespace rewriter
