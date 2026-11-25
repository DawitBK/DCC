'use client';

import { useId, type ReactNode } from 'react';
import type { Permission } from '@dcc/contracts';
import { needsRoleHint } from '@/lib/permissions-ui';
import { formatDuration } from '@/lib/format';

/**
 * Small pieces shared by the governance, security and insight screens (audit, security center, incidents,
 * approval rules, analytics, dashboard, help). They are layout and wording only: no data is read here.
 */

/** A row of facts at the top of a screen. */
export function FactStrip({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <div className="kit-facts gov-facts" role="group" aria-label={label}>
      {children}
    </div>
  );
}

/** A panel while its first answer is on its way: a few shimmering lines, announced once. */
export function PanelSkeleton({
  lines = 4,
  label = 'Loading…',
}: {
  lines?: number;
  label?: string;
}) {
  return (
    <div className="gov-skeleton" role="status" aria-live="polite" aria-busy="true">
      <span className="visually-hidden">{label}</span>
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className="kit-skeleton"
          style={{ width: `${Math.max(35, 100 - index * 17)}%` }}
        />
      ))}
    </div>
  );
}

/**
 * A button that stays visible when the person's role cannot use it: it says why, in words, beside it
 * (`needsRoleHint`). It uses `aria-disabled` so a keyboard user can still reach it and hear the reason.
 */
export function GatedButton({
  allowed,
  permission,
  className = 'btn btn-outline',
  busy = false,
  onClick,
  children,
  reason,
}: {
  allowed: boolean;
  permission: Permission;
  className?: string;
  busy?: boolean;
  onClick: () => void;
  children: ReactNode;
  /** Replaces the standard "needs one of these roles" sentence. */
  reason?: string;
}) {
  const id = useId();
  const blocked = !allowed || busy;
  return (
    <span className="gov-gated">
      <button
        type="button"
        className={className}
        aria-disabled={blocked || undefined}
        aria-describedby={!allowed ? id : undefined}
        onClick={() => {
          if (!blocked) onClick();
        }}
      >
        {children}
      </button>
      {!allowed && (
        <small className="hint gov-gated-reason" id={id}>
          {reason ?? needsRoleHint(permission)}
        </small>
      )}
    </span>
  );
}

/** A named step in a "what to do next" list: a word for how urgent it is, what is wrong, what to do. */
export type NextStep = {
  id: string;
  urgency: 'now' | 'soon' | 'info';
  title: string;
  detail: string;
  action?: { label: string; run: () => void };
};

const URGENCY: Record<NextStep['urgency'], { label: string; tone: 'red' | 'amber' | 'blue' }> = {
  now: { label: 'Act now', tone: 'red' },
  soon: { label: 'Soon', tone: 'amber' },
  info: { label: 'For your information', tone: 'blue' },
};

export function NextSteps({ steps, empty }: { steps: NextStep[]; empty: ReactNode }) {
  if (steps.length === 0) return <>{empty}</>;
  return (
    <ul className="gov-steps">
      {steps.map((step) => (
        <li key={step.id} className={`gov-step gov-step-${step.urgency}`}>
          <span className={`status status-${URGENCY[step.urgency].tone}`}>
            {URGENCY[step.urgency].label}
          </span>
          <div className="gov-step-body">
            <strong>{step.title}</strong>
            <span>{step.detail}</span>
          </div>
          {step.action && (
            <button type="button" className="btn btn-outline" onClick={step.action.run}>
              {step.action.label}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

/** "3 d 4 h" since an ISO time, or "—" when there is none. */
export function ageSince(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso) return '—';
  const time = new Date(iso).getTime();
  return Number.isNaN(time) ? '—' : formatDuration(Math.max(0, (now - time) / 1000));
}

/** Seconds between two ISO times, or null when either is missing. */
export function secondsBetween(from: string | null | undefined, to: string | null | undefined) {
  if (!from || !to) return null;
  const a = new Date(from).getTime();
  const b = new Date(to).getTime();
  return Number.isNaN(a) || Number.isNaN(b) ? null : Math.max(0, (b - a) / 1000);
}

/** Today at 00:00, as a plain `YYYY-MM-DDTHH:mm` value for a date-time input. */
export function localInputValue(date: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
