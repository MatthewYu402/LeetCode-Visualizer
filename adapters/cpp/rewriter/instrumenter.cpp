// instrumenter.cpp: see instrumenter.hpp for what is inserted, and why no
// insertion contains a newline.

#include "instrumenter.hpp"

#include "clang/Lex/Lexer.h"

#include <algorithm>
#include <set>

namespace rewriter {

  using namespace clang;

  Instrumenter::Instrumenter(Rewriter &rewriter, ASTContext &context)
      : rewriter_(rewriter), context_(context), sources_(context.getSourceManager()) {}

  // ======================================================================
  // Source positions
  // ======================================================================

  // Only text written in the user's file is edited: not the prelude, not
  // trace.hpp, not the standard headers, and not code produced by a macro.
  bool Instrumenter::editable(SourceLocation loc) const {
    return loc.isValid() && !loc.isMacroID() && sources_.isInMainFile(loc);
  }

  unsigned Instrumenter::line(SourceLocation loc) const { return sources_.getSpellingLineNumber(loc); }

  // The position just after a statement, where a closing `}` goes when the
  // statement was an unbraced body. getEndLoc() is the START of the last
  // token, so first step past that token. A statement such as `x = 1;` does
  // not include its `;`, so step past a `;` if one comes next.
  SourceLocation Instrumenter::afterStatement(const Stmt *stmt) const {
    const LangOptions &lang = context_.getLangOpts();
    SourceLocation after_semi = Lexer::findLocationAfterToken(stmt->getEndLoc(), tok::semi, sources_, lang, false);
    if (after_semi.isValid()) return after_semi;
    return Lexer::getLocForEndOfToken(stmt->getEndLoc(), 0, sources_, lang);
  }

  // Every insertion goes AFTER earlier insertions at the same position. The
  // walk is ordered so that this gives the right text: a body's `{` is
  // inserted before the record that follows it, and an inner block's `}`
  // before the `}` of the block around it.
  void Instrumenter::insert(SourceLocation loc, const std::string &text) {
    rewriter_.InsertText(loc, text, /*InsertAfter=*/true, /*indentNewLines=*/false);
  }

  // ======================================================================
  // Scopes
  // ======================================================================

  void Instrumenter::declare(const VarDecl *var) {
    if (var == nullptr || scopes_.empty()) return;
    if (const auto *decomposition = dyn_cast<DecompositionDecl>(var)) {
      for (const BindingDecl *binding : decomposition->bindings())  // auto [a, b] = ...
        if (!binding->getName().empty()) scopes_.back().push_back({binding->getNameAsString(), ""});
      return;
    }
    if (!var->getName().empty()) scopes_.back().push_back({var->getNameAsString(), containerOf(var->getInit())});
  }

  // `it = m.find(x);` as a statement of its own: from now on `it` is a
  // position in `m`. (An assignment from something else ends the pairing.)
  // A class-type iterator's `=` is an operator call, a built-in one a
  // BinaryOperator, so both forms are checked.
  void Instrumenter::noteAssignment(const Stmt *stmt) {
    const auto *expr = dyn_cast_or_null<Expr>(stmt);
    if (expr == nullptr) return;
    expr = expr->IgnoreImplicit();
    const Expr *lhs = nullptr, *rhs = nullptr;
    if (const auto *op = dyn_cast<BinaryOperator>(expr); op && op->getOpcode() == BO_Assign) {
      lhs = op->getLHS();
      rhs = op->getRHS();
    } else if (const auto *call = dyn_cast<CXXOperatorCallExpr>(expr); call && call->getOperator() == OO_Equal && call->getNumArgs() == 2) {
      lhs = call->getArg(0);
      rhs = call->getArg(1);
    }
    const auto *ref = lhs ? dyn_cast<DeclRefExpr>(lhs->IgnoreParenImpCasts()) : nullptr;
    if (ref == nullptr) return;
    const std::string name = ref->getDecl()->getNameAsString();
    for (auto scope = scopes_.rbegin(); scope != scopes_.rend(); ++scope) {  // the innermost declaration of that name
      for (auto var = scope->rbegin(); var != scope->rend(); ++var) {
        if (var->name == name) {
          var->container = containerOf(rhs);
          return;
        }
      }
    }
  }

  // The one visible container an expression makes an iterator from, or "".
  // It looks for calls that return a position in the container they are
  // called on (v.begin(), m.find(k), s.lower_bound(x), ...) or are passed
  // (std::begin(v)), anywhere in the expression, so both `m.find(x)` and
  // `lower_bound(v.begin(), v.end(), x)` give one container. Two different
  // containers, or none, give "". Whether the variable really is an iterator
  // into it is checked by the runtime (trace::IteratorOf), so `int x = *m.find(k);`
  // is safe: it is written as an int.
  std::string Instrumenter::containerOf(const Stmt *root) const {
    static const std::set<std::string> methods = {"begin", "end", "cbegin", "cend", "find", "lower_bound", "upper_bound",
                                                  "erase", "insert", "emplace", "emplace_hint"};
    static const std::set<std::string> functions = {"begin", "end", "cbegin", "cend"};
    const std::vector<std::string> visible = visibleNames();
    std::set<std::string> found;

    std::function<void(const Stmt *)> walk = [&](const Stmt *node) {
      if (node == nullptr || isa<LambdaExpr>(node)) return;
      const Expr *object = nullptr;
      if (const auto *call = dyn_cast<CXXMemberCallExpr>(node)) {
        if (const CXXMethodDecl *method = call->getMethodDecl(); method && methods.count(method->getNameAsString()))
          object = call->getImplicitObjectArgument();
      } else if (const auto *call = dyn_cast<CallExpr>(node); call && !isa<CXXOperatorCallExpr>(node)) {
        if (const FunctionDecl *fn = call->getDirectCallee(); fn && functions.count(fn->getNameAsString()) && call->getNumArgs() == 1)
          object = call->getArg(0);
      }
      if (object != nullptr) {
        if (const auto *ref = dyn_cast<DeclRefExpr>(object->IgnoreParenImpCasts()); ref && isa<VarDecl>(ref->getDecl())) {
          const std::string name = ref->getDecl()->getNameAsString();
          if (std::find(visible.begin(), visible.end(), name) != visible.end()) found.insert(name);
        }
      }
      for (const Stmt *child : node->children()) walk(child);
    };
    walk(root);
    return found.size() == 1 ? *found.begin() : "";
  }

  // What a statement declares: the variables of a DeclStmt (int a = 1, b = 2;).
  void Instrumenter::declare(const Stmt *stmt) {
    if (const auto *decls = dyn_cast_or_null<DeclStmt>(stmt))
      for (const Decl *decl : decls->decls()) declare(dyn_cast<VarDecl>(decl));
  }

  std::vector<std::string> Instrumenter::visibleNames() const {
    std::vector<std::string> names;
    for (const auto &scope : scopes_) {
      for (const Var &var : scope) {
        names.erase(std::remove(names.begin(), names.end(), var.name), names.end());
        names.push_back(var.name);
      }
    }
    return names;
  }

  // Every visible variable, outermost first. A name declared again in an inner
  // scope hides the outer one (C++ name lookup would pick the inner one too),
  // so only the innermost is kept and the step has no duplicate keys.
  //
  // A variable paired with a container that is still visible (and is not the
  // variable itself) is written with var_iter.
  std::string Instrumenter::varArgs() const {
    std::vector<Var> vars;
    for (const auto &scope : scopes_) {
      for (const Var &var : scope) {
        vars.erase(std::remove_if(vars.begin(), vars.end(), [&](const Var &v) { return v.name == var.name; }), vars.end());
        vars.push_back(var);
      }
    }
    const auto visible = [&](const std::string &name) {
      return std::any_of(vars.begin(), vars.end(), [&](const Var &v) { return v.name == name; });
    };
    std::string args;
    for (const Var &var : vars) {
      if (!var.container.empty() && var.container != var.name && visible(var.container)) {
        args += ", ::trace::var_iter(\"" + var.name + "\", " + var.name + ", \"" + var.container + "\", " + var.container + ")";
      } else {
        args += ", ::trace::var(\"" + var.name + "\", " + var.name + ")";
      }
    }
    return args;
  }

  // ======================================================================
  // Functions
  // ======================================================================

  bool Instrumenter::shouldInstrument(const FunctionDecl *fn) const {
    if (!fn->doesThisDeclarationHaveABody() || fn->isImplicit() || fn->isDefaulted() || fn->isDeleted()) return false;
    if (!editable(fn->getLocation()) || !isa_and_nonnull<CompoundStmt>(fn->getBody())) return false;
    if (fn->isOverloadedOperator()) return false;  // comparators and operator() bodies
    if (const auto *method = dyn_cast<CXXMethodDecl>(fn)) {
      if (isa<CXXConstructorDecl>(method) || isa<CXXDestructorDecl>(method) || isa<CXXConversionDecl>(method)) return false;
      const CXXRecordDecl *owner = method->getParent();
      if (owner->isLambda() || owner->getName() != "Solution") return false;
    }
    return true;
  }

  bool Instrumenter::traverseFunction(FunctionDecl *fn, const std::function<bool()> &walk_normally) {
    if (!shouldInstrument(fn)) {
      const bool saved = active_;
      active_ = false;  // a function inside an instrumented one (a local class's method) is not instrumented
      const bool keep_going = walk_normally();
      active_ = saved;
      return keep_going;
    }

    // Save the state of an enclosing function, if any, and start fresh.
    const bool saved_active = active_, saved_void = returns_void_;
    const std::string saved_type = return_type_;
    auto saved_scopes = std::move(scopes_);

    active_ = true;
    const QualType type = fn->getReturnType();
    returns_void_ = type->isVoidType();
    PrintingPolicy policy(context_.getLangOpts());
    policy.SuppressTagKeyword = true;
    return_type_ = type.getAsString(policy);  // as written: vector<int>, ListNode *
    if (return_type_.find("auto") != std::string::npos) return_type_.clear();  // not deduced yet: no ret<T>

    // The parameters are the function's outermost scope.
    scopes_.clear();
    scopes_.emplace_back();
    for (const ParmVarDecl *param : fn->parameters())
      if (!param->getName().empty()) scopes_.back().push_back({param->getNameAsString(), ""});

    auto *body = cast<CompoundStmt>(fn->getBody());
    insert(body->getLBracLoc().getLocWithOffset(1), " ::trace::Frame trace_frame_(\"" + fn->getNameAsString() + "\");");

    const bool keep_going = traverseBlock(body, /*guard_line=*/0, [&] {
      // A void function that runs off its end returns here: give that its return step.
      if (returns_void_ && editable(body->getRBracLoc()))
        insert(body->getRBracLoc(), "::trace::ret_void(" + std::to_string(line(body->getRBracLoc())) + varArgs() + "); ");
    });

    active_ = saved_active;
    returns_void_ = saved_void;
    return_type_ = saved_type;
    scopes_ = std::move(saved_scopes);
    return keep_going;
  }

  bool Instrumenter::TraverseFunctionDecl(FunctionDecl *fn) {
    return traverseFunction(fn, [&] { return Base::TraverseFunctionDecl(fn); });
  }

  bool Instrumenter::TraverseCXXMethodDecl(CXXMethodDecl *method) {
    return traverseFunction(method, [&] { return Base::TraverseCXXMethodDecl(method); });
  }

  // A class declared inside an instrumented function: its methods are not instrumented.
  bool Instrumenter::TraverseCXXRecordDecl(CXXRecordDecl *record) {
    const bool saved = active_;
    active_ = false;
    const bool keep_going = Base::TraverseCXXRecordDecl(record);
    active_ = saved;
    return keep_going;
  }

  // A lambda's body runs in its own call, and its variables are its captures
  // and parameters, not the enclosing function's. Instrumenting it as part of
  // the enclosing function would name variables it cannot see, so its body is
  // left as written.
  bool Instrumenter::TraverseLambdaExpr(LambdaExpr *) { return true; }

  // ======================================================================
  // Blocks and statements
  // ======================================================================

  bool Instrumenter::traverseBlock(CompoundStmt *block, unsigned guard_line, const std::function<void()> &at_end) {
    scopes_.emplace_back();
    if (guard_line != 0 && editable(block->getLBracLoc()))
      insert(block->getLBracLoc().getLocWithOffset(1), " ::trace::Scope trace_scope_(" + std::to_string(guard_line) + ");");
    for (Stmt *stmt : block->body()) {
      if (!traverseStatement(stmt)) {
        scopes_.pop_back();
        return false;
      }
    }
    if (at_end) at_end();
    scopes_.pop_back();
    return true;
  }

  bool Instrumenter::traverseStatement(Stmt *stmt) {
    // `case 1: x = 2;` is a CaseStmt holding `x = 2;`. The record goes after
    // the label, before the statement, so it stays inside that case.
    Stmt *target = stmt;
    while (true) {
      if (auto *label = dyn_cast<SwitchCase>(target)) target = label->getSubStmt();
      else if (auto *named = dyn_cast<LabelStmt>(target)) target = named->getSubStmt();
      else break;
    }

    // Loops get no record of their own: their body's statements do. A nested
    // `{ }` gets one per statement inside it, and `;` does nothing.
    const bool is_loop = isa<ForStmt, CXXForRangeStmt, WhileStmt, DoStmt>(target);
    const bool records = !is_loop && !isa<CompoundStmt, NullStmt>(target) && editable(target->getBeginLoc());

    // 1. The step before this statement: only variables declared before it.
    if (records) {
      const std::string where = std::to_string(line(target->getBeginLoc()));
      insert(target->getBeginLoc(), "::trace::record(" + where + varArgs() + "); ");
      if (auto *ret = dyn_cast<ReturnStmt>(target)) rewriteReturn(ret);
    }
    // 2. Into the statement: nested blocks see the scope as it is here.
    if (!TraverseStmt(stmt)) return false;
    // 3. Only now does what it declares become visible, to the statements after it,
    //    and an assignment such as `it = m.find(x);` pairs `it` with `m` from now on.
    declare(target);
    noteAssignment(target);
    return true;
  }

  // return expr;  ->  return ::trace::ret<T>(LINE, expr, vars...);
  // return;       ->  ::trace::ret_void(LINE, vars...); return;
  void Instrumenter::rewriteReturn(ReturnStmt *ret) {
    const std::string where = std::to_string(line(ret->getBeginLoc()));
    if (returns_void_) {
      insert(ret->getBeginLoc(), "::trace::ret_void(" + where + varArgs() + "); ");
      return;
    }
    const Expr *value = ret->getRetValue();
    if (value == nullptr || return_type_.empty()) return;
    const SourceLocation begin = value->getBeginLoc();
    const SourceLocation end = Lexer::getLocForEndOfToken(value->getEndLoc(), 0, sources_, context_.getLangOpts());
    if (!editable(begin) || !editable(end)) return;
    insert(begin, "::trace::ret<" + return_type_ + ">(" + where + ", ");
    insert(end, varArgs() + ")");
  }

  bool Instrumenter::traverseBody(Stmt *body, unsigned owner_line) {
    if (body == nullptr) return true;
    if (auto *block = dyn_cast<CompoundStmt>(body)) return traverseBlock(block, owner_line);
    if (isa<NullStmt>(body)) return true;

    // One statement with no braces, such as `if (x) y++;` or the `if` of an
    // `else if`: wrap it in a block so a Scope and a record can go before it.
    const SourceLocation begin = body->getBeginLoc();
    const SourceLocation end = afterStatement(body);
    if (!editable(begin) || !editable(end)) return TraverseStmt(body);
    insert(begin, "{ ::trace::Scope trace_scope_(" + std::to_string(owner_line) + "); ");
    scopes_.emplace_back();
    const bool keep_going = traverseStatement(body);
    scopes_.pop_back();
    insert(end, " }");  // after any `}` inserted inside it, at the same position
    return keep_going;
  }

  // A bare `{ ... }` inside a function (or a switch body, a try block). Blocks
  // that are bodies of if/for/while never reach here: traverseBody takes them.
  bool Instrumenter::TraverseCompoundStmt(CompoundStmt *block) {
    if (!active_) return Base::TraverseCompoundStmt(block);
    return traverseBlock(block, line(block->getLBracLoc()));
  }

  bool Instrumenter::TraverseIfStmt(IfStmt *stmt) {
    if (!active_) return Base::TraverseIfStmt(stmt);
    scopes_.emplace_back();  // if (auto x = f(); x > 0): x is visible in both branches
    bool keep_going = TraverseStmt(stmt->getInit());
    declare(stmt->getInit());
    if (VarDecl *var = stmt->getConditionVariable()) {  // if (int x = f())
      keep_going = keep_going && TraverseStmt(var->getInit());
      declare(var);
    }
    keep_going = keep_going && TraverseStmt(stmt->getCond());
    const unsigned owner = line(stmt->getBeginLoc());
    keep_going = keep_going && traverseBody(stmt->getThen(), owner);
    keep_going = keep_going && traverseBody(stmt->getElse(), owner);  // an `else if` is an IfStmt body
    scopes_.pop_back();
    return keep_going;
  }

  bool Instrumenter::TraverseForStmt(ForStmt *stmt) {
    if (!active_) return Base::TraverseForStmt(stmt);
    scopes_.emplace_back();  // for (int i = 0; ...): i is visible in the body only
    bool keep_going = TraverseStmt(stmt->getInit());
    declare(stmt->getInit());
    if (VarDecl *var = stmt->getConditionVariable()) {
      keep_going = keep_going && TraverseStmt(var->getInit());
      declare(var);
    }
    keep_going = keep_going && TraverseStmt(stmt->getCond()) && TraverseStmt(stmt->getInc());
    keep_going = keep_going && traverseBody(stmt->getBody(), line(stmt->getBeginLoc()));
    scopes_.pop_back();
    return keep_going;
  }

  bool Instrumenter::TraverseCXXForRangeStmt(CXXForRangeStmt *stmt) {
    if (!active_) return Base::TraverseCXXForRangeStmt(stmt);
    scopes_.emplace_back();  // for (Node* n : nodes): n is visible in the body only
    bool keep_going = TraverseStmt(stmt->getInit());
    declare(stmt->getInit());
    keep_going = keep_going && TraverseStmt(stmt->getRangeInit());
    declare(stmt->getLoopVariable());
    keep_going = keep_going && traverseBody(stmt->getBody(), line(stmt->getBeginLoc()));
    scopes_.pop_back();
    return keep_going;
  }

  bool Instrumenter::TraverseWhileStmt(WhileStmt *stmt) {
    if (!active_) return Base::TraverseWhileStmt(stmt);
    scopes_.emplace_back();
    bool keep_going = true;
    if (VarDecl *var = stmt->getConditionVariable()) {
      keep_going = TraverseStmt(var->getInit());
      declare(var);
    }
    keep_going = keep_going && TraverseStmt(stmt->getCond());
    keep_going = keep_going && traverseBody(stmt->getBody(), line(stmt->getBeginLoc()));
    scopes_.pop_back();
    return keep_going;
  }

  bool Instrumenter::TraverseDoStmt(DoStmt *stmt) {
    if (!active_) return Base::TraverseDoStmt(stmt);
    return traverseBody(stmt->getBody(), line(stmt->getBeginLoc())) && TraverseStmt(stmt->getCond());
  }

  // A switch body gets records before its cases' statements but no Scope
  // guard: a jump to a `case` label may not skip a variable's initialization,
  // and the guard is a variable. (The user's own variables in a case need
  // braces for the same reason, and a braced case block does get a guard.)
  bool Instrumenter::TraverseSwitchStmt(SwitchStmt *stmt) {
    if (!active_) return Base::TraverseSwitchStmt(stmt);
    scopes_.emplace_back();
    bool keep_going = TraverseStmt(stmt->getInit());
    declare(stmt->getInit());
    if (VarDecl *var = stmt->getConditionVariable()) {
      keep_going = keep_going && TraverseStmt(var->getInit());
      declare(var);
    }
    keep_going = keep_going && TraverseStmt(stmt->getCond());
    if (auto *block = dyn_cast_or_null<CompoundStmt>(stmt->getBody())) {
      keep_going = keep_going && traverseBlock(block, /*guard_line=*/0);
    } else {
      keep_going = keep_going && TraverseStmt(stmt->getBody());
    }
    scopes_.pop_back();
    return keep_going;
  }

}  // namespace rewriter
