"""Hints for parameters whose type does not say what they are (trace-format.md §4).

An `array<array<int>>` can be a grid, an adjacency list, an adjacency matrix, an
edge list, or intervals, and only the problem knows which. This guesses from two
of the sources the spec lists, and writes a hint only when both agree:

  2. LeetCode's parameter name (`edges`, `graph`, `intervals`, `isConnected`, ...),
  4. the shape of the example value (every row a pair, a square of 0s and 1s, ...).

A name with no matching shape, or a shape with no known name, gives no hint: the
drawing by kind is always right, and a wrong hint misleads more than none
(docs/hint-inference.md §4.3). Shared by every language: it reads only the
neutral type and the parsed example.
"""

# Names LeetCode gives such parameters, by hint. Matched exactly, case-sensitive.
NAMES = {
    "grid": {"grid", "board", "matrix", "mat", "image", "maze", "heights", "dungeon", "obstacleGrid", "land", "picture"},
    "adjacency-list": {"graph", "adj", "adjList", "rooms"},
    "adjacency-matrix": {"isConnected", "adjacencyMatrix"},
    "edge-list": {"edges", "connections", "prerequisites", "roads", "flights", "times", "trust", "dislikes", "pairs", "redEdges", "blueEdges"},
    "intervals": {"intervals", "meetings", "ranges", "firstList", "secondList", "points", "newInterval"},
}

TWO_D = {"array<array<int>>", "array<array<char>>", "array<array<string>>", "array<array<bool>>", "array<array<float>>"}


def _is_int(v):
    return isinstance(v, int) and not isinstance(v, bool)


def _fits(hint, rows):
    if not isinstance(rows, list) or not rows or not all(isinstance(r, list) for r in rows):
        return False
    n = len(rows)
    if hint == "grid":
        return all(len(r) == len(rows[0]) for r in rows) and len(rows[0]) > 0
    if hint == "adjacency-list":
        return all(_is_int(v) and 0 <= v < n for r in rows for v in r)
    if hint == "adjacency-matrix":
        return all(len(r) == n for r in rows) and all(v in (0, 1) and not isinstance(v, bool) for r in rows for v in r)
    if hint == "edge-list":  # [u, v] or [u, v, weight]
        return all(len(r) in (2, 3) and all(_is_int(v) for v in r) and r[0] >= 0 and r[1] >= 0 for r in rows) and len({len(r) for r in rows}) == 1
    if hint == "intervals":
        return all(len(r) == 2 and all(isinstance(v, (int, float)) and not isinstance(v, bool) for v in r) and r[0] <= r[1] for r in rows)
    return False


def infer_hint(name, neutral_type, value):
    """The hint for one parameter, or None."""
    if neutral_type not in TWO_D:
        return None
    for hint, names in NAMES.items():
        if name in names:
            return hint if _fits(hint, value) else None
    return None
