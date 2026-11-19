package lvtrace;

/** A value the trace cannot show (a container that contains itself): the run stops with this message. */
final class TraceError extends RuntimeException {
  TraceError(String message) {
    super(message);
  }
}
