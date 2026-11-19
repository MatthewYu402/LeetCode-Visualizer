package lvtrace;

import java.math.BigDecimal;

/** JSON text for strings and numbers, written by hand: the JDK has no JSON library. */
final class Json {
  static final long SAFE = (1L << 53) - 1;

  private Json() {}

  static String string(CharSequence s) {
    StringBuilder out = new StringBuilder(s.length() + 2).append('"');
    for (int i = 0; i < s.length(); i++) {
      char c = s.charAt(i);
      switch (c) {
        case '"' -> out.append("\\\"");
        case '\\' -> out.append("\\\\");
        case '\n' -> out.append("\\n");
        case '\r' -> out.append("\\r");
        case '\t' -> out.append("\\t");
        case '\b' -> out.append("\\b");
        case '\f' -> out.append("\\f");
        default -> {
          if (c < 0x20 || Character.isSurrogate(c) && !validSurrogate(s, i)) out.append(String.format("\\u%04x", (int) c));
          else out.append(c);
        }
      }
    }
    return out.append('"').toString();
  }

  private static boolean validSurrogate(CharSequence s, int i) {
    char c = s.charAt(i);
    if (Character.isHighSurrogate(c)) return i + 1 < s.length() && Character.isLowSurrogate(s.charAt(i + 1));
    return i > 0 && Character.isHighSurrogate(s.charAt(i - 1));
  }

  /** An integer: bare within ±(2^53 − 1), else the tagged `int` kind (spec, Tagged numbers). */
  static String integer(long v) {
    if (-SAFE <= v && v <= SAFE) return Long.toString(v);
    return "{\"kind\": \"int\", \"value\": \"" + v + "\"}";
  }

  /**
   * A float: NaN and the infinities, and whole values (3.0, so it is not read as 3), use the
   * tagged `float` kind; anything else is a bare JSON number. Python writes the same: a whole
   * value below 1e16 keeps its ".0", and larger ones are written with an exponent.
   */
  static String floating(double v) {
    if (Double.isNaN(v)) return "{\"kind\": \"float\", \"value\": \"NaN\"}";
    if (Double.isInfinite(v)) return "{\"kind\": \"float\", \"value\": \"" + (v > 0 ? "Infinity" : "-Infinity") + "\"}";
    if (v == Math.rint(v) && Math.abs(v) < 1e16) {
      String text = (v == 0 && 1 / v < 0) ? "-0.0" : new BigDecimal(v).toPlainString() + ".0";
      return "{\"kind\": \"float\", \"value\": \"" + text + "\"}";
    }
    String text = Double.toString(v);
    return text;
  }
}
