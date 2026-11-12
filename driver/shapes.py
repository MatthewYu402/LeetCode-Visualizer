"""LeetCode's notations for linked structures, decoded once for every language.

An example writes a tree or a graph as nested JSON arrays. These functions turn
that notation into plain node records, which each language's generator then
writes as constructor calls and pointer assignments:

    Nodes(nodes=[{"val": 3, "left": 1, "right": 2}, {"val": 9, "left": None, "right": None}, ...], root=0)

A link is the index of another node, None for a null pointer, or a list of
indices for a vector field such as `neighbors` or `children`. The decoding
rules live here once, so a C++ driver and a later Python driver cannot drift
apart on what [1,null,2,3] means.

The notations are LeetCode's. Each function says which problems use it.
"""

from dataclasses import dataclass

from .errors import DriverError


@dataclass
class Nodes:
    nodes: list   # one dict per node: "val" plus one key per link field
    root: object  # index of the node the parameter points to, or None for nullptr


def _check_val(value, where):
    if isinstance(value, bool) or not isinstance(value, int):
        raise DriverError(f"{where}: node values must be integers, found {value!r}.")
    return value


def _check_list(value, where, what):
    if not isinstance(value, list):
        raise DriverError(f"{where}: {what} must be written as a JSON array, found {value!r}.")
    return value


def linked_list(values, where, pos=-1, next_field="next"):
    """[1,2,3] -> 1 -> 2 -> 3. `pos` (Linked List Cycle) links the last node
    back to index `pos`; -1 means no cycle."""
    _check_list(values, where, "a linked list")
    nodes = [{"val": _check_val(v, where), next_field: i + 1 if i + 1 < len(values) else None}
             for i, v in enumerate(values)]
    if isinstance(pos, bool) or not isinstance(pos, int):
        raise DriverError(f"pos must be an integer, found {pos!r}.")
    if pos != -1:
        if not 0 <= pos < len(nodes):
            raise DriverError(f"pos = {pos} is not an index of {where} (it has {len(nodes)} nodes), and is not -1.")
        nodes[-1][next_field] = pos
    return Nodes(nodes, 0 if nodes else None)


def binary_tree(values, where, left="left", right="right", extra=()):
    """Level order with null for a missing child: [3,9,20,null,null,15,7].

    Each node in the queue takes the next two values as its left and right
    child; a null child takes its place but gets no children of its own.
    Trailing nulls may be left out. `extra` names more link fields that start
    as null (Populating Next Right Pointers adds `next`)."""
    _check_list(values, where, "a tree")
    if not values or values[0] is None:
        if any(v is not None for v in values):
            raise DriverError(f"{where}: the root is null, so no other value can be placed.")
        return Nodes([], None)

    def make(v):
        node = {"val": _check_val(v, where), left: None, right: None}
        node.update({f: None for f in extra})
        return node

    nodes = [make(values[0])]
    queue, i = [0], 1
    while queue and i < len(values):
        parent = queue.pop(0)
        for side in (left, right):
            if i < len(values) and values[i] is not None:
                nodes.append(make(values[i]))
                nodes[parent][side] = len(nodes) - 1
                queue.append(len(nodes) - 1)
            i += 1
    if any(v is not None for v in values[i:]):
        raise DriverError(f"{where}: {values[i:]} has no parent node to attach to.")
    return Nodes(nodes, 0)


def nary_tree(values, where, children="children"):
    """N-ary level order (N-ary Tree Traversal problems): [1,null,3,2,4,null,5,6].

    After the root comes a null, then each node's children in order, each
    group ended by a null."""
    _check_list(values, where, "an N-ary tree")
    if not values or values[0] is None:
        return Nodes([], None)
    if len(values) > 1 and values[1] is not None:
        raise DriverError(f"{where}: in an N-ary tree, the root must be followed by null.")
    nodes = [{"val": _check_val(values[0], where), children: []}]
    queue, i = [0], 2
    while i < len(values):
        if not queue:
            raise DriverError(f"{where}: {values[i:]} has no parent node to attach to.")
        parent = queue.pop(0)
        while i < len(values) and values[i] is not None:
            nodes.append({"val": _check_val(values[i], where), children: []})
            nodes[parent][children].append(len(nodes) - 1)
            queue.append(len(nodes) - 1)
            i += 1
        i += 1  # the null that ends this group
    return Nodes(nodes, 0)


def graph(adjacency, where, neighbors="neighbors"):
    """Adjacency list (Clone Graph): item i lists the values of node i + 1's
    neighbors. Node values are 1, 2, ..., n. [] is an empty graph (null)."""
    _check_list(adjacency, where, "a graph")
    nodes = [{"val": i + 1, neighbors: []} for i in range(len(adjacency))]
    for i, adj in enumerate(adjacency):
        _check_list(adj, f"{where}[{i}]", "a neighbor list")
        for v in adj:
            _check_val(v, f"{where}[{i}]")
            if not 1 <= v <= len(nodes):
                raise DriverError(f"{where}[{i}]: neighbor {v} is not a node (values are 1 to {len(nodes)}).")
            nodes[i][neighbors].append(v - 1)
    return Nodes(nodes, 0 if nodes else None)


def random_list(pairs, where, next_field="next", random_field="random"):
    """Copy List with Random Pointer: [[7,null],[13,0],...]. Each item is
    [val, index of the node `random` points to, or null]."""
    _check_list(pairs, where, "a list with random pointers")
    nodes = []
    for i, pair in enumerate(pairs):
        if not isinstance(pair, list) or len(pair) != 2:
            raise DriverError(f"{where}[{i}]: expected [val, random_index], found {pair!r}.")
        val, rnd = pair
        if rnd is not None:
            _check_val(rnd, f"{where}[{i}]")
            if not 0 <= rnd < len(pairs):
                raise DriverError(f"{where}[{i}]: random index {rnd} is not a node index.")
        nodes.append({"val": _check_val(val, f"{where}[{i}]"),
                      next_field: i + 1 if i + 1 < len(pairs) else None, random_field: rnd})
    return Nodes(nodes, 0 if nodes else None)
