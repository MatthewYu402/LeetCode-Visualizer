package lvtrace;

import java.util.HashMap;
import java.util.Map;

/**
 * One call of a traced method, from {@link Trace#enter} to {@link #exit}.
 *
 * <p>Java cannot list a frame's locals at run time, so each recording call passes them in
 * (the rewriter writes the names and values of every local in scope). The frame keeps the
 * last ones it was given: while a callee runs, a caller's primitives cannot change, and its
 * objects are read again at every step, so the caller is drawn as it is now.
 */
public final class Frame {
  final String id;
  final String function;
  final Map<String, String> hints;   // local -> "queue", "deque", "stack", or "list": what the declared type says
  Object[] vars = new Object[0];     // name, value, name, value, ...
  int line;
  Step lastStep;                     // the step this frame's last line recorded; outcomes go on it
  int reads;
  boolean returned;
  boolean headerTaken;               // a for loop's header step was taken before its init or update ran

  Frame(String id, String function, Map<String, String> hints) {
    this.id = id;
    this.function = function;
    this.hints = hints;
  }

  /** Ends the call: pops it, whether it returned or threw. Called from the rewriter's finally. */
  public void exit() {
    Trace.leave(this);
  }

  static Map<String, String> parseHints(String text) {
    Map<String, String> out = new HashMap<>();
    if (text == null || text.isEmpty()) return out;
    for (String pair : text.split(";")) {
      int eq = pair.indexOf('=');
      if (eq > 0) out.put(pair.substring(0, eq), pair.substring(eq + 1));
    }
    return out;
  }
}
