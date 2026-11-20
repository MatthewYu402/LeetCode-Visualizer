package lvtrace;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * One recorded step, kept open until the trace is written: the running line's outcomes are
 * added after the step is taken, and an outcome's value may add objects to the step's heap.
 * Everything else is rendered as JSON text when the step is taken (CLAUDE.md invariant 10).
 */
final class Step {
  final int number;
  final List<String> lowerFrames = new ArrayList<>();  // every frame but the top, as JSON
  String topFrame;                                     // the top frame's JSON without its closing brace
  final List<String> outcomes = new ArrayList<>();
  String members;                                      // "{...}" or null
  final Map<String, String> heap = new LinkedHashMap<>();
  final Map<String, String> topKinds = new HashMap<>();     // the kind written for each top-frame local
  final Map<String, String> memberKinds = new HashMap<>();  // the kind written for each member

  Step(int number) {
    this.number = number;
  }

  /** Characters of this step's JSON text, as json() writes it. */
  int size() {
    StringBuilder out = new StringBuilder();
    json(out);
    return out.length();
  }

  void json(StringBuilder out) {
    out.append("{\"step\": ").append(number).append(", \"frames\": [");
    for (String f : lowerFrames) out.append(f).append(", ");
    out.append(topFrame);
    if (!outcomes.isEmpty()) out.append(", \"outcomes\": [").append(String.join(", ", outcomes)).append(']');
    out.append("}]");
    if (members != null) out.append(", \"members\": ").append(members);
    out.append(", \"heap\": {");
    boolean first = true;
    for (Map.Entry<String, String> e : heap.entrySet()) {
      if (!first) out.append(", ");
      first = false;
      out.append(Json.string(e.getKey())).append(": ").append(e.getValue());
    }
    out.append("}}");
  }
}
