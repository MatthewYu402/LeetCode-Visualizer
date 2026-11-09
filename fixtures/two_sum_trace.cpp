class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        // key: a number from the array, value: its index
        unordered_map<int, int> numMap;

        for (int i = 0; i < static_cast<int>(nums.size()); ++i) {
            int complement = target - nums[i];
            auto it = numMap.find(complement);

            if (it != numMap.end()) {
                return {it->second, i};
            }

            // not found: remember this number and its index
            numMap[nums[i]] = i;
        }
        return {};
    }
};