#include <iostream>
#include <vector>
#include <unordered_map>

using std::unordered_map;
using std::vector; // bring vector into the local scope

class Solution
{
public:
  vector<int> twoSum(const vector<int> &nums, int target)
  {
    // key -> number from array; value -> index
    unordered_map<int, int> numMap;

    for (int i = 0; i < static_cast<int>(nums.size()); ++i)
    {
      int complement = target - nums[i];
      auto it = numMap.find(complement);

      if (it != numMap.end())
      {
        return {it->second, i};
      }

      // If not found, insert current number and its index into the map
      numMap[nums[i]] = i;
    }
    // no solution
    return {};
  }
};