class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:
        # key -> number from array; value -> index
        numMap = {}

        for i in range(len(nums)):
            compliment = target - nums[i]

            if compliment in numMap:
                return [numMap[compliment], i]

            # If not found, insert current number and its index into the map
            numMap[nums[i]] = i
        # no solution
        return []
