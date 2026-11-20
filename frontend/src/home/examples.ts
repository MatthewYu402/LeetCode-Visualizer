// Example problems: the sandbox's Examples menu and the home page's cards (docs/frontend.md §10.2,
// §12). Each is in all three languages; picking one opens the sandbox with that Solution in the
// editor and its example in the inputs. The code and example of each are copied verbatim from
// docs/manual-test-suite.md, the cases the author runs by hand, and examples.test.ts checks they
// still match it. The home page's cards open the C++ version.

import type { EditorLanguage } from "../editor/languages";

export interface ExampleSolution {
  /** The case's number in docs/manual-test-suite.md. */
  suiteCase: number;
  /** The Solution, as LeetCode gives it (with its commented node definitions). */
  code: string;
  /** The example, as LeetCode writes it: "Input: ...\nOutput: ...". */
  text: string;
}

export interface Example {
  /** The route's name for it: #/sandbox/two-sum. */
  slug: string;
  title: string;
  /** What kind of problem it is, as the Examples menu labels it: "Hashing", "DP". */
  topic: string;
  difficulty: "Easy" | "Medium" | "Hard";
  /** What it draws, in the canvas's own words. */
  tags: string[];
  /** One sentence: what to watch. */
  blurb: string;
  solutions: Record<EditorLanguage, ExampleSolution>;
}

export const EXAMPLES: Example[] = [
  {
    slug: "two-sum",
    title: "Two Sum",
    topic: "Hashing",
    difficulty: "Easy",
    tags: ["array", "map"],
    blurb: "A hash map fills one entry per step until the complement is found.",
    solutions: {
      cpp: {
        suiteCase: 1,
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
      python: {
        suiteCase: 71,
        code: `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        numMap = {}
        for i in range(len(nums)):
            complement = target - nums[i]
            if complement in numMap:
                return [numMap[complement], i]
            numMap[nums[i]] = i
        return []
`,
        text: "Input: nums = [3,2,4,6], target = 10\nOutput: [2,3]\n",
      },
      java: {
        suiteCase: 85,
        code: `class Solution {
    public int[] twoSum(int[] nums, int target) {
        Map<Integer, Integer> numMap = new HashMap<>();
        for (int i = 0; i < nums.length; i++) {
            int complement = target - nums[i];
            if (numMap.containsKey(complement)) {
                return new int[] {numMap.get(complement), i};
            }
            numMap.put(nums[i], i);
        }
        return new int[0];
    }
}
`,
        text: "Input: nums = [3,2,4,6], target = 10\nOutput: [2,3]\n",
      },
    },
  },
  {
    slug: "container-with-most-water",
    title: "Container With Most Water",
    topic: "Two pointers",
    difficulty: "Medium",
    tags: ["array", "two pointers"],
    blurb: "Two pointers walk in from both ends, keeping the widest, tallest pair.",
    solutions: {
      cpp: {
        suiteCase: 2,
        code: `class Solution {
public:
    int maxArea(vector<int>& height) {
        int left = 0, right = height.size() - 1;
        int best = 0;
        while (left < right) {
            int h = min(height[left], height[right]);
            best = max(best, h * (right - left));
            if (height[left] < height[right]) {
                left++;
            } else {
                right--;
            }
        }
        return best;
    }
};
`,
        text: "Input: height = [1,8,6,2,5,4,8,3,7]\nOutput: 49\n",
      },
      python: {
        suiteCase: 94,
        code: `class Solution:
    def maxArea(self, height: List[int]) -> int:
        left, right = 0, len(height) - 1
        best = 0
        while left < right:
            h = min(height[left], height[right])
            best = max(best, h * (right - left))
            if height[left] < height[right]:
                left += 1
            else:
                right -= 1
        return best
`,
        text: "Input: height = [1,8,6,2,5,4,8,3,7]\nOutput: 49\n",
      },
      java: {
        suiteCase: 86,
        code: `class Solution {
    public int maxArea(int[] height) {
        int left = 0, right = height.length - 1;
        int best = 0;
        while (left < right) {
            int h = Math.min(height[left], height[right]);
            best = Math.max(best, h * (right - left));
            if (height[left] < height[right]) {
                left++;
            } else {
                right--;
            }
        }
        return best;
    }
}
`,
        text: "Input: height = [1,8,6,2,5,4,8,3,7]\nOutput: 49\n",
      },
    },
  },
  {
    slug: "valid-parentheses",
    title: "Valid Parentheses",
    topic: "Stack",
    difficulty: "Easy",
    tags: ["string", "stack"],
    blurb: "Each opening bracket waits on a stack for the one that closes it.",
    solutions: {
      cpp: {
        suiteCase: 24,
        code: `class Solution {
public:
    bool isValid(string s) {
        stack<char> st;
        for (char c : s) {
            if (c == '(' || c == '[' || c == '{') {
                st.push(c);
            } else {
                if (st.empty()) return false;
                char top = st.top();
                st.pop();
                if ((c == ')' && top != '(') || (c == ']' && top != '[') || (c == '}' && top != '{')) {
                    return false;
                }
            }
        }
        return st.empty();
    }
};
`,
        text: "Input: s = \"([]{})\"\nOutput: true\n",
      },
      python: {
        suiteCase: 72,
        code: `class Solution:
    def isValid(self, s: str) -> bool:
        pairs = {")": "(", "]": "[", "}": "{"}
        stack = []
        for c in s:
            if c in pairs:
                if not stack or stack[-1] != pairs[c]:
                    return False
                stack.pop()
            else:
                stack.append(c)
        return not stack
`,
        text: "Input: s = \"([]{})\"\nOutput: true\n",
      },
      java: {
        suiteCase: 87,
        code: `class Solution {
    public boolean isValid(String s) {
        Deque<Character> st = new ArrayDeque<>();
        for (char c : s.toCharArray()) {
            if (c == '(' || c == '[' || c == '{') {
                st.push(c);
            } else {
                if (st.isEmpty()) return false;
                char top = st.pop();
                if ((c == ')' && top != '(') || (c == ']' && top != '[') || (c == '}' && top != '{')) {
                    return false;
                }
            }
        }
        return st.isEmpty();
    }
}
`,
        text: "Input: s = \"([]{})\"\nOutput: true\n",
      },
    },
  },
  {
    slug: "reverse-linked-list",
    title: "Reverse Linked List",
    topic: "Linked list",
    difficulty: "Easy",
    tags: ["linked list"],
    blurb: "Three pointers turn each next arrow around, one node at a time.",
    solutions: {
      cpp: {
        suiteCase: 30,
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
      python: {
        suiteCase: 77,
        code: `# Definition for singly-linked list.
# class ListNode:
#     def __init__(self, val=0, next=None):
#         self.val = val
#         self.next = next
class Solution:
    def reverseList(self, head: Optional[ListNode]) -> Optional[ListNode]:
        prev, curr = None, head
        while curr:
            nxt = curr.next
            curr.next = prev
            prev = curr
            curr = nxt
        return prev
`,
        text: "Input: head = [1,2,3,4,5]\nOutput: [5,4,3,2,1]\n",
      },
      java: {
        suiteCase: 88,
        code: `/**
 * Definition for singly-linked list.
 * public class ListNode {
 *     int val;
 *     ListNode next;
 *     ListNode() {}
 *     ListNode(int val) { this.val = val; }
 *     ListNode(int val, ListNode next) { this.val = val; this.next = next; }
 * }
 */
class Solution {
    public ListNode reverseList(ListNode head) {
        ListNode prev = null;
        ListNode curr = head;
        while (curr != null) {
            ListNode nextTemp = curr.next;
            curr.next = prev;
            prev = curr;
            curr = nextTemp;
        }
        return prev;
    }
}
`,
        text: "Input: head = [1,2,3,4,5]\nOutput: [5,4,3,2,1]\n",
      },
    },
  },
  {
    slug: "maximum-depth",
    title: "Maximum Depth of Binary Tree",
    topic: "Tree",
    difficulty: "Easy",
    tags: ["tree", "recursion"],
    blurb: "Each call returns its subtree's depth; the recursion card shows every call.",
    solutions: {
      cpp: {
        suiteCase: 93,
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
    int maxDepth(TreeNode* root) {
        if (root == nullptr) {
            return 0;
        }
        int left = maxDepth(root->left);
        int right = maxDepth(root->right);
        return 1 + max(left, right);
    }
};
`,
        text: "Input: root = [3,9,20,null,null,15,7]\nOutput: 3\n",
      },
      python: {
        suiteCase: 78,
        code: `# Definition for a binary tree node.
# class TreeNode:
#     def __init__(self, val=0, left=None, right=None):
#         self.val = val
#         self.left = left
#         self.right = right
class Solution:
    def maxDepth(self, root: Optional[TreeNode]) -> int:
        if not root:
            return 0
        left = self.maxDepth(root.left)
        right = self.maxDepth(root.right)
        return 1 + max(left, right)
`,
        text: "Input: root = [3,9,20,null,null,15,7]\nOutput: 3\n",
      },
      java: {
        suiteCase: 89,
        code: `/**
 * Definition for a binary tree node.
 * public class TreeNode {
 *     int val;
 *     TreeNode left;
 *     TreeNode right;
 *     TreeNode() {}
 *     TreeNode(int val) { this.val = val; }
 *     TreeNode(int val, TreeNode left, TreeNode right) {
 *         this.val = val;
 *         this.left = left;
 *         this.right = right;
 *     }
 * }
 */
class Solution {
    public int maxDepth(TreeNode root) {
        if (root == null) {
            return 0;
        }
        int left = maxDepth(root.left);
        int right = maxDepth(root.right);
        return 1 + Math.max(left, right);
    }
}
`,
        text: "Input: root = [3,9,20,null,null,15,7]\nOutput: 3\n",
      },
    },
  },
  {
    slug: "course-schedule",
    title: "Course Schedule",
    topic: "Graph",
    difficulty: "Medium",
    tags: ["graph", "queue"],
    blurb: "Prerequisites drawn as a graph; courses leave the queue as their last prerequisite is taken.",
    solutions: {
      cpp: {
        suiteCase: 45,
        code: `class Solution {
public:
    bool canFinish(int numCourses, vector<vector<int>>& prerequisites) {
        vector<vector<int>> adj(numCourses);
        vector<int> indegree(numCourses, 0);
        for (auto& p : prerequisites) {
            adj[p[1]].push_back(p[0]);
            indegree[p[0]]++;
        }
        queue<int> ready;
        for (int i = 0; i < numCourses; i++) {
            if (indegree[i] == 0) ready.push(i);
        }
        int taken = 0;
        while (!ready.empty()) {
            int course = ready.front();
            ready.pop();
            taken++;
            for (int next : adj[course]) {
                if (--indegree[next] == 0) ready.push(next);
            }
        }
        return taken == numCourses;
    }
};
`,
        text: "Input: numCourses = 4, prerequisites = [[1,0],[2,0],[3,1],[3,2]]\nOutput: true\n",
      },
      python: {
        suiteCase: 96,
        code: `class Solution:
    def canFinish(self, numCourses: int, prerequisites: List[List[int]]) -> bool:
        adj = [[] for _ in range(numCourses)]
        indegree = [0] * numCourses
        for course, pre in prerequisites:
            adj[pre].append(course)
            indegree[course] += 1
        ready = deque(i for i in range(numCourses) if indegree[i] == 0)
        taken = 0
        while ready:
            course = ready.popleft()
            taken += 1
            for nxt in adj[course]:
                indegree[nxt] -= 1
                if indegree[nxt] == 0:
                    ready.append(nxt)
        return taken == numCourses
`,
        text: "Input: numCourses = 4, prerequisites = [[1,0],[2,0],[3,1],[3,2]]\nOutput: true\n",
      },
      java: {
        suiteCase: 97,
        code: `class Solution {
    public boolean canFinish(int numCourses, int[][] prerequisites) {
        List<List<Integer>> adj = new ArrayList<>();
        for (int i = 0; i < numCourses; i++) adj.add(new ArrayList<>());
        int[] indegree = new int[numCourses];
        for (int[] p : prerequisites) {
            adj.get(p[1]).add(p[0]);
            indegree[p[0]]++;
        }
        Queue<Integer> ready = new ArrayDeque<>();
        for (int i = 0; i < numCourses; i++) {
            if (indegree[i] == 0) ready.offer(i);
        }
        int taken = 0;
        while (!ready.isEmpty()) {
            int course = ready.poll();
            taken++;
            for (int next : adj.get(course)) {
                if (--indegree[next] == 0) ready.offer(next);
            }
        }
        return taken == numCourses;
    }
}
`,
        text: "Input: numCourses = 4, prerequisites = [[1,0],[2,0],[3,1],[3,2]]\nOutput: true\n",
      },
    },
  },
  {
    slug: "subsets",
    title: "Subsets",
    topic: "Backtracking",
    difficulty: "Medium",
    tags: ["array", "recursion"],
    blurb: "A path grows and shrinks; every call adds a copy of it to the answer.",
    solutions: {
      cpp: {
        suiteCase: 54,
        code: `class Solution {
public:
    vector<vector<int>> subsets(vector<int>& nums) {
        vector<vector<int>> result;
        vector<int> path;
        backtrack(nums, 0, path, result);
        return result;
    }

    void backtrack(vector<int>& nums, int start, vector<int>& path, vector<vector<int>>& result) {
        result.push_back(path);
        for (int i = start; i < (int)nums.size(); i++) {
            path.push_back(nums[i]);
            backtrack(nums, i + 1, path, result);
            path.pop_back();
        }
    }
};
`,
        text: "Input: nums = [1,2,3]\nOutput: [[],[1],[1,2],[1,2,3],[1,3],[2],[2,3],[3]]\n",
      },
      python: {
        suiteCase: 81,
        code: `class Solution:
    def subsets(self, nums: List[int]) -> List[List[int]]:
        res = []
        path = []
        def backtrack(start: int) -> None:
            res.append(path[:])
            for i in range(start, len(nums)):
                path.append(nums[i])
                backtrack(i + 1)
                path.pop()
        backtrack(0)
        return res
`,
        text: "Input: nums = [1,2,3]\nOutput: [[],[1],[1,2],[1,2,3],[1,3],[2],[2,3],[3]]\n",
      },
      java: {
        suiteCase: 91,
        code: `class Solution {
    public List<List<Integer>> subsets(int[] nums) {
        List<List<Integer>> result = new ArrayList<>();
        List<Integer> path = new ArrayList<>();
        backtrack(nums, 0, path, result);
        return result;
    }

    private void backtrack(int[] nums, int start, List<Integer> path, List<List<Integer>> result) {
        result.add(new ArrayList<>(path));
        for (int i = start; i < nums.length; i++) {
            path.add(nums[i]);
            backtrack(nums, i + 1, path, result);
            path.remove(path.size() - 1);
        }
    }
}
`,
        text: "Input: nums = [1,2,3]\nOutput: [[],[1],[1,2],[1,2,3],[1,3],[2],[2,3],[3]]\n",
      },
    },
  },
  {
    slug: "unique-paths",
    title: "Unique Paths",
    topic: "DP",
    difficulty: "Medium",
    tags: ["grid", "dp"],
    blurb: "A 2D table filled row by row, each cell the sum of the one above and the one to the left.",
    solutions: {
      cpp: {
        suiteCase: 52,
        code: `class Solution {
public:
    int uniquePaths(int m, int n) {
        vector<vector<int>> dp(m, vector<int>(n, 1));
        for (int r = 1; r < m; r++) {
            for (int c = 1; c < n; c++) {
                dp[r][c] = dp[r - 1][c] + dp[r][c - 1];
            }
        }
        return dp[m - 1][n - 1];
    }
};
`,
        text: "Input: m = 3, n = 4\nOutput: 10\n",
      },
      python: {
        suiteCase: 98,
        code: `class Solution:
    def uniquePaths(self, m: int, n: int) -> int:
        dp = [[1] * n for _ in range(m)]
        for r in range(1, m):
            for c in range(1, n):
                dp[r][c] = dp[r - 1][c] + dp[r][c - 1]
        return dp[m - 1][n - 1]
`,
        text: "Input: m = 3, n = 4\nOutput: 10\n",
      },
      java: {
        suiteCase: 99,
        code: `class Solution {
    public int uniquePaths(int m, int n) {
        int[][] dp = new int[m][n];
        for (int[] row : dp) Arrays.fill(row, 1);
        for (int r = 1; r < m; r++) {
            for (int c = 1; c < n; c++) {
                dp[r][c] = dp[r - 1][c] + dp[r][c - 1];
            }
        }
        return dp[m - 1][n - 1];
    }
}
`,
        text: "Input: m = 3, n = 4\nOutput: 10\n",
      },
    },
  },
];

export function exampleNamed(slug: string | undefined): Example | undefined {
  return slug === undefined ? undefined : EXAMPLES.find((e) => e.slug === slug);
}
