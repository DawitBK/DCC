'use client';

import { useState } from 'react';
import type { PublicationDto, SocialAccountDto } from '@dcc/contracts';
import { EmptyState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { queryString } from '@/lib/browser-api';
import { formatDateTime, shortId } from '@/lib/format';
import { PLATFORM_LABELS, PUBLICATION_STATUS } from '@/lib/labels';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const TEXT = {
  title: 'Content calendar',
  description: 'What was published and what is scheduled, by day.',
  toPublishing: 'Open publishing',
  panel: 'Publishing calendar',
  subtitle: 'Scheduled posts on their planned day; the rest on the day they were sent',
  previous: 'Previous month',
  next: 'Next month',
  days: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  listTitle: (month: string) => `In ${month}`,
  empty: 'Nothing published or scheduled this month',
  emptyBody: 'Schedule an approved post from the Publishing screen and it appears here.',
  note: 'Drafts and posts still in review are not on the calendar: only a publication has a date.',
};

/** The day a publication belongs to: its planned time if scheduled, else when it went out. */
function dateOf(publication: PublicationDto): Date {
  return new Date(publication.scheduledAt ?? publication.completedAt ?? publication.requestedAt);
}

/** `GET /api/publications?from=&to=` for the month on screen, `GET /api/social-accounts` for names. */
export function CalendarScreen() {
  const { companyId, companyName, go, can } = useWorkspace();
  const [month, setMonth] = useState(() => {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  });
  const end = new Date(month.getFullYear(), month.getMonth() + 1, 1);
  const publications = useApiData<PublicationDto[]>(
    `/publications${queryString({ from: month.toISOString(), to: end.toISOString() })}`,
  );
  const accounts = useApiData<SocialAccountDto[]>('/social-accounts');

  const rows = (publications.data ?? [])
    .filter((row) => !companyId || row.companyId === companyId)
    .filter((row) => dateOf(row) >= month && dateOf(row) < end)
    .sort((a, b) => dateOf(a).getTime() - dateOf(b).getTime());
  const accountName = (id: string) => {
    const account = accounts.data?.find((entry) => entry.id === id);
    return account
      ? `${account.displayName} (${PLATFORM_LABELS[account.platform]})`
      : `Account ${shortId(id)}`;
  };
  const monthName = month.toLocaleString('en', { month: 'long', year: 'numeric' });
  const offset = month.getDay();
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = Array.from(
    { length: Math.ceil((offset + daysInMonth) / 7) * 7 },
    (_, index) => index - offset + 1,
  );
  const move = (by: number) =>
    setMonth((value) => new Date(value.getFullYear(), value.getMonth() + by, 1));
  const time = (date: Date) => date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <>
      <PageTitle
        title={TEXT.title}
        description={TEXT.description}
        action={
          (can('content.publish') || can('publishing.freeze')) && (
            <button className="btn btn-outline" onClick={() => go('publishing')}>
              {TEXT.toPublishing}
            </button>
          )
        }
      />
      <ErrorBox error={publications.error} loading />
      <SectionPanel title={TEXT.panel} subtitle={TEXT.subtitle}>
        <div className="calendar-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <button className="btn btn-outline" aria-label={TEXT.previous} onClick={() => move(-1)}>
              ‹
            </button>
            <strong style={{ minWidth: 160, textAlign: 'center', fontSize: 14 }} aria-live="polite">
              {monthName}
            </strong>
            <button className="btn btn-outline" aria-label={TEXT.next} onClick={() => move(1)}>
              ›
            </button>
          </div>
        </div>
        <div className="calendar-scroll" aria-hidden="true">
          <div className="calendar-grid">
            {TEXT.days.map((day) => (
              <div className="calendar-day-label" key={day}>
                {day}
              </div>
            ))}
            {cells.map((day, index) => {
              const inMonth = day >= 1 && day <= daysInMonth;
              const events = inMonth ? rows.filter((row) => dateOf(row).getDate() === day) : [];
              return (
                <div className="calendar-cell" key={index}>
                  {inMonth && <span className="calendar-date">{day}</span>}
                  {events.map((event) => (
                    <span
                      className={`calendar-event ${event.status === 'scheduled' ? 'gold-event' : ''}`}
                      key={event.id}
                      title={`${time(dateOf(event))} · ${accountName(event.socialAccountId)}`}
                    >
                      {time(dateOf(event))} {accountName(event.socialAccountId)}
                    </span>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        <h3 className="label" style={{ marginTop: 16 }}>
          {TEXT.listTitle(monthName)}
        </h3>
        {publications.data && rows.length === 0 && (
          <EmptyState title={TEXT.empty}>{TEXT.emptyBody}</EmptyState>
        )}
        <div className="activity-list">
          {rows.map((row) => (
            <div className="activity-row" key={row.id}>
              <span className="activity-dot" aria-hidden="true" />
              <div className="activity-copy" style={{ flex: 1 }}>
                <strong>{accountName(row.socialAccountId)}</strong>
                <small>
                  {companyName(row.companyId)} · {formatDateTime(dateOf(row).toISOString())}
                </small>
              </div>
              <StatusChip status={PUBLICATION_STATUS[row.status]} />
            </div>
          ))}
        </div>
        <small className="hint">{TEXT.note}</small>
      </SectionPanel>
    </>
  );
}
