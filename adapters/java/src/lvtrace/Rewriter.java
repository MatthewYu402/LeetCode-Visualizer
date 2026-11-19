package lvtrace;

import com.sun.source.tree.ArrayAccessTree;
import com.sun.source.tree.AssignmentTree;
import com.sun.source.tree.BinaryTree;
import com.sun.source.tree.BlockTree;
import com.sun.source.tree.CaseTree;
import com.sun.source.tree.CatchTree;
import com.sun.source.tree.ClassTree;
import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.tree.CompoundAssignmentTree;
import com.sun.source.tree.ConditionalExpressionTree;
import com.sun.source.tree.DoWhileLoopTree;
import com.sun.source.tree.EnhancedForLoopTree;
import com.sun.source.tree.ExpressionStatementTree;
import com.sun.source.tree.ExpressionTree;
import com.sun.source.tree.ForLoopTree;
import com.sun.source.tree.IdentifierTree;
import com.sun.source.tree.IfTree;
import com.sun.source.tree.LabeledStatementTree;
import com.sun.source.tree.LambdaExpressionTree;
import com.sun.source.tree.LiteralTree;
import com.sun.source.tree.MemberSelectTree;
import com.sun.source.tree.MethodInvocationTree;
import com.sun.source.tree.MethodTree;
import com.sun.source.tree.NewClassTree;
import com.sun.source.tree.ParenthesizedTree;
import com.sun.source.tree.PrimitiveTypeTree;
import com.sun.source.tree.ReturnTree;
import com.sun.source.tree.StatementTree;
import com.sun.source.tree.SwitchExpressionTree;
import com.sun.source.tree.SwitchTree;
import com.sun.source.tree.SynchronizedTree;
import com.sun.source.tree.ThrowTree;
import com.sun.source.tree.Tree;
import com.sun.source.tree.TryTree;
import com.sun.source.tree.TypeCastTree;
import com.sun.source.tree.UnaryTree;
import com.sun.source.tree.VariableTree;
import com.sun.source.tree.WhileLoopTree;
import com.sun.source.util.SourcePositions;
import com.sun.source.util.TreeScanner;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The Java rewriter: inserts the runtime's calls into a Solution's source, on the user's own
 * lines, so no line moves (docs/adapters/java.md §4). It follows the C++ rewriter's rules:
 *
 * <pre>
 *   int x = nums[i];        record(L, __f, vars...); int x = nums[ixN(L, "nums[i]", "nums", nums, 1, i)]; store(L, ...);
 *   if (seen.contains(x))   if (cond(L, "seen.contains(x)", (seen.contains(key(L, ..., x)))))
 *   while (lo < hi)         while (at(L, __f, vars...) && cond(L, "lo < hi", (lo < hi)))
 *   for (int i = 0; ...)    for (int i = init(L, "int i = 0", "i", 0); at(...) && cond(...); i++, pend(L, "i++", "i", i))
 *   return a + b;           return ret(L, __f, a + b);
 * </pre>
 *
 * <p>Each method of class Solution gets a frame ({@code Trace.enter}) and a {@code finally} that
 * ends it. Java cannot list a frame's locals at run time, so every recording call passes the
 * locals in scope by name. Each inserted piece is numbered: when javac rejects one (a local that
 * is not yet definitely assigned, a return step after a statement that cannot complete), Build
 * drops that piece and compiles again, so the compiler decides what is legal.
 */
final class Rewriter {
  static final String T = "lvtrace.Trace.";
  static final Set<String> STACK_METHODS = Set.of("push", "pop", "peek", "isEmpty", "size", "clear");

  private final String src;
  private final CompilationUnitTree cu;
  private final SourcePositions sp;
  private final List<Insert> inserts = new ArrayList<>();
  private int nextPiece = 1;

  // Per class and per method.
  private final Map<String, String> fieldTypes = new HashMap<>();
  private String memberHints = "";
  private final List<List<String[]>> scopes = new ArrayList<>();   // {name, declared type}
  private int line;                                                // the statement being rewritten

  record Insert(int pos, long order, int piece, String text) {}

  Rewriter(String src, CompilationUnitTree cu, SourcePositions sp) {
    this.src = src;
    this.cu = cu;
    this.sp = sp;
  }

  // ------------------------------------------------------------------ output

  /** The rewritten source without the dropped pieces, and where each piece's text ended up. */
  Output output(Set<Integer> dropped, String prefix) {
    List<Insert> kept = new ArrayList<>();
    for (Insert in : inserts) if (!dropped.contains(in.piece)) kept.add(in);
    kept.sort(Comparator.comparingInt(Insert::pos).thenComparingLong(Insert::order));
    StringBuilder out = new StringBuilder(prefix);
    List<int[]> spans = new ArrayList<>();  // {start, end, piece} in the output
    int at = 0;
    for (Insert in : kept) {
      out.append(src, at, in.pos);
      at = in.pos;
      int start = out.length();
      out.append(in.text);
      if (in.piece > 0) spans.add(new int[] {start, out.length(), in.piece});
    }
    out.append(src.substring(at));
    return new Output(out.toString(), spans);
  }

  record Output(String text, List<int[]> spans) {
    int pieceAt(long pos) {
      for (int[] s : spans) if (pos >= s[0] && pos < s[1]) return s[2];
      return 0;
    }
  }

  private void insert(int pos, long order, int piece, String text) {
    inserts.add(new Insert(pos, order, piece, text));
  }

  private int piece() {
    return nextPiece++;
  }

  /** `prefix` before and `suffix` after a span, as one removable piece: outer wraps open first and close last. */
  private void wrap(Tree t, String prefix, String suffix) {
    int s = start(t), e = end(t);
    int p = piece();
    insert(s, -(long) (e - s) * 4 - 2, p, prefix);
    insert(e, (long) (e - s) * 4 + 2, p, suffix);
  }

  // Statement-level inserts at a statement's edges: a brace opens before anything, a step comes
  // next; at the end a store comes first, then a closing brace.
  private static final long OPEN_BRACE = Long.MIN_VALUE / 2;
  private static final long BEFORE = Long.MIN_VALUE / 4;
  private static final long AFTER = Long.MAX_VALUE / 4;
  private static final long CLOSE_BRACE = Long.MAX_VALUE / 2;

  // ------------------------------------------------------------------ positions

  int start(Tree t) {
    return (int) sp.getStartPosition(cu, t);
  }

  int end(Tree t) {
    return (int) sp.getEndPosition(cu, t);
  }

  int lineOf(int pos) {
    return (int) cu.getLineMap().getLineNumber(pos);
  }

  String text(Tree t) {
    return src.substring(start(t), end(t));
  }

  static String oneLine(String s) {
    return String.join(" ", s.strip().split("\\s+"));
  }

  static String lit(String s) {
    StringBuilder out = new StringBuilder("\"");
    for (char c : s.toCharArray()) {
      switch (c) {
        case '"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        case '\n', '\r' -> out.append(' ');
        default -> out.append(c < 0x20 ? ' ' : c);
      }
    }
    return out.append('"').toString();
  }

  // ------------------------------------------------------------------ the class

  void rewrite() {
    for (Tree t : cu.getTypeDecls()) {
      if (t instanceof ClassTree c && c.getSimpleName().contentEquals("Solution")) solution(c);
    }
  }

  private void solution(ClassTree cls) {
    Map<String, Set<String>> fieldCalls = new HashMap<>();
    for (Tree m : cls.getMembers()) {
      if (m instanceof VariableTree v) fieldTypes.put(v.getName().toString(), typeText(v));
    }
    for (Tree m : cls.getMembers()) {
      if (m instanceof MethodTree method && method.getBody() != null) calls(method.getBody(), fieldCalls, null);
    }
    StringBuilder hints = new StringBuilder();
    for (Map.Entry<String, String> f : fieldTypes.entrySet()) {
      String h = hint(f.getValue(), fieldCalls.get(f.getKey()));
      if (h != null) hints.append(hints.length() > 0 ? ";" : "").append(f.getKey()).append('=').append(h);
    }
    memberHints = hints.toString();
    for (Tree m : cls.getMembers()) {
      if (m instanceof MethodTree method && method.getBody() != null && !method.getName().contentEquals("<init>")) method(method);
    }
  }

  /** What the declared type (and the calls on it) says that the value's class does not. */
  static String hint(String type, Set<String> calls) {
    String base = baseName(type);
    boolean stackUse = calls != null && !calls.isEmpty() && STACK_METHODS.containsAll(calls)
        && (calls.contains("push") || calls.contains("pop"));
    switch (base) {
      case "Queue", "AbstractQueue":
        return "queue";
      case "Deque", "ArrayDeque":
        return stackUse ? "stack" : "deque";
      case "LinkedList":
        return stackUse ? "stack" : "list";
      case "List", "AbstractList", "Collection":
        return "list";  // only a LinkedList reads it: an ArrayList is an array either way
      default:
        return null;
    }
  }

  static String baseName(String type) {
    String t = type.strip();
    int lt = t.indexOf('<');
    if (lt >= 0) t = t.substring(0, lt);
    int dot = t.lastIndexOf('.');
    return dot >= 0 ? t.substring(dot + 1) : t;
  }

  private String typeText(VariableTree v) {
    Tree type = v.getType();
    if (type == null || start(type) < 0) {  // `var`: the class it is initialized with
      if (v.getInitializer() instanceof NewClassTree n) return text(n.getIdentifier());
      return "var";
    }
    return text(type);
  }

  /** The method names called on each name (`stack.push`, `this.stack.push`) inside a tree, lambdas included. */
  private void calls(Tree tree, Map<String, Set<String>> out, Set<String> onlyNames) {
    new TreeScanner<Void, Void>() {
      @Override
      public Void visitMethodInvocation(MethodInvocationTree node, Void v) {
        if (node.getMethodSelect() instanceof MemberSelectTree ms) {
          String receiver = rootName(ms.getExpression());
          if (receiver != null && (onlyNames == null || onlyNames.contains(receiver))) {
            out.computeIfAbsent(receiver, k -> new HashSet<>()).add(ms.getIdentifier().toString());
          }
        }
        return super.visitMethodInvocation(node, v);
      }
    }.scan(tree, null);
  }

  /** `x` or `this.x`: the name; anything else: null. */
  static String rootName(ExpressionTree e) {
    if (e instanceof IdentifierTree id) return id.getName().toString();
    if (e instanceof MemberSelectTree ms && ms.getExpression() instanceof IdentifierTree id && id.getName().contentEquals("this")) {
      return ms.getIdentifier().toString();
    }
    return null;
  }

  // ------------------------------------------------------------------ methods

  private void method(MethodTree m) {
    scopes.clear();
    scopes.add(new ArrayList<>());
    for (VariableTree p : m.getParameters()) declare(p.getName().toString(), typeText(p));

    // Hints for locals, from their declared types and the calls made on them.
    Map<String, String> localTypes = new LinkedHashMap<>();
    new TreeScanner<Void, Void>() {
      @Override
      public Void visitVariable(VariableTree node, Void v) {
        localTypes.put(node.getName().toString(), typeText(node));
        return super.visitVariable(node, v);
      }

      @Override
      public Void visitLambdaExpression(LambdaExpressionTree node, Void v) {
        return null;
      }

      @Override
      public Void visitClass(ClassTree node, Void v) {
        return null;
      }
    }.scan(m, null);
    for (VariableTree p : m.getParameters()) localTypes.put(p.getName().toString(), typeText(p));
    Map<String, Set<String>> localCalls = new HashMap<>();
    calls(m.getBody(), localCalls, localTypes.keySet());
    StringBuilder hints = new StringBuilder();
    for (Map.Entry<String, String> l : localTypes.entrySet()) {
      String h = hint(l.getValue(), localCalls.get(l.getKey()));
      if (h != null) hints.append(hints.length() > 0 ? ";" : "").append(l.getKey()).append('=').append(h);
    }
    String indexPairs = indexes(m, localTypes);

    BlockTree body = m.getBody();
    int open = start(body) + 1;
    int close = end(body) - 1;
    String name = m.getName().toString();
    insert(open, OPEN_BRACE, 0, "lvtrace.Frame __f = " + T + "enter(" + lit(name) + ", " + lit(hints.toString()) + ", "
        + lit(indexPairs) + ", " + lit(memberHints) + "); try {");
    statements(body.getStatements());
    boolean isVoid = m.getReturnType() instanceof PrimitiveTypeTree p && p.getPrimitiveTypeKind() == javax.lang.model.type.TypeKind.VOID;
    if (isVoid) {
      // A void method that runs off its end returns there. javac rejects this when the end
      // cannot be reached (the body ends with a return or a loop that never ends): Build drops it.
      insert(close, CLOSE_BRACE - 2, piece(), " " + T + "retVoid(" + lineOf(close) + ", __f); ");
    }
    insert(close, CLOSE_BRACE - 1, 0, "} finally { __f.exit(); }");
  }

  /** The rewriter's index pairs (spec, Indexes): an integer local used as `c[i]`, `c[i ± k]`, `c.get(i)`, `c.charAt(i)`. */
  private String indexes(MethodTree m, Map<String, String> localTypes) {
    Map<String, Set<String>> pairs = new LinkedHashMap<>();
    new TreeScanner<Void, Void>() {
      void pair(ExpressionTree container, ExpressionTree index) {
        String c = rootName(container);
        String i = indexLocal(index);
        if (c == null || i == null || c.equals(i)) return;
        String it = localTypes.get(i);
        if (it == null || !Set.of("int", "long", "short", "byte", "Integer").contains(it.strip())) return;
        String ct = localTypes.containsKey(c) && !(container instanceof MemberSelectTree) ? localTypes.get(c) : fieldTypes.get(c);
        if (ct == null || !positional(ct)) return;
        pairs.computeIfAbsent(i, k -> new LinkedHashSet<>()).add(c);
      }

      @Override
      public Void visitArrayAccess(ArrayAccessTree node, Void v) {
        ExpressionTree a = node.getExpression();
        while (a instanceof ArrayAccessTree inner) a = inner.getExpression();
        pair(a, node.getIndex());
        return super.visitArrayAccess(node, v);
      }

      @Override
      public Void visitMethodInvocation(MethodInvocationTree node, Void v) {
        if (node.getMethodSelect() instanceof MemberSelectTree ms && node.getArguments().size() == 1) {
          String method = ms.getIdentifier().toString();
          if (method.equals("get") || method.equals("charAt")) pair(ms.getExpression(), node.getArguments().get(0));
        }
        return super.visitMethodInvocation(node, v);
      }

      @Override
      public Void visitLambdaExpression(LambdaExpressionTree node, Void v) {
        return null;
      }

      @Override
      public Void visitClass(ClassTree node, Void v) {
        return null;
      }
    }.scan(m.getBody(), null);
    StringBuilder out = new StringBuilder();
    for (Map.Entry<String, Set<String>> e : pairs.entrySet()) {
      out.append(out.length() > 0 ? ";" : "").append(e.getKey()).append(':').append(String.join(",", e.getValue()));
    }
    return out.toString();
  }

  /** `i`, `i + 1`, `i - k` with k a literal: the local; anything else: null. */
  static String indexLocal(ExpressionTree e) {
    while (e instanceof ParenthesizedTree p) e = p.getExpression();
    if (e instanceof IdentifierTree id) return id.getName().toString();
    if (e instanceof BinaryTree b && (b.getKind() == Tree.Kind.PLUS || b.getKind() == Tree.Kind.MINUS)
        && b.getLeftOperand() instanceof IdentifierTree id && b.getRightOperand() instanceof LiteralTree) {
      return id.getName().toString();
    }
    return null;
  }

  /** A type a position counts into: an array, a List, a String. */
  static boolean positional(String type) {
    String t = type.strip();
    if (t.endsWith("]")) return true;
    String base = baseName(t);
    return Set.of("List", "ArrayList", "String", "StringBuilder").contains(base);
  }

  static boolean keyed(String type) {
    return Set.of("Map", "HashMap", "TreeMap", "LinkedHashMap", "SortedMap", "NavigableMap").contains(baseName(type));
  }

  static boolean setType(String type) {
    return Set.of("Set", "HashSet", "TreeSet", "LinkedHashSet", "SortedSet", "NavigableSet").contains(baseName(type));
  }

  // ------------------------------------------------------------------ scopes

  private void declare(String name, String type) {
    scopes.get(scopes.size() - 1).add(new String[] {name, type});
  }

  private void push() {
    scopes.add(new ArrayList<>());
  }

  private void pop() {
    scopes.remove(scopes.size() - 1);
  }

  /** The declared type of a name: a local in scope, else a field of Solution. Null when unknown. */
  private String typeOf(ExpressionTree root) {
    String name = rootName(root);
    if (name == null) return null;
    if (root instanceof IdentifierTree) {
      for (int i = scopes.size() - 1; i >= 0; i--) {
        for (String[] v : scopes.get(i)) if (v[0].equals(name)) return v[1];
      }
    }
    return fieldTypes.get(name);
  }

  /** `, "x", x` for every local in scope, each its own piece (a local not yet assigned is dropped by Build). */
  private void vars(int pos, long order) {
    Set<String> seen = new HashSet<>();
    for (List<String[]> scope : scopes) {
      for (String[] v : scope) {
        if (seen.add(v[0])) insert(pos, order, piece(), ", " + lit(v[0]) + ", " + v[0]);
      }
    }
  }

  private long seq;  // statement-level inserts at one position keep the order they were made in: outer first

  /** A step before a statement. Returns the order just after it, for a store that must follow it. */
  private long record(int pos, int at) {
    long base = BEFORE + (seq++) * 8;
    insert(pos, base, 0, T + "record(" + at + ", __f");
    vars(pos, base + 1);
    insert(pos, base + 2, 0, "); ");
    return base + 3;
  }

  // ------------------------------------------------------------------ statements

  private void statements(List<? extends StatementTree> list) {
    for (StatementTree s : list) {
      statement(s, start(s));
      if (s instanceof VariableTree v) declare(v.getName().toString(), typeText(v));
    }
  }

  /** A loop's or an if's body: a block, or one statement given braces so a step and a store fit around it. */
  private void body(StatementTree s) {
    if (s == null) return;
    if (s instanceof BlockTree b) {
      push();
      statements(b.getStatements());
      pop();
      return;
    }
    insert(start(s), OPEN_BRACE, 0, "{ ");
    push();
    statement(s, start(s));
    pop();
    insert(end(s), CLOSE_BRACE, 0, " }");
  }

  private void statement(StatementTree s, int before) {
    int saved = line;
    line = lineOf(start(s));
    switch (s.getKind()) {
      case VARIABLE -> variable((VariableTree) s, before);
      case EXPRESSION_STATEMENT -> expressionStatement((ExpressionStatementTree) s, before);
      case IF -> {
        IfTree t = (IfTree) s;
        record(before, line);
        condition(t.getCondition(), line);
        body(t.getThenStatement());
        body(t.getElseStatement());
      }
      case WHILE_LOOP -> {
        WhileLoopTree t = (WhileLoopTree) s;
        loopHeader(t.getCondition(), line, t.getStatement());
        body(t.getStatement());
      }
      case DO_WHILE_LOOP -> {
        DoWhileLoopTree t = (DoWhileLoopTree) s;
        body(t.getStatement());
        int at = lineOf(start(t.getCondition()));
        int saved2 = line;
        line = at;
        if (!isTrue(t.getCondition())) {
          ExpressionTree inner = unparen(t.getCondition());
          int p = piece();
          int st = start(inner), en = end(inner);
          insert(st, -(long) (en - st) * 4 - 3, p, T + "at(" + at + ", __f");
          vars(st, -(long) (en - st) * 4 - 3);  // same order: kept in insertion order after the opening text
          insert(st, -(long) (en - st) * 4 - 2, p, ") && " + T + "cond(" + at + ", " + lit(oneLine(text(inner))) + ", (");
          insert(en, (long) (en - st) * 4 + 2, p, "))");
          expression(inner);
        }
        line = saved2;
      }
      case FOR_LOOP -> forLoop((ForLoopTree) s, before);
      case ENHANCED_FOR_LOOP -> {
        EnhancedForLoopTree t = (EnhancedForLoopTree) s;
        expression(t.getExpression());
        push();
        VariableTree v = t.getVariable();
        declare(v.getName().toString(), typeText(v));
        String header = oneLine(src.substring(start(v), end(t.getExpression())));
        StatementTree b = t.getStatement();
        int at = line;
        boolean block = b instanceof BlockTree;
        int pos = block ? start(b) + 1 : start(b);
        if (!block) insert(pos, OPEN_BRACE, 0, "{ ");
        long after = record(pos, at);
        insert(pos, after, piece(), T + "store(" + at + ", " + lit(header) + ", " + lit(v.getName().toString()) + ", "
            + v.getName() + "); ");
        if (block) {
          push();
          statements(((BlockTree) b).getStatements());
          pop();
        } else {
          push();
          statement(b, start(b));
          pop();
          insert(end(b), CLOSE_BRACE, 0, " }");
        }
        pop();
      }
      case RETURN -> {
        ReturnTree t = (ReturnTree) s;
        record(before, line);
        if (t.getExpression() == null) {
          insert(before, BEFORE + (seq++) * 8, 0, T + "retVoid(" + line + ", __f); ");
        } else {
          expression(t.getExpression());
          wrap(t.getExpression(), T + "ret(" + line + ", __f, ", ")");
        }
      }
      case BLOCK -> {
        push();
        statements(((BlockTree) s).getStatements());
        pop();
      }
      case LABELED_STATEMENT -> statement(((LabeledStatementTree) s).getStatement(), before);
      case SWITCH -> {
        SwitchTree t = (SwitchTree) s;
        record(before, line);
        expression(t.getExpression());
        push();
        for (CaseTree c : t.getCases()) {
          if (c.getBody() != null) {
            if (c.getBody() instanceof StatementTree st) body(st);
          } else if (c.getStatements() != null) {
            statements(c.getStatements());
          }
        }
        pop();
      }
      case TRY -> {
        TryTree t = (TryTree) s;
        push();
        for (Tree r : t.getResources()) {
          if (r instanceof VariableTree v) declare(v.getName().toString(), typeText(v));
        }
        body(t.getBlock());
        pop();
        for (CatchTree c : t.getCatches()) {
          push();
          declare(c.getParameter().getName().toString(), typeText(c.getParameter()));
          body(c.getBlock());
          pop();
        }
        if (t.getFinallyBlock() != null) body(t.getFinallyBlock());
      }
      case SYNCHRONIZED -> body(((SynchronizedTree) s).getBlock());
      case THROW -> {
        record(before, line);
        expression(((ThrowTree) s).getExpression());
      }
      case BREAK, CONTINUE, ASSERT, YIELD -> record(before, line);
      default -> {
        // a local class, an empty statement: nothing to record
      }
    }
    line = saved;
  }

  private void variable(VariableTree v, int before) {
    record(before, line);
    ExpressionTree init = v.getInitializer();
    if (init == null) return;
    expression(init);
    // `int a = 1, b = 2;` is two trees: each store goes after the declaration's semicolon.
    int semi = statementEnd(end(v));
    String code = oneLine(src.substring(start(v), end(init)));
    insert(semi, AFTER, piece(), " " + T + "store(" + line + ", " + lit(code) + ", " + lit(v.getName().toString()) + ", "
        + v.getName() + ");");
  }

  /** The position just after the `;` that ends the declaration containing `pos`. */
  private int statementEnd(int pos) {
    if (pos > 0 && src.charAt(pos - 1) == ';') return pos;
    int depth = 0;
    for (int i = pos; i < src.length(); i++) {
      char c = src.charAt(i);
      if (c == '(' || c == '{' || c == '[') depth++;
      else if (c == ')' || c == '}' || c == ']') depth--;
      else if (c == ';' && depth <= 0) return i + 1;
    }
    return pos;
  }

  private void expressionStatement(ExpressionStatementTree s, int before) {
    record(before, line);
    ExpressionTree e = s.getExpression();
    if (mapPut(s, e)) return;
    ExpressionTree target = storeTarget(e);
    if (target != null) {
      targetIndexes(target);
      if (e instanceof AssignmentTree a) expression(a.getExpression());
      if (e instanceof CompoundAssignmentTree a) expression(a.getExpression());
      if (pure(target)) {
        insert(end(s), AFTER, piece(), " " + T + "store(" + line + ", " + lit(oneLine(text(e))) + ", " + lit(oneLine(text(target)))
            + ", " + text(target) + ");");
      }
    } else {
      expression(e);
    }
  }

  /**
   * `m.put(k, v)` on a map: a store to `m[k]`, written as the C++ and Python traces write it, so a
   * line that fills a map says what it stored. The key must be pure: the value is read back as m.get(k).
   */
  private boolean mapPut(ExpressionStatementTree s, ExpressionTree e) {
    if (!(e instanceof MethodInvocationTree mi) || !(mi.getMethodSelect() instanceof MemberSelectTree ms)
        || !ms.getIdentifier().contentEquals("put") || mi.getArguments().size() != 2) {
      return false;
    }
    String name = rootName(ms.getExpression());
    String type = name == null ? null : typeOf(ms.getExpression());
    ExpressionTree key = mi.getArguments().get(0);
    if (type == null || !keyed(type) || !pure(key)) return false;
    expression(e);
    insert(end(s), AFTER, piece(), " " + T + "store(" + line + ", " + lit(oneLine(text(e))) + ", "
        + lit(name + "[" + oneLine(text(key)) + "]") + ", " + text(ms.getExpression()) + ".get(" + text(key) + "));");
    return true;
  }

  static ExpressionTree storeTarget(ExpressionTree e) {
    if (e instanceof AssignmentTree a) return a.getVariable();
    if (e instanceof CompoundAssignmentTree a) return a.getVariable();
    if (e instanceof UnaryTree u && switch (u.getKind()) {
      case PREFIX_INCREMENT, PREFIX_DECREMENT, POSTFIX_INCREMENT, POSTFIX_DECREMENT -> true;
      default -> false;
    }) {
      return u.getExpression();
    }
    return null;
  }

  /** Reads inside a store's target: the cell stored to is not a read, the positions it names may be. */
  private void targetIndexes(ExpressionTree target) {
    ExpressionTree t = target;
    while (t instanceof ArrayAccessTree a) {
      expression(a.getIndex());
      t = a.getExpression();
    }
  }

  /** Can be evaluated again with no effect: names, literals, fields, cells, and arithmetic of those. */
  static boolean pure(ExpressionTree e) {
    if (e instanceof IdentifierTree || e instanceof LiteralTree) return true;
    if (e instanceof ParenthesizedTree p) return pure(p.getExpression());
    if (e instanceof MemberSelectTree m) return pure(m.getExpression());
    if (e instanceof ArrayAccessTree a) return pure(a.getExpression()) && pure(a.getIndex());
    if (e instanceof BinaryTree b) return pure(b.getLeftOperand()) && pure(b.getRightOperand());
    if (e instanceof TypeCastTree c) return pure(c.getExpression());
    if (e instanceof UnaryTree u) {
      return switch (u.getKind()) {
        case UNARY_MINUS, UNARY_PLUS, LOGICAL_COMPLEMENT, BITWISE_COMPLEMENT -> pure(u.getExpression());
        default -> false;
      };
    }
    return false;
  }

  static ExpressionTree unparen(ExpressionTree e) {
    while (e instanceof ParenthesizedTree p) e = p.getExpression();
    return e;
  }

  static boolean isTrue(ExpressionTree e) {
    return unparen(e) instanceof LiteralTree l && Boolean.TRUE.equals(l.getValue());
  }

  /** An if's condition: its outcome on the statement's step. */
  private void condition(ExpressionTree c, int at) {
    ExpressionTree inner = unparen(c);
    expression(inner);
    wrap(inner, T + "cond(" + at + ", " + lit(oneLine(text(inner))) + ", (", "))");
  }

  /**
   * A while's header: a step at each check, then the condition's outcome. `while (true)` keeps
   * its constant (javac's reachability depends on it), so its step goes at the start of the body.
   */
  private void loopHeader(ExpressionTree c, int at, StatementTree body) {
    ExpressionTree inner = unparen(c);
    if (isTrue(inner)) {
      stepAtBodyStart(body, at);
      return;
    }
    expression(inner);
    int st = start(inner), en = end(inner);
    long open = -(long) (en - st) * 4 - 3;
    int p = piece();
    insert(st, open, p, T + "at(" + at + ", __f");
    for (Insert in : varInserts(st, open)) inserts.add(in);
    insert(st, open + 1, p, ") && " + T + "cond(" + at + ", " + lit(oneLine(text(inner))) + ", (");
    insert(en, (long) (en - st) * 4 + 2, p, "))");
  }

  private List<Insert> varInserts(int pos, long order) {
    List<Insert> out = new ArrayList<>();
    Set<String> seen = new HashSet<>();
    for (List<String[]> scope : scopes) {
      for (String[] v : scope) {
        if (seen.add(v[0])) out.add(new Insert(pos, order, piece(), ", " + lit(v[0]) + ", " + v[0]));
      }
    }
    return out;
  }

  private void stepAtBodyStart(StatementTree body, int at) {
    if (body instanceof BlockTree b) record(start(b) + 1, at);
    // a one-statement body of `while (true)`: no step for the header
  }

  private void forLoop(ForLoopTree t, int before) {
    // The header's first step comes before the initializer runs, as C++ takes it.
    long base = BEFORE + (seq++) * 8;
    insert(before, base, 0, T + "head(" + line + ", __f");
    vars(before, base + 1);
    insert(before, base + 2, 0, "); ");
    push();
    int at = line;
    for (StatementTree init : t.getInitializer()) {
      if (init instanceof VariableTree v) {
        if (v.getInitializer() != null) {
          expression(v.getInitializer());
          String code = oneLine(src.substring(start(v), end(v.getInitializer())));
          wrap(v.getInitializer(), T + "init(" + at + ", " + lit(code) + ", " + lit(v.getName().toString()) + ", ", ")");
        }
        declare(v.getName().toString(), typeText(v));
      } else if (init instanceof ExpressionStatementTree es && es.getExpression() instanceof AssignmentTree a && pure(a.getVariable())) {
        expression(a.getExpression());
        wrap(a.getExpression(), T + "init(" + at + ", " + lit(oneLine(text(a))) + ", " + lit(oneLine(text(a.getVariable()))) + ", ", ")");
      }
    }
    if (t.getCondition() != null && !isTrue(t.getCondition())) {
      loopHeader(t.getCondition(), at, t.getStatement());
    } else {
      // No condition to wrap: the step before the init, and one before each update, are the header's.
    }
    if (!t.getUpdate().isEmpty()) {
      // Each later check's step: first in the update list, before the update runs.
      ExpressionStatementTree first = t.getUpdate().get(0);
      int p = start(first);
      long order = -(1L << 40) - (seq++) * 8;
      insert(p, order, 0, T + "head(" + at + ", __f");
      vars(p, order + 1);
      insert(p, order + 2, 0, "), ");
    }
    for (ExpressionStatementTree u : t.getUpdate()) {
      ExpressionTree target = storeTarget(u.getExpression());
      if (target != null && pure(target)) {
        insert(end(u), AFTER, piece(), ", " + T + "pend(" + at + ", " + lit(oneLine(text(u.getExpression()))) + ", "
            + lit(oneLine(text(target))) + ", " + text(target) + ")");
      }
    }
    body(t.getStatement());
    pop();
  }

  // ------------------------------------------------------------------ expressions: reads and conditions

  private void expression(ExpressionTree e) {
    if (e == null) return;
    new TreeScanner<Void, Void>() {
      @Override
      public Void visitArrayAccess(ArrayAccessTree node, Void v) {
        read(node);
        return null;
      }

      @Override
      public Void visitMethodInvocation(MethodInvocationTree node, Void v) {
        if (!methodRead(node)) super.visitMethodInvocation(node, v);
        return null;
      }

      @Override
      public Void visitConditionalExpression(ConditionalExpressionTree node, Void v) {
        ExpressionTree c = unparen(node.getCondition());
        scan(c, null);
        wrap(c, T + "cond(" + line + ", " + lit(oneLine(text(c))) + ", (", "))");
        scan(node.getTrueExpression(), null);
        scan(node.getFalseExpression(), null);
        return null;
      }

      @Override
      public Void visitAssignment(AssignmentTree node, Void v) {
        // an assignment inside an expression: its target is not read
        ExpressionTree t = node.getVariable();
        while (t instanceof ArrayAccessTree a) {
          scan(a.getIndex(), null);
          t = a.getExpression();
        }
        scan(node.getExpression(), null);
        return null;
      }

      @Override
      public Void visitLambdaExpression(LambdaExpressionTree node, Void v) {
        return null;  // not instrumented (docs/adapters/java.md §9)
      }

      @Override
      public Void visitClass(ClassTree node, Void v) {
        return null;
      }

      @Override
      public Void visitSwitchExpression(SwitchExpressionTree node, Void v) {
        scan(node.getExpression(), null);
        return null;
      }

      /** `a[i][j]`: the outer indexes are kept (ix0), the last one records the read (ixN). */
      void read(ArrayAccessTree node) {
        List<ExpressionTree> indexes = new ArrayList<>();
        ExpressionTree root = node;
        while (root instanceof ArrayAccessTree a) {
          indexes.add(0, a.getIndex());
          root = a.getExpression();
        }
        for (ExpressionTree i : indexes) scan(i, null);
        String name = rootName(root);
        String type = typeOf(root);
        if (name == null || type == null || !positional(type)) {
          scan(root, null);
          return;
        }
        chain(node, root, name, indexes);
      }

      /** `s.charAt(i)`, `list.get(i)`, `grid.get(i).get(j)`, and the key reads `m.get(k)`, `m.containsKey(k)`, `set.contains(k)`. */
      boolean methodRead(MethodInvocationTree node) {
        if (!(node.getMethodSelect() instanceof MemberSelectTree ms) || node.getArguments().isEmpty()) return false;
        String method = ms.getIdentifier().toString();
        ExpressionTree receiver = ms.getExpression();
        String name = rootName(receiver);
        String type = name == null ? null : typeOf(receiver);
        ExpressionTree first = node.getArguments().get(0);
        if (type != null && (keyed(type) && Set.of("get", "containsKey", "getOrDefault").contains(method)
            || setType(type) && method.equals("contains"))) {
          for (ExpressionTree a : node.getArguments()) scan(a, null);
          wrap(first, T + "key(" + line + ", " + lit(oneLine(text(node))) + ", " + lit(name) + ", " + text(receiver) + ", ", ")");
          return true;
        }
        if ((method.equals("get") || method.equals("charAt")) && node.getArguments().size() == 1) {
          List<ExpressionTree> indexes = new ArrayList<>();
          ExpressionTree root = node;
          while (root instanceof MethodInvocationTree mi && mi.getMethodSelect() instanceof MemberSelectTree s2
              && mi.getArguments().size() == 1 && (s2.getIdentifier().contentEquals("get") || s2.getIdentifier().contentEquals("charAt"))) {
            indexes.add(0, mi.getArguments().get(0));
            root = s2.getExpression();
          }
          String rootName = rootName(root);
          String rootType = rootName == null ? null : typeOf(root);
          if (rootType == null || !positional(rootType)) return false;
          for (ExpressionTree i : indexes) scan(i, null);
          chain(node, root, rootName, indexes);
          return true;
        }
        return false;
      }
    }.scan(e, null);
  }

  private void chain(ExpressionTree whole, ExpressionTree root, String name, List<ExpressionTree> indexes) {
    String code = lit(oneLine(text(whole)));
    for (int k = 0; k < indexes.size(); k++) {
      ExpressionTree i = indexes.get(k);
      if (k < indexes.size() - 1) {
        wrap(i, T + "ix0(", ")");
      } else {
        wrap(i, T + "ixN(" + line + ", " + code + ", " + lit(name) + ", " + text(root) + ", " + indexes.size() + ", ", ")");
      }
    }
  }
}
