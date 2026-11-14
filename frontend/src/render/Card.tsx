import type { ReactNode } from "react";

/**
 * The header every structure's card shares: the variable's name, a muted kind label with its
 * size, and, when this step changed it in one clear way, a chip naming the operation.
 */
export function CardHeader({ name, meta, op, end }: { name: string; meta: string; op?: string | null; end?: ReactNode }) {
  return (
    <header className="card-header">
      <h3 className="card-name">{name}</h3>
      <span className="card-meta">{meta}</span>
      {(op || end) && (
        <span className="card-header-end">
          {op && (
            <span key={op} className="op-chip">
              {op}
            </span>
          )}
          {end}
        </span>
      )}
    </header>
  );
}

/** "empty", in a dashed box the size of one cell. */
export function Empty() {
  return <div className="empty">empty</div>;
}
