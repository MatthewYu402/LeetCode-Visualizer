class Solution {
    public int[] twoSum(int[] nums, int target) {
        // key: a number from the array, value: its index
        Map<Integer, Integer> numMap = new HashMap<>();

        for (int i = 0; i < nums.length; ++i) {
            int complement = target - nums[i];

            if (numMap.containsKey(complement)) {
                return new int[] {numMap.get(complement), i};
            }

            // not found: remember this number and its index
            numMap.put(nums[i], i);
        }
        return new int[0];
    }
}
