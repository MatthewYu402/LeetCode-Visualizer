// Clone Graph, instrumented by hand with trace::record.
//
// Each record(...) call sits just before the statement it describes, and its
// first argument is that statement's line in fixtures/clone_graph_trace.cpp,
// the user's original source. As in fixtures/two_sum_hand_inst.cpp, a loop
// header (the while and the range-for) gets no record of its own.
//
// Build, run, and compare with the golden trace, from the repository root:
//   clang++ -std=c++20 -Wall -Wextra -Wpedantic -I adapters/cpp/runtime fixtures/clone_graph_hand_inst.cpp -o /tmp/clone_graph
//   TRACE_OUT=/tmp/clone-graph.json /tmp/clone_graph
//   python3 -I tools/check_trace.py --equals fixtures/clone-graph.trace.json /tmp/clone-graph.json
//
// What it checks: a problem's own Node with a table, cycles through a vector
// field, a map from refs to refs, objects made with new mid-run, and a
// result_heap that holds only the clones.
//
// Ids are stable even though unordered_map iterates in address order, which
// changes from run to run: every new clone is the only unseen object at the
// first step after it is made, so it gets the next id whatever the order.

// ---- Supplied by LeetCode's harness (later, by our driver) ----
#include "trace.hpp"

#include <queue>
#include <unordered_map>
#include <vector>

using namespace std;

// LeetCode shows this definition as a comment above the Solution. The driver
// will generate the struct and its table from that comment.
class Node {
public:
  int val;
  vector<Node *> neighbors;
  Node() : val(0), neighbors() {}
  Node(int _val) : val(_val), neighbors() {}
  Node(int _val, vector<Node *> _neighbors) : val(_val), neighbors(_neighbors) {}
};

template <> struct trace::Fields<Node> {
  static constexpr const char *type = "Node";
  static constexpr auto fields = std::make_tuple(
    std::pair{"val", &Node::val},
    std::pair{"neighbors", &Node::neighbors});
};

// ---- The user's Solution, with record() calls inserted ----
class Solution {
public:
  Node *cloneGraph(Node *node) {
    ::trace::record(4, ::trace::var("node", node));
    if (node == nullptr) {
      ::trace::record(5, ::trace::var("node", node));
      return nullptr;
    }

    ::trace::record(8, ::trace::var("node", node));
    unordered_map<Node *, Node *> visited;

    ::trace::record(9, ::trace::var("node", node), ::trace::var("visited", visited));
    queue<Node *> q;

    ::trace::record(10, ::trace::var("node", node), ::trace::var("visited", visited),
                    ::trace::var("q", q));
    q.push(node);

    ::trace::record(11, ::trace::var("node", node), ::trace::var("visited", visited),
                    ::trace::var("q", q));
    visited[node] = new Node(node->val);

    while (!q.empty()) {
      ::trace::record(14, ::trace::var("node", node), ::trace::var("visited", visited),
                      ::trace::var("q", q));
      Node *curr = q.front();

      ::trace::record(15, ::trace::var("node", node), ::trace::var("visited", visited),
                      ::trace::var("q", q), ::trace::var("curr", curr));
      q.pop();

      for (Node *neighbor : curr->neighbors) {
        ::trace::record(18, ::trace::var("node", node), ::trace::var("visited", visited),
                        ::trace::var("q", q), ::trace::var("curr", curr),
                        ::trace::var("neighbor", neighbor));
        if (visited.find(neighbor) == visited.end()) {
          ::trace::record(19, ::trace::var("node", node), ::trace::var("visited", visited),
                          ::trace::var("q", q), ::trace::var("curr", curr),
                          ::trace::var("neighbor", neighbor));
          visited[neighbor] = new Node(neighbor->val);

          ::trace::record(20, ::trace::var("node", node), ::trace::var("visited", visited),
                          ::trace::var("q", q), ::trace::var("curr", curr),
                          ::trace::var("neighbor", neighbor));
          q.push(neighbor);
        }

        ::trace::record(22, ::trace::var("node", node), ::trace::var("visited", visited),
                        ::trace::var("q", q), ::trace::var("curr", curr),
                        ::trace::var("neighbor", neighbor));
        visited[curr]->neighbors.push_back(visited[neighbor]);
      }
    }

    // curr and neighbor are out of scope after the loop. q is not: it was
    // declared before the loop, and it is empty here.
    ::trace::record(25, ::trace::var("node", node), ::trace::var("visited", visited),
                    ::trace::var("q", q));
    return visited[node];
  }
};

// ---- Appended by the driver (hand-written for now) ----
int main() {
  trace::tracer.begin(R"({"method": "cloneGraph", "params": [{"name": "node", "type": "Node"}], "returns": {"type": "Node"}, "input": {"node": [[2, 4], [1, 3], [2, 4], [1, 3]]}})");

  // adjList = [[2,4],[1,3],[2,4],[1,3]]: item i lists the neighbors of node i + 1.
  Node *n1 = new Node(1);
  Node *n2 = new Node(2);
  Node *n3 = new Node(3);
  Node *n4 = new Node(4);
  n1->neighbors = {n2, n4};
  n2->neighbors = {n1, n3};
  n3->neighbors = {n2, n4};
  n4->neighbors = {n1, n3};

  Node *answer = Solution().cloneGraph(n1);

  trace::write_result(answer);
  return 0;
}
