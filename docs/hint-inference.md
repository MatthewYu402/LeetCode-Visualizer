# Hint Inference

> **Status:** Proposal. Nothing here is implemented, and the trace format has not changed for it.
> **Related:** [`trace-format.md`](trace-format.md) §4 (problem metadata and hints) and §5 (kinds), [`adapters/cpp.md`](adapters/cpp.md) (the C++ adapter), [`frontend.md`](frontend.md) (how a renderer is chosen)

This document parks an idea so it is not lost: how an adapter works out **which data structure a value is meant to be** when its type does not say. It records what is decided, what is open, and when the work is planned.

---

## 1. The problem

A value's **kind** comes from its type, with no guessing. The compiler picks the serializer, so a `std::stack<int>` is always a `stack` and an `unordered_map` is always a `map` ([`trace-format.md` Key Insight 5](trace-format.md#summary-of-kinds)).

Some types are used for several different structures. A `vector<vector<int>>` is always an `array` of `array`s, but it can mean any of these:

| What it holds | Example value | Best drawn as |
|---|---|---|
| A grid | `[[1,0],[0,1]]` | 2D cells |
| An adjacency matrix | `[[0,1],[1,0]]` | Nodes and edges |
| An adjacency list | `[[1,2],[0],[0]]` | Nodes and edges |
| An edge list | `[[0,1],[1,2]]` | Nodes and edges |
| Intervals | `[[1,3],[2,6]]` | Bars on a number line |

The same happens in languages where a structure is a plain array: a Python list used through `heapq` is an `array` that is really a priority queue.

The **hint** is the field that says which one it is. Hints are inferred by the adapter and never asked of the user, because there is no problem catalog.

> **Key insight 1: a wrong hint is cheap, a wrong kind is not.** A hint only changes how a value is drawn. The data in the trace is the same either way, so the frontend can redraw with a different view without running the code again. That is why inference is allowed to be a guess.

## 2. What exists today

| Piece | State |
|---|---|
| The `hint` field on a problem parameter | In the spec and the schema |
| The list of allowed hints | In the spec and the schema |
| An adapter that writes hints | **None.** The C++ adapter writes no hints, and the Two Sum fixture has none |
| The frontend's fallback | Draws by kind alone when there is no hint, so an `array` of `array`s is nested arrays |
| A "view as" control to override a hint | Planned in the frontend |
| Hints for local variables | **Not possible in the format.** See §4.1 |

## 3. Where a hint can come from

The spec lists four sources, from most to least certain. This table adds what each one needs.

| # | Source | Example | Needs |
|---|---|---|---|
| 1 | The signature's types | A `TreeNode*` parameter is a `tree` | The method signature (driver generation) |
| 2 | LeetCode's parameter names | `grid`, `edges`, `intervals` | The method signature, plus a small table of names |
| 3 | How the code uses the value | `grid[r][c]` with two loop indices suggests `grid`. Elements used as indices into another array suggest a graph | The AST (the rewriter) |
| 4 | The shape of the example value | Every inner array has exactly two numbers | Only the parsed example, so it can be shared by every language |

Sources 1 to 3 are per language. Source 4 is language-neutral and could live in one shared place.

## 4. Open decisions

These are proposals to decide when the work starts. None is settled.

### 4.1 Hints for locals

Today a hint lives on an entry of `problem.params`. A local variable has nowhere to carry one. A solution that builds its own `vector<vector<int>> graph` inside the method cannot be marked as an adjacency list, even when the adapter is sure.

Options:

- **A.** A top-level map from variable name to hint. Simple, but two variables with the same name in different scopes would share one hint. That is the same shadowing problem the call-stack design has to solve.
- **B.** Hints inside each stack frame. The call stack exists since trace format v0.6 (`frames`, [`trace-format.md` §6](trace-format.md#6-steps)), so this is now possible.
- **C.** Leave locals without hints and rely on "view as".

Any of A or B is a spec change and follows the procedure in `Skills.md` §3.

### 4.2 When sources disagree

A parameter named `grid` whose example looks like an edge list gives two answers. The proposal is that the more certain source wins, in the order of §3.

### 4.3 When no source is confident

The proposal is to write **no hint** instead of a weak guess. The kind-only drawing is always correct, and a wrong hint is more confusing than a plain one.

### 4.4 Whether the trace should say how sure the adapter is

A confidence value would let the frontend decide. It also adds a field every adapter must fill in consistently. Leaning no, until a real case needs it.

## 5. When

Roadmap Phase 4, item 5, after the rewriter can see the AST. Source 4 (the shape of the example) could be done earlier, with the driver in Phase 3, because it needs only the parsed input.

## 6. Design questions

**Q1. Why not ask the user which structure it is?** The goal is to paste a `Solution` and an example and get a visualization, with no annotations. A guess with an override keeps that promise. A question before every run does not.

**Q2. Why is this not solved by adding more kinds?** A kind is for what the type tells the adapter. `vector<vector<int>>` tells it nothing more than "array of arrays". Inventing a `grid` kind would mean the adapter guesses the kind, and a wrong kind changes what the data claims to be.

**Q3. Why does a missing hint not break anything?** Every renderer can draw from the kind alone. A hint only selects a more helpful picture of the same data.