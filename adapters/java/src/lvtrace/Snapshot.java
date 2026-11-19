package lvtrace;

import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Deque;
import java.util.IdentityHashMap;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.PriorityQueue;
import java.util.Queue;
import java.util.Set;
import java.util.Stack;

/**
 * One step's (or one outcome's, or the result's) normalization: Java values to the trace's
 * kinds (docs/adapters/java.md §3), its heap, and which containers are reached from more than
 * one place (spec, Shared containers).
 *
 * <p>A value's kind comes from its class, except where the declared type or the code's use says
 * more: a {@code LinkedList} or {@code ArrayDeque} declared as a {@code Queue} is a queue, a
 * {@code Deque} the code uses only through push, pop, and peek is a stack. Those hints come from
 * the rewriter, for a frame's own locals and the Solution's members.
 */
final class Snapshot {
  static final Object OMIT = new Object();

  final Map<String, String> heap;
  IdentityHashMap<Object, Integer> counts;         // container -> places in the step; null: write no ids
  private final IdentityHashMap<Object, Boolean> showable = new IdentityHashMap<>();
  private final ArrayDeque<Object[]> pending = new ArrayDeque<>();  // {object, StringBuilder of its fields}
  private boolean draining;

  Snapshot(Map<String, String> heap) {
    this.heap = heap;
  }

  // ---- kinds

  /** Booleans, the boxed numbers, chars, and strings (a StringBuilder is the string it is building). */
  static boolean plain(Object v) {
    return v == null || v instanceof Boolean || v instanceof Integer || v instanceof Long || v instanceof Short
        || v instanceof Byte || v instanceof Double || v instanceof Float || v instanceof Character
        || v instanceof String || v instanceof StringBuilder || v instanceof StringBuffer;
  }

  static String kind(Object v, String hint) {
    if (plain(v)) return "plain";
    if (v.getClass().isArray()) return "array";
    if (v instanceof Stack) return "stack";
    if (v instanceof PriorityQueue) return "priority-queue";
    if (v instanceof Deque) {
      if ("stack".equals(hint)) return "stack";
      if ("queue".equals(hint)) return "queue";
      if ("list".equals(hint) || hint == null && v instanceof LinkedList) return "list";
      return "deque";
    }
    if (v instanceof List) return "array";
    if (v instanceof Queue) return "queue";
    if (v instanceof Map) return "map";
    if (v instanceof Set) return "set";
    if (userObject(v)) return "object";
    return null;
  }

  /** An instance of a class from the user's file or the driver's node classes: the unnamed package. */
  static boolean userObject(Object v) {
    Class<?> c = v.getClass();
    return c.getPackageName().isEmpty() && !c.isEnum() && !c.isAnonymousClass() && !c.isSynthetic()
        && !c.getName().contains("$$Lambda") && c != Trace.solutionClass() && !c.getName().equals("LvMain");
  }

  static List<Object> children(Object v, String kind) {
    switch (kind) {
      case "array":
        if (v.getClass().isArray()) {
          int n = Array.getLength(v);
          List<Object> out = new ArrayList<>(n);
          for (int i = 0; i < n; i++) out.add(Array.get(v, i));
          return out;
        }
        return new ArrayList<>((Collection<?>) v);
      case "list": case "queue": case "deque": case "set": case "priority-queue":
        return new ArrayList<>((Collection<?>) v);
      case "stack":
        if (v instanceof Stack) return new ArrayList<>((Stack<?>) v);
        List<Object> out = new ArrayList<>((Collection<?>) v);  // a Deque: its head is the top
        Collections.reverse(out);
        return out;
      case "map":
        List<Object> kv = new ArrayList<>();
        for (Map.Entry<?, ?> e : ((Map<?, ?>) v).entrySet()) {
          kv.add(e.getKey());
          kv.add(e.getValue());
        }
        return kv;
      default:
        return List.of();
    }
  }

  static List<Object[]> fields(Object obj) {
    List<Object[]> out = new ArrayList<>();
    List<Class<?>> chain = new ArrayList<>();
    for (Class<?> c = obj.getClass(); c != null && c != Object.class; c = c.getSuperclass()) chain.add(0, c);
    for (Class<?> c : chain) {
      for (Field f : c.getDeclaredFields()) {
        if (Modifier.isStatic(f.getModifiers()) || f.isSynthetic()) continue;
        try {
          f.setAccessible(true);
          out.add(new Object[] {f.getName(), f.get(obj)});
        } catch (ReflectiveOperationException | RuntimeException e) {
          // not readable: left out, as a field with no kind is
        }
      }
    }
    return out;
  }

  boolean canShow(Object v) {
    return canShow(v, null, Collections.newSetFromMap(new IdentityHashMap<>()));
  }

  boolean canShow(Object v, String hint, Set<Object> path) {
    String kind = kind(v, hint);
    if (kind == null) return false;
    if (kind.equals("plain") || kind.equals("object")) return true;
    Boolean known = showable.get(v);
    if (known != null) return known;
    if (!path.add(v)) return true;  // a cycle: count() reports it
    boolean ok = true;
    for (Object c : children(v, kind)) {
      if (!canShow(c, null, path)) {
        ok = false;
        break;
      }
    }
    path.remove(v);
    showable.put(v, ok);
    return ok;
  }

  // ---- shared containers

  /** Counts the places each container is reached from: every place a value is written, and an object's fields once. */
  void count(List<Object[]> roots) {
    counts = new IdentityHashMap<>();
    Set<Object> seen = Collections.newSetFromMap(new IdentityHashMap<>());
    ArrayDeque<Object> objects = new ArrayDeque<>();
    for (Object[] root : roots) {
      Object v = root[0];
      String hint = (String) root[1];
      if (canShow(v, hint, Collections.newSetFromMap(new IdentityHashMap<>()))) walk(v, hint, Collections.newSetFromMap(new IdentityHashMap<>()), seen, objects);
      while (!objects.isEmpty()) {
        for (Object[] f : fields(objects.pop())) {
          if (canShow(f[1])) walk(f[1], null, Collections.newSetFromMap(new IdentityHashMap<>()), seen, objects);
        }
      }
    }
  }

  private void walk(Object v, String hint, Set<Object> path, Set<Object> seen, ArrayDeque<Object> objects) {
    String kind = kind(v, hint);
    if (kind == null || kind.equals("plain")) return;
    if (kind.equals("object")) {
      if (seen.add(v)) objects.add(v);
      return;
    }
    if (!path.add(v)) throw new TraceError("A " + v.getClass().getSimpleName() + " contains itself, so it cannot be drawn. The trace stops here.");
    counts.merge(v, 1, Integer::sum);
    for (Object c : children(v, kind)) walk(c, null, path, seen, objects);
    path.remove(v);
  }

  // ---- values

  /** A value's JSON, or OMIT when it has no kind. `place`: written at a place of the step, so a shared container gets its id. */
  Object value(Object v, String hint, boolean place) {
    if (!canShow(v, hint, Collections.newSetFromMap(new IdentityHashMap<>()))) return OMIT;
    return write(v, hint, place);
  }

  String write(Object v, String hint, boolean place) {
    String kind = kind(v, hint);
    if (kind.equals("plain")) return plainJson(v);
    if (kind.equals("object")) return ref(v);
    StringBuilder out = new StringBuilder("{\"kind\": \"").append(kind).append('"');
    if (place && counts != null && counts.getOrDefault(v, 0) >= 2) out.append(", \"id\": ").append(Json.string(Trace.containerId(v)));
    List<Object> items = children(v, kind);
    if (kind.equals("map")) {
      out.append(", \"entries\": [");
      for (int i = 0; i < items.size(); i += 2) {
        if (i > 0) out.append(", ");
        out.append('[').append(write(items.get(i), null, place)).append(", ").append(write(items.get(i + 1), null, place)).append(']');
      }
    } else {
      out.append(", \"items\": [");
      for (int i = 0; i < items.size(); i++) {
        if (i > 0) out.append(", ");
        out.append(write(items.get(i), null, place));
      }
    }
    out.append(']');
    if (kind.equals("priority-queue")) out.append(", \"order\": \"").append(order((PriorityQueue<?>) v)).append('"');
    return out.append('}').toString();
  }

  static String order(PriorityQueue<?> pq) {
    Object c = pq.comparator();
    if (c == null) return "min";
    if (c == Collections.reverseOrder()) return "max";
    return "custom";
  }

  static String plainJson(Object v) {
    if (v == null) return "null";
    if (v instanceof Boolean) return v.toString();
    if (v instanceof Character || v instanceof CharSequence) return Json.string(v.toString());
    if (v instanceof Double || v instanceof Float) return Json.floating(v instanceof Float ? Double.parseDouble(v.toString()) : (Double) v);
    if (v instanceof Number) return Json.integer(((Number) v).longValue());
    return Json.string(v.toString());
  }

  String ref(Object obj) {
    String id = Trace.objectId(obj);
    if (!heap.containsKey(id)) {
      heap.put(id, null);  // in the heap before its fields, so cycles end (invariant 6)
      pending.add(new Object[] {obj, id});
    }
    if (!draining) {
      // Fields are written from a worklist, not by recursion: a long list of nodes would
      // otherwise nest one call per node inside the user's own calls.
      draining = true;
      try {
        while (!pending.isEmpty()) {
          Object[] p = pending.poll();
          StringBuilder fields = new StringBuilder();
          for (Object[] f : fields(p[0])) {
            Object written = value(f[1], null, true);
            if (written == OMIT) continue;
            if (fields.length() > 0) fields.append(", ");
            fields.append(Json.string((String) f[0])).append(": ").append(written);
          }
          heap.put((String) p[1], "{\"kind\": \"object\", \"type\": " + Json.string(p[0].getClass().getSimpleName())
              + ", \"fields\": {" + fields + "}}");
        }
      } finally {
        draining = false;
      }
    }
    return "{\"kind\": \"ref\", \"id\": " + Json.string(id) + "}";
  }
}
