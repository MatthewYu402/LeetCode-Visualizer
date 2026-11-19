// Example problems the home page links to (docs/frontend.md §12). Each opens the sandbox with
// its Solution in the editor and its example in the inputs. The code and example are copied
// verbatim from docs/manual-test-suite.md, the cases the author runs by hand, and
// examples.test.ts checks they still match it.

export interface Example {
  /** The route's name for it: #/sandbox/two-sum. */
  slug: string;
  title: string;
  /** The case's number in docs/manual-test-suite.md. */
  suiteCase: number;
  difficulty: "Easy" | "Medium" | "Hard";
  /** What it draws, in the canvas's own words. */
  tags: string[];
  /** One sentence: what to watch. */
  blurb: string;
  /** The Solution, as LeetCode gives it (with its commented node definitions). */
  code: string;
  /** The example, as LeetCode writes it: "Input: ...\nOutput: ...". */
  text: string;
}

export const EXAMPLES: Example[] = [
  {
    slug: "two-sum",
    title: "Two Sum",
    suiteCase: 1,
    difficulty: "Easy",
    tags: ["array", "map"],
    blurb: "A hash map fills one entry per step until the complement is found.",
    code: `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        unordered_map<int, int> numMap;
        for (int i = 0; i < (int)nums.size(); i++) {
            int complement = target - nums[i];
            auto it = numMap.find(complement);
            if (it != numMap.end()) {
                return {it->second, i};
            }
            numMap[nums[i]] = i;
        }
        return {};
    }
};
`,
    text: "Input: nums = [3,2,4,6], target = 10\nOutput: [2,3]\n",
  },
  {
    slug: "valid-palindrome",
    title: "Valid Palindrome",
    suiteCase: 11,
    difficulty: "Easy",
    tags: ["string", "two pointers"],
    blurb: "Two pointers walk in from both ends, skipping what is not a letter.",
    code: `class Solution {
public:
    bool isPalindrome(string s) {
        int left = 0, right = s.size() - 1;
        while (left < right) {
            while (left < right && !isalnum(s[left])) left++;
            while (left < right && !isalnum(s[right])) right--;
            if (tolower(s[left]) != tolower(s[right])) {
                return false;
            }
            left++;
            right--;
        }
        return true;
    }
};
`,
    text: "Input: s = \"Race, car!\"\nOutput: true\n",
  },
  {
    slug: "daily-temperatures",
    title: "Daily Temperatures",
    suiteCase: 25,
    difficulty: "Medium",
    tags: ["array", "stack"],
    blurb: "A monotonic stack holds the days still waiting for a warmer one.",
    code: `class Solution {
public:
    vector<int> dailyTemperatures(vector<int>& temperatures) {
        int n = temperatures.size();
        vector<int> answer(n, 0);
        stack<int> waiting;
        for (int i = 0; i < n; i++) {
            while (!waiting.empty() && temperatures[waiting.top()] < temperatures[i]) {
                int j = waiting.top();
                waiting.pop();
                answer[j] = i - j;
            }
            waiting.push(i);
        }
        return answer;
    }
};
`,
    text: "Input: temperatures = [73,74,75,71,69,72,76,73]\nOutput: [1,1,4,2,1,1,0,0]\n",
  },
  {
    slug: "reverse-linked-list",
    title: "Reverse Linked List",
    suiteCase: 30,
    difficulty: "Easy",
    tags: ["linked list"],
    blurb: "Three pointers turn each next arrow around, one node at a time.",
    code: `/**
 * Definition for singly-linked list.
 * struct ListNode {
 *     int val;
 *     ListNode *next;
 *     ListNode() : val(0), next(nullptr) {}
 *     ListNode(int x) : val(x), next(nullptr) {}
 *     ListNode(int x, ListNode *next) : val(x), next(next) {}
 * };
 */
class Solution {
public:
    ListNode* reverseList(ListNode* head) {
        ListNode* prev = nullptr;
        ListNode* curr = head;
        while (curr != nullptr) {
            ListNode* nextTemp = curr->next;
            curr->next = prev;
            prev = curr;
            curr = nextTemp;
        }
        return prev;
    }
};
`,
    text: "Input: head = [1,2,3,4,5]\nOutput: [5,4,3,2,1]\n",
  },
  {
    slug: "invert-binary-tree",
    title: "Invert Binary Tree",
    suiteCase: 36,
    difficulty: "Easy",
    tags: ["tree", "recursion"],
    blurb: "Each call swaps two children; the recursion card shows every call.",
    code: `/**
 * Definition for a binary tree node.
 * struct TreeNode {
 *     int val;
 *     TreeNode *left;
 *     TreeNode *right;
 *     TreeNode() : val(0), left(nullptr), right(nullptr) {}
 *     TreeNode(int x) : val(x), left(nullptr), right(nullptr) {}
 *     TreeNode(int x, TreeNode *left, TreeNode *right) : val(x), left(left), right(right) {}
 * };
 */
class Solution {
public:
    TreeNode* invertTree(TreeNode* root) {
        if (root == nullptr) {
            return nullptr;
        }
        TreeNode* left = invertTree(root->left);
        TreeNode* right = invertTree(root->right);
        root->left = right;
        root->right = left;
        return root;
    }
};
`,
    text: "Input: root = [4,2,7,1,3,6,9]\nOutput: [4,7,2,9,6,3,1]\n",
  },
  {
    slug: "network-delay-time",
    title: "Network Delay Time",
    suiteCase: 46,
    difficulty: "Medium",
    tags: ["graph", "heap"],
    blurb: "Dijkstra: a min-heap of distances settles one node after another.",
    code: `class Solution {
public:
    int networkDelayTime(vector<vector<int>>& times, int n, int k) {
        vector<vector<pair<int, int>>> graph(n + 1);
        for (auto& t : times) {
            graph[t[0]].push_back({t[1], t[2]});
        }
        vector<int> dist(n + 1, INT_MAX);
        priority_queue<pair<int, int>, vector<pair<int, int>>, greater<pair<int, int>>> heap;
        dist[k] = 0;
        heap.push({0, k});
        while (!heap.empty()) {
            auto [d, u] = heap.top();
            heap.pop();
            if (d > dist[u]) continue;
            for (auto& [v, w] : graph[u]) {
                if (dist[u] + w < dist[v]) {
                    dist[v] = dist[u] + w;
                    heap.push({dist[v], v});
                }
            }
        }
        int best = 0;
        for (int i = 1; i <= n; i++) {
            if (dist[i] == INT_MAX) return -1;
            best = max(best, dist[i]);
        }
        return best;
    }
};
`,
    text: "Input: times = [[2,1,1],[2,3,1],[3,4,1]], n = 4, k = 2\nOutput: 2\n",
  },
];

/** The example a route names, or undefined. */
export function exampleNamed(slug: string | undefined): Example | undefined {
  return slug === undefined ? undefined : EXAMPLES.find((e) => e.slug === slug);
}
