"""The Python rewriter: inserts the outcome calls into a Solution's syntax tree (docs/adapters/python.md §4).

    instrument(source, filename) -> (code object, Info)

sys.settrace gives the steps, but not what a line evaluated. So, before the Solution
runs, its syntax tree is rewritten with calls to the tracer, the way the C++ rewriter
inserts them into the source:

    if numMap.get(complement) ...   ->  if __trace__.cond(7, "...", ...)
    total += x                      ->  total += x; __trace__.store(5, "total += x", "total", total)
    dp[i - 1][j]                    ->  __trace__.rd(9, "dp[i - 1][j]", "dp", False, dp, (i - 1, j))
    x in seen                       ->  __trace__.has(4, "x in seen", "seen", False, seen, x, False)
    memo.get(n)                     ->  __trace__.get(3, "memo.get(n)", "memo", False, memo, n)

Every inserted node takes the location of the node it stands for, so the user's line
numbers are unchanged, and no inserted call starts a line of its own (which would make
settrace report an extra line). Only functions are rewritten: the Solution's methods,
functions at the top of the file, and functions nested in them. Lambdas and
comprehensions are not (C++ lambdas are not instrumented either).

The same pass reads, from the source, which locals subscript which containers (the
trace's `indexes`, filtered at run time to integer locals and positional containers),
which names the code passes to heapq (drawn as a min priority-queue), and which lines
hold a list, set, or dict comprehension. Python 3.12 runs those inside the function
(PEP 709) and reports their line again on every item; the tracer takes one step for
the line, as for a generator expression, which runs in a frame of its own.
"""

import ast
from dataclasses import dataclass, field

TRACE = "__trace__"
HEAPQ = {"heappush", "heappop", "heapify", "heappushpop", "heapreplace"}
_SKIP = (ast.Lambda, ast.ListComp, ast.SetComp, ast.DictComp, ast.GeneratorExp)
_FUNCTIONS = (ast.FunctionDef, ast.AsyncFunctionDef)


@dataclass
class Info:
    traced_roots: set = field(default_factory=set)       # Solution, and functions at the top of the file
    heaps: dict = field(default_factory=dict)            # function -> local names passed to heapq
    member_heaps: set = field(default_factory=set)       # member names (self.x) passed to heapq
    index_candidates: dict = field(default_factory=dict)  # function -> [(local, container, is_member)]
    comprehensions: dict = field(default_factory=dict)    # line -> (group, the statement's first line)


def instrument(source, filename):
    tree = ast.parse(source, filename)
    info = Info()
    info.traced_roots.add("Solution")
    for node in tree.body:
        if isinstance(node, _FUNCTIONS):
            info.traced_roots.add(node.name)
    for node in ast.walk(tree):
        if isinstance(node, _FUNCTIONS):
            _analyse(node, info)
    _comprehensions(tree, info)
    rewriter = _Rewriter(source)
    for node in tree.body:
        if isinstance(node, ast.ClassDef) and node.name == "Solution":
            rewriter.class_body(node)
        elif isinstance(node, _FUNCTIONS):
            rewriter.function(node)
    ast.fix_missing_locations(tree)
    return compile(tree, filename, "exec"), info


# ---------------------------------------------------------------------- analysis

def _container(node):
    """(name, is_member) for a container named directly: `nums`, or `self.memo`."""
    if isinstance(node, ast.Name):
        return node.id, False
    if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and node.value.id == "self":
        return node.attr, True
    return None


def _index_local(node):
    """The local an index is, or is plus or minus a constant (`i`, `i + 1`, `1 + i`, `i - 1`)."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.BinOp) and isinstance(node.op, (ast.Add, ast.Sub)):
        const = lambda n: isinstance(n, ast.Constant) and type(n.value) is int
        if isinstance(node.left, ast.Name) and const(node.right):
            return node.left.id
        if isinstance(node.op, ast.Add) and const(node.left) and isinstance(node.right, ast.Name):
            return node.right.id
    return None


def _own_nodes(function):
    """The nodes of one function, not of functions, lambdas, or comprehensions inside it."""
    stack = list(function.body)
    while stack:
        node = stack.pop()
        yield node
        for child in ast.iter_child_nodes(node):
            if not isinstance(child, _FUNCTIONS + _SKIP):
                stack.append(child)


_COMPREHENSIONS = (ast.ListComp, ast.SetComp, ast.DictComp)


def _comprehensions(tree, info):
    """Each comprehension's lines, as one group per comprehension, with its statement's
    first line. A loop's header is left out: its own steps, one per check, must stay."""
    group = 0
    for stmt in ast.walk(tree):
        if not isinstance(stmt, ast.stmt) or isinstance(stmt, (ast.For, ast.AsyncFor, ast.While) + _FUNCTIONS):
            continue
        for name, value in ast.iter_fields(stmt):
            parts = value if isinstance(value, list) else [value]
            for part in parts:
                if not isinstance(part, ast.expr):
                    continue  # a statement in a body: it is visited on its own
                for comp in ast.walk(part):
                    if isinstance(comp, _COMPREHENSIONS):
                        group += 1
                        for line in range(comp.lineno, comp.end_lineno + 1):
                            info.comprehensions.setdefault(line, (group, stmt.lineno))


def _analyse(function, info):
    pairs = []
    heaps = info.heaps.setdefault(function.name, set())
    for node in sorted(_own_nodes(function), key=lambda n: (getattr(n, "lineno", 0), getattr(n, "col_offset", 0))):
        if isinstance(node, ast.Subscript) and not isinstance(node.slice, ast.Slice):
            container, local = _container(node.value), _index_local(node.slice)
            if container and local:
                pair = (local, container[0], container[1])
                if pair not in pairs:
                    pairs.append(pair)
        if isinstance(node, ast.Call) and node.args:
            f = node.func
            name = f.attr if isinstance(f, ast.Attribute) and isinstance(f.value, ast.Name) and f.value.id == "heapq" \
                else f.id if isinstance(f, ast.Name) else None
            if name in HEAPQ:
                target = _container(node.args[0])
                if target:
                    (info.member_heaps.add(target[0]) if target[1] else heaps.add(target[0]))
    if pairs:
        info.index_candidates.setdefault(function.name, []).extend(p for p in pairs if p not in info.index_candidates.get(function.name, []))


# ---------------------------------------------------------------------- rewriting

def _pure(node):
    """An expression that can be evaluated again with no effect: names, constants,
    attributes, subscripts, and arithmetic of those. A store's target is re-read only
    when it is pure, so the user's code is never run twice."""
    if isinstance(node, (ast.Name, ast.Constant)):
        return True
    if isinstance(node, ast.Attribute):
        return _pure(node.value)
    if isinstance(node, ast.Subscript):
        return _pure(node.value) and _pure(node.slice)
    if isinstance(node, ast.BinOp):
        return _pure(node.left) and _pure(node.right)
    if isinstance(node, ast.UnaryOp):
        return _pure(node.operand)
    if isinstance(node, ast.Tuple):
        return all(_pure(e) for e in node.elts)
    return False


def _load(node):
    """A copy of a target expression, for reading it back."""
    copy = ast.parse(ast.unparse(node), mode="eval").body
    for n in ast.walk(copy):
        if hasattr(n, "ctx"):
            n.ctx = ast.Load()
    return _place(copy, node)


def _place(new, old):
    """Gives `new` and everything in it the location of `old`."""
    for n in ast.walk(new):
        for attr in ("lineno", "col_offset", "end_lineno", "end_col_offset"):
            setattr(n, attr, getattr(old, attr))
    return new


def _locate(node, at):
    """Gives `node` alone (not its children) the location of `at`."""
    for attr in ("lineno", "col_offset", "end_lineno", "end_col_offset"):
        setattr(node, attr, getattr(at, attr))
    return node


def _call(method, args, at):
    node = ast.Call(func=ast.Attribute(value=ast.Name(id=TRACE, ctx=ast.Load()), attr=method, ctx=ast.Load()),
                    args=args, keywords=[])
    _place(node.func, at)
    for attr in ("lineno", "col_offset", "end_lineno", "end_col_offset"):
        setattr(node, attr, getattr(at, attr))
    return node


def _const(value, at):
    return _place(ast.Constant(value=value), at)


class _Rewriter:
    def __init__(self, source):
        self.source = source

    def code(self, node):
        text = ast.get_source_segment(self.source, node)
        return text if text else ast.unparse(node)

    # ---- structure

    def class_body(self, cls):
        for node in cls.body:
            if isinstance(node, _FUNCTIONS):
                self.function(node)

    def function(self, fn):
        fn.body = self.body(fn.body)

    def body(self, statements):
        out = []
        for stmt in statements:
            out.extend(self.statement(stmt))
        return out

    def statement(self, s):
        """The statement, rewritten, and the store calls that follow it on its line."""
        if isinstance(s, _FUNCTIONS):
            self.function(s)  # a nested function (a dfs helper): rewritten the same way
            return [s]
        if isinstance(s, ast.ClassDef):
            return [s]
        after = []
        if isinstance(s, (ast.If, ast.While)):
            s.test = self.condition(s.test)
            s.body, s.orelse = self.body(s.body), self.body(s.orelse)
            return [s]
        if isinstance(s, (ast.For, ast.AsyncFor)):
            s.iter = self.expr(s.iter)
            s.body = self.store_calls(s, [s.target], self.code(s.target)) + self.body(s.body)
            s.orelse = self.body(s.orelse)
            return [s]
        if isinstance(s, ast.Assign):
            s.value = self.expr(s.value)
            after = self.store_calls(s, s.targets, self.code(s))
            for t in s.targets:
                self.target_indexes(t)
        elif isinstance(s, ast.AugAssign):
            s.value = self.expr(s.value)
            after = self.store_calls(s, [s.target], self.code(s))
            self.target_indexes(s.target)
        elif isinstance(s, ast.AnnAssign):
            if s.value is not None:
                s.value = self.expr(s.value)
                after = self.store_calls(s, [s.target], self.code(s))
        else:
            for name, value in ast.iter_fields(s):
                if isinstance(value, list):
                    if value and all(isinstance(v, ast.stmt) for v in value):
                        setattr(s, name, self.body(value))
                    elif value and isinstance(value[0], ast.excepthandler):
                        for handler in value:
                            handler.body = self.body(handler.body)
                    elif value and isinstance(value[0], ast.match_case):
                        for case in value:
                            case.body = self.body(case.body)
                    elif value and isinstance(value[0], ast.withitem):
                        for item in value:
                            item.context_expr = self.expr(item.context_expr)
                    elif value and all(isinstance(v, ast.expr) for v in value):
                        setattr(s, name, [self.expr(v) for v in value])
                elif isinstance(value, ast.expr) and name not in ("target",):
                    setattr(s, name, self.expr(value))
        return [s] + after

    def target_indexes(self, target):
        """Reads inside a store's target: `nums[i]` in `numMap[nums[i]] = i`. The cell stored
        to is not a read (spec §6, Outcomes), nor is the row it is in (`dp[i]` in `dp[i][j] = 0`);
        only the expressions that say where are. Called after store_calls, which reads the
        target back as written."""
        if isinstance(target, (ast.Tuple, ast.List)):
            for e in target.elts:
                self.target_indexes(e)
        elif isinstance(target, ast.Subscript):
            node = target
            while isinstance(node, ast.Subscript):
                node.slice = self.expr(node.slice)
                node = node.value

    def store_calls(self, stmt, targets, code):
        """`__trace__.store(line, code, target, <target read back>)` for each target that can
        be read back without running anything (_pure). Placed on the statement's own line."""
        calls = []
        for target in targets:
            if isinstance(target, ast.Starred) or not _pure(target):
                continue
            if isinstance(target, (ast.Tuple, ast.List)) and any(isinstance(e, ast.Starred) for e in target.elts):
                continue
            call = ast.Expr(value=_call("store", [_const(stmt.lineno, stmt), _const(code, stmt),
                                                  _const(self.code(target), stmt), _load(target)], stmt))
            # Every node on the statement's first line, where its store runs (the target is
            # written first), so the call never starts a line of its own.
            for n in ast.walk(call):
                n.lineno = n.end_lineno = stmt.lineno
                n.col_offset = n.end_col_offset = stmt.col_offset
            calls.append(call)
        return calls

    # ---- expressions

    def condition(self, test):
        code = self.code(test)
        return _call("cond", [_const(test.lineno, test), _const(code, test), self.expr(test)], test)

    def expr(self, node):
        return _Expressions(self).visit(node)


class _Expressions(ast.NodeTransformer):
    """Reads and conditions inside one expression. Lambdas and comprehensions are left as they are."""

    def __init__(self, rewriter):
        self.r = rewriter
        self.objects = set()   # subscripts that are the object of a method call: `groups[key].append(s)`

    def visit(self, node):
        if isinstance(node, _SKIP):
            return node
        return super().visit(node)

    def visit_Lambda(self, node):
        return node

    visit_ListComp = visit_SetComp = visit_DictComp = visit_GeneratorExp = visit_Lambda

    def visit_Call(self, node):
        f = node.func
        if isinstance(f, ast.Attribute):
            inner = f.value
            while isinstance(inner, ast.Subscript):
                self.objects.add(id(inner))
                inner = inner.value
        # m.get(k) / m.get(k, default) on a container named directly: a read of the entry.
        if isinstance(f, ast.Attribute) and f.attr == "get" and 1 <= len(node.args) <= 2 and not node.keywords:
            target = _container(f.value)
            if target:
                args = [self.visit(a) for a in node.args]
                return _call("get", [_const(node.lineno, node), _const(self.r.code(node), node), _const(target[0], node),
                                     _const(target[1], node), f.value, *args], node)
        self.generic_visit(node)
        return node

    def visit_IfExp(self, node):
        node.test = self.r.condition(node.test)
        node.body, node.orelse = self.visit(node.body), self.visit(node.orelse)
        return node

    def visit_Compare(self, node):
        if len(node.ops) == 1 and isinstance(node.ops[0], (ast.In, ast.NotIn)):
            target = _container(node.comparators[0])
            if target:
                left = self.visit(node.left)
                return _call("has", [_const(node.lineno, node), _const(self.r.code(node), node), _const(target[0], node),
                                     _const(target[1], node), node.comparators[0], left,
                                     _const(isinstance(node.ops[0], ast.NotIn), node)], node)
        self.generic_visit(node)
        return node

    def visit_Subscript(self, node):
        if not isinstance(node.ctx, ast.Load) or id(node) in self.objects:
            self.generic_visit(node)
            return node
        chain, base = [], node
        while isinstance(base, ast.Subscript):
            if isinstance(base.slice, ast.Slice):
                self.generic_visit(node)
                return node
            chain.append(base.slice)
            base = base.value
        target = _container(base)
        if not target:
            self.generic_visit(node)
            return node
        keys = [self.visit(k) for k in reversed(chain)]
        keys_tuple = _locate(ast.Tuple(elts=keys, ctx=ast.Load()), node)
        return _call("rd", [_const(node.lineno, node), _const(self.r.code(node), node), _const(target[0], node),
                            _const(target[1], node), base, keys_tuple], node)
