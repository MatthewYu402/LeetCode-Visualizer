class Solution:
    def subsets(self, nums: List[int]) -> List[List[int]]:
        result = []
        path = []
        self.backtrack(nums, 0, path, result)
        return result

    def backtrack(self, nums: List[int], start: int, path: List[int], result: List[List[int]]) -> None:
        result.append(path[:])
        for i in range(start, len(nums)):
            path.append(nums[i])
            self.backtrack(nums, i + 1, path, result)
            path.pop()
