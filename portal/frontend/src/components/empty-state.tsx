import type { ReactNode } from 'react';

/** "Nothing here" inside a panel: a short title and one line saying why or what to do. */
export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty-state">
      <div>
        <strong>{title}</strong>
        {children && <p>{children}</p>}
      </div>
    </div>
  );
}

const TEXT = { loading: 'Loading…' };

/** Shown while the first answer from the API is on its way. */
export function LoadingState({ label = TEXT.loading }: { label?: string }) {
  return (
    <div className="empty-state" role="status" aria-live="polite">
      <div>
        <p>{label}</p>
      </div>
    </div>
  );
}
