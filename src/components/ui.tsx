import type { ReactNode } from "react";

/** Consistent page title block: title, one-line description, optional actions on the right. */
export function PageHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div className="min-w-0">
        <h1 className="page-title">{title}</h1>
        {description && <p className="page-desc">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </header>
  );
}

/** Empty list/table state: says what's missing and what to do next. */
export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state" role="status">
      <div className="empty-state-icon" aria-hidden="true">
        <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 13l2.5-7.5A2 2 0 0 1 7.4 4h9.2a2 2 0 0 1 1.9 1.5L21 13" />
          <path d="M3 13v5a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-5h-5.5a2.5 2.5 0 0 1-5 0H3z" />
        </svg>
      </div>
      <div className="empty-state-title">{title}</div>
      {hint && <p className="empty-state-hint">{hint}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

/** Loading placeholder shaped like list rows, so the page doesn't jump when data arrives. */
export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div className="px-5 py-2" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="skeleton-row">
          <div className="skeleton" style={{ width: `${55 - (i % 3) * 12}%`, height: 12 }} />
          <div className="skeleton" style={{ width: `${30 - (i % 2) * 8}%`, height: 10 }} />
        </div>
      ))}
    </div>
  );
}

/** Ask the app shell to switch view (used by empty-state buttons). */
export function goTo(view: string) {
  window.dispatchEvent(new CustomEvent("portal:navigate", { detail: view }));
}

/** Empty-state button that jumps the user to the first field of the form on this page. */
export function FocusFormButton({ label }: { label: string }) {
  return (
    <button
      className="neu-btn"
      onClick={() => {
        const el = document.querySelector<HTMLElement>("main input, main select, main textarea");
        el?.scrollIntoView({ behavior: "smooth", block: "center" });
        el?.focus({ preventScroll: true });
      }}
    >
      {label}
    </button>
  );
}

export function NavButton({ view, label }: { view: string; label: string }) {
  return (
    <button className="neu-btn" onClick={() => goTo(view)}>
      {label}
    </button>
  );
}
