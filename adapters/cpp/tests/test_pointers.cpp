// Tests for objects: trace::Fields, the pointer serializer Serializer<T*>, and
// the serializer for objects held by value.
//
// Run from the repository root:
//   make -C adapters/cpp test T=pointers
//
// A pointer serializes to a ref, and the object it points to is written into
// the heap. Each check looks at both: the JSON that serialize() returned, and
// the heap entries it left behind.
//
// The serializer tests build their own Ctx, like test_serialize.cpp. The last
// sections go through record(), to check ids across steps, and through the
// same steps write_result() takes, to check the result's own heap.

#include "leetcode_types.hpp"

#include <iostream>
#include <queue>
#include <string>
#include <unordered_map>
#include <vector>

// A graph node, as in Clone Graph. `Node` differs per problem, so it is defined
// here with its own table instead of in leetcode_types.hpp.
struct Node {
  int val;
  std::vector<Node *> neighbors;
  Node(int x) : val(x) {}
};

template <> struct trace::Fields<Node> {
  static constexpr const char* type = "Node";
  static constexpr auto fields = std::make_tuple(
    std::pair{"val", &Node::val},
    std::pair{"neighbors", &Node::neighbors});
};

namespace {

  int passed = 0;
  int failed = 0;

  void check(const std::string &name, const std::string &actual, const std::string &expected) {
    if (actual == expected) {
      ++passed;
      std::cout << "  PASS  " << name << "\n";
    } else {
      ++failed;
      std::cout << "  FAIL  " << name << "\n"
                << "          expected: " << expected << "\n"
                << "          actual:   " << actual << "\n";
    }
  }

  void check_true(const std::string &name, bool condition) {
    if (condition) {
      ++passed;
      std::cout << "  PASS  " << name << "\n";
    } else {
      ++failed;
      std::cout << "  FAIL  " << name << "\n";
    }
  }

  // One id table and one heap, like a single step. reset() starts a new run.
  trace::IdTable ids;
  trace::Heap heap;
  trace::Ctx ctx{ids, heap};

  void reset() {
    ids.clear();
    heap.clear();
  }

  // The heap entry for an id, or "<missing>".
  std::string entry(const std::string &id) { return heap.contains(id) ? heap.at(id) : "<missing>"; }

  std::string last_step() { return trace::tracer.steps.empty() ? "" : trace::tracer.steps.back(); }

} // namespace

int main() {
  using trace::record;
  using trace::serialize;
  using trace::var;

  std::cout << "null\n";
  {
    reset();
    ListNode *head = nullptr;
    check("null pointer is bare null", serialize(head, ctx), R"(null)");
    check_true("null adds nothing to the heap", heap.empty());
    check_true("null takes no id", ids.empty());
  }

  std::cout << "one node\n";
  {
    reset();
    ListNode a(7);
    ListNode *head = &a;
    check("pointer is a ref", serialize(head, ctx), R"({"kind": "ref", "id": "n1"})");
    check("object is in the heap", entry("n1"), R"({"kind": "object", "type": "ListNode", "fields": {"val": 7, "next": null}})");
    check_true("one heap entry", heap.size() == 1);
  }

  std::cout << "a chain 1 -> 2 -> 3\n";
  {
    reset();
    ListNode c(3), b(2, &c), a(1, &b);
    ListNode *head = &a;
    check("head is n1", serialize(head, ctx), R"({"kind": "ref", "id": "n1"})");
    check("n1 points to n2", entry("n1"), R"({"kind": "object", "type": "ListNode", "fields": {"val": 1, "next": {"kind": "ref", "id": "n2"}}})");
    check("n2 points to n3", entry("n2"), R"({"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": {"kind": "ref", "id": "n3"}}})");
    check("n3 ends the list", entry("n3"), R"({"kind": "object", "type": "ListNode", "fields": {"val": 3, "next": null}})");
    check_true("three heap entries", heap.size() == 3);
  }

  std::cout << "aliases\n";
  {
    reset();
    ListNode b(2), a(1, &b);
    ListNode *head = &a;
    ListNode *cur = &b;
    ListNode *also_head = &a;
    check("head is n1", serialize(head, ctx), R"({"kind": "ref", "id": "n1"})");
    check("cur is the node head.next reached", serialize(cur, ctx), R"({"kind": "ref", "id": "n2"})");
    check("a second pointer to the same node shares its id", serialize(also_head, ctx), R"({"kind": "ref", "id": "n1"})");
    check_true("each object is in the heap once", heap.size() == 2);
  }

  std::cout << "cycles\n";
  {
    reset();
    ListNode a(1), b(2);
    a.next = &b;
    b.next = &a; // a -> b -> a
    ListNode *head = &a;
    check("a two-node cycle terminates", serialize(head, ctx), R"({"kind": "ref", "id": "n1"})");
    check("n1 points to n2", entry("n1"), R"({"kind": "object", "type": "ListNode", "fields": {"val": 1, "next": {"kind": "ref", "id": "n2"}}})");
    check("n2 points back to n1", entry("n2"), R"({"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": {"kind": "ref", "id": "n1"}}})");

    reset();
    ListNode self(9);
    self.next = &self;
    ListNode *p = &self;
    check("a node pointing to itself terminates", serialize(p, ctx), R"({"kind": "ref", "id": "n1"})");
    check("and refers to itself", entry("n1"), R"({"kind": "object", "type": "ListNode", "fields": {"val": 9, "next": {"kind": "ref", "id": "n1"}}})");
    check_true("no placeholder is left behind", entry("n1") != "" && heap.size() == 1);
  }

  std::cout << "TreeNode\n";
  {
    reset();
    TreeNode left(3), root(5, &left, nullptr);
    TreeNode *r = &root;
    check("root is n1", serialize(r, ctx), R"({"kind": "ref", "id": "n1"})");
    check("root has a left child and no right child", entry("n1"),
          R"({"kind": "object", "type": "TreeNode", "fields": {"val": 5, "left": {"kind": "ref", "id": "n2"}, "right": null}})");
    check("leaf", entry("n2"), R"({"kind": "object", "type": "TreeNode", "fields": {"val": 3, "left": null, "right": null}})");

    reset();
    TreeNode shared(1), top(0, &shared, &shared); // not a real tree: one node reached twice
    TreeNode *t = &top;
    serialize(t, ctx);
    check("a node reached twice is written once", entry("n1"),
          R"({"kind": "object", "type": "TreeNode", "fields": {"val": 0, "left": {"kind": "ref", "id": "n2"}, "right": {"kind": "ref", "id": "n2"}}})");
    check_true("two heap entries", heap.size() == 2);
  }

  std::cout << "pointers inside containers\n";
  {
    reset();
    ListNode a(1), b(2);
    std::vector<ListNode *> lists{&a, nullptr, &b, &a};
    check("vector of pointers", serialize(lists, ctx),
          R"({"kind": "array", "items": [{"kind": "ref", "id": "n1"}, null, {"kind": "ref", "id": "n2"}, {"kind": "ref", "id": "n1"}]})");
    check_true("both nodes are in the heap", heap.size() == 2);

    reset();
    TreeNode x(1), y(2);
    std::queue<TreeNode *> q;
    q.push(&x);
    q.push(&y);
    check("queue of pointers", serialize(q, ctx), R"({"kind": "queue", "items": [{"kind": "ref", "id": "n1"}, {"kind": "ref", "id": "n2"}]})");

    reset();
    ListNode k(1), v(2);
    std::unordered_map<ListNode *, ListNode *> copies{{&k, &v}};
    check("pointers as map key and value", serialize(copies, ctx), R"({"kind": "map", "entries": [[{"kind": "ref", "id": "n1"}, {"kind": "ref", "id": "n2"}]]})");

    reset();
    ListNode first(1), second(2);
    std::pair<ListNode *, ListNode *> both{&first, &second};
    check("pair: first gets the lower id on every compiler", serialize(both, ctx), R"({"kind": "tuple", "items": [{"kind": "ref", "id": "n1"}, {"kind": "ref", "id": "n2"}]})");
  }

  std::cout << "a problem's own Node (graph)\n";
  {
    reset();
    Node one(1), two(2);
    one.neighbors = {&two};
    two.neighbors = {&one}; // a cycle through a vector field
    Node *start = &one;
    check("start is n1", serialize(start, ctx), R"({"kind": "ref", "id": "n1"})");
    check("neighbors is an array of refs", entry("n1"),
          R"({"kind": "object", "type": "Node", "fields": {"val": 1, "neighbors": {"kind": "array", "items": [{"kind": "ref", "id": "n2"}]}}})");
    check("the cycle closes with a ref", entry("n2"),
          R"({"kind": "object", "type": "Node", "fields": {"val": 2, "neighbors": {"kind": "array", "items": [{"kind": "ref", "id": "n1"}]}}})");
  }

  std::cout << "pointers to const\n";
  {
    reset();
    ListNode b(2), a(1, &b);
    const ListNode *head = &a;
    check("const pointer is a ref", serialize(head, ctx), R"({"kind": "ref", "id": "n1"})");
    check("the object is written the same way", entry("n1"), R"({"kind": "object", "type": "ListNode", "fields": {"val": 1, "next": {"kind": "ref", "id": "n2"}}})");

    ListNode *plain = &a;
    check("a plain pointer to the same node shares the id", serialize(plain, ctx), R"({"kind": "ref", "id": "n1"})");
    check_true("still two heap entries", heap.size() == 2);

    reset();
    const TreeNode *none = nullptr;
    check("a null const pointer is bare null", serialize(none, ctx), R"(null)");

    reset();
    const ListNode fixed(4); // the node itself is const, so &fixed is a const ListNode*
    ListNode *const pinned = &a;
    check("const pointer to a plain node (ListNode *const)", serialize(pinned, ctx), R"({"kind": "ref", "id": "n1"})");
    std::vector<const ListNode *> views{&fixed, &a};
    check("vector of const pointers", serialize(views, ctx), R"({"kind": "array", "items": [{"kind": "ref", "id": "n3"}, {"kind": "ref", "id": "n1"}]})");
  }

  std::cout << "objects held by value\n";
  {
    reset();
    ListNode dummy(0);
    check("the variable is a ref, not an inline object", serialize(dummy, ctx), R"({"kind": "ref", "id": "n1"})");
    check("the object is in the heap under its own id", entry("n1"), R"({"kind": "object", "type": "ListNode", "fields": {"val": 0, "next": null}})");

    ListNode *tail = &dummy;
    check("a pointer to it shares the id", serialize(tail, ctx), R"({"kind": "ref", "id": "n1"})");
    check_true("one node, one heap entry", heap.size() == 1);

    reset();
    ListNode second(0);
    ListNode *to_second = &second;
    serialize(to_second, ctx);
    check("pointer first, value second: still one id", serialize(second, ctx), R"({"kind": "ref", "id": "n1"})");

    reset();
    ListNode a(1), b(2, &a);
    check("a by-value node's fields are followed", serialize(b, ctx), R"({"kind": "ref", "id": "n1"})");
    check("its next is a ref to the other node", entry("n1"), R"({"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": {"kind": "ref", "id": "n2"}}})");

    reset();
    ListNode copy = b; // a copy is a different object at a different address
    serialize(b, ctx);
    check("a copy gets its own id", serialize(copy, ctx), R"({"kind": "ref", "id": "n3"})");
    check("but points to the same next node", entry("n3"), R"({"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": {"kind": "ref", "id": "n2"}}})");

    reset();
    const TreeNode leaf(8);
    check("a const object held by value", serialize(leaf, ctx), R"({"kind": "ref", "id": "n1"})");
    check("is written like any other", entry("n1"), R"({"kind": "object", "type": "TreeNode", "fields": {"val": 8, "left": null, "right": null}})");

    reset();
    std::vector<ListNode> pool{ListNode(1), ListNode(2)};
    pool[0].next = &pool[1];
    check("vector of nodes: each element is a ref", serialize(pool, ctx), R"({"kind": "array", "items": [{"kind": "ref", "id": "n1"}, {"kind": "ref", "id": "n2"}]})");
    check("a pointer into the vector lands on that element", entry("n1"), R"({"kind": "object", "type": "ListNode", "fields": {"val": 1, "next": {"kind": "ref", "id": "n2"}}})");
    check_true("two heap entries", heap.size() == 2);

    reset();
    Node solo(7);
    check("a problem's own Node by value", serialize(solo, ctx), R"({"kind": "ref", "id": "n1"})");
    check("with its array field", entry("n1"), R"({"kind": "object", "type": "Node", "fields": {"val": 7, "neighbors": {"kind": "array", "items": []}}})");
  }

  std::cout << "the dummy-head pattern through record()\n";
  {
    trace::tracer = trace::Tracer{};
    trace::Frame frame("f"); // record() runs only inside a frame
    ListNode one(1);
    ListNode dummy(0);
    ListNode *tail = &dummy;

    record(1, var("dummy", dummy), var("tail", tail));
    check("step 0: dummy and tail are the same node", last_step(),
          R"({"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {"dummy": {"kind": "ref", "id": "n1"}, "tail": {"kind": "ref", "id": "n1"}}}], "heap": {"n1": {"kind": "object", "type": "ListNode", "fields": {"val": 0, "next": null}}}})");

    tail->next = &one;
    record(2, var("dummy", dummy), var("tail", tail));
    check("step 1: a change through tail shows on dummy", last_step(),
          R"({"step": 1, "frames": [{"id": "f1", "function": "f", "line": 2, "locals": {"dummy": {"kind": "ref", "id": "n1"}, "tail": {"kind": "ref", "id": "n1"}}}], "heap": {"n1": {"kind": "object", "type": "ListNode", "fields": {"val": 0, "next": {"kind": "ref", "id": "n2"}}}, "n2": {"kind": "object", "type": "ListNode", "fields": {"val": 1, "next": null}}}})");

    tail = tail->next;
    record(3, var("dummy", dummy), var("tail", tail));
    check("step 2: tail moves on, dummy stays", last_step(),
          R"({"step": 2, "frames": [{"id": "f1", "function": "f", "line": 3, "locals": {"dummy": {"kind": "ref", "id": "n1"}, "tail": {"kind": "ref", "id": "n2"}}}], "heap": {"n1": {"kind": "object", "type": "ListNode", "fields": {"val": 0, "next": {"kind": "ref", "id": "n2"}}}, "n2": {"kind": "object", "type": "ListNode", "fields": {"val": 1, "next": null}}}})");
  }

  std::cout << "a returned pointer: the result has a heap of its own\n";
  {
    // What write_result() does, without the file: a fresh heap, the run-long ids.
    trace::tracer = trace::Tracer{};
    trace::Frame frame("f"); // record() runs only inside a frame
    trace::tracer.begin(R"({"method": "f", "params": [], "returns": {"type": "ListNode"}, "input": {}})");
    ListNode b(2), a(1, &b);
    ListNode *head = &a;
    record(1, var("head", head)); // a is n1, b is n2

    ListNode *returned = &b;
    trace::Heap result_heap;
    trace::Ctx result_ctx{trace::tracer.id_table, result_heap};
    const std::string result = serialize(returned, result_ctx);
    check("the returned node keeps the id it had in the steps", result, R"({"kind": "ref", "id": "n2"})");
    check_true("the result heap holds only what the result reaches", result_heap.size() == 1 && result_heap.contains("n2"));
    check("the document carries result and result_heap", trace::build_document(result, result_heap),
          R"({"version": "0.7", "language": "cpp", "problem": {"method": "f", "params": [], "returns": {"type": "ListNode"}, "input": {}}, "steps": [{"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {"head": {"kind": "ref", "id": "n1"}}}], "heap": {"n1": {"kind": "object", "type": "ListNode", "fields": {"val": 1, "next": {"kind": "ref", "id": "n2"}}}, "n2": {"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": null}}}}], "result": {"kind": "ref", "id": "n2"}, "result_heap": {"n2": {"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": null}}}})");

    ListNode *nothing = nullptr;
    trace::Heap empty_heap;
    trace::Ctx empty_ctx{trace::tracer.id_table, empty_heap};
    const std::string null_result = serialize(nothing, empty_ctx);
    check("a returned null pointer is a null result", null_result, R"(null)");
    check_true("with nothing in its heap", empty_heap.empty());
    check_true("so the document has no result_heap", trace::build_document(null_result, empty_heap).find("\"result_heap\"") == std::string::npos);
  }

  std::cout << "through record(): ids last the run, the heap lasts one step\n";
  {
    trace::tracer = trace::Tracer{};
    trace::Frame frame("f"); // record() runs only inside a frame
    ListNode b(2), a(1, &b);
    ListNode *head = &a;

    record(1, var("head", head));
    check("step 0: head is n1, both nodes in the heap", last_step(),
          R"({"step": 0, "frames": [{"id": "f1", "function": "f", "line": 1, "locals": {"head": {"kind": "ref", "id": "n1"}}}], "heap": {"n1": {"kind": "object", "type": "ListNode", "fields": {"val": 1, "next": {"kind": "ref", "id": "n2"}}}, "n2": {"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": null}}}})");

    head = head->next;
    record(2, var("head", head));
    check("step 1: the second node is still n2, and n1 is no longer reachable", last_step(),
          R"({"step": 1, "frames": [{"id": "f1", "function": "f", "line": 2, "locals": {"head": {"kind": "ref", "id": "n2"}}}], "heap": {"n2": {"kind": "object", "type": "ListNode", "fields": {"val": 2, "next": null}}}})");

    head->val = 50;
    record(3, var("head", head));
    check("step 2: a changed field shows", last_step(),
          R"({"step": 2, "frames": [{"id": "f1", "function": "f", "line": 3, "locals": {"head": {"kind": "ref", "id": "n2"}}}], "heap": {"n2": {"kind": "object", "type": "ListNode", "fields": {"val": 50, "next": null}}}})");

    ListNode c(3);
    head->next = &c;
    record(4, var("head", head));
    check("step 3: a new node gets the next id", last_step(),
          R"({"step": 3, "frames": [{"id": "f1", "function": "f", "line": 4, "locals": {"head": {"kind": "ref", "id": "n2"}}}], "heap": {"n2": {"kind": "object", "type": "ListNode", "fields": {"val": 50, "next": {"kind": "ref", "id": "n3"}}}, "n3": {"kind": "object", "type": "ListNode", "fields": {"val": 3, "next": null}}}})");

    head = nullptr;
    record(5, var("head", head));
    check("step 4: a null local, empty heap", last_step(), R"({"step": 4, "frames": [{"id": "f1", "function": "f", "line": 5, "locals": {"head": null}}], "heap": {}})");

    check_true("three objects were seen in the whole run", trace::tracer.id_table.size() == 3);
  }

  std::cout << "\n"
            << passed << " passed, " << failed << " failed\n";
  return failed == 0 ? 0 : 1;
}