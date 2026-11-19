class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        # key -> number from array; value -> index
        numMap = {}

        for i in range(len(nums)):
            complement = target - nums[i]

            if complement in numMap:
                return [numMap[complement], i]

            # If not found, insert current number and its index into the map
            numMap[nums[i]] = i
        # no solution
        return []
