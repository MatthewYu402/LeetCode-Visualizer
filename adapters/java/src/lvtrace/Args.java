package lvtrace;

import java.util.ArrayList;
import java.util.List;

/**
 * Large inputs, read from text: javac allows 64 KB of bytecode per method, so the driver writes
 * an array of more than a few hundred values as its example text and LvMain reads it here. Only
 * what LeetCode's examples hold: arrays (one or two levels) of numbers, chars, booleans, and strings.
 */
public final class Args {
  private final String s;
  private int i;

  private Args(String s) {
    this.s = s;
  }

  public static int[] int1(String json) {
    List<Object> v = parse(json);
    int[] out = new int[v.size()];
    for (int k = 0; k < out.length; k++) out[k] = ((Number) v.get(k)).intValue();
    return out;
  }

  public static long[] long1(String json) {
    List<Object> v = parse(json);
    long[] out = new long[v.size()];
    for (int k = 0; k < out.length; k++) out[k] = ((Number) v.get(k)).longValue();
    return out;
  }

  public static double[] double1(String json) {
    List<Object> v = parse(json);
    double[] out = new double[v.size()];
    for (int k = 0; k < out.length; k++) out[k] = ((Number) v.get(k)).doubleValue();
    return out;
  }

  public static char[] char1(String json) {
    List<Object> v = parse(json);
    char[] out = new char[v.size()];
    for (int k = 0; k < out.length; k++) out[k] = ((String) v.get(k)).charAt(0);
    return out;
  }

  public static boolean[] boolean1(String json) {
    List<Object> v = parse(json);
    boolean[] out = new boolean[v.size()];
    for (int k = 0; k < out.length; k++) out[k] = (Boolean) v.get(k);
    return out;
  }

  public static String[] string1(String json) {
    return parse(json).toArray(new String[0]);
  }

  public static int[][] int2(String json) {
    List<Object> rows = parse(json);
    int[][] out = new int[rows.size()][];
    for (int r = 0; r < out.length; r++) out[r] = int1(rows.get(r));
    return out;
  }

  public static long[][] long2(String json) {
    List<Object> rows = parse(json);
    long[][] out = new long[rows.size()][];
    for (int r = 0; r < out.length; r++) out[r] = long1(rows.get(r));
    return out;
  }

  public static double[][] double2(String json) {
    List<Object> rows = parse(json);
    double[][] out = new double[rows.size()][];
    for (int r = 0; r < out.length; r++) out[r] = double1(rows.get(r));
    return out;
  }

  public static char[][] char2(String json) {
    List<Object> rows = parse(json);
    char[][] out = new char[rows.size()][];
    for (int r = 0; r < out.length; r++) out[r] = char1(rows.get(r));
    return out;
  }

  public static boolean[][] boolean2(String json) {
    List<Object> rows = parse(json);
    boolean[][] out = new boolean[rows.size()][];
    for (int r = 0; r < out.length; r++) out[r] = boolean1(rows.get(r));
    return out;
  }

  public static String[][] string2(String json) {
    List<Object> rows = parse(json);
    String[][] out = new String[rows.size()][];
    for (int r = 0; r < out.length; r++) out[r] = ((List<?>) rows.get(r)).toArray(new String[0]);
    return out;
  }

  public static List<Integer> intList(String csv) {
    List<Integer> out = new ArrayList<>();
    for (String p : csv.split(",")) if (!p.isEmpty()) out.add(Integer.parseInt(p));
    return out;
  }

  public static List<Long> longList(String csv) {
    List<Long> out = new ArrayList<>();
    for (String p : csv.split(",")) if (!p.isEmpty()) out.add(Long.parseLong(p));
    return out;
  }

  private static int[] int1(Object row) {
    List<?> v = (List<?>) row;
    int[] out = new int[v.size()];
    for (int k = 0; k < out.length; k++) out[k] = ((Number) v.get(k)).intValue();
    return out;
  }

  private static long[] long1(Object row) {
    List<?> v = (List<?>) row;
    long[] out = new long[v.size()];
    for (int k = 0; k < out.length; k++) out[k] = ((Number) v.get(k)).longValue();
    return out;
  }

  private static double[] double1(Object row) {
    List<?> v = (List<?>) row;
    double[] out = new double[v.size()];
    for (int k = 0; k < out.length; k++) out[k] = ((Number) v.get(k)).doubleValue();
    return out;
  }

  private static char[] char1(Object row) {
    List<?> v = (List<?>) row;
    char[] out = new char[v.size()];
    for (int k = 0; k < out.length; k++) out[k] = ((String) v.get(k)).charAt(0);
    return out;
  }

  private static boolean[] boolean1(Object row) {
    List<?> v = (List<?>) row;
    boolean[] out = new boolean[v.size()];
    for (int k = 0; k < out.length; k++) out[k] = (Boolean) v.get(k);
    return out;
  }

  @SuppressWarnings("unchecked")
  static List<Object> parse(String json) {
    Args p = new Args(json);
    Object v = p.value();
    return (List<Object>) v;
  }

  private Object value() {
    skip();
    char c = s.charAt(i);
    if (c == '[') {
      List<Object> out = new ArrayList<>();
      i++;
      skip();
      if (s.charAt(i) == ']') {
        i++;
        return out;
      }
      while (true) {
        out.add(value());
        skip();
        if (s.charAt(i++) == ']') return out;
      }
    }
    if (c == '"') return string();
    if (s.startsWith("true", i)) {
      i += 4;
      return true;
    }
    if (s.startsWith("false", i)) {
      i += 5;
      return false;
    }
    if (s.startsWith("null", i)) {
      i += 4;
      return null;
    }
    int start = i;
    while (i < s.length() && "+-0123456789.eE".indexOf(s.charAt(i)) >= 0) i++;
    String num = s.substring(start, i);
    if (num.contains(".") || num.contains("e") || num.contains("E")) return Double.parseDouble(num);
    return Long.parseLong(num);
  }

  private String string() {
    StringBuilder out = new StringBuilder();
    i++;
    while (true) {
      char c = s.charAt(i++);
      if (c == '"') return out.toString();
      if (c != '\\') {
        out.append(c);
        continue;
      }
      char e = s.charAt(i++);
      switch (e) {
        case 'n' -> out.append('\n');
        case 't' -> out.append('\t');
        case 'r' -> out.append('\r');
        case 'b' -> out.append('\b');
        case 'f' -> out.append('\f');
        case 'u' -> {
          out.append((char) Integer.parseInt(s.substring(i, i + 4), 16));
          i += 4;
        }
        default -> out.append(e);
      }
    }
  }

  private void skip() {
    while (i < s.length() && Character.isWhitespace(s.charAt(i))) i++;
  }
}
