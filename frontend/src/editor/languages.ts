// Editor languages. This is a UI input only: it picks the Monaco mode and, later, is sent with
// the run request. No renderer, diff, or state code may import this module (CLAUDE.md invariant 2).

export type EditorLanguage = "cpp" | "java" | "python";

export const LANGUAGES: { id: EditorLanguage; label: string; monaco: string }[] = [
  { id: "cpp", label: "C++", monaco: "cpp" },
  { id: "java", label: "Java", monaco: "java" },
  { id: "python", label: "Python", monaco: "python" },
];

export function monacoLanguage(id: EditorLanguage): string {
  return LANGUAGES.find((l) => l.id === id)?.monaco ?? "plaintext";
}

/**
 * What the page opens with: the bare Two Sum Solution in each language, as LeetCode gives it.
 * There is no trace until the user runs it.
 */
export const TEMPLATES: Record<EditorLanguage, string> = {
  cpp: `class Solution {
public:
    vector<int> twoSum(vector<int>& nums, int target) {
        
    }
};
`,
  java: `class Solution {
    public int[] twoSum(int[] nums, int target) {

    }
}
`,
  python: `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:

`,
};

/**
 * Two Sum's first example, shown as placeholder text: in the example box, and in a field
 * whose method and name match, so the starter shows what to type until the user types.
 */
export const STARTER_EXAMPLE = {
  method: "twoSum",
  values: { nums: "[2,7,11,15]", target: "9" } as Record<string, string>,
  text: "Input: nums = [2,7,11,15], target = 9\nOutput: [0,1]",
};
