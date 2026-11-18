import { createContext, useContext, type ReactNode } from "react";

/** True inside a card that draws one of the step's members (the Solution's memo), so its header says "member". */
export const MemberCard = createContext(false);

/** Drawn at the end of a card's header when set: the card's "View as" menu (components/ViewMenu.tsx). */
export const CardControls = createContext<ReactNode>(null);

/**
 * The header every structure's card shares: the variable's name, a muted kind label with its
 * size, and, when this step changed it in one clear way, a chip naming the operation.
 */
export function CardHeader({ name, meta, op, end }: { name: string; meta: string; op?: string | null; end?: ReactNode }) {
  const member = useContext(MemberCard);
  const controls = useContext(CardControls);
  return (
    <header className="card-header">
      <h3 className="card-name">{name}</h3>
      {member && (
        <span className="member-tag" title="A member variable of the Solution: every call sees this one">
          member
        </span>
      )}
      <span className="card-meta">{meta}</span>
      {(op || end || controls) && (
        <span className="card-header-end">
          {op && (
            <span key={op} className="op-chip">
              {op}
            </span>
          )}
          {end}
          {controls}
        </span>
      )}
    </header>
  );
}

/** "empty", in a dashed box the size of one cell. */
export function Empty() {
  return <div className="empty">empty</div>;
}
