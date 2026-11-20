# Manual test suite

Solutions to paste into the sandbox page, one per data structure or behaviour, each with what to look at and room for notes.

## How to use it

1. Choose the case's language in the top bar (cases 1 to 70 and 93 are C++, 71 to 84 and 94 Python, 85 to 92 Java, and 95 is in all three), then copy the **Code** block into the editor (select all, then paste over the starter).
2. Copy the whole **Example** block (both lines) into the **or paste a LeetCode example** box. Pasting fills the fields; the `Output:` line is ignored.
3. Press **Run code**, then step through. Write what you notice under **Notes**.

Every case was run with its pasted example through the pipeline on 2026-11-17 (`main` at `d352b95` plus the light-theme change), and its fields were filled through `/api/signature` the way the page does. Each `Output:` line is what the run returned. The step counts are from those runs. The Python cases (71 to 84, 94) and the Java cases (85 to 92) were run the same way on 2026-11-19, with the Python adapter on Python 3.12 and the Java adapter on JDK 21, and case 93 with the C++ pipeline. Rebuild the sandbox images first (`docker build -f sandbox/cpp.Dockerfile -t leetcode-visualizer-sandbox-cpp .` and `docker build -f sandbox/python.Dockerfile -t leetcode-visualizer-sandbox-python .` and `docker build -f sandbox/java.Dockerfile -t leetcode-visualizer-sandbox-java .`; before the Python adapter it was `sandbox/Dockerfile`, tagged `leetcode-visualizer-sandbox`), since an image built before the v0.11 commit writes an older trace version, which the page rejects.

## Found while writing this

- **`indexes` over-marked** when a local appeared inside a computed index (`count[s[i] - 'a']`, `dp[i - coin]`). Fixed in v0.12: a local is paired only when the index is the local, or the local plus or minus a constant. A local that is itself the index still pairs, so `dp[m][n]` in case 53 still pins `m` on `dp`'s last row.
- **Strings get no markers.** The trace pairs `left`/`right` with `s` in Valid Palindrome (case 11), but a string has no card to draw them on.
- **Two methods with the same parameter names** (Pow, case 57) need the Method picker; the command-line pipeline refuses to guess.

## General notes

- 


## Index

| # | Case | What it exercises | Steps | Ends |
|---|---|---|---|---|
| 1 | [Two Sum (hash map, iterator)](#1-two-sum-hash-map-iterator) | array, map, iterator | 22 | returns |
| 2 | [Container With Most Water (two pointers)](#2-container-with-most-water-two-pointers) | array | 45 | returns |
| 3 | [Binary Search (lo, hi, mid)](#3-binary-search-lo-hi-mid) | array | 16 | returns |
| 4 | [Move Zeroes (void, in place)](#4-move-zeroes-void-in-place) | array | 19 | returns |
| 5 | [Sort Colors (Dutch flag, three pointers)](#5-sort-colors-dutch-flag-three-pointers) | array | 31 | returns |
| 6 | [Merge Sorted Array (two arrays, three indexes)](#6-merge-sorted-array-two-arrays-three-indexes) | array | 23 | returns |
| 7 | [Product of Array Except Self (prefix and suffix)](#7-product-of-array-except-self-prefix-and-suffix) | array | 25 | returns |
| 8 | [Best Time to Buy and Sell Stock (scalars only)](#8-best-time-to-buy-and-sell-stock-scalars-only) | array | 22 | returns |
| 9 | [Spiral Matrix (2D array, four bounds)](#9-spiral-matrix-2d-array-four-bounds) | array | 42 | returns |
| 10 | [Rotate Image (void, 2D in place)](#10-rotate-image-void-2d-in-place) | array | 22 | returns |
| 11 | [Valid Palindrome (two pointers on a string)](#11-valid-palindrome-two-pointers-on-a-string) | scalars | 34 | returns |
| 12 | [Longest Substring Without Repeating Characters (sliding window)](#12-longest-substring-without-repeating-characters-sliding-window) | map | 50 | returns |
| 13 | [Valid Anagram (count array of 26)](#13-valid-anagram-count-array-of-26) | array | 78 | returns |
| 14 | [Group Anagrams (map of string to array)](#14-group-anagrams-map-of-string-to-array) | array, map | 34 | returns |
| 15 | [Fizz Buzz (prints to cout)](#15-fizz-buzz-prints-to-cout) | array | 44 | returns |
| 16 | [Contains Duplicate (hash set)](#16-contains-duplicate-hash-set) | array, set | 17 | returns |
| 17 | [Longest Consecutive Sequence (set, inner while)](#17-longest-consecutive-sequence-set-inner-while) | array, set | 37 | returns |
| 18 | [Car Pooling (ordered map, range-for over pairs)](#18-car-pooling-ordered-map-range-for-over-pairs) | array, map | 22 | returns |
| 19 | [Contains Duplicate III (ordered set, lower_bound iterator)](#19-contains-duplicate-iii-ordered-set-lower_bound-iterator) | array, set, iterator | 38 | returns |
| 20 | [Sort Characters By Frequency (multimap)](#20-sort-characters-by-frequency-multimap) | map, multimap | 25 | returns |
| 21 | [Top K Frequent Elements (map and min-heap of pairs)](#21-top-k-frequent-elements-map-and-min-heap-of-pairs) | array, map, heap, pair | 34 | returns |
| 22 | [Kth Largest Element (min-heap of ints)](#22-kth-largest-element-min-heap-of-ints) | array, heap | 25 | returns |
| 23 | [Last Stone Weight (max-heap)](#23-last-stone-weight-max-heap) | array, heap | 31 | returns |
| 24 | [Valid Parentheses (stack of chars)](#24-valid-parentheses-stack-of-chars) | stack | 30 | returns |
| 25 | [Daily Temperatures (monotonic stack of indexes)](#25-daily-temperatures-monotonic-stack-of-indexes) | array, stack | 54 | returns |
| 26 | [Evaluate Reverse Polish Notation (stack, array of strings)](#26-evaluate-reverse-polish-notation-stack-array-of-strings) | array, stack | 36 | returns |
| 27 | [Sliding Window Maximum (deque)](#27-sliding-window-maximum-deque) | array, deque | 64 | returns |
| 28 | [Rotting Oranges (queue of pairs, grid BFS)](#28-rotting-oranges-queue-of-pairs-grid-bfs) | array, queue, pair | 179 | returns |
| 29 | [Find the Winner of the Circular Game (std::list and an iterator)](#29-find-the-winner-of-the-circular-game-stdlist-and-an-iterator) | std::list, iterator | 46 | returns |
| 30 | [Reverse Linked List (three pointers)](#30-reverse-linked-list-three-pointers) | linked list | 30 | returns |
| 31 | [Merge Two Sorted Lists (dummy node by value)](#31-merge-two-sorted-lists-dummy-node-by-value) | linked list | 31 | returns |
| 32 | [Linked List Cycle (pos, slow and fast)](#32-linked-list-cycle-pos-slow-and-fast) | linked list | 16 | returns |
| 33 | [Remove Nth Node From End (node unlinked)](#33-remove-nth-node-from-end-node-unlinked) | linked list | 23 | returns |
| 34 | [Add Two Numbers (building a new list)](#34-add-two-numbers-building-a-new-list) | linked list | 39 | returns |
| 35 | [Middle of the Linked List (empty-ish edge: one node)](#35-middle-of-the-linked-list-empty-ish-edge-one-node) | linked list | 5 | returns |
| 36 | [Invert Binary Tree (recursion returning nodes)](#36-invert-binary-tree-recursion-returning-nodes) | tree, recursion (15 calls) | 73 | returns |
| 37 | [Binary Tree Level Order Traversal (queue of nodes)](#37-binary-tree-level-order-traversal-queue-of-nodes) | array, queue, tree | 56 | returns |
| 38 | [Validate Binary Search Tree (bounds as long long)](#38-validate-binary-search-tree-bounds-as-long-long) | big int, tree, recursion (6 calls) | 20 | returns |
| 39 | [Kth Smallest Element in a BST (iterative, stack of nodes)](#39-kth-smallest-element-in-a-bst-iterative-stack-of-nodes) | stack, tree | 36 | returns |
| 40 | [Diameter of Binary Tree (helper with an int& out-parameter)](#40-diameter-of-binary-tree-helper-with-an-int-out-parameter) | tree, recursion (12 calls) | 52 | returns |
| 41 | [Path Sum II (void backtracking on a tree)](#41-path-sum-ii-void-backtracking-on-a-tree) | array, tree, recursion (22 calls) | 120 | returns |
| 42 | [Average of Levels (doubles)](#42-average-of-levels-doubles) | array, queue, tree, doubles | 55 | returns |
| 43 | [Clone Graph (graph nodes, BFS, map of node to node)](#43-clone-graph-graph-nodes-bfs-map-of-node-to-node) | map, queue, graph | 50 | returns |
| 44 | [Number of Islands (void DFS on a char grid)](#44-number-of-islands-void-dfs-on-a-char-grid) | array, recursion (19 calls) | 102 | returns |
| 45 | [Course Schedule (adjacency list local, Kahn's BFS)](#45-course-schedule-adjacency-list-local-kahns-bfs) | array, queue | 56 | returns |
| 46 | [Network Delay Time (Dijkstra, heap of pairs)](#46-network-delay-time-dijkstra-heap-of-pairs) | array, heap, pair | 56 | returns |
| 47 | [Redundant Connection (union-find with path compression)](#47-redundant-connection-union-find-with-path-compression) | array, recursion (9 calls) | 52 | returns |
| 48 | [Fibonacci Number (plain recursion)](#48-fibonacci-number-plain-recursion) | recursion (15 calls) | 45 | returns |
| 49 | [Fibonacci, large (recursion tree folding)](#49-fibonacci-large-recursion-tree-folding) | recursion (109 calls) | 327 | returns |
| 50 | [Climbing Stairs (memoized recursion, map by reference)](#50-climbing-stairs-memoized-recursion-map-by-reference) | map, recursion (10 calls) | 40 | returns |
| 51 | [Coin Change (1D DP table)](#51-coin-change-1d-dp-table) | array | 110 | returns |
| 52 | [Unique Paths (2D DP table)](#52-unique-paths-2d-dp-table) | array | 20 | returns |
| 53 | [Longest Common Subsequence (2D DP over two strings)](#53-longest-common-subsequence-2d-dp-over-two-strings) | array | 60 | returns |
| 54 | [Subsets (backtracking, void)](#54-subsets-backtracking-void) | array, recursion (9 calls) | 57 | returns |
| 55 | [Permutations (backtracking with a used array of bools)](#55-permutations-backtracking-with-a-used-array-of-bools) | array, recursion (17 calls) | 210 | returns |
| 56 | [Generate Parentheses (string built by recursion)](#56-generate-parentheses-string-built-by-recursion) | array, recursion (9 calls) | 43 | returns |
| 57 | [Pow(x, n) (recursion with doubles)](#57-powx-n-recursion-with-doubles) | doubles, recursion (4 calls) | 17 | returns |
| 58 | [Single Number (XOR)](#58-single-number-xor) | array | 13 | returns |
| 59 | [Number of 1 Bits (unsigned, shifts)](#59-number-of-1-bits-unsigned-shifts) | scalars | 16 | returns |
| 60 | [Sqrt(x) (binary search with long long)](#60-sqrtx-binary-search-with-long-long) | scalars | 136 | returns |
| 61 | [Reverse Integer (overflow check)](#61-reverse-integer-overflow-check) | scalars | 22 | returns |
| 62 | [Empty input](#62-empty-input) | array | 3 | returns |
| 63 | [Infinite loop (reaches the step cap)](#63-infinite-loop-reaches-the-step-cap) | scalars | 2000 | step cap |
| 64 | [Crash (null pointer)](#64-crash-null-pointer) | — | — | crashes |
| 65 | [Compile error](#65-compile-error) | — | — | compile error |
| 66 | [Example names that do not match](#66-example-names-that-do-not-match) | — | — | input error |
| 67 | [Long single line (statement cut with an ellipsis)](#67-long-single-line-statement-cut-with-an-ellipsis) | array | 12 | returns |
| 68 | [Climbing Stairs (memo as a member)](#68-climbing-stairs-memo-as-a-member) | map (member), recursion | 28 | returns |
| 69 | [Merge Intervals (intervals hint)](#69-merge-intervals-intervals-hint) | array (intervals view) | 17 | returns |
| 70 | [Number of Provinces (adjacency matrix hint)](#70-number-of-provinces-adjacency-matrix-hint) | array (graph view), recursion | 44 | returns |
| 71 | [Two Sum (dict, in)](#71-two-sum-dict-in) | array, map | 18 | returns |
| 72 | [Valid Parentheses (list as a stack)](#72-valid-parentheses-list-as-a-stack) | array, map | 26 | returns |
| 73 | [Kth Largest Element (heapq min-heap)](#73-kth-largest-element-heapq-min-heap) | priority queue (min) | 26 | returns |
| 74 | [Top K Frequent Elements (Counter, heap of tuples)](#74-top-k-frequent-elements-counter-heap-of-tuples) | map, priority queue of tuples | 15 | returns |
| 75 | [Number of Islands (deque BFS on a grid)](#75-number-of-islands-deque-bfs-on-a-grid) | array (grid), deque | 101 | returns |
| 76 | [Contains Duplicate III (SortedList)](#76-contains-duplicate-iii-sortedlist) | multiset (SortedList) | 38 | returns |
| 77 | [Reverse Linked List (Optional[ListNode])](#77-reverse-linked-list-optionallistnode) | linked list | 29 | returns |
| 78 | [Maximum Depth of Binary Tree (recursion)](#78-maximum-depth-of-binary-tree-recursion) | tree, recursion | 43 | returns |
| 79 | [Clone Graph (Node in a docstring)](#79-clone-graph-node-in-a-docstring) | graph, map | 48 | returns |
| 80 | [Climbing Stairs (memo as a member)](#80-climbing-stairs-memo-as-a-member) | map (member), recursion | 31 | returns |
| 81 | [Subsets (backtracking, path[:])](#81-subsets-backtracking-path) | array, recursion | 58 | returns |
| 82 | [Fibonacci with @cache (memo not shown)](#82-fibonacci-with-cache-memo-not-shown) | scalars, recursion | 27 | returns |
| 83 | [Exception (index out of range)](#83-exception-index-out-of-range) | — | — | raises |
| 84 | [Infinite loop (reaches the step cap)](#84-infinite-loop-reaches-the-step-cap) | scalars | 2000 | step cap |
| 85 | [Two Sum (HashMap, containsKey)](#85-two-sum-hashmap-containskey) | array, map | 18 | returns |
| 86 | [Container With Most Water (two pointers)](#86-container-with-most-water-two-pointers) | array | 46 | returns |
| 87 | [Valid Parentheses (Deque used as a stack)](#87-valid-parentheses-deque-used-as-a-stack) | stack | 27 | returns |
| 88 | [Reverse Linked List (three pointers)](#88-reverse-linked-list-three-pointers) | linked list | 30 | returns |
| 89 | [Maximum Depth of Binary Tree (recursion)](#89-maximum-depth-of-binary-tree-recursion) | tree, recursion | 43 | returns |
| 90 | [Number of Islands (void DFS on a char grid)](#90-number-of-islands-void-dfs-on-a-char-grid) | array (grid), recursion | 102 | returns |
| 91 | [Subsets (backtracking, void)](#91-subsets-backtracking-void) | array, recursion | 57 | returns |
| 92 | [Climbing Stairs (memo as a member)](#92-climbing-stairs-memo-as-a-member) | map (member), recursion | 28 | returns |
| 93 | [Maximum Depth of Binary Tree (recursion)](#93-maximum-depth-of-binary-tree-recursion) | tree, recursion | 43 | returns |
| 94 | [Container With Most Water (two pointers)](#94-container-with-most-water-two-pointers) | array | 45 | returns |

---

# Arrays and pointers

## 1 Two Sum (hash map, iterator)

**Exercises:** array, map, iterator · **Steps:** 22 · **Ends:** returns

**Watch for:** `i` marker under `nums` only; `numMap` rows appear one per step; `it` shown as a position in `numMap`; no Output tab, since nothing is printed.

**Code**

```cpp
class Solution {
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
```

**Example**

```text
Input: nums = [3,2,4,6], target = 10
Output: [2,3]
```

**Notes**

- 


## 2 Container With Most Water (two pointers)

**Exercises:** array · **Steps:** 45 · **Ends:** returns

**Watch for:** `left` and `right` markers walk toward each other under `height`; `best` changes in amber.

**Code**

```cpp
class Solution {
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
```

**Example**

```text
Input: height = [1,8,6,2,5,4,8,3,7]
Output: 49
```

**Notes**

- 


## 3 Binary Search (lo, hi, mid)

**Exercises:** array · **Steps:** 16 · **Ends:** returns

**Watch for:** Three markers `lo`, `mid`, `hi` under `nums`; the condition chips true/false on each loop check.

**Code**

```cpp
class Solution {
public:
    int search(vector<int>& nums, int target) {
        int lo = 0, hi = nums.size() - 1;
        while (lo <= hi) {
            int mid = lo + (hi - lo) / 2;
            if (nums[mid] == target) {
                return mid;
            } else if (nums[mid] < target) {
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return -1;
    }
};
```

**Example**

```text
Input: nums = [-1,0,3,5,9,12,17,21], target = 17
Output: 6
```

**Notes**

- 


## 4 Move Zeroes (void, in place)

**Exercises:** array · **Steps:** 19 · **Ends:** returns

**Watch for:** A void method: the result row says `returned, no value`; `nums` cells flash as they are swapped; the final step shows the changed input.

**Code**

```cpp
class Solution {
public:
    void moveZeroes(vector<int>& nums) {
        int write = 0;
        for (int read = 0; read < (int)nums.size(); read++) {
            if (nums[read] != 0) {
                swap(nums[write], nums[read]);
                write++;
            }
        }
    }
};
```

**Example**

```text
Input: nums = [0,1,0,3,12]
Output: null
```

**Notes**

- 


## 5 Sort Colors (Dutch flag, three pointers)

**Exercises:** array · **Steps:** 31 · **Ends:** returns

**Watch for:** `low`, `mid`, `high` markers on one array; several markers on one cell stack.

**Code**

```cpp
class Solution {
public:
    void sortColors(vector<int>& nums) {
        int low = 0, mid = 0, high = nums.size() - 1;
        while (mid <= high) {
            if (nums[mid] == 0) {
                swap(nums[low], nums[mid]);
                low++;
                mid++;
            } else if (nums[mid] == 1) {
                mid++;
            } else {
                swap(nums[mid], nums[high]);
                high--;
            }
        }
    }
};
```

**Example**

```text
Input: nums = [2,0,2,1,1,0]
Output: null
```

**Notes**

- 


## 6 Merge Sorted Array (two arrays, three indexes)

**Exercises:** array · **Steps:** 23 · **Ends:** returns

**Watch for:** `i` and `k` under `nums1`, `j` under `nums2` (v0.9 `indexes`): each marker only under the array it indexes.

**Code**

```cpp
class Solution {
public:
    void merge(vector<int>& nums1, int m, vector<int>& nums2, int n) {
        int i = m - 1, j = n - 1, k = m + n - 1;
        while (j >= 0) {
            if (i >= 0 && nums1[i] > nums2[j]) {
                nums1[k] = nums1[i];
                i--;
            } else {
                nums1[k] = nums2[j];
                j--;
            }
            k--;
        }
    }
};
```

**Example**

```text
Input: nums1 = [1,2,3,0,0,0], m = 3, nums2 = [2,5,6], n = 3
Output: null
```

**Notes**

- 


## 7 Product of Array Except Self (prefix and suffix)

**Exercises:** array · **Steps:** 25 · **Ends:** returns

**Watch for:** `answer` filled left to right, then updated right to left; `i` under both `nums` and `answer`.

**Code**

```cpp
class Solution {
public:
    vector<int> productExceptSelf(vector<int>& nums) {
        int n = nums.size();
        vector<int> answer(n, 1);
        for (int i = 1; i < n; i++) {
            answer[i] = answer[i - 1] * nums[i - 1];
        }
        int suffix = 1;
        for (int i = n - 1; i >= 0; i--) {
            answer[i] *= suffix;
            suffix *= nums[i];
        }
        return answer;
    }
};
```

**Example**

```text
Input: nums = [1,2,3,4]
Output: [24,12,8,6]
```

**Notes**

- 


## 8 Best Time to Buy and Sell Stock (scalars only)

**Exercises:** array · **Steps:** 22 · **Ends:** returns

**Watch for:** Only `prices` gets a card; `minPrice` and `best` live in the state panel. Store chips `best = 5`.

**Code**

```cpp
class Solution {
public:
    int maxProfit(vector<int>& prices) {
        int minPrice = INT_MAX;
        int best = 0;
        for (int price : prices) {
            minPrice = min(minPrice, price);
            best = max(best, price - minPrice);
        }
        return best;
    }
};
```

**Example**

```text
Input: prices = [7,1,5,3,6,4]
Output: 5
```

**Notes**

- 


## 9 Spiral Matrix (2D array, four bounds)

**Exercises:** array · **Steps:** 42 · **Ends:** returns

**Watch for:** A 2D array drawn as nested arrays today (no grid view yet: the "View as" work). The trace pairs `top`, `bottom`, and `r` with `matrix` (row markers); `c`, `left`, `right` index a row, so they get none.

**Code**

```cpp
class Solution {
public:
    vector<int> spiralOrder(vector<vector<int>>& matrix) {
        vector<int> result;
        int top = 0, bottom = matrix.size() - 1;
        int left = 0, right = matrix[0].size() - 1;
        while (top <= bottom && left <= right) {
            for (int c = left; c <= right; c++) result.push_back(matrix[top][c]);
            top++;
            for (int r = top; r <= bottom; r++) result.push_back(matrix[r][right]);
            right--;
            if (top <= bottom) {
                for (int c = right; c >= left; c--) result.push_back(matrix[bottom][c]);
                bottom--;
            }
            if (left <= right) {
                for (int r = bottom; r >= top; r--) result.push_back(matrix[r][left]);
                left++;
            }
        }
        return result;
    }
};
```

**Example**

```text
Input: matrix = [[1,2,3],[4,5,6],[7,8,9]]
Output: [1,2,3,6,9,8,7,4,5]
```

**Notes**

- 


## 10 Rotate Image (void, 2D in place)

**Exercises:** array · **Steps:** 22 · **Ends:** returns

**Watch for:** Transpose then reverse each row; the 2D array changes in place. Good test for how nested arrays show diffs.

**Code**

```cpp
class Solution {
public:
    void rotate(vector<vector<int>>& matrix) {
        int n = matrix.size();
        for (int i = 0; i < n; i++) {
            for (int j = i + 1; j < n; j++) {
                swap(matrix[i][j], matrix[j][i]);
            }
        }
        for (int i = 0; i < n; i++) {
            reverse(matrix[i].begin(), matrix[i].end());
        }
    }
};
```

**Example**

```text
Input: matrix = [[1,2,3],[4,5,6],[7,8,9]]
Output: null
```

**Notes**

- 


---

# Strings

## 11 Valid Palindrome (two pointers on a string)

**Exercises:** scalars · **Steps:** 34 · **Ends:** returns

**Watch for:** The string card: `left` and `right` walking in from both ends, and the two characters each comparison reads outlined (v0.11). Try `s = "A man, a plan, a canal: Panama"` on a narrow window: the strip scrolls to follow the pointers.

**Code**

```cpp
class Solution {
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
```

**Example**

```text
Input: s = "Race, car!"
Output: true
```

**Notes**

- 


## 12 Longest Substring Without Repeating Characters (sliding window)

**Exercises:** map · **Steps:** 50 · **Ends:** returns

**Watch for:** `unordered_map<char, int>`: char keys in the map card; `left` and `right` against the string.

**Code**

```cpp
class Solution {
public:
    int lengthOfLongestSubstring(string s) {
        unordered_map<char, int> last;
        int best = 0, left = 0;
        for (int right = 0; right < (int)s.size(); right++) {
            char c = s[right];
            if (last.count(c) && last[c] >= left) {
                left = last[c] + 1;
            }
            last[c] = right;
            best = max(best, right - left + 1);
        }
        return best;
    }
};
```

**Example**

```text
Input: s = "abcabcbb"
Output: 3
```

**Notes**

- 


## 13 Valid Anagram (count array of 26)

**Exercises:** array · **Steps:** 78 · **Ends:** returns

**Watch for:** A wide 26-cell array. Since v0.12 `count[s[i] - 'a']` no longer pairs `i` with `count`, so no marker shows under `count`.

**Code**

```cpp
class Solution {
public:
    bool isAnagram(string s, string t) {
        if (s.size() != t.size()) return false;
        vector<int> count(26, 0);
        for (int i = 0; i < (int)s.size(); i++) {
            count[s[i] - 'a']++;
            count[t[i] - 'a']--;
        }
        for (int x : count) {
            if (x != 0) return false;
        }
        return true;
    }
};
```

**Example**

```text
Input: s = "anagram", t = "nagaram"
Output: true
```

**Notes**

- 


## 14 Group Anagrams (map of string to array)

**Exercises:** array, map · **Steps:** 34 · **Ends:** returns

**Watch for:** `unordered_map<string, vector<string>>`: map values that are arrays. How readable is a map of lists?

**Code**

```cpp
class Solution {
public:
    vector<vector<string>> groupAnagrams(vector<string>& strs) {
        unordered_map<string, vector<string>> groups;
        for (const string& s : strs) {
            string key = s;
            sort(key.begin(), key.end());
            groups[key].push_back(s);
        }
        vector<vector<string>> result;
        for (auto& [key, words] : groups) {
            result.push_back(words);
        }
        return result;
    }
};
```

**Example**

```text
Input: strs = ["eat","tea","tan","ate","nat","bat"]
Output: any grouping
```

**Notes**

- 


## 15 Fizz Buzz (prints to cout)

**Exercises:** array · **Steps:** 44 · **Ends:** returns

**Watch for:** The Output tab appears beside Locals; it holds the whole run's prints. `answer` is an array of strings.

**Code**

```cpp
class Solution {
public:
    vector<string> fizzBuzz(int n) {
        vector<string> answer;
        for (int i = 1; i <= n; i++) {
            string word;
            if (i % 3 == 0) word += "Fizz";
            if (i % 5 == 0) word += "Buzz";
            if (word.empty()) word = to_string(i);
            cout << i << " -> " << word << endl;
            answer.push_back(word);
        }
        return answer;
    }
};
```

**Example**

```text
Input: n = 5
Output: ["1","2","Fizz","4","Buzz"]
```

**Notes**

- 


---

# Sets and maps

## 16 Contains Duplicate (hash set)

**Exercises:** array, set · **Steps:** 17 · **Ends:** returns

**Watch for:** Set card with curly braces; members fade in; the run stops at the duplicate.

**Code**

```cpp
class Solution {
public:
    bool containsDuplicate(vector<int>& nums) {
        unordered_set<int> seen;
        for (int x : nums) {
            if (seen.count(x)) {
                return true;
            }
            seen.insert(x);
        }
        return false;
    }
};
```

**Example**

```text
Input: nums = [1,2,3,4,2]
Output: true
```

**Notes**

- 


## 17 Longest Consecutive Sequence (set, inner while)

**Exercises:** array, set · **Steps:** 37 · **Ends:** returns

**Watch for:** Set built at once from the input; nested loop checks; `current` and `length` as store chips.

**Code**

```cpp
class Solution {
public:
    int longestConsecutive(vector<int>& nums) {
        unordered_set<int> numSet(nums.begin(), nums.end());
        int best = 0;
        for (int x : numSet) {
            if (!numSet.count(x - 1)) {
                int current = x;
                int length = 1;
                while (numSet.count(current + 1)) {
                    current++;
                    length++;
                }
                best = max(best, length);
            }
        }
        return best;
    }
};
```

**Example**

```text
Input: nums = [100,4,200,1,3,2]
Output: 4
```

**Notes**

- 


## 18 Car Pooling (ordered map, range-for over pairs)

**Exercises:** array, map · **Steps:** 22 · **Ends:** returns

**Watch for:** `map<int, int>` (ordered): the trace's order is shown as is. The structured binding `[place, delta]` shows as two plain locals.

**Code**

```cpp
class Solution {
public:
    bool carPooling(vector<vector<int>>& trips, int capacity) {
        map<int, int> change;
        for (auto& trip : trips) {
            change[trip[1]] += trip[0];
            change[trip[2]] -= trip[0];
        }
        int load = 0;
        for (auto& [place, delta] : change) {
            load += delta;
            if (load > capacity) {
                return false;
            }
        }
        return true;
    }
};
```

**Example**

```text
Input: trips = [[2,1,5],[3,3,7]], capacity = 5
Output: true
```

**Notes**

- 


## 19 Contains Duplicate III (ordered set, lower_bound iterator)

**Exercises:** array, set, iterator · **Steps:** 38 · **Ends:** returns

**Watch for:** An iterator into a `set` (`it`), drawn as a position on the set's member; a sliding window that erases.

**Code**

```cpp
class Solution {
public:
    bool containsNearbyAlmostDuplicate(vector<int>& nums, int indexDiff, int valueDiff) {
        set<long long> window;
        for (int i = 0; i < (int)nums.size(); i++) {
            auto it = window.lower_bound((long long)nums[i] - valueDiff);
            if (it != window.end() && *it <= (long long)nums[i] + valueDiff) {
                return true;
            }
            window.insert(nums[i]);
            if (i >= indexDiff) {
                window.erase(nums[i - indexDiff]);
            }
        }
        return false;
    }
};
```

**Example**

```text
Input: nums = [1,5,9,1,5,9], indexDiff = 2, valueDiff = 3
Output: false
```

**Notes**

- 


## 20 Sort Characters By Frequency (multimap)

**Exercises:** map, multimap · **Steps:** 25 · **Ends:** returns

**Watch for:** `multimap<int, char, greater<int>>`: one row per key, values side by side, matched by count.

**Code**

```cpp
class Solution {
public:
    string frequencySort(string s) {
        unordered_map<char, int> freq;
        for (char c : s) freq[c]++;
        multimap<int, char, greater<int>> byCount;
        for (auto& [c, n] : freq) {
            byCount.insert({n, c});
        }
        string result;
        for (auto& [n, c] : byCount) {
            result += string(n, c);
        }
        return result;
    }
};
```

**Example**

```text
Input: s = "tree"
Output: any order of equal counts
```

**Notes**

- 


## 21 Top K Frequent Elements (map and min-heap of pairs)

**Exercises:** array, map, heap, pair · **Steps:** 34 · **Ends:** returns

**Watch for:** `priority_queue<pair<int, int>, ..., greater<>>`: the heap card with tuple items, min order; pops when size passes k.

**Code**

```cpp
class Solution {
public:
    vector<int> topKFrequent(vector<int>& nums, int k) {
        unordered_map<int, int> count;
        for (int x : nums) count[x]++;
        priority_queue<pair<int, int>, vector<pair<int, int>>, greater<pair<int, int>>> heap;
        for (auto& [value, n] : count) {
            heap.push({n, value});
            if ((int)heap.size() > k) {
                heap.pop();
            }
        }
        vector<int> result;
        while (!heap.empty()) {
            result.push_back(heap.top().second);
            heap.pop();
        }
        return result;
    }
};
```

**Example**

```text
Input: nums = [1,1,1,2,2,3], k = 2
Output: [2,1]
```

**Notes**

- 


## 22 Kth Largest Element (min-heap of ints)

**Exercises:** array, heap · **Steps:** 25 · **Ends:** returns

**Watch for:** Heap card: tree plus storage row; `push 4`, `pop 1` chips.

**Code**

```cpp
class Solution {
public:
    int findKthLargest(vector<int>& nums, int k) {
        priority_queue<int, vector<int>, greater<int>> heap;
        for (int x : nums) {
            heap.push(x);
            if ((int)heap.size() > k) {
                heap.pop();
            }
        }
        return heap.top();
    }
};
```

**Example**

```text
Input: nums = [3,2,1,5,6,4], k = 2
Output: 5
```

**Notes**

- 


## 23 Last Stone Weight (max-heap)

**Exercises:** array, heap · **Steps:** 31 · **Ends:** returns

**Watch for:** Max-heap: the default `priority_queue<int>`; two pops then maybe a push each round.

**Code**

```cpp
class Solution {
public:
    int lastStoneWeight(vector<int>& stones) {
        priority_queue<int> heap(stones.begin(), stones.end());
        while (heap.size() > 1) {
            int a = heap.top();
            heap.pop();
            int b = heap.top();
            heap.pop();
            if (a != b) {
                heap.push(a - b);
            }
        }
        return heap.empty() ? 0 : heap.top();
    }
};
```

**Example**

```text
Input: stones = [2,7,4,1,8,1]
Output: 1
```

**Notes**

- 


---

# Stacks, queues, deques, lists

## 24 Valid Parentheses (stack of chars)

**Exercises:** stack · **Steps:** 30 · **Ends:** returns

**Watch for:** Vertical stack with an open top; `push '('` and `pop` chips.

**Code**

```cpp
class Solution {
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
```

**Example**

```text
Input: s = "([]{})"
Output: true
```

**Notes**

- 


## 25 Daily Temperatures (monotonic stack of indexes)

**Exercises:** array, stack · **Steps:** 54 · **Ends:** returns

**Watch for:** A stack holding indexes into `temperatures`; `answer` filled out of order.

**Code**

```cpp
class Solution {
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
```

**Example**

```text
Input: temperatures = [73,74,75,71,69,72,76,73]
Output: [1,1,4,2,1,1,0,0]
```

**Notes**

- 


## 26 Evaluate Reverse Polish Notation (stack, array of strings)

**Exercises:** array, stack · **Steps:** 36 · **Ends:** returns

**Watch for:** Stack of ints growing and shrinking; tokens as an array of strings with `i`.

**Code**

```cpp
class Solution {
public:
    int evalRPN(vector<string>& tokens) {
        stack<int> st;
        for (int i = 0; i < (int)tokens.size(); i++) {
            const string& t = tokens[i];
            if (t == "+" || t == "-" || t == "*" || t == "/") {
                int b = st.top();
                st.pop();
                int a = st.top();
                st.pop();
                if (t == "+") st.push(a + b);
                else if (t == "-") st.push(a - b);
                else if (t == "*") st.push(a * b);
                else st.push(a / b);
            } else {
                st.push(stoi(t));
            }
        }
        return st.top();
    }
};
```

**Example**

```text
Input: tokens = ["2","1","+","3","*"]
Output: 9
```

**Notes**

- 


## 27 Sliding Window Maximum (deque)

**Exercises:** array, deque · **Steps:** 64 · **Ends:** returns

**Watch for:** Deque tube with front and back; `pop back` and `pop front` chips.

**Code**

```cpp
class Solution {
public:
    vector<int> maxSlidingWindow(vector<int>& nums, int k) {
        deque<int> window;
        vector<int> result;
        for (int i = 0; i < (int)nums.size(); i++) {
            if (!window.empty() && window.front() <= i - k) {
                window.pop_front();
            }
            while (!window.empty() && nums[window.back()] < nums[i]) {
                window.pop_back();
            }
            window.push_back(i);
            if (i >= k - 1) {
                result.push_back(nums[window.front()]);
            }
        }
        return result;
    }
};
```

**Example**

```text
Input: nums = [1,3,-1,-3,5,3,6,7], k = 3
Output: [3,3,5,5,6,7]
```

**Notes**

- 


## 28 Rotting Oranges (queue of pairs, grid BFS)

**Exercises:** array, queue, pair · **Steps:** 179 · **Ends:** returns

**Watch for:** Queue tube holding tuples; a 2D grid changing; a long run. Step count is shown in the playback bar.

**Code**

```cpp
class Solution {
public:
    int orangesRotting(vector<vector<int>>& grid) {
        int rows = grid.size(), cols = grid[0].size();
        queue<pair<int, int>> q;
        int fresh = 0;
        for (int r = 0; r < rows; r++) {
            for (int c = 0; c < cols; c++) {
                if (grid[r][c] == 2) q.push({r, c});
                else if (grid[r][c] == 1) fresh++;
            }
        }
        int minutes = 0;
        int dr[4] = {1, -1, 0, 0};
        int dc[4] = {0, 0, 1, -1};
        while (!q.empty() && fresh > 0) {
            int size = q.size();
            for (int s = 0; s < size; s++) {
                auto [r, c] = q.front();
                q.pop();
                for (int d = 0; d < 4; d++) {
                    int nr = r + dr[d], nc = c + dc[d];
                    if (nr >= 0 && nr < rows && nc >= 0 && nc < cols && grid[nr][nc] == 1) {
                        grid[nr][nc] = 2;
                        fresh--;
                        q.push({nr, nc});
                    }
                }
            }
            minutes++;
        }
        return fresh == 0 ? minutes : -1;
    }
};
```

**Example**

```text
Input: grid = [[2,1,1],[1,1,0],[0,1,1]]
Output: 4
```

**Notes**

- 


## 29 Find the Winner of the Circular Game (std::list and an iterator)

**Exercises:** std::list, iterator · **Steps:** 46 · **Ends:** returns

**Watch for:** The `list` kind (two-way arrows, front/back) and an iterator moving around it; `erase` removes a node.

**Code**

```cpp
class Solution {
public:
    int findTheWinner(int n, int k) {
        list<int> circle;
        for (int i = 1; i <= n; i++) circle.push_back(i);
        auto it = circle.begin();
        while (circle.size() > 1) {
            for (int step = 1; step < k; step++) {
                it++;
                if (it == circle.end()) it = circle.begin();
            }
            it = circle.erase(it);
            if (it == circle.end()) it = circle.begin();
        }
        return circle.front();
    }
};
```

**Example**

```text
Input: n = 5, k = 2
Output: 3
```

**Notes**

- 


---

# Linked lists

## 30 Reverse Linked List (three pointers)

**Exercises:** linked list · **Steps:** 30 · **Ends:** returns

**Watch for:** Known rough edge: `prev`, `curr`, `nextTemp` are all the same blue. Reversed links curve under the row.

**Code**

```cpp
/**
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
```

**Example**

```text
Input: head = [1,2,3,4,5]
Output: [5,4,3,2,1]
```

**Notes**

- 


## 31 Merge Two Sorted Lists (dummy node by value)

**Exercises:** linked list · **Steps:** 31 · **Ends:** returns

**Watch for:** `ListNode dummy(0)` is a heap object with `tail` pointing at it; two input lists merge into one; the result list turns purple.

**Code**

```cpp
/**
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
    ListNode* mergeTwoLists(ListNode* list1, ListNode* list2) {
        ListNode dummy(0);
        ListNode* tail = &dummy;
        while (list1 != nullptr && list2 != nullptr) {
            if (list1->val <= list2->val) {
                tail->next = list1;
                list1 = list1->next;
            } else {
                tail->next = list2;
                list2 = list2->next;
            }
            tail = tail->next;
        }
        tail->next = list1 != nullptr ? list1 : list2;
        return dummy.next;
    }
};
```

**Example**

```text
Input: list1 = [1,2,4], list2 = [1,3,4]
Output: [1,1,2,3,4,4]
```

**Notes**

- 


## 32 Linked List Cycle (pos, slow and fast)

**Exercises:** linked list · **Steps:** 16 · **Ends:** returns

**Watch for:** A cycle drawn from the `pos` input; `slow` and `fast` tags meet on one node.

**Code**

```cpp
/**
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
    bool hasCycle(ListNode *head) {
        ListNode* slow = head;
        ListNode* fast = head;
        while (fast != nullptr && fast->next != nullptr) {
            slow = slow->next;
            fast = fast->next->next;
            if (slow == fast) {
                return true;
            }
        }
        return false;
    }
};
```

**Example**

```text
Input: head = [3,2,0,-4], pos = 1
Output: true
```

**Notes**

- 


## 33 Remove Nth Node From End (node unlinked)

**Exercises:** linked list · **Steps:** 23 · **Ends:** returns

**Watch for:** A node is skipped by a redirected edge; does the removed node fade out or stay drawn?

**Code**

```cpp
/**
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
    ListNode* removeNthFromEnd(ListNode* head, int n) {
        ListNode dummy(0, head);
        ListNode* fast = &dummy;
        ListNode* slow = &dummy;
        for (int i = 0; i <= n; i++) {
            fast = fast->next;
        }
        while (fast != nullptr) {
            fast = fast->next;
            slow = slow->next;
        }
        slow->next = slow->next->next;
        return dummy.next;
    }
};
```

**Example**

```text
Input: head = [1,2,3,4,5], n = 2
Output: [1,2,3,5]
```

**Notes**

- 


## 34 Add Two Numbers (building a new list)

**Exercises:** linked list · **Steps:** 39 · **Ends:** returns

**Watch for:** Three lists on the canvas: two inputs and a new one growing with `new ListNode`; `carry` as a store chip.

**Code**

```cpp
/**
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
    ListNode* addTwoNumbers(ListNode* l1, ListNode* l2) {
        ListNode dummy(0);
        ListNode* tail = &dummy;
        int carry = 0;
        while (l1 != nullptr || l2 != nullptr || carry != 0) {
            int sum = carry;
            if (l1 != nullptr) {
                sum += l1->val;
                l1 = l1->next;
            }
            if (l2 != nullptr) {
                sum += l2->val;
                l2 = l2->next;
            }
            carry = sum / 10;
            tail->next = new ListNode(sum % 10);
            tail = tail->next;
        }
        return dummy.next;
    }
};
```

**Example**

```text
Input: l1 = [2,4,3], l2 = [5,6,4]
Output: [7,0,8]
```

**Notes**

- 


## 35 Middle of the Linked List (empty-ish edge: one node)

**Exercises:** linked list · **Steps:** 5 · **Ends:** returns

**Watch for:** A one-node list: does the card look sensible with a single node and two tags on it?

**Code**

```cpp
/**
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
    ListNode* middleNode(ListNode* head) {
        ListNode* slow = head;
        ListNode* fast = head;
        while (fast != nullptr && fast->next != nullptr) {
            slow = slow->next;
            fast = fast->next->next;
        }
        return slow;
    }
};
```

**Example**

```text
Input: head = [7]
Output: [7]
```

**Notes**

- 


---

# Trees

## 36 Invert Binary Tree (recursion returning nodes)

**Exercises:** tree, recursion (15 calls) · **Steps:** 73 · **Ends:** returns

**Watch for:** Recursion card with node return values; the tree's children swap with glides.

**Code**

```cpp
/**
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
```

**Example**

```text
Input: root = [4,2,7,1,3,6,9]
Output: [4,7,2,9,6,3,1]
```

**Notes**

- 


## 37 Binary Tree Level Order Traversal (queue of nodes)

**Exercises:** array, queue, tree · **Steps:** 56 · **Ends:** returns

**Watch for:** A queue whose items are refs, shown by their node's value; `result` is an array of arrays.

**Code**

```cpp
/**
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
    vector<vector<int>> levelOrder(TreeNode* root) {
        vector<vector<int>> result;
        if (root == nullptr) return result;
        queue<TreeNode*> q;
        q.push(root);
        while (!q.empty()) {
            int size = q.size();
            vector<int> level;
            for (int i = 0; i < size; i++) {
                TreeNode* node = q.front();
                q.pop();
                level.push_back(node->val);
                if (node->left) q.push(node->left);
                if (node->right) q.push(node->right);
            }
            result.push_back(level);
        }
        return result;
    }
};
```

**Example**

```text
Input: root = [3,9,20,null,null,15,7]
Output: [[3],[9,20],[15,7]]
```

**Notes**

- 


## 38 Validate Binary Search Tree (bounds as long long)

**Exercises:** big int, tree, recursion (6 calls) · **Steps:** 20 · **Ends:** returns

**Watch for:** `LLONG_MIN` and `LLONG_MAX` are beyond 2^53: they travel as tagged ints and must show exactly, not rounded.

**Code**

```cpp
/**
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
    bool isValidBST(TreeNode* root) {
        return check(root, LLONG_MIN, LLONG_MAX);
    }

    bool check(TreeNode* node, long long low, long long high) {
        if (node == nullptr) return true;
        if (node->val <= low || node->val >= high) return false;
        return check(node->left, low, node->val) && check(node->right, node->val, high);
    }
};
```

**Example**

```text
Input: root = [5,1,4,null,null,3,6]
Output: false
```

**Notes**

- 


## 39 Kth Smallest Element in a BST (iterative, stack of nodes)

**Exercises:** stack, tree · **Steps:** 36 · **Ends:** returns

**Watch for:** Stack of node refs; `curr` walks down the left spine; the path from the root is blue.

**Code**

```cpp
/**
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
    int kthSmallest(TreeNode* root, int k) {
        stack<TreeNode*> st;
        TreeNode* curr = root;
        while (curr != nullptr || !st.empty()) {
            while (curr != nullptr) {
                st.push(curr);
                curr = curr->left;
            }
            curr = st.top();
            st.pop();
            k--;
            if (k == 0) return curr->val;
            curr = curr->right;
        }
        return -1;
    }
};
```

**Example**

```text
Input: root = [5,3,6,2,4,null,null,1], k = 3
Output: 3
```

**Notes**

- 


## 40 Diameter of Binary Tree (helper with an int& out-parameter)

**Exercises:** tree, recursion (12 calls) · **Steps:** 52 · **Ends:** returns

**Watch for:** A recursive helper that returns heights and updates `best` through a reference; the recursion card shows heights.

**Code**

```cpp
/**
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
    int diameterOfBinaryTree(TreeNode* root) {
        int best = 0;
        height(root, best);
        return best;
    }

    int height(TreeNode* node, int& best) {
        if (node == nullptr) return 0;
        int left = height(node->left, best);
        int right = height(node->right, best);
        best = max(best, left + right);
        return 1 + max(left, right);
    }
};
```

**Example**

```text
Input: root = [1,2,3,4,5]
Output: 3
```

**Notes**

- 


## 41 Path Sum II (void backtracking on a tree)

**Exercises:** array, tree, recursion (22 calls) · **Steps:** 120 · **Ends:** returns

**Watch for:** Void recursion: the call-stack card instead of the recursion card; `path` pushes and pops.

**Code**

```cpp
/**
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
    vector<vector<int>> pathSum(TreeNode* root, int targetSum) {
        vector<vector<int>> result;
        vector<int> path;
        dfs(root, targetSum, path, result);
        return result;
    }

    void dfs(TreeNode* node, int remaining, vector<int>& path, vector<vector<int>>& result) {
        if (node == nullptr) return;
        path.push_back(node->val);
        remaining -= node->val;
        if (node->left == nullptr && node->right == nullptr && remaining == 0) {
            result.push_back(path);
        }
        dfs(node->left, remaining, path, result);
        dfs(node->right, remaining, path, result);
        path.pop_back();
    }
};
```

**Example**

```text
Input: root = [5,4,8,11,null,13,4,7,2,null,null,5,1], targetSum = 22
Output: [[5,4,11,2],[5,8,4,5]]
```

**Notes**

- 


## 42 Average of Levels (doubles)

**Exercises:** array, queue, tree, doubles · **Steps:** 55 · **Ends:** returns

**Watch for:** Floating-point values: `sum` as a double, `result` an array of floats like `14.5`.

**Code**

```cpp
/**
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
    vector<double> averageOfLevels(TreeNode* root) {
        vector<double> result;
        queue<TreeNode*> q;
        q.push(root);
        while (!q.empty()) {
            int size = q.size();
            double sum = 0;
            for (int i = 0; i < size; i++) {
                TreeNode* node = q.front();
                q.pop();
                sum += node->val;
                if (node->left) q.push(node->left);
                if (node->right) q.push(node->right);
            }
            result.push_back(sum / size);
        }
        return result;
    }
};
```

**Example**

```text
Input: root = [3,9,20,null,null,15,7]
Output: [3.0,14.5,11.0]
```

**Notes**

- 


---

# Graphs

## 43 Clone Graph (graph nodes, BFS, map of node to node)

**Exercises:** map, queue, graph · **Steps:** 50 · **Ends:** returns

**Watch for:** Two graphs: the input and the clone being built. Known rough edge: the clone card's title and reserved space.

**Code**

```cpp
/*
// Definition for a Node.
class Node {
public:
    int val;
    vector<Node*> neighbors;
    Node() {
        val = 0;
        neighbors = vector<Node*>();
    }
    Node(int _val) {
        val = _val;
        neighbors = vector<Node*>();
    }
    Node(int _val, vector<Node*> _neighbors) {
        val = _val;
        neighbors = _neighbors;
    }
};
*/

class Solution {
public:
    Node* cloneGraph(Node* node) {
        if (node == nullptr) return nullptr;
        unordered_map<Node*, Node*> copies;
        queue<Node*> q;
        q.push(node);
        copies[node] = new Node(node->val);
        while (!q.empty()) {
            Node* curr = q.front();
            q.pop();
            for (Node* neighbor : curr->neighbors) {
                if (!copies.count(neighbor)) {
                    copies[neighbor] = new Node(neighbor->val);
                    q.push(neighbor);
                }
                copies[curr]->neighbors.push_back(copies[neighbor]);
            }
        }
        return copies[node];
    }
};
```

**Example**

```text
Input: adjList = [[2,4],[1,3],[2,4],[1,3]]
Output: [[2,4],[1,3],[2,4],[1,3]]
```

**Notes**

- 


## 44 Number of Islands (void DFS on a char grid)

**Exercises:** array, recursion (19 calls) · **Steps:** 102 · **Ends:** returns

**Watch for:** A grid of chars changed in place by a void recursive DFS: the call-stack card while nested.

**Code**

```cpp
class Solution {
public:
    int numIslands(vector<vector<char>>& grid) {
        int count = 0;
        for (int r = 0; r < (int)grid.size(); r++) {
            for (int c = 0; c < (int)grid[0].size(); c++) {
                if (grid[r][c] == '1') {
                    count++;
                    sink(grid, r, c);
                }
            }
        }
        return count;
    }

    void sink(vector<vector<char>>& grid, int r, int c) {
        if (r < 0 || c < 0 || r >= (int)grid.size() || c >= (int)grid[0].size() || grid[r][c] != '1') return;
        grid[r][c] = '0';
        sink(grid, r + 1, c);
        sink(grid, r - 1, c);
        sink(grid, r, c + 1);
        sink(grid, r, c - 1);
    }
};
```

**Example**

```text
Input: grid = [["1","1","0"],["0","1","0"],["0","0","1"]]
Output: 2
```

**Notes**

- 


## 45 Course Schedule (adjacency list local, Kahn's BFS)

**Exercises:** array, queue · **Steps:** 56 · **Ends:** returns

**Watch for:** `prerequisites` starts as a graph ("auto, from the name"); open its View menu to set the direction to `[a, b] is b → a`. `adj` is a local, so it starts as rows: pick "Graph (adjacency list)" in its menu and watch the arrows fill in.

**Code**

```cpp
class Solution {
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
```

**Example**

```text
Input: numCourses = 4, prerequisites = [[1,0],[2,0],[3,1],[3,2]]
Output: true
```

**Notes**

- 


## 46 Network Delay Time (Dijkstra, heap of pairs)

**Exercises:** array, heap, pair · **Steps:** 56 · **Ends:** returns

**Watch for:** `times` drawn as a weighted graph from its edge list (each weight beside its edge); weighted adjacency of pairs, a min-heap of (distance, node), and `dist` with `INT_MAX` values. `u` and `v` (structured bindings) get markers under `dist`, and `u` one under `graph`; on the first step of `for (auto& [v, w] : graph[u])` the row `graph[u]` has a dashed read outline (a ring on node `u` in the graph view). Nodes 1 and 4 have no outgoing edges, so their loops have no step and no read.

**Code**

```cpp
class Solution {
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
```

**Example**

```text
Input: times = [[2,1,1],[2,3,1],[3,4,1]], n = 4, k = 2
Output: 2
```

**Notes**

- 


## 47 Redundant Connection (union-find with path compression)

**Exercises:** array, recursion (9 calls) · **Steps:** 52 · **Ends:** returns

**Watch for:** `edges` drawn as a graph from its pairs; `parent` array changing as sets merge; a recursive `find` that returns values (recursion card).

**Code**

```cpp
class Solution {
public:
    vector<int> findRedundantConnection(vector<vector<int>>& edges) {
        vector<int> parent(edges.size() + 1);
        for (int i = 0; i < (int)parent.size(); i++) parent[i] = i;
        for (auto& e : edges) {
            int a = find(parent, e[0]);
            int b = find(parent, e[1]);
            if (a == b) return e;
            parent[a] = b;
        }
        return {};
    }

    int find(vector<int>& parent, int x) {
        if (parent[x] != x) {
            parent[x] = find(parent, parent[x]);
        }
        return parent[x];
    }
};
```

**Example**

```text
Input: edges = [[1,2],[1,3],[2,3]]
Output: [2,3]
```

**Notes**

- 


---

# Recursion and dynamic programming

## 48 Fibonacci Number (plain recursion)

**Exercises:** recursion (15 calls) · **Steps:** 45 · **Ends:** returns

**Watch for:** The recursion tree: every call with its return value; base cases amber; the return-to-caller arrow.

**Code**

```cpp
class Solution {
public:
    int fib(int n) {
        if (n <= 1) {
            return n;
        }
        return fib(n - 1) + fib(n - 2);
    }
};
```

**Example**

```text
Input: n = 5
Output: 5
```

**Notes**

- 


## 49 Fibonacci, large (recursion tree folding)

**Exercises:** recursion (109 calls) · **Steps:** 327 · **Ends:** returns

**Watch for:** 109 calls, past the 80-call limit: finished branches fold into one box and the path to the running call stays whole.

**Code**

```cpp
class Solution {
public:
    int fib(int n) {
        if (n <= 1) {
            return n;
        }
        return fib(n - 1) + fib(n - 2);
    }
};
```

**Example**

```text
Input: n = 9
Output: 34
```

**Notes**

- 


## 50 Climbing Stairs (memoized recursion, map by reference)

**Exercises:** map, recursion (10 calls) · **Steps:** 40 · **Ends:** returns

**Watch for:** A memo map passed by reference: callers see it fill in; later calls return at once.

**Code**

```cpp
class Solution {
public:
    int climbStairs(int n) {
        unordered_map<int, int> memo;
        return ways(n, memo);
    }

    int ways(int n, unordered_map<int, int>& memo) {
        if (n <= 2) return n;
        if (memo.count(n)) return memo[n];
        memo[n] = ways(n - 1, memo) + ways(n - 2, memo);
        return memo[n];
    }
};
```

**Example**

```text
Input: n = 6
Output: 13
```

**Notes**

- 


## 51 Coin Change (1D DP table)

**Exercises:** array · **Steps:** 110 · **Ends:** returns

**Watch for:** `dp` filled left to right, `amount + 1` as infinity, `i` under `dp`. Since v0.12 `dp[i - coin]` gives `coin` no marker; `dp[amount]` still pins `amount` on `dp`'s last cell, since that index is `amount` itself.

**Code**

```cpp
class Solution {
public:
    int coinChange(vector<int>& coins, int amount) {
        vector<int> dp(amount + 1, amount + 1);
        dp[0] = 0;
        for (int i = 1; i <= amount; i++) {
            for (int coin : coins) {
                if (coin <= i) {
                    dp[i] = min(dp[i], dp[i - coin] + 1);
                }
            }
        }
        return dp[amount] > amount ? -1 : dp[amount];
    }
};
```

**Example**

```text
Input: coins = [1,2,5], amount = 11
Output: 3
```

**Notes**

- 


## 52 Unique Paths (2D DP table)

**Exercises:** array · **Steps:** 20 · **Ends:** returns

**Watch for:** A 2D `dp` grid filled row by row: a strong case for a grid view.

**Code**

```cpp
class Solution {
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
```

**Example**

```text
Input: m = 3, n = 4
Output: 10
```

**Notes**

- 


## 53 Longest Common Subsequence (2D DP over two strings)

**Exercises:** array · **Steps:** 60 · **Ends:** returns

**Watch for:** Two strings and a (m+1) x (n+1) table; check readability of a bigger nested array. Known flaw: `dp[m][n]` pins an `m` marker on `dp`'s last row for the whole run.

**Code**

```cpp
class Solution {
public:
    int longestCommonSubsequence(string text1, string text2) {
        int m = text1.size(), n = text2.size();
        vector<vector<int>> dp(m + 1, vector<int>(n + 1, 0));
        for (int i = 1; i <= m; i++) {
            for (int j = 1; j <= n; j++) {
                if (text1[i - 1] == text2[j - 1]) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }
        return dp[m][n];
    }
};
```

**Example**

```text
Input: text1 = "abcde", text2 = "ace"
Output: 3
```

**Notes**

- 


## 54 Subsets (backtracking, void)

**Exercises:** array, recursion (9 calls) · **Steps:** 57 · **Ends:** returns

**Watch for:** The fixture problem: `i` under `nums` only, `start` with no marker; call-stack card.

**Code**

```cpp
class Solution {
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
```

**Example**

```text
Input: nums = [1,2,3]
Output: [[],[1],[1,2],[1,2,3],[1,3],[2],[2,3],[3]]
```

**Notes**

- 


## 55 Permutations (backtracking with a used array of bools)

**Exercises:** array, recursion (17 calls) · **Steps:** 210 · **Ends:** returns

**Watch for:** `vector<bool> used` flipping true/false; deeper call stack than Subsets.

**Code**

```cpp
class Solution {
public:
    vector<vector<int>> permute(vector<int>& nums) {
        vector<vector<int>> result;
        vector<int> path;
        vector<bool> used(nums.size(), false);
        build(nums, used, path, result);
        return result;
    }

    void build(vector<int>& nums, vector<bool>& used, vector<int>& path, vector<vector<int>>& result) {
        if (path.size() == nums.size()) {
            result.push_back(path);
            return;
        }
        for (int i = 0; i < (int)nums.size(); i++) {
            if (used[i]) continue;
            used[i] = true;
            path.push_back(nums[i]);
            build(nums, used, path, result);
            path.pop_back();
            used[i] = false;
        }
    }
};
```

**Example**

```text
Input: nums = [1,2,3]
Output: [[1,2,3],[1,3,2],[2,1,3],[2,3,1],[3,1,2],[3,2,1]]
```

**Notes**

- 


## 56 Generate Parentheses (string built by recursion)

**Exercises:** array, recursion (9 calls) · **Steps:** 43 · **Ends:** returns

**Watch for:** A string parameter passed by value, growing per call; void recursion with two branches.

**Code**

```cpp
class Solution {
public:
    vector<string> generateParenthesis(int n) {
        vector<string> result;
        build("", 0, 0, n, result);
        return result;
    }

    void build(string current, int open, int close, int n, vector<string>& result) {
        if ((int)current.size() == 2 * n) {
            result.push_back(current);
            return;
        }
        if (open < n) build(current + "(", open + 1, close, n, result);
        if (close < open) build(current + ")", open, close + 1, n, result);
    }
};
```

**Example**

```text
Input: n = 2
Output: ["(())","()()"]
```

**Notes**

- 


## 57 Pow(x, n) (recursion with doubles)

**Exercises:** doubles, recursion (4 calls) · **Steps:** 17 · **Ends:** returns · **Method:** `myPow`

**Watch for:** Two public methods take `(x, n)` (`myPow` and the helper `fast`), so the inputs panel shows a Method picker: check it preselects `myPow`. Then: double return values in the recursion boxes, and a negative exponent.

**Code**

```cpp
class Solution {
public:
    double myPow(double x, int n) {
        long long power = n;
        if (power < 0) {
            x = 1 / x;
            power = -power;
        }
        return fast(x, power);
    }

    double fast(double x, long long n) {
        if (n == 0) return 1.0;
        double half = fast(x, n / 2);
        return n % 2 == 0 ? half * half : half * half * x;
    }
};
```

**Example**

```text
Input: x = 2.00000, n = -2
Output: 0.25
```

**Notes**

- 


---

# Numbers and bits

## 58 Single Number (XOR)

**Exercises:** array · **Steps:** 13 · **Ends:** returns

**Watch for:** A single scalar changing each step; nothing on the canvas but `nums`.

**Code**

```cpp
class Solution {
public:
    int singleNumber(vector<int>& nums) {
        int result = 0;
        for (int x : nums) {
            result ^= x;
        }
        return result;
    }
};
```

**Example**

```text
Input: nums = [4,1,2,1,2]
Output: 4
```

**Notes**

- 


## 59 Number of 1 Bits (unsigned, shifts)

**Exercises:** scalars · **Steps:** 16 · **Ends:** returns

**Watch for:** An unsigned `uint32_t` shifting right; values in the locals table each step.

**Code**

```cpp
class Solution {
public:
    int hammingWeight(uint32_t n) {
        int count = 0;
        while (n != 0) {
            count += n & 1;
            n >>= 1;
        }
        return count;
    }
};
```

**Example**

```text
Input: n = 11
Output: 3
```

**Notes**

- 


## 60 Sqrt(x) (binary search with long long)

**Exercises:** scalars · **Steps:** 136 · **Ends:** returns

**Watch for:** `mid * mid` computed in `long long`; `lo`/`hi` are not indexes into anything, so no markers.

**Code**

```cpp
class Solution {
public:
    int mySqrt(int x) {
        long long lo = 0, hi = x, answer = 0;
        while (lo <= hi) {
            long long mid = lo + (hi - lo) / 2;
            if (mid * mid <= x) {
                answer = mid;
                lo = mid + 1;
            } else {
                hi = mid - 1;
            }
        }
        return answer;
    }
};
```

**Example**

```text
Input: x = 2147395599
Output: 46339
```

**Notes**

- 


## 61 Reverse Integer (overflow check)

**Exercises:** scalars · **Steps:** 22 · **Ends:** returns

**Watch for:** Negative numbers, `INT_MAX / 10` comparisons, and a zero result on overflow.

**Code**

```cpp
class Solution {
public:
    int reverse(int x) {
        int result = 0;
        while (x != 0) {
            int digit = x % 10;
            x /= 10;
            if (result > INT_MAX / 10 || (result == INT_MAX / 10 && digit > 7)) return 0;
            if (result < INT_MIN / 10 || (result == INT_MIN / 10 && digit < -8)) return 0;
            result = result * 10 + digit;
        }
        return result;
    }
};
```

**Example**

```text
Input: x = -123
Output: -321
```

**Notes**

- 


---

# Edge cases and failures

## 62 Empty input

**Exercises:** array · **Steps:** 3 · **Ends:** returns

**Watch for:** An empty array card (`array · 0`); a run of very few steps.

**Code**

```cpp
class Solution {
public:
    int maxSubArray(vector<int>& nums) {
        int best = INT_MIN, current = 0;
        for (int x : nums) {
            current = max(x, current + x);
            best = max(best, current);
        }
        return best;
    }
};
```

**Example**

```text
Input: nums = []
Output: -2147483648
```

**Notes**

- 


## 63 Infinite loop (reaches the step cap)

**Exercises:** scalars · **Steps:** 2000 · **Ends:** step cap

**Watch for:** 2,000 steps, a `truncated` badge, and the result row saying it stopped at the step limit (not a wrong answer).

**Code**

```cpp
class Solution {
public:
    int countDown(int n) {
        int steps = 0;
        while (n > 0) {
            steps++;
            n++;
        }
        return steps;
    }
};
```

**Example**

```text
Input: n = 3
Output: (never returns)
```

**Notes**

- 


## 64 Crash (null pointer)

**Exercises:** — · **Steps:** — · **Ends:** crashes

**Watch for:** The red card in the inputs panel: how the crash is worded, and whether any steps are kept.

**Code**

```cpp
/**
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
    int secondValue(ListNode* head) {
        return head->next->next->val;
    }
};
```

**Example**

```text
Input: head = [1]
Output: (crashes)
```

**Notes**

- 


## 65 Compile error

**Exercises:** — · **Steps:** — · **Ends:** compile error

**Watch for:** Clang's message with the line number, in the red card; the editor keeps your code.

**Code**

```cpp
class Solution {
public:
    int addOne(int n) {
        int result = n + 1
        return result;
    }
};
```

**Example**

```text
Input: n = 4
Output: (does not compile)
```

**Notes**

- 


## 66 Example names that do not match

**Exercises:** — · **Steps:** — · **Ends:** input error

**Watch for:** Pasting an example whose names are not the parameters: what the fill note and Run say.

**Code**

```cpp
class Solution {
public:
    int add(int a, int b) {
        return a + b;
    }
};
```

**Example**

```text
Input: a = 1, c = 2
Output: (cannot run)
```

**Notes**

- 


## 67 Long single line (statement cut with an ellipsis)

**Exercises:** array · **Steps:** 12 · **Ends:** returns

**Watch for:** A very long statement on the running line: it should be cut with `…`, full text on hover.

**Code**

```cpp
class Solution {
public:
    int score(vector<int>& nums) {
        int total = 0;
        for (int i = 0; i < (int)nums.size(); i++) {
            total += (nums[i] % 2 == 0 ? nums[i] * 3 + (i > 0 ? nums[i - 1] : 0) : nums[i] - (i + 1 < (int)nums.size() ? nums[i + 1] : 0)) + (total > 10 ? 1 : 0);
        }
        return total;
    }
};
```

**Example**

```text
Input: nums = [4,7,2,9]
Output: 42
```

**Notes**

-


# Member variables

## 68 Climbing Stairs (memo as a member)

**Exercises:** map (member), recursion (9 calls) · **Steps:** 28 · **Ends:** returns

**Watch for:** `memo` is a member of `Solution`, not a local: one card with a `member` tag, the same at every depth of the recursion, filling as calls return. `memo.count(n)` and `memo[n]` outline the entry they found (v0.12). The state panel lists `memo` under "Members of Solution".

**Code**

```cpp
class Solution {
    unordered_map<int, int> memo;
public:
    int climbStairs(int n) {
        if (n <= 2) return n;
        if (memo.count(n)) return memo[n];
        memo[n] = climbStairs(n - 1) + climbStairs(n - 2);
        return memo[n];
    }
};
```

**Example**

```text
Input: n = 5
Output: 8
```

**Notes**

- 


# View as

## 69 Merge Intervals (intervals hint)

**Exercises:** array (intervals view) · **Steps:** 17 · **Ends:** returns

**Watch for:** `intervals` drawn as bars on a number line ("auto, from the name"), with `i` beside the row it is on and the row each line reads dashed. `merged` is a local, so it starts as a grid: pick "Intervals" in its View menu and the two cards share one number line. The bar that grows turns amber.

**Code**

```cpp
class Solution {
public:
    vector<vector<int>> merge(vector<vector<int>>& intervals) {
        sort(intervals.begin(), intervals.end());
        vector<vector<int>> merged;
        for (int i = 0; i < (int)intervals.size(); i++) {
            if (merged.empty() || merged.back()[1] < intervals[i][0]) {
                merged.push_back(intervals[i]);
            } else {
                merged.back()[1] = max(merged.back()[1], intervals[i][1]);
            }
        }
        return merged;
    }
};
```

**Example**

```text
Input: intervals = [[1,3],[2,6],[8,10],[15,18]]
Output: [[1,6],[8,10],[15,18]]
```

**Notes**

- 


## 70 Number of Provinces (adjacency matrix hint)

**Exercises:** array (graph view), recursion · **Steps:** 44 · **Ends:** returns

**Watch for:** `isConnected` drawn as a graph from its matrix (0 and 1 joined, 2 alone); the edge `isConnected[u][v]` lights up when it is read. Switch it to Grid and back in its View menu; the dimmed options say why they do not fit.

**Code**

```cpp
class Solution {
public:
    int findCircleNum(vector<vector<int>>& isConnected) {
        int n = isConnected.size(), count = 0;
        vector<bool> seen(n, false);
        for (int i = 0; i < n; i++) {
            if (seen[i]) continue;
            count++;
            visit(isConnected, seen, i);
        }
        return count;
    }
    void visit(vector<vector<int>>& isConnected, vector<bool>& seen, int u) {
        seen[u] = true;
        for (int v = 0; v < (int)isConnected.size(); v++) {
            if (isConnected[u][v] == 1 && !seen[v]) visit(isConnected, seen, v);
        }
    }
};
```

**Example**

```text
Input: isConnected = [[1,1,0],[1,1,0],[0,0,1]]
Output: 2
```

**Notes**

- 


# Python

The same page with **Python** chosen in the top bar. These run through the Python adapter ([`docs/adapters/python.md`](adapters/python.md)); what they show should look like the C++ cases for the same structures.

## 71 Two Sum (dict, in)

**Exercises:** array, map · **Steps:** 18 · **Ends:** returns

**Watch for:** `i` marker under `nums`; `numMap` gains one entry per pass; the `in` check outlines the entry it found on the last pass.

**Code**

```python
class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        numMap = {}
        for i in range(len(nums)):
            complement = target - nums[i]
            if complement in numMap:
                return [numMap[complement], i]
            numMap[nums[i]] = i
        return []
```

**Example**

```text
Input: nums = [3,2,4,6], target = 10
Output: [2,3]
```

**Notes**

- 


## 72 Valid Parentheses (list as a stack)

**Exercises:** array, map · **Steps:** 26 · **Ends:** returns

**Watch for:** `stack` is a list, so it is drawn as an array that grows and shrinks at its end; `pairs[c]` is outlined when read.

**Code**

```python
class Solution:
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
```

**Example**

```text
Input: s = "([]{})"
Output: true
```

**Notes**

- 


## 73 Kth Largest Element (heapq min-heap)

**Exercises:** priority queue (min) · **Steps:** 26 · **Ends:** returns

**Watch for:** `heap` is drawn as a min priority queue, not an array, because the code passes it to `heapq`; the smallest of the k largest stays on top.

**Code**

```python
class Solution:
    def findKthLargest(self, nums: List[int], k: int) -> int:
        heap = []
        for x in nums:
            heapq.heappush(heap, x)
            if len(heap) > k:
                heapq.heappop(heap)
        return heap[0]
```

**Example**

```text
Input: nums = [3,2,1,5,6,4], k = 2
Output: 5
```

**Notes**

- 


## 74 Top K Frequent Elements (Counter, heap of tuples)

**Exercises:** map, priority queue of tuples · **Steps:** 15 · **Ends:** returns

**Watch for:** `count` (a `Counter`) is a map; `heap` holds `(count, value)` tuples as a min priority queue.

**Code**

```python
class Solution:
    def topKFrequent(self, nums: List[int], k: int) -> List[int]:
        count = Counter(nums)
        heap = []
        for num, c in count.items():
            heappush(heap, (c, num))
            if len(heap) > k:
                heappop(heap)
        return [num for c, num in heap]
```

**Example**

```text
Input: nums = [1,1,1,2,2,3], k = 2
Output: [2,1]
```

**Notes**

- 


## 75 Number of Islands (deque BFS on a grid)

**Exercises:** array (grid), deque · **Steps:** 101 · **Ends:** returns

**Watch for:** `grid` as a grid of strings; `q` is a deque of tuples.

**Code**

```python
class Solution:
    def numIslands(self, grid: List[List[str]]) -> int:
        rows, cols = len(grid), len(grid[0])
        islands = 0
        for r in range(rows):
            for c in range(cols):
                if grid[r][c] == "1":
                    islands += 1
                    grid[r][c] = "0"
                    q = deque([(r, c)])
                    while q:
                        x, y = q.popleft()
                        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
                            nx, ny = x + dx, y + dy
                            if 0 <= nx < rows and 0 <= ny < cols and grid[nx][ny] == "1":
                                grid[nx][ny] = "0"
                                q.append((nx, ny))
        return islands
```

**Example**

```text
Input: grid = [["1","1","0"],["0","1","0"],["0","0","1"]]
Output: 2
```

**Notes**

- 


## 76 Contains Duplicate III (SortedList)

**Exercises:** multiset (SortedList) · **Steps:** 38 · **Ends:** returns

**Watch for:** `window` is a `SortedList`, drawn as a multiset; `bisect_left` gives a position, not an iterator.

**Code**

```python
class Solution:
    def containsNearbyAlmostDuplicate(self, nums: List[int], indexDiff: int, valueDiff: int) -> bool:
        window = SortedList()
        for i, x in enumerate(nums):
            j = window.bisect_left(x - valueDiff)
            if j < len(window) and window[j] <= x + valueDiff:
                return True
            window.add(x)
            if i >= indexDiff:
                window.remove(nums[i - indexDiff])
        return False
```

**Example**

```text
Input: nums = [1,5,9,1,5,9], indexDiff = 2, valueDiff = 3
Output: false
```

**Notes**

- 


## 77 Reverse Linked List (Optional[ListNode])

**Exercises:** linked list · **Steps:** 29 · **Ends:** returns

**Watch for:** The same picture as the C++ case: `prev`, `curr`, and `nxt` as tags on the nodes, the arrow turning one link per pass.

**Code**

```python
# Definition for singly-linked list.
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
```

**Example**

```text
Input: head = [1,2,3,4,5]
Output: [5,4,3,2,1]
```

**Notes**

- 


## 78 Maximum Depth of Binary Tree (recursion)

**Exercises:** tree, recursion · **Steps:** 43 · **Ends:** returns

**Watch for:** The recursion card shows each call with its node and its return value; the tree's `root` tag moves with the call.

**Code**

```python
# Definition for a binary tree node.
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
```

**Example**

```text
Input: root = [3,9,20,null,null,15,7]
Output: 3
```

**Notes**

- 


## 79 Clone Graph (Node in a docstring)

**Exercises:** graph, map · **Steps:** 48 · **Ends:** returns

**Watch for:** LeetCode shows `Node` inside a triple-quoted string; it is read from there. Both graphs are drawn, the clone growing beside the original.

**Code**

```python
"""
# Definition for a Node.
class Node:
    def __init__(self, val = 0, neighbors = None):
        self.val = val
        self.neighbors = neighbors if neighbors is not None else []
"""

from typing import Optional
class Solution:
    def cloneGraph(self, node: Optional['Node']) -> Optional['Node']:
        if not node:
            return None
        clones = {node: Node(node.val)}
        q = deque([node])
        while q:
            cur = q.popleft()
            for nb in cur.neighbors:
                if nb not in clones:
                    clones[nb] = Node(nb.val)
                    q.append(nb)
                clones[cur].neighbors.append(clones[nb])
        return clones[node]
```

**Example**

```text
Input: adjList = [[2,4],[1,3],[2,4],[1,3]]
Output: [[2,4],[1,3],[2,4],[1,3]]
```

**Notes**

- 


## 80 Climbing Stairs (memo as a member)

**Exercises:** map (member), recursion · **Steps:** 31 · **Ends:** returns

**Watch for:** `memo` appears under Members from the step after `self.memo = {}`, not before; `self.memo[n]` reads are outlined.

**Code**

```python
class Solution:
    def climbStairs(self, n: int) -> int:
        self.memo = {}
        return self._ways(n)

    def _ways(self, n: int) -> int:
        if n <= 2:
            return n
        if n in self.memo:
            return self.memo[n]
        self.memo[n] = self._ways(n - 1) + self._ways(n - 2)
        return self.memo[n]
```

**Example**

```text
Input: n = 5
Output: 8
```

**Notes**

- 


## 81 Subsets (backtracking, path[:])

**Exercises:** array, recursion · **Steps:** 58 · **Ends:** returns

**Watch for:** `path[:]` copies, so `res` holds separate lists; `path` and the list inside `res` it was copied from are never marked as one.

**Code**

```python
class Solution:
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
```

**Example**

```text
Input: nums = [1,2,3]
Output: [[],[1],[1,2],[1,2,3],[1,3],[2],[2,3],[3]]
```

**Notes**

- 


## 82 Fibonacci with @cache (memo not shown)

**Exercises:** scalars, recursion · **Steps:** 27 · **Ends:** returns

**Watch for:** A known limitation: the `@cache` table lives inside `functools`, so no card shows it. The recursion card shows that each `fib(k)` is computed once.

**Code**

```python
class Solution:
    def fib(self, n: int) -> int:
        @cache
        def f(k: int) -> int:
            if k < 2:
                return k
            return f(k - 1) + f(k - 2)
        return f(n)
```

**Example**

```text
Input: n = 6
Output: 8
```

**Notes**

- 


## 83 Exception (index out of range)

**Exercises:** — · **Steps:** — · **Ends:** raises

**Watch for:** No trace: the error names `solution.py`, the line, and `IndexError`, with only your own frames in the traceback, and shows what was printed before it.

**Code**

```python
class Solution:
    def getLast(self, nums: List[int]) -> int:
        print("looking at", nums)
        return nums[len(nums)]
```

**Example**

```text
Input: nums = [1,2,3]
Output: (raises IndexError)
```

**Notes**

- 


## 84 Infinite loop (reaches the step cap)

**Exercises:** scalars · **Steps:** 2000 · **Ends:** step cap

**Watch for:** The trace stops at 2,000 steps with no result, and the page says it was cut off.

**Code**

```python
class Solution:
    def spin(self, n: int) -> int:
        while n > 0:
            n += 1
        return n
```

**Example**

```text
Input: n = 1
Output: (never returns)
```

**Notes**

- 


# Java

The same page with **Java** chosen in the top bar. These run through the Java adapter ([`docs/adapters/java.md`](adapters/java.md)). With cases 93 and 94 below, the eight problems of the sandbox's Examples menu exist in all three languages.

## 85 Two Sum (HashMap, containsKey)

**Exercises:** array, map · **Steps:** 18 · **Ends:** returns

**Watch for:** `i` marker under `nums`; `numMap` gains one entry per pass (`numMap.put` shows as a store to `numMap[nums[i]]`); the `containsKey` check outlines the entry it found.

**Code**

```java
class Solution {
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
```

**Example**

```text
Input: nums = [3,2,4,6], target = 10
Output: [2,3]
```

**Notes**

- 


## 86 Container With Most Water (two pointers)

**Exercises:** array · **Steps:** 46 · **Ends:** returns

**Watch for:** `left` and `right` markers walk in from both ends of `height`; `best` grows as wider or taller pairs are found.

**Code**

```java
class Solution {
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
```

**Example**

```text
Input: height = [1,8,6,2,5,4,8,3,7]
Output: 49
```

**Notes**

- 


## 87 Valid Parentheses (Deque used as a stack)

**Exercises:** stack · **Steps:** 27 · **Ends:** returns

**Watch for:** `st` is an `ArrayDeque`, but the code only pushes, pops, and peeks, so it is drawn as a stack: its top is the last item.

**Code**

```java
class Solution {
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
```

**Example**

```text
Input: s = "([]{})"
Output: true
```

**Notes**

- 


## 88 Reverse Linked List (three pointers)

**Exercises:** linked list · **Steps:** 30 · **Ends:** returns

**Watch for:** `prev`, `curr`, and `nextTemp` as tags on the nodes; one link turns per pass, as in the C++ case.

**Code**

```java
/**
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
```

**Example**

```text
Input: head = [1,2,3,4,5]
Output: [5,4,3,2,1]
```

**Notes**

- 


## 89 Maximum Depth of Binary Tree (recursion)

**Exercises:** tree, recursion · **Steps:** 43 · **Ends:** returns

**Watch for:** The recursion card shows each call with its node and what it returned; `root` moves down the tree with the calls.

**Code**

```java
/**
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
```

**Example**

```text
Input: root = [3,9,20,null,null,15,7]
Output: 3
```

**Notes**

- 


## 90 Number of Islands (void DFS on a char grid)

**Exercises:** array (grid), recursion · **Steps:** 102 · **Ends:** returns

**Watch for:** `grid` as a grid of characters; each land cell turns to water as `sink` reaches it, and the call-stack card shows the void recursion.

**Code**

```java
class Solution {
    public int numIslands(char[][] grid) {
        int count = 0;
        for (int r = 0; r < grid.length; r++) {
            for (int c = 0; c < grid[0].length; c++) {
                if (grid[r][c] == '1') {
                    count++;
                    sink(grid, r, c);
                }
            }
        }
        return count;
    }

    private void sink(char[][] grid, int r, int c) {
        if (r < 0 || c < 0 || r >= grid.length || c >= grid[0].length || grid[r][c] != '1') return;
        grid[r][c] = '0';
        sink(grid, r + 1, c);
        sink(grid, r - 1, c);
        sink(grid, r, c + 1);
        sink(grid, r, c - 1);
    }
}
```

**Example**

```text
Input: grid = [["1","1","0"],["0","1","0"],["0","0","1"]]
Output: 2
```

**Notes**

- 


## 91 Subsets (backtracking, void)

**Exercises:** array, recursion · **Steps:** 57 · **Ends:** returns

**Watch for:** `path` grows and shrinks; `result` gains a copy at each call (`new ArrayList<>(path)`), so no two of its lists are marked as one.

**Code**

```java
class Solution {
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
```

**Example**

```text
Input: nums = [1,2,3]
Output: [[],[1],[1,2],[1,2,3],[1,3],[2],[2,3],[3]]
```

**Notes**

- 


## 92 Climbing Stairs (memo as a member)

**Exercises:** map (member), recursion · **Steps:** 28 · **Ends:** returns

**Watch for:** `memo` is a field of Solution, shown under Members at every step; `memo.containsKey(n)` and `memo.get(n)` outline the entry they read.

**Code**

```java
class Solution {
    private Map<Integer, Integer> memo = new HashMap<>();

    public int climbStairs(int n) {
        if (n <= 2) return n;
        if (memo.containsKey(n)) return memo.get(n);
        memo.put(n, climbStairs(n - 1) + climbStairs(n - 2));
        return memo.get(n);
    }
}
```

**Example**

```text
Input: n = 5
Output: 8
```

**Notes**

- 


# More for the Examples menu

The C++ and Python versions of Examples menu problems that the sections above did not have.

## 93 Maximum Depth of Binary Tree (recursion)

**Exercises:** tree, recursion · **Steps:** 43 · **Ends:** returns

**Watch for:** The recursion card shows each call with its node and what it returned, as in the Python and Java cases.

**Code**

```cpp
/**
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
```

**Example**

```text
Input: root = [3,9,20,null,null,15,7]
Output: 3
```

**Notes**

- 


## 94 Container With Most Water (two pointers)

**Exercises:** array · **Steps:** 45 · **Ends:** returns

**Watch for:** `left` and `right` markers walk in from both ends of `height`, as in the C++ and Java cases.

**Code**

```python
class Solution:
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
```

**Example**

```text
Input: height = [1,8,6,2,5,4,8,3,7]
Output: 49
```

**Notes**

- 

## 95 Two Sum on 3,000 numbers (the size limit)

**Exercises:** array · map · **Steps:** 588 in C++, 583 in Python and Java · **Ends:** truncated at the size limit (no result)

**Watch for:** the run stops recording after about 580 steps, at the size limit, not the step limit. The state panel's `truncated` badge says so on hover, and on the last step the result row reads "did not return: stopped at the size limit", with a tooltip suggesting a smaller input. Do it in each of C++, Python, and Java (open Two Sum from the Examples menu in each, then replace the inputs).

**Code**

The Two Sum example from the Examples menu, in any of the three languages.

**Example**

```text
Input: nums = [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20,21,22,23,24,25,26,27,28,29,30,31,32,33,34,35,36,37,38,39,40,41,42,43,44,45,46,47,48,49,50,51,52,53,54,55,56,57,58,59,60,61,62,63,64,65,66,67,68,69,70,71,72,73,74,75,76,77,78,79,80,81,82,83,84,85,86,87,88,89,90,91,92,93,94,95,96,97,98,99,100,101,102,103,104,105,106,107,108,109,110,111,112,113,114,115,116,117,118,119,120,121,122,123,124,125,126,127,128,129,130,131,132,133,134,135,136,137,138,139,140,141,142,143,144,145,146,147,148,149,150,151,152,153,154,155,156,157,158,159,160,161,162,163,164,165,166,167,168,169,170,171,172,173,174,175,176,177,178,179,180,181,182,183,184,185,186,187,188,189,190,191,192,193,194,195,196,197,198,199,200,201,202,203,204,205,206,207,208,209,210,211,212,213,214,215,216,217,218,219,220,221,222,223,224,225,226,227,228,229,230,231,232,233,234,235,236,237,238,239,240,241,242,243,244,245,246,247,248,249,250,251,252,253,254,255,256,257,258,259,260,261,262,263,264,265,266,267,268,269,270,271,272,273,274,275,276,277,278,279,280,281,282,283,284,285,286,287,288,289,290,291,292,293,294,295,296,297,298,299,300,301,302,303,304,305,306,307,308,309,310,311,312,313,314,315,316,317,318,319,320,321,322,323,324,325,326,327,328,329,330,331,332,333,334,335,336,337,338,339,340,341,342,343,344,345,346,347,348,349,350,351,352,353,354,355,356,357,358,359,360,361,362,363,364,365,366,367,368,369,370,371,372,373,374,375,376,377,378,379,380,381,382,383,384,385,386,387,388,389,390,391,392,393,394,395,396,397,398,399,400,401,402,403,404,405,406,407,408,409,410,411,412,413,414,415,416,417,418,419,420,421,422,423,424,425,426,427,428,429,430,431,432,433,434,435,436,437,438,439,440,441,442,443,444,445,446,447,448,449,450,451,452,453,454,455,456,457,458,459,460,461,462,463,464,465,466,467,468,469,470,471,472,473,474,475,476,477,478,479,480,481,482,483,484,485,486,487,488,489,490,491,492,493,494,495,496,497,498,499,500,501,502,503,504,505,506,507,508,509,510,511,512,513,514,515,516,517,518,519,520,521,522,523,524,525,526,527,528,529,530,531,532,533,534,535,536,537,538,539,540,541,542,543,544,545,546,547,548,549,550,551,552,553,554,555,556,557,558,559,560,561,562,563,564,565,566,567,568,569,570,571,572,573,574,575,576,577,578,579,580,581,582,583,584,585,586,587,588,589,590,591,592,593,594,595,596,597,598,599,600,601,602,603,604,605,606,607,608,609,610,611,612,613,614,615,616,617,618,619,620,621,622,623,624,625,626,627,628,629,630,631,632,633,634,635,636,637,638,639,640,641,642,643,644,645,646,647,648,649,650,651,652,653,654,655,656,657,658,659,660,661,662,663,664,665,666,667,668,669,670,671,672,673,674,675,676,677,678,679,680,681,682,683,684,685,686,687,688,689,690,691,692,693,694,695,696,697,698,699,700,701,702,703,704,705,706,707,708,709,710,711,712,713,714,715,716,717,718,719,720,721,722,723,724,725,726,727,728,729,730,731,732,733,734,735,736,737,738,739,740,741,742,743,744,745,746,747,748,749,750,751,752,753,754,755,756,757,758,759,760,761,762,763,764,765,766,767,768,769,770,771,772,773,774,775,776,777,778,779,780,781,782,783,784,785,786,787,788,789,790,791,792,793,794,795,796,797,798,799,800,801,802,803,804,805,806,807,808,809,810,811,812,813,814,815,816,817,818,819,820,821,822,823,824,825,826,827,828,829,830,831,832,833,834,835,836,837,838,839,840,841,842,843,844,845,846,847,848,849,850,851,852,853,854,855,856,857,858,859,860,861,862,863,864,865,866,867,868,869,870,871,872,873,874,875,876,877,878,879,880,881,882,883,884,885,886,887,888,889,890,891,892,893,894,895,896,897,898,899,900,901,902,903,904,905,906,907,908,909,910,911,912,913,914,915,916,917,918,919,920,921,922,923,924,925,926,927,928,929,930,931,932,933,934,935,936,937,938,939,940,941,942,943,944,945,946,947,948,949,950,951,952,953,954,955,956,957,958,959,960,961,962,963,964,965,966,967,968,969,970,971,972,973,974,975,976,977,978,979,980,981,982,983,984,985,986,987,988,989,990,991,992,993,994,995,996,997,998,999,1000,1001,1002,1003,1004,1005,1006,1007,1008,1009,1010,1011,1012,1013,1014,1015,1016,1017,1018,1019,1020,1021,1022,1023,1024,1025,1026,1027,1028,1029,1030,1031,1032,1033,1034,1035,1036,1037,1038,1039,1040,1041,1042,1043,1044,1045,1046,1047,1048,1049,1050,1051,1052,1053,1054,1055,1056,1057,1058,1059,1060,1061,1062,1063,1064,1065,1066,1067,1068,1069,1070,1071,1072,1073,1074,1075,1076,1077,1078,1079,1080,1081,1082,1083,1084,1085,1086,1087,1088,1089,1090,1091,1092,1093,1094,1095,1096,1097,1098,1099,1100,1101,1102,1103,1104,1105,1106,1107,1108,1109,1110,1111,1112,1113,1114,1115,1116,1117,1118,1119,1120,1121,1122,1123,1124,1125,1126,1127,1128,1129,1130,1131,1132,1133,1134,1135,1136,1137,1138,1139,1140,1141,1142,1143,1144,1145,1146,1147,1148,1149,1150,1151,1152,1153,1154,1155,1156,1157,1158,1159,1160,1161,1162,1163,1164,1165,1166,1167,1168,1169,1170,1171,1172,1173,1174,1175,1176,1177,1178,1179,1180,1181,1182,1183,1184,1185,1186,1187,1188,1189,1190,1191,1192,1193,1194,1195,1196,1197,1198,1199,1200,1201,1202,1203,1204,1205,1206,1207,1208,1209,1210,1211,1212,1213,1214,1215,1216,1217,1218,1219,1220,1221,1222,1223,1224,1225,1226,1227,1228,1229,1230,1231,1232,1233,1234,1235,1236,1237,1238,1239,1240,1241,1242,1243,1244,1245,1246,1247,1248,1249,1250,1251,1252,1253,1254,1255,1256,1257,1258,1259,1260,1261,1262,1263,1264,1265,1266,1267,1268,1269,1270,1271,1272,1273,1274,1275,1276,1277,1278,1279,1280,1281,1282,1283,1284,1285,1286,1287,1288,1289,1290,1291,1292,1293,1294,1295,1296,1297,1298,1299,1300,1301,1302,1303,1304,1305,1306,1307,1308,1309,1310,1311,1312,1313,1314,1315,1316,1317,1318,1319,1320,1321,1322,1323,1324,1325,1326,1327,1328,1329,1330,1331,1332,1333,1334,1335,1336,1337,1338,1339,1340,1341,1342,1343,1344,1345,1346,1347,1348,1349,1350,1351,1352,1353,1354,1355,1356,1357,1358,1359,1360,1361,1362,1363,1364,1365,1366,1367,1368,1369,1370,1371,1372,1373,1374,1375,1376,1377,1378,1379,1380,1381,1382,1383,1384,1385,1386,1387,1388,1389,1390,1391,1392,1393,1394,1395,1396,1397,1398,1399,1400,1401,1402,1403,1404,1405,1406,1407,1408,1409,1410,1411,1412,1413,1414,1415,1416,1417,1418,1419,1420,1421,1422,1423,1424,1425,1426,1427,1428,1429,1430,1431,1432,1433,1434,1435,1436,1437,1438,1439,1440,1441,1442,1443,1444,1445,1446,1447,1448,1449,1450,1451,1452,1453,1454,1455,1456,1457,1458,1459,1460,1461,1462,1463,1464,1465,1466,1467,1468,1469,1470,1471,1472,1473,1474,1475,1476,1477,1478,1479,1480,1481,1482,1483,1484,1485,1486,1487,1488,1489,1490,1491,1492,1493,1494,1495,1496,1497,1498,1499,1500,1501,1502,1503,1504,1505,1506,1507,1508,1509,1510,1511,1512,1513,1514,1515,1516,1517,1518,1519,1520,1521,1522,1523,1524,1525,1526,1527,1528,1529,1530,1531,1532,1533,1534,1535,1536,1537,1538,1539,1540,1541,1542,1543,1544,1545,1546,1547,1548,1549,1550,1551,1552,1553,1554,1555,1556,1557,1558,1559,1560,1561,1562,1563,1564,1565,1566,1567,1568,1569,1570,1571,1572,1573,1574,1575,1576,1577,1578,1579,1580,1581,1582,1583,1584,1585,1586,1587,1588,1589,1590,1591,1592,1593,1594,1595,1596,1597,1598,1599,1600,1601,1602,1603,1604,1605,1606,1607,1608,1609,1610,1611,1612,1613,1614,1615,1616,1617,1618,1619,1620,1621,1622,1623,1624,1625,1626,1627,1628,1629,1630,1631,1632,1633,1634,1635,1636,1637,1638,1639,1640,1641,1642,1643,1644,1645,1646,1647,1648,1649,1650,1651,1652,1653,1654,1655,1656,1657,1658,1659,1660,1661,1662,1663,1664,1665,1666,1667,1668,1669,1670,1671,1672,1673,1674,1675,1676,1677,1678,1679,1680,1681,1682,1683,1684,1685,1686,1687,1688,1689,1690,1691,1692,1693,1694,1695,1696,1697,1698,1699,1700,1701,1702,1703,1704,1705,1706,1707,1708,1709,1710,1711,1712,1713,1714,1715,1716,1717,1718,1719,1720,1721,1722,1723,1724,1725,1726,1727,1728,1729,1730,1731,1732,1733,1734,1735,1736,1737,1738,1739,1740,1741,1742,1743,1744,1745,1746,1747,1748,1749,1750,1751,1752,1753,1754,1755,1756,1757,1758,1759,1760,1761,1762,1763,1764,1765,1766,1767,1768,1769,1770,1771,1772,1773,1774,1775,1776,1777,1778,1779,1780,1781,1782,1783,1784,1785,1786,1787,1788,1789,1790,1791,1792,1793,1794,1795,1796,1797,1798,1799,1800,1801,1802,1803,1804,1805,1806,1807,1808,1809,1810,1811,1812,1813,1814,1815,1816,1817,1818,1819,1820,1821,1822,1823,1824,1825,1826,1827,1828,1829,1830,1831,1832,1833,1834,1835,1836,1837,1838,1839,1840,1841,1842,1843,1844,1845,1846,1847,1848,1849,1850,1851,1852,1853,1854,1855,1856,1857,1858,1859,1860,1861,1862,1863,1864,1865,1866,1867,1868,1869,1870,1871,1872,1873,1874,1875,1876,1877,1878,1879,1880,1881,1882,1883,1884,1885,1886,1887,1888,1889,1890,1891,1892,1893,1894,1895,1896,1897,1898,1899,1900,1901,1902,1903,1904,1905,1906,1907,1908,1909,1910,1911,1912,1913,1914,1915,1916,1917,1918,1919,1920,1921,1922,1923,1924,1925,1926,1927,1928,1929,1930,1931,1932,1933,1934,1935,1936,1937,1938,1939,1940,1941,1942,1943,1944,1945,1946,1947,1948,1949,1950,1951,1952,1953,1954,1955,1956,1957,1958,1959,1960,1961,1962,1963,1964,1965,1966,1967,1968,1969,1970,1971,1972,1973,1974,1975,1976,1977,1978,1979,1980,1981,1982,1983,1984,1985,1986,1987,1988,1989,1990,1991,1992,1993,1994,1995,1996,1997,1998,1999,2000,2001,2002,2003,2004,2005,2006,2007,2008,2009,2010,2011,2012,2013,2014,2015,2016,2017,2018,2019,2020,2021,2022,2023,2024,2025,2026,2027,2028,2029,2030,2031,2032,2033,2034,2035,2036,2037,2038,2039,2040,2041,2042,2043,2044,2045,2046,2047,2048,2049,2050,2051,2052,2053,2054,2055,2056,2057,2058,2059,2060,2061,2062,2063,2064,2065,2066,2067,2068,2069,2070,2071,2072,2073,2074,2075,2076,2077,2078,2079,2080,2081,2082,2083,2084,2085,2086,2087,2088,2089,2090,2091,2092,2093,2094,2095,2096,2097,2098,2099,2100,2101,2102,2103,2104,2105,2106,2107,2108,2109,2110,2111,2112,2113,2114,2115,2116,2117,2118,2119,2120,2121,2122,2123,2124,2125,2126,2127,2128,2129,2130,2131,2132,2133,2134,2135,2136,2137,2138,2139,2140,2141,2142,2143,2144,2145,2146,2147,2148,2149,2150,2151,2152,2153,2154,2155,2156,2157,2158,2159,2160,2161,2162,2163,2164,2165,2166,2167,2168,2169,2170,2171,2172,2173,2174,2175,2176,2177,2178,2179,2180,2181,2182,2183,2184,2185,2186,2187,2188,2189,2190,2191,2192,2193,2194,2195,2196,2197,2198,2199,2200,2201,2202,2203,2204,2205,2206,2207,2208,2209,2210,2211,2212,2213,2214,2215,2216,2217,2218,2219,2220,2221,2222,2223,2224,2225,2226,2227,2228,2229,2230,2231,2232,2233,2234,2235,2236,2237,2238,2239,2240,2241,2242,2243,2244,2245,2246,2247,2248,2249,2250,2251,2252,2253,2254,2255,2256,2257,2258,2259,2260,2261,2262,2263,2264,2265,2266,2267,2268,2269,2270,2271,2272,2273,2274,2275,2276,2277,2278,2279,2280,2281,2282,2283,2284,2285,2286,2287,2288,2289,2290,2291,2292,2293,2294,2295,2296,2297,2298,2299,2300,2301,2302,2303,2304,2305,2306,2307,2308,2309,2310,2311,2312,2313,2314,2315,2316,2317,2318,2319,2320,2321,2322,2323,2324,2325,2326,2327,2328,2329,2330,2331,2332,2333,2334,2335,2336,2337,2338,2339,2340,2341,2342,2343,2344,2345,2346,2347,2348,2349,2350,2351,2352,2353,2354,2355,2356,2357,2358,2359,2360,2361,2362,2363,2364,2365,2366,2367,2368,2369,2370,2371,2372,2373,2374,2375,2376,2377,2378,2379,2380,2381,2382,2383,2384,2385,2386,2387,2388,2389,2390,2391,2392,2393,2394,2395,2396,2397,2398,2399,2400,2401,2402,2403,2404,2405,2406,2407,2408,2409,2410,2411,2412,2413,2414,2415,2416,2417,2418,2419,2420,2421,2422,2423,2424,2425,2426,2427,2428,2429,2430,2431,2432,2433,2434,2435,2436,2437,2438,2439,2440,2441,2442,2443,2444,2445,2446,2447,2448,2449,2450,2451,2452,2453,2454,2455,2456,2457,2458,2459,2460,2461,2462,2463,2464,2465,2466,2467,2468,2469,2470,2471,2472,2473,2474,2475,2476,2477,2478,2479,2480,2481,2482,2483,2484,2485,2486,2487,2488,2489,2490,2491,2492,2493,2494,2495,2496,2497,2498,2499,2500,2501,2502,2503,2504,2505,2506,2507,2508,2509,2510,2511,2512,2513,2514,2515,2516,2517,2518,2519,2520,2521,2522,2523,2524,2525,2526,2527,2528,2529,2530,2531,2532,2533,2534,2535,2536,2537,2538,2539,2540,2541,2542,2543,2544,2545,2546,2547,2548,2549,2550,2551,2552,2553,2554,2555,2556,2557,2558,2559,2560,2561,2562,2563,2564,2565,2566,2567,2568,2569,2570,2571,2572,2573,2574,2575,2576,2577,2578,2579,2580,2581,2582,2583,2584,2585,2586,2587,2588,2589,2590,2591,2592,2593,2594,2595,2596,2597,2598,2599,2600,2601,2602,2603,2604,2605,2606,2607,2608,2609,2610,2611,2612,2613,2614,2615,2616,2617,2618,2619,2620,2621,2622,2623,2624,2625,2626,2627,2628,2629,2630,2631,2632,2633,2634,2635,2636,2637,2638,2639,2640,2641,2642,2643,2644,2645,2646,2647,2648,2649,2650,2651,2652,2653,2654,2655,2656,2657,2658,2659,2660,2661,2662,2663,2664,2665,2666,2667,2668,2669,2670,2671,2672,2673,2674,2675,2676,2677,2678,2679,2680,2681,2682,2683,2684,2685,2686,2687,2688,2689,2690,2691,2692,2693,2694,2695,2696,2697,2698,2699,2700,2701,2702,2703,2704,2705,2706,2707,2708,2709,2710,2711,2712,2713,2714,2715,2716,2717,2718,2719,2720,2721,2722,2723,2724,2725,2726,2727,2728,2729,2730,2731,2732,2733,2734,2735,2736,2737,2738,2739,2740,2741,2742,2743,2744,2745,2746,2747,2748,2749,2750,2751,2752,2753,2754,2755,2756,2757,2758,2759,2760,2761,2762,2763,2764,2765,2766,2767,2768,2769,2770,2771,2772,2773,2774,2775,2776,2777,2778,2779,2780,2781,2782,2783,2784,2785,2786,2787,2788,2789,2790,2791,2792,2793,2794,2795,2796,2797,2798,2799,2800,2801,2802,2803,2804,2805,2806,2807,2808,2809,2810,2811,2812,2813,2814,2815,2816,2817,2818,2819,2820,2821,2822,2823,2824,2825,2826,2827,2828,2829,2830,2831,2832,2833,2834,2835,2836,2837,2838,2839,2840,2841,2842,2843,2844,2845,2846,2847,2848,2849,2850,2851,2852,2853,2854,2855,2856,2857,2858,2859,2860,2861,2862,2863,2864,2865,2866,2867,2868,2869,2870,2871,2872,2873,2874,2875,2876,2877,2878,2879,2880,2881,2882,2883,2884,2885,2886,2887,2888,2889,2890,2891,2892,2893,2894,2895,2896,2897,2898,2899,2900,2901,2902,2903,2904,2905,2906,2907,2908,2909,2910,2911,2912,2913,2914,2915,2916,2917,2918,2919,2920,2921,2922,2923,2924,2925,2926,2927,2928,2929,2930,2931,2932,2933,2934,2935,2936,2937,2938,2939,2940,2941,2942,2943,2944,2945,2946,2947,2948,2949,2950,2951,2952,2953,2954,2955,2956,2957,2958,2959,2960,2961,2962,2963,2964,2965,2966,2967,2968,2969,2970,2971,2972,2973,2974,2975,2976,2977,2978,2979,2980,2981,2982,2983,2984,2985,2986,2987,2988,2989,2990,2991,2992,2993,2994,2995,2996,2997,2998,2999], target = 5997
Output: [2998,2999]
```

**Notes**

-

