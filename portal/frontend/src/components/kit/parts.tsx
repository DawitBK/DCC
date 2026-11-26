'use client';

import { useState, type ReactNode } from 'react';
import { shortId } from '@/lib/format';

/** Label and value pairs: the facts of one thing, as a description list. A missing value shows "—". */
export function DescriptionList({
  items,
  columns = 2,
}: {
  items: { label: string; value: ReactNode; hint?: string }[];
  columns?: 1 | 2 | 3;
}) {
  return (
    <dl className={`kit-dl kit-dl-${columns}`}>
      {items.map((item) => (
        <div key={item.label} className="kit-dl-row">
          <dt>{item.label}</dt>
          <dd>
            {item.value === null || item.value === undefined || item.value === ''
              ? '—'
              : item.value}
            {item.hint && <small className="hint">{item.hint}</small>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export type TimelineItem = {
  id: string;
  when: string;
  title: ReactNode;
  detail?: ReactNode;
  tone?: 'green' | 'amber' | 'red' | 'blue' | 'gray';
};

/** What happened, newest first, each with its time. The tone is a dot beside words, never the only signal. */
export function Timeline({ items, empty }: { items: TimelineItem[]; empty?: ReactNode }) {
  if (items.length === 0) return <>{empty}</>;
  return (
    <ol className="kit-timeline">
      {items.map((item) => (
        <li key={item.id} className={`kit-timeline-item kit-tone-${item.tone ?? 'gray'}`}>
          <span className="kit-timeline-dot" aria-hidden="true" />
          <div>
            <div className="kit-timeline-title">{item.title}</div>
            {item.detail && <div className="kit-timeline-detail">{item.detail}</div>}
            <time className="kit-timeline-when">{item.when}</time>
          </div>
        </li>
      ))}
    </ol>
  );
}

/** A message box: what a limit or a rule means, or why something is not available to this person. */
export function Callout({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warn' | 'danger' | 'ok';
  title?: string;
  children?: ReactNode;
}) {
  return (
    <div className={`kit-callout kit-callout-${tone}`} role={tone === 'danger' ? 'alert' : 'note'}>
      {title && <strong>{title}</strong>}
      {children && <div>{children}</div>}
    </div>
  );
}

/** Horizontal bars for a short list of counts ("5 in review, 6 drafts"). Words and numbers are always shown. */
export function BarList({
  rows,
  total,
}: {
  rows: { label: string; value: number; tone?: 'green' | 'amber' | 'red' | 'blue' | 'gray' }[];
  total?: number;
}) {
  const max = total ?? Math.max(1, ...rows.map((row) => row.value));
  return (
    <ul className="kit-bars">
      {rows.map((row) => (
        <li key={row.label}>
          <span className="kit-bar-label">{row.label}</span>
          <span className="kit-bar-track" aria-hidden="true">
            <span
              className={`kit-bar-fill kit-tone-${row.tone ?? 'blue'}`}
              style={{ width: `${Math.round((row.value / max) * 100)}%` }}
            />
          </span>
          <span className="kit-bar-value">{row.value}</span>
        </li>
      ))}
    </ul>
  );
}

/** An id the person may need to quote: shown short, copied whole. */
export function CopyId({ value, label = 'Copy id' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="kit-copy"
      title={`${label}: ${value}`}
      onClick={() => {
        void navigator.clipboard?.writeText(value).then(() => {
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      <code>{shortId(value)}</code>
      <span aria-live="polite">{copied ? 'Copied' : 'Copy'}</span>
    </button>
  );
}

/** A big number with a label, for a row of facts at the top of a detail page. */
export function Fact({ label, value, note }: { label: string; value: ReactNode; note?: string }) {
  return (
    <div className="kit-fact">
      <span className="kit-fact-label">{label}</span>
      <strong className="kit-fact-value">{value}</strong>
      {note && <span className="kit-fact-note">{note}</span>}
    </div>
  );
}
