// Editor languages. This is a UI input only: it picks the Monaco mode and the starter template,
// and is sent with the signature and run requests, where it picks the backend's driver and
// sandbox. No renderer, diff, or state code may import this module (CLAUDE.md invariant 2).

export type EditorLanguage = "cpp" | "java" | "python";

/** `runs`: the backend can trace it (its `language` field takes the same id). */
export const LANGUAGES: { id: EditorLanguage; label: string; monaco: string; runs: boolean }[] = [
  { id: "cpp", label: "C++", monaco: "cpp", runs: true },
  { id: "python", label: "Python", monaco: "python", runs: true },
  { id: "java", label: "Java", monaco: "java", runs: true },
];

export function canRun(id: EditorLanguage): boolean {
  return LANGUAGES.find((l) => l.id === id)?.runs ?? false;
}

/** The languages that run, as a sentence: "C++, Python, and Java". */
export const RUNNABLE = sentence(LANGUAGES.filter((l) => l.runs).map((l) => l.label));

function sentence(items: string[]): string {
  if (items.length <= 2) return items.join(" and ");
  return `${items.slice(0, -1).join(", ")}, and ${items[items.length - 1]}`;
}

export function isEditorLanguage(id: string | null | undefined): id is EditorLanguage {
  return LANGUAGES.some((l) => l.id === id);
}

const LANGUAGE_KEY = "lcv-language";

/** The language picked last in this browser tab (sessionStorage), if any. Storage can be blocked. */
export function rememberedLanguage(): EditorLanguage | null {
  try {
    const id = globalThis.sessionStorage?.getItem(LANGUAGE_KEY);
    return isEditorLanguage(id) ? id : null;
  } catch {
    return null;
  }
}

export function rememberLanguage(id: EditorLanguage): void {
  try {
    globalThis.sessionStorage?.setItem(LANGUAGE_KEY, id);
  } catch {
    // blocked storage: the choice lasts until the page is reloaded
  }
}

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
