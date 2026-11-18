import { useId, useState } from "react";

/** What the info button next to the Code panel's title says. */
export const PASTE_HINT =
  "Paste the code exactly as LeetCode gives it, with the comments above the Solution. Those comments define ListNode, TreeNode, or Node, and the visualizer reads them to know how your linked lists, trees, and graphs are built.";

/**
 * An info button beside the Code title. Its note shows on hover and on keyboard focus, and a tap
 * shows it on a touch screen (the tap focuses the button). Escape hides it until the pointer or
 * focus leaves, so it never sits over the code unasked.
 */
export function PasteHint() {
  const id = useId();
  const [dismissed, setDismissed] = useState(false);
  return (
    <span className={`paste-hint ${dismissed ? "is-dismissed" : ""}`} onMouseLeave={() => setDismissed(false)}>
      <button
        type="button"
        className="paste-hint-button"
        aria-label="How to paste your code"
        aria-describedby={id}
        onBlur={() => setDismissed(false)}
        onKeyDown={(e) => {
          if (e.key === "Escape") setDismissed(true);
        }}
      >
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="6.75" fill="none" stroke="currentColor" strokeWidth="1.5" />
          <path d="M8 7.25v4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          <circle cx="8" cy="4.9" r="0.95" fill="currentColor" />
        </svg>
      </button>
      <span role="tooltip" id={id} className="paste-hint-note">
        {PASTE_HINT}
      </span>
    </span>
  );
}
