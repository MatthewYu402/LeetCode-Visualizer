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

/** Starter Solution templates for the languages that have no fixture yet. */
export const TEMPLATES: Record<Exclude<EditorLanguage, "cpp">, string> = {
  java: `class Solution {
    public int[] twoSum(int[] nums, int target) {

    }
}
`,
  python: `class Solution:
    def twoSum(self, nums: List[int], target: int) -> List[int]:

`,
};
