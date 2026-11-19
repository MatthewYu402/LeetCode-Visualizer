package lvtrace;

import com.sun.source.tree.CompilationUnitTree;
import com.sun.source.util.JavacTask;
import com.sun.source.util.Trees;
import java.io.IOException;
import java.net.URI;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import javax.tools.Diagnostic;
import javax.tools.DiagnosticCollector;
import javax.tools.JavaCompiler;
import javax.tools.JavaFileObject;
import javax.tools.SimpleJavaFileObject;
import javax.tools.ToolProvider;

/**
 * Stage 2 and 3 for Java, in one JVM: rewrite the Solution, then compile it with the
 * driver's LvMain.java and Nodes.java (docs/adapters/java.md §4, §7).
 *
 * <pre>
 *   java -cp RUNTIME lvtrace.Build WORK      reads WORK/Solution.java, LvMain.java, Nodes.java;
 *                                            writes WORK/classes/ and WORK/Solution.rewritten.java
 * </pre>
 *
 * Exit status: 0 built; 10 the user's code does not compile (javac's messages, naming
 * Solution.java and the line, on stderr); 20 the rewritten or generated code does not compile
 * (a bug in the rewriter or the driver).
 *
 * <p>LeetCode's Java environment imports java.util and friends; the same imports are put in
 * front of the user's first line, so no line moves.
 */
public final class Build {
  static final String IMPORTS = "import java.util.*; import java.util.function.*; import java.util.stream.*; import java.math.*; ";
  static final int EXIT_USER = 10;
  static final int EXIT_BUG = 20;
  static final int MAX_PASSES = 8;

  private Build() {}

  public static void main(String[] args) throws IOException {
    Path work = Path.of(args.length > 0 ? args[0] : ".");
    String user = Files.readString(work.resolve("Solution.java"), StandardCharsets.UTF_8);
    List<JavaFileObject> generated = new ArrayList<>();
    for (String name : List.of("LvMain.java", "Nodes.java")) {
      Path p = work.resolve(name);
      if (Files.exists(p)) generated.add(source(name, IMPORTS + Files.readString(p, StandardCharsets.UTF_8)));
    }
    Path classes = work.resolve("classes");
    Files.createDirectories(classes);
    JavaCompiler javac = ToolProvider.getSystemJavaCompiler();

    // Parse the user's code as written. A syntax error is the user's: report it as it stands.
    DiagnosticCollector<JavaFileObject> parsing = new DiagnosticCollector<>();
    JavacTask parse = (JavacTask) javac.getTask(null, null, parsing, List.of("-proc:none"), null, List.of(source("Solution.java", user)));
    CompilationUnitTree cu = parse.parse().iterator().next();
    if (hasErrors(parsing)) {
      System.exit(original(javac, user, generated, classes));
    }
    Rewriter rewriter = new Rewriter(user, cu, Trees.instance(parse).getSourcePositions());
    rewriter.rewrite();

    Set<Integer> dropped = new HashSet<>();
    for (int pass = 0; pass < MAX_PASSES; pass++) {
      Rewriter.Output out = rewriter.output(dropped, IMPORTS);
      Files.writeString(work.resolve("Solution.rewritten.java"), out.text(), StandardCharsets.UTF_8);
      DiagnosticCollector<JavaFileObject> d = compile(javac, out.text(), generated, classes);
      if (!hasErrors(d)) System.exit(0);
      boolean progress = false;
      boolean unexplained = false;
      for (Diagnostic<? extends JavaFileObject> e : d.getDiagnostics()) {
        if (e.getKind() != Diagnostic.Kind.ERROR) continue;
        int piece = isSolution(e) ? out.pieceAt(e.getPosition()) : 0;
        if (piece > 0) progress |= dropped.add(piece);
        else unexplained = true;
      }
      if (unexplained || !progress) {
        int status = original(javac, user, generated, classes);
        if (status == 0) {
          System.err.println("The rewritten Solution does not compile. This is a bug in the Java rewriter, not in your code:");
          print(d, out.text());
          status = EXIT_BUG;
        }
        System.exit(status);
      }
    }
    System.err.println("The rewritten Solution still does not compile after " + MAX_PASSES + " passes (a bug in the Java rewriter).");
    System.exit(EXIT_BUG);
  }

  /** Compiles the code as the user wrote it: its errors are theirs (10); errors only in generated files are ours (20); none: 0. */
  static int original(JavaCompiler javac, String user, List<JavaFileObject> generated, Path classes) throws IOException {
    String text = IMPORTS + user;
    DiagnosticCollector<JavaFileObject> d = compile(javac, text, generated, classes);
    if (!hasErrors(d)) return 0;
    boolean users = false;
    for (Diagnostic<? extends JavaFileObject> e : d.getDiagnostics()) {
      if (e.getKind() == Diagnostic.Kind.ERROR && isSolution(e)) users = true;
    }
    if (!users) {
      System.err.println("The generated program does not compile. This is a bug in the driver, not in your code:");
      print(d, text);
      return EXIT_BUG;
    }
    print(d, text);
    return EXIT_USER;
  }

  static DiagnosticCollector<JavaFileObject> compile(JavaCompiler javac, String solution, List<JavaFileObject> generated, Path classes) {
    DiagnosticCollector<JavaFileObject> d = new DiagnosticCollector<>();
    List<JavaFileObject> files = new ArrayList<>(generated);
    files.add(0, source("Solution.java", solution));
    List<String> options = List.of("-d", classes.toString(), "-cp", System.getProperty("java.class.path"), "-proc:none",
        "-nowarn", "-Xlint:none", "-encoding", "UTF-8", "-g");
    javac.getTask(null, null, d, options, null, files).call();
    return d;
  }

  static boolean hasErrors(DiagnosticCollector<JavaFileObject> d) {
    for (Diagnostic<? extends JavaFileObject> e : d.getDiagnostics()) if (e.getKind() == Diagnostic.Kind.ERROR) return true;
    return false;
  }

  static boolean isSolution(Diagnostic<? extends JavaFileObject> e) {
    return e.getSource() != null && e.getSource().toUri().getPath().endsWith("/Solution.java");
  }

  /** javac's errors, as `File.java:LINE: error: message`, the line, and a caret (columns of line 1 leave out the imports). */
  static void print(DiagnosticCollector<JavaFileObject> d, String solutionText) {
    String[] lines = solutionText.split("\n", -1);
    for (Diagnostic<? extends JavaFileObject> e : d.getDiagnostics()) {
      if (e.getKind() != Diagnostic.Kind.ERROR) continue;
      String file = e.getSource() == null ? "?" : Path.of(e.getSource().toUri().getPath()).getFileName().toString();
      long line = e.getLineNumber();
      System.err.println(file + ":" + line + ": error: " + e.getMessage(Locale.ENGLISH));
      if (isSolution(e) && line >= 1 && line <= lines.length) {
        String text = lines[(int) line - 1];
        long column = e.getColumnNumber();
        if (line == 1 && text.startsWith(IMPORTS)) {
          text = text.substring(IMPORTS.length());
          column -= IMPORTS.length();
        }
        System.err.println(text.stripTrailing());
        if (column >= 1 && column <= text.length() + 1) System.err.println(" ".repeat((int) column - 1) + "^");
      }
    }
  }

  static JavaFileObject source(String name, String text) {
    return new SimpleJavaFileObject(URI.create("string:///" + name), JavaFileObject.Kind.SOURCE) {
      @Override
      public CharSequence getCharContent(boolean ignoreEncodingErrors) {
        return text;
      }
    };
  }
}
