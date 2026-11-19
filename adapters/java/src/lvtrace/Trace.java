package lvtrace;

import java.io.IOException;
import java.io.PrintStream;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The Java runtime: records steps, frames, outcomes, and members, and writes the trace
 * (docs/trace-format.md, v0.14; docs/adapters/java.md).
 *
 * <p>The rewriter (Rewriter.java) inserts calls to the public methods below into the user's
 * Solution, on the user's own lines, and the driver's generated {@code LvMain} calls
 * {@link #begin}, {@link #start}, and {@link #finish}. Every public method guards itself: an
 * error in the tracer ends the run with exit status 3 (a bug in the adapter), never as an
 * exception the user's code could catch.
 */
public final class Trace {
  static final String VERSION = "0.14";
  static final int MAX_STEPS = 2000;
  static final int MAX_READS = 16;
  static final int EXIT_USER = 1;
  static final int EXIT_ADAPTER = 3;
  static final String RECURSION_HINT = "Java ran out of stack space for nested calls. The example may be too deep for "
      + "recursion, or the recursion may never reach its base case.";

  private static String problem = "{}";
  private static Object solution;
  private static final List<Frame> stack = new ArrayList<>();
  private static final List<Step> steps = new ArrayList<>();
  private static final Map<String, Map<String, List<String>>> indexes = new LinkedHashMap<>();
  private static final IdentityHashMap<Object, String> objectIds = new IdentityHashMap<>();
  private static final IdentityHashMap<Object, String> containerIds = new IdentityHashMap<>();
  private static final ArrayDeque<Integer> indexStack = new ArrayDeque<>();  // outer indexes of a read in progress
  private static Map<String, String> memberHints = Map.of();
  private static List<Field> memberFields;
  private static int nextFrame = 1;

  private Trace() {}

  // ------------------------------------------------------------------ the run

  /** Reads the problem object the driver wrote (problem.json, next to the program). */
  public static void begin() {
    try {
      problem = Files.readString(Path.of("problem.json"), StandardCharsets.UTF_8).strip();
    } catch (IOException | RuntimeException e) {
      internal(e);
    }
  }

  public static void start(Object theSolution) {
    solution = theSolution;
  }

  static Class<?> solutionClass() {
    return solution == null ? null : solution.getClass();
  }

  public static void finish(Object answer) {
    try {
      write(false, true, answer);
    } catch (Throwable e) {
      guard(e);
    }
  }

  public static void finishVoid() {
    finish(null);
  }

  /** The user's code threw: what it threw, with the user's frames only, then exit 1. */
  public static void failed(Throwable t) {
    PrintStream err = System.err;
    System.out.flush();
    if (t instanceof StackOverflowError) {
      err.println("java.lang.StackOverflowError");
      err.println(RECURSION_HINT);
    } else if (t instanceof TraceError) {
      err.println(t.getMessage());
    } else {
      err.println("Exception in thread \"main\" " + t);
      for (StackTraceElement e : t.getStackTrace()) {
        if ("Solution.java".equals(e.getFileName())) err.println("\tat " + e);
      }
    }
    halt(EXIT_USER);
  }

  // ------------------------------------------------------------------ frames

  /**
   * A call begins. hints: "q=queue;st=stack" for locals whose declared type or use says more
   * than their class; indexes: "i:nums,dp;j:dp", the rewriter's index pairs for this function;
   * members: the same hints for the Solution's fields.
   */
  public static Frame enter(String function, String hints, String indexPairs, String members) {
    try {
      Frame f = new Frame("f" + nextFrame++, function, Frame.parseHints(hints));
      if (memberHints.isEmpty() && !members.isEmpty()) memberHints = Frame.parseHints(members);
      if (!indexPairs.isEmpty()) {
        Map<String, List<String>> forFunction = indexes.computeIfAbsent(function, k -> new LinkedHashMap<>());
        for (String pair : indexPairs.split(";")) {
          int colon = pair.indexOf(':');
          List<String> containers = forFunction.computeIfAbsent(pair.substring(0, colon), k -> new ArrayList<>());
          for (String c : pair.substring(colon + 1).split(",")) {
            if (!containers.contains(c)) containers.add(c);
          }
        }
      }
      stack.add(f);
      return f;
    } catch (Throwable e) {
      guard(e);
      return null;
    }
  }

  static void leave(Frame f) {
    int i = stack.lastIndexOf(f);
    if (i >= 0) stack.subList(i, stack.size()).clear();  // a call that ended by an exception has no return step (spec §6)
  }

  // ------------------------------------------------------------------ steps

  /** A step before a statement: the running frame's locals, given as name, value, name, value, ... */
  public static void record(int line, Frame f, Object... vars) {
    try {
      f.headerTaken = false;
      f.vars = vars;
      take(f, line, false, null);
    } catch (Throwable e) {
      guard(e);
    }
  }

  /** A loop header's step, before its condition is checked: `while (at(...) && cond(...))`. Always true. */
  public static boolean at(int line, Frame f, Object... vars) {
    if (f.headerTaken) {  // a for loop's step was taken before its init or update ran: only the outcomes are left
      f.headerTaken = false;
      return true;
    }
    record(line, f, vars);
    return true;
  }

  /**
   * A for loop's header step, taken before its initializer (in front of the loop) and before
   * each update (first in the update list), so the step shows the locals before the line runs, as
   * in C++. The stores of the init or update and the condition go on it.
   */
  public static void head(int line, Frame f, Object... vars) {
    record(line, f, vars);
    f.headerTaken = true;
  }

  public static void retVoid(int line, Frame f) {
    try {
      take(f, line, true, null);
      f.returned = true;
    } catch (Throwable e) {
      guard(e);
    }
  }

  private static <T> T returning(int line, Frame f, T value) {
    try {
      take(f, line, true, value);
      f.returned = true;
    } catch (Throwable e) {
      guard(e);
    }
    return value;
  }

  // One per primitive, so `return c;` in an int method still converts as the user's code did.
  public static int ret(int line, Frame f, int v) { returning(line, f, v); return v; }
  public static long ret(int line, Frame f, long v) { returning(line, f, v); return v; }
  public static double ret(int line, Frame f, double v) { returning(line, f, v); return v; }
  public static float ret(int line, Frame f, float v) { returning(line, f, v); return v; }
  public static char ret(int line, Frame f, char v) { returning(line, f, v); return v; }
  public static boolean ret(int line, Frame f, boolean v) { returning(line, f, v); return v; }
  public static short ret(int line, Frame f, short v) { returning(line, f, v); return v; }
  public static byte ret(int line, Frame f, byte v) { returning(line, f, v); return v; }
  public static <T> T ret(int line, Frame f, T v) { return returning(line, f, v); }

  private static void take(Frame top, int line, boolean isReturn, Object value) {
    if (steps.size() >= MAX_STEPS) cap();
    Step step = new Step(steps.size());
    Snapshot snap = new Snapshot(step.heap);
    List<Object[]> roots = new ArrayList<>();
    for (Frame f : stack) {
      for (int i = 0; i + 1 < f.vars.length; i += 2) roots.add(new Object[] {f.vars[i + 1], f.hints.get((String) f.vars[i])});
    }
    if (isReturn) roots.add(new Object[] {value, null});
    List<Object[]> members = members();
    for (Object[] m : members) roots.add(new Object[] {m[1], memberHints.get((String) m[0])});
    snap.count(roots);

    for (Frame f : stack) {
      boolean isTop = f == top;
      StringBuilder out = new StringBuilder("{\"id\": ").append(Json.string(f.id))
          .append(", \"function\": ").append(Json.string(f.function))
          .append(", \"line\": ").append(isTop ? line : f.line)
          .append(", \"locals\": {");
      boolean first = true;
      for (int i = 0; i + 1 < f.vars.length; i += 2) {
        String name = (String) f.vars[i];
        String hint = f.hints.get(name);
        Object written = snap.value(f.vars[i + 1], hint, true);
        if (written == Snapshot.OMIT) continue;
        if (!first) out.append(", ");
        first = false;
        out.append(Json.string(name)).append(": ").append(written);
        if (isTop) step.topKinds.put(name, kindName(f.vars[i + 1], hint));
      }
      out.append('}');
      if (isTop) {
        if (isReturn) {
          Object rv = snap.value(value, null, true);
          out.append(", \"return_value\": ").append(rv == Snapshot.OMIT ? "null" : rv);
        }
        step.topFrame = out.toString();
      } else {
        step.lowerFrames.add(out.append('}').toString());
      }
    }
    if (!members.isEmpty()) {
      StringBuilder out = new StringBuilder("{");
      for (Object[] m : members) {
        String name = (String) m[0];
        Object written = snap.value(m[1], memberHints.get(name), true);
        if (written == Snapshot.OMIT) continue;
        if (out.length() > 1) out.append(", ");
        out.append(Json.string(name)).append(": ").append(written);
        step.memberKinds.put(name, kindName(m[1], memberHints.get(name)));
      }
      if (out.length() > 1) step.members = out.append('}').toString();
    }
    steps.add(step);
    top.lastStep = isReturn ? null : step;
    top.line = line;
    top.reads = 0;
    indexStack.clear();
  }

  private static String kindName(Object v, String hint) {
    String kind = Snapshot.kind(v, hint);
    if ("plain".equals(kind) && (v instanceof CharSequence)) return "string";
    return kind;
  }

  /** The Solution's mutable fields: everything but constants (static final, or final primitives and strings). */
  private static List<Object[]> members() {
    List<Object[]> out = new ArrayList<>();
    if (solution == null) return out;
    if (memberFields == null) {
      memberFields = new ArrayList<>();
      for (Field f : solution.getClass().getDeclaredFields()) {
        int m = f.getModifiers();
        boolean constant = Modifier.isFinal(m) && (Modifier.isStatic(m) || f.getType().isPrimitive()
            || f.getType() == String.class || Number.class.isAssignableFrom(f.getType()) || f.getType() == Boolean.class
            || f.getType() == Character.class);
        if (constant || f.isSynthetic()) continue;
        try {
          f.setAccessible(true);
          memberFields.add(f);
        } catch (RuntimeException e) {
          // not readable: left out
        }
      }
    }
    for (Field f : memberFields) {
      try {
        out.add(new Object[] {f.getName(), f.get(Modifier.isStatic(f.getModifiers()) ? null : solution)});
      } catch (ReflectiveOperationException e) {
        // left out
      }
    }
    return out;
  }

  private static void cap() {
    write(true, false, null);
    halt(0);
  }

  // ------------------------------------------------------------------ outcomes

  private static Frame outcomeFrame(int line) {
    if (stack.isEmpty()) return null;
    Frame f = stack.get(stack.size() - 1);
    return f.lastStep != null && f.line == line ? f : null;
  }

  private static String outcomeValue(Frame f, Object v) {
    Object written = new Snapshot(f.lastStep.heap).value(v, null, false);
    return written == Snapshot.OMIT ? null : (String) written;
  }

  public static boolean cond(int line, String code, boolean v) {
    try {
      Frame f = outcomeFrame(line);
      if (f != null) {
        f.lastStep.outcomes.add("{\"kind\": \"condition\", \"code\": " + Json.string(code) + ", \"value\": " + v + "}");
      }
    } catch (Throwable e) {
      guard(e);
    }
    return v;
  }

  public static void store(int line, String code, String target, Object v) {
    try {
      Frame f = outcomeFrame(line);
      if (f == null) return;
      Object w = new Snapshot(f.lastStep.heap).value(v, hintFor(f, target), false);
      String written = w == Snapshot.OMIT ? null : (String) w;
      if (written != null) f.lastStep.outcomes.add(storeJson(code, target, written));
    } catch (Throwable e) {
      guard(e);
    }
  }

  private static String storeJson(String code, String target, String value) {
    return "{\"kind\": \"store\", \"code\": " + Json.string(code) + ", \"target\": " + Json.string(target) + ", \"value\": " + value + "}";
  }

  /** A for loop's initializer (`int i = init(...)`): a store on the header's step, taken just before (head). */
  public static <T> T init(int line, String code, String target, T v) {
    store(line, code, target, v);
    return v;
  }

  /** A for loop's update (`head(...), i++, pend(...)`): a store on the header's step. */
  public static void pend(int line, String code, String target, Object v) {
    store(line, code, target, v);
  }

  /** An outer index of `a[i][j]`, kept until the read's last index arrives. */
  public static int ix0(int i) {
    indexStack.push(i);
    return i;
  }

  /**
   * The last index of `target[...][i]` (or `s.charAt(i)`, `list.get(i)`), `depth` indexes in all:
   * records a read of the cell, and returns i so the user's code reads it as written.
   */
  public static int ixN(int line, String code, String target, Object container, int depth, int i) {
    List<Integer> at = new ArrayList<>();
    for (int k = 1; k < depth && !indexStack.isEmpty(); k++) at.add(0, indexStack.pop());
    at.add(i);
    try {
      readAt(line, code, target, container, at);
    } catch (StackOverflowError e) {
      throw e;
    } catch (Throwable e) {
      // the read is not recorded; the user's own expression runs as written
    }
    return i;
  }

  private static void readAt(int line, String code, String target, Object container, List<Integer> at) {
    Frame f = outcomeFrame(line);
    if (f == null || f.reads >= MAX_READS) return;
    String kind = targetKind(f, target);
    if (!"array".equals(kind) && !"string".equals(kind)) return;
    Object c = container;
    for (int depth = 0; depth < at.size(); depth++) {
      int k = at.get(depth);
      if (c == null || k < 0) return;
      if (c.getClass().isArray()) c = Array.get(c, k);
      else if (c instanceof List) c = ((List<?>) c).get(k);
      else if (c instanceof CharSequence && depth == at.size() - 1) c = ((CharSequence) c).charAt(k);
      else return;
    }
    String value = outcomeValue(f, c);
    if (value == null) return;
    StringBuilder json = new StringBuilder("{\"kind\": \"read\", \"code\": ").append(Json.string(code))
        .append(", \"target\": ").append(Json.string(target)).append(", \"at\": [");
    for (int k = 0; k < at.size(); k++) json.append(k > 0 ? ", " : "").append(at.get(k));
    f.lastStep.outcomes.add(json.append("], \"value\": ").append(value).append('}').toString());
    f.reads++;
  }

  /** A key of `target.get(k)`, `containsKey(k)`, `contains(k)`, `getOrDefault(k, d)`: a read when present. */
  public static <K> K key(int line, String code, String target, Object container, K k) {
    try {
      Frame f = outcomeFrame(line);
      if (f == null || f.reads >= MAX_READS) return k;
      String kind = targetKind(f, target);
      Object value;
      if ("map".equals(kind) && container instanceof Map && ((Map<?, ?>) container).containsKey(k)) {
        value = ((Map<?, ?>) container).get(k);
      } else if ("set".equals(kind) && container instanceof Set && ((Set<?>) container).contains(k)) {
        value = k;
      } else {
        return k;
      }
      String keyJson = outcomeValue(f, k);
      String valueJson = outcomeValue(f, value);
      if (keyJson == null || valueJson == null) return k;
      f.lastStep.outcomes.add("{\"kind\": \"read\", \"code\": " + Json.string(code) + ", \"target\": " + Json.string(target)
          + ", \"key\": " + keyJson + ", \"value\": " + valueJson + "}");
      f.reads++;
    } catch (StackOverflowError e) {
      throw e;
    } catch (Throwable e) {
      // a key whose hashCode or compareTo throws: the user's own call will throw it
    }
    return k;
  }

  /** What a store's target's declared type says: a local's hint, else a member's. */
  private static String hintFor(Frame f, String target) {
    String h = f.hints.get(target);
    if (h != null) return h;
    String name = target.startsWith("this.") ? target.substring(5) : target;
    return memberHints.get(name);
  }

  /** The kind the step wrote for a read's target: a local of the frame, or a member no local hides. */
  private static String targetKind(Frame f, String target) {
    String kind = f.lastStep.topKinds.get(target);
    if (kind != null) return kind;
    for (int i = 0; i < f.vars.length; i += 2) {
      if (target.equals(f.vars[i])) return null;  // a local hides the member, though the step left it out
    }
    return f.lastStep.memberKinds.get(target);
  }

  // ------------------------------------------------------------------ ids

  static String objectId(Object v) {
    return objectIds.computeIfAbsent(v, k -> "n" + (objectIds.size() + 1));
  }

  static String containerId(Object v) {
    return containerIds.computeIfAbsent(v, k -> "c" + (containerIds.size() + 1));
  }

  // ------------------------------------------------------------------ the document

  private static void write(boolean truncated, boolean returned, Object result) {
    StringBuilder out = new StringBuilder(1 << 16);
    out.append("{\"version\": \"").append(VERSION).append("\", \"language\": \"java\", \"problem\": ").append(problem);
    if (!indexes.isEmpty()) {
      out.append(", \"indexes\": {");
      boolean firstF = true;
      for (Map.Entry<String, Map<String, List<String>>> fn : indexes.entrySet()) {
        out.append(firstF ? "" : ", ").append(Json.string(fn.getKey())).append(": {");
        firstF = false;
        boolean firstL = true;
        for (Map.Entry<String, List<String>> local : fn.getValue().entrySet()) {
          out.append(firstL ? "" : ", ").append(Json.string(local.getKey())).append(": [");
          firstL = false;
          for (int i = 0; i < local.getValue().size(); i++) out.append(i > 0 ? ", " : "").append(Json.string(local.getValue().get(i)));
          out.append(']');
        }
        out.append('}');
      }
      out.append('}');
    }
    out.append(", \"steps\": [");
    for (int i = 0; i < steps.size(); i++) {
      if (i > 0) out.append(", ");
      steps.get(i).json(out);
    }
    out.append(']');
    if (returned) {
      Map<String, String> heap = new LinkedHashMap<>();
      Snapshot snap = new Snapshot(heap);
      List<Object[]> roots = new ArrayList<>();
      roots.add(new Object[] {result, null});
      snap.count(roots);
      Object written = snap.value(result, null, true);
      out.append(", \"result\": ").append(written == Snapshot.OMIT ? "null" : written);
      if (!heap.isEmpty()) {
        out.append(", \"result_heap\": {");
        boolean first = true;
        for (Map.Entry<String, String> e : heap.entrySet()) {
          out.append(first ? "" : ", ").append(Json.string(e.getKey())).append(": ").append(e.getValue());
          first = false;
        }
        out.append('}');
      }
    }
    if (truncated) out.append(", \"truncated\": true");
    out.append('}');
    String path = System.getenv().getOrDefault("TRACE_OUT", "trace.json");
    try {
      Files.writeString(Path.of(path), out, StandardCharsets.UTF_8);
    } catch (IOException e) {
      throw new IllegalStateException("cannot write the trace to " + path + ": " + e.getMessage());
    }
  }

  // ------------------------------------------------------------------ failures

  private static void guard(Throwable e) {
    if (e instanceof TraceError) {
      System.out.flush();
      System.err.println(e.getMessage());
      halt(EXIT_USER);
    }
    if (e instanceof StackOverflowError) {
      failed(e);  // the user's calls left the tracer no room: the same limit their code would reach
    }
    if (e instanceof OutOfMemoryError) {
      System.out.flush();
      System.err.println("java.lang.OutOfMemoryError: the program used more memory than it may.");
      halt(EXIT_USER);
    }
    internal(e);
  }

  private static void internal(Throwable e) {
    System.out.flush();
    System.err.println("Internal error in the Java tracer: " + e);
    for (StackTraceElement s : e.getStackTrace()) System.err.println("\tat " + s);
    halt(EXIT_ADAPTER);
  }

  static void halt(int status) {
    System.out.flush();
    System.err.flush();
    Runtime.getRuntime().halt(status);
  }
}
