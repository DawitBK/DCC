import type { ReactNode } from 'react';

/** A number with its label. `foot` is the small line under it; `change` is the highlighted start of that line. */
export function StatCard({
  label,
  value,
  change,
  foot = 'vs. previous 30 days',
  icon,
}: {
  label: string;
  value: string;
  change?: string;
  foot?: ReactNode;
  icon?: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        {icon && (
          <span className="stat-icon" aria-hidden="true">
            {icon}
          </span>
        )}
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">
        {change && <span className="positive">{change}</span>} {foot}
      </div>
    </article>
  );
}
