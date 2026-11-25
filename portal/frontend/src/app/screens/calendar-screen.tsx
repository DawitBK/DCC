'use client';

import { useMemo, useState } from 'react';
import {
  PUBLICATION_STATUSES,
  SOCIAL_PLATFORMS,
  type ContentItemDto,
  type FreezeDto,
  type PublicationDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { ErrorBox } from '@/components/error-box';
import { CancelPublicationDialog, ReconcileButton } from '@/components/publication-actions';
import { StatusChip } from '@/components/status-chip';
import { PageHeader } from '@/components/kit/page-header';
import { Fact } from '@/components/kit/parts';
import { EmptyBlock, Skeletons } from '@/components/work/parts';
import { PublicationDrawer } from '@/components/work/publication-parts';
import { PublishDialog } from '@/components/work/publish-dialog';
import { queryString } from '@/lib/browser-api';
import { excerpt, shortId } from '@/lib/format';
import { PLATFORM_LABELS, PUBLICATION_STATUS, type Tone } from '@/lib/labels';
import { needsRoleHint } from '@/lib/permissions-ui';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import {
  accountPublishState,
  addDays,
  dayKey,
  formatDayHeading,
  formatTime,
  publicationMoment,
  startOfDay,
} from '@/lib/work';
import './calendar-screen.css';
import './work-shared.css';

type View = 'month' | 'week' | 'agenda';
const VIEWS: View[] = ['month', 'week', 'agenda'];

const TEXT = {
  title: 'Content calendar',
  description:
    'What is planned and what went out, by day. A publication sits on the day it is planned for, or on the day it was requested. Drafts and posts still in review are not here: only a publication has a date.',
  loadError: 'The calendar could not be loaded',
  today: 'Today',
  previous: (view: View) => (view === 'week' ? 'Previous week' : 'Previous month'),
  next: (view: View) => (view === 'week' ? 'Next week' : 'Next month'),
  views: { month: 'Month', week: 'Week', agenda: 'Agenda' },
  viewLabel: 'Calendar view',
  filtersLabel: 'Filter the calendar',
  filters: { company: 'Company', account: 'Account', platform: 'Network', status: 'State' },
  all: 'All',
  facts: {
    inView: 'Publications in view',
    inViewNote: 'In this period, after the filters',
    scheduled: 'Scheduled',
    scheduledNote: 'Waiting for their time',
    published: 'Published',
    publishedNote: 'Went out',
    attention: 'Failed or waiting',
    attentionNote: 'Failed, or the engine has not answered',
    free: 'Approved, not yet scheduled',
    freeNote: 'Could be scheduled now',
  },
  zone: (zone: string) => `Times are in your time zone (${zone}).`,
  days: 'Days of the week',
  openDay: (label: string, count: number) =>
    count === 0
      ? `${label}: nothing planned`
      : `${label}: ${count} ${count === 1 ? 'publication' : 'publications'}`,
  more: (n: number) => `+${n} more`,
  count: (n: number) => `${n} ${n === 1 ? 'post' : 'posts'}`,
  noEventsDay: 'Nothing planned or sent on this day.',
  dayTitle: (label: string) => label,
  emptyPeriod: 'Nothing is planned or was sent in this period',
  emptyPeriodBody:
    'Schedule an approved post and it appears here on its day. Use the list on the side, or the Publishing screen.',
  unscheduled: 'Approved, not yet scheduled',
  unscheduledHint:
    'Posts that are approved and have at least one account with no publication yet. Choose a time to schedule them.',
  unscheduledEmpty: 'Every approved post has been sent or scheduled',
  unscheduledEmptyBody:
    'When a post is approved it appears here until someone schedules or publishes it.',
  accountsFree: (free: number, total: number) => `${free} of ${total} accounts still free`,
  scheduleAction: 'Schedule…',
  openPost: 'Open the post',
  mayNotSchedule: 'Scheduling needs a publisher role in the company.',
  checkEngine: 'Check with the engine',
  openPublishing: 'Open publishing',
  noText: '(text not available)',
  newer: 'newer version exists',
  tableCaption: (month: string) => `Publications in ${month}`,
  planned: 'planned',
  eventLabel: (time: string, account: string, status: string, text: string) =>
    `${time}, ${account}, ${status}. ${text}`,
};

function weekStart(date: Date): Date {
  return addDays(startOfDay(date), -((date.getDay() + 6) % 7));
}

function rangeOf(view: View, cursor: Date): { from: Date; to: Date; weeks: Date[][] } {
  if (view === 'week') {
    const from = weekStart(cursor);
    return {
      from,
      to: addDays(from, 7),
      weeks: [Array.from({ length: 7 }, (_, i) => addDays(from, i))],
    };
  }
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const last = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0);
  const from = weekStart(first);
  const to = addDays(weekStart(last), 7);
  const weeks: Date[][] = [];
  for (let day = from; day < to; day = addDays(day, 7))
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(day, i)));
  return { from, to, weeks };
}

type CalEvent = {
  publication: PublicationDto;
  at: Date;
  tone: Tone;
  account: SocialAccountDto | undefined;
  accountName: string;
  text: string;
  newer: boolean;
};

/**
 * `GET /api/publications?from=&to=` for the period on screen, `GET /api/content-items` (text and the approved
 * posts), `GET /api/social-accounts`. Month, week and agenda views; the filters work on what the API returned.
 * An event opens a quick look at the publication; the side list schedules approved posts that have no date yet.
 */
export function CalendarScreen() {
  const { companyId, companyName, open, can, go, companies, refreshNotifications, screenAllowed } =
    useWorkspace();
  const [view, setView] = useState<View>('month');
  const [cursor, setCursor] = useState(() => startOfDay(new Date()));
  const [selected, setSelected] = useState<string | null>(null);
  const [filter, setFilter] = useState({ company: '', account: '', platform: '', status: '' });
  const range = useMemo(() => rangeOf(view, cursor), [view, cursor]);
  const zone = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone, []);

  const periodStart = range.from.toISOString();
  const periodEnd = range.to.toISOString();
  const publications = useApiData<PublicationDto[]>(
    `/publications${queryString({ from: periodStart, to: periodEnd })}`,
  );
  const everything = useApiData<PublicationDto[]>('/publications');
  const items = useApiData<ContentItemDto[]>('/content-items');
  const accounts = useApiData<SocialAccountDto[]>('/social-accounts');
  const freezes = useApiData<FreezeDto[]>(can('publishing.freeze') ? '/publishing-freezes' : null);

  const [looking, setLooking] = useState<PublicationDto | null>(null);
  const [cancelling, setCancelling] = useState<PublicationDto | null>(null);
  const [scheduling, setScheduling] = useState<ContentItemDto | null>(null);

  const accountList = useMemo(() => accounts.data ?? [], [accounts.data]);
  const accountsInScope = accountList.filter(
    (account) =>
      (!companyId || account.companyId === companyId) &&
      (!filter.company || account.companyId === filter.company),
  );
  const itemById = useMemo(
    () => new Map((items.data ?? []).map((item) => [item.id, item])),
    [items.data],
  );
  const accountOf = (id: string) => accountList.find((entry) => entry.id === id);
  const nameOf = (id: string) => {
    const account = accountOf(id);
    return account
      ? `${PLATFORM_LABELS[account.platform]} · ${account.displayName}`
      : `Account ${shortId(id)}`;
  };

  const events: CalEvent[] = useMemo(
    () =>
      (publications.data ?? [])
        .filter((row) => !companyId || row.companyId === companyId)
        .filter((row) => !filter.company || row.companyId === filter.company)
        .filter((row) => !filter.account || row.socialAccountId === filter.account)
        .filter(
          (row) =>
            !filter.platform ||
            accountList.find((entry) => entry.id === row.socialAccountId)?.platform ===
              filter.platform,
        )
        .filter((row) => !filter.status || row.status === filter.status)
        .map((row) => {
          const item = itemById.get(row.contentItemId);
          return {
            publication: row,
            at: publicationMoment(row),
            tone: PUBLICATION_STATUS[row.status].tone,
            account: accountList.find((entry) => entry.id === row.socialAccountId),
            accountName: nameOf(row.socialAccountId),
            text: item?.preview?.excerpt ?? TEXT.noText,
            newer: Boolean(item && item.currentVersionId !== row.contentVersionId),
          };
        })
        .sort((a, b) => a.at.getTime() - b.at.getTime()),
    [publications.data, companyId, filter, accountList, itemById],
  );
  const byDay = useMemo(() => {
    const map = new Map<string, CalEvent[]>();
    for (const event of events) {
      const key = dayKey(event.at);
      map.set(key, [...(map.get(key) ?? []), event]);
    }
    return map;
  }, [events]);

  // approved posts that still have an account with no publication of their current version
  const unscheduled = (items.data ?? [])
    .filter((item) => item.status === 'approved')
    .filter((item) => !companyId || item.companyId === companyId)
    .filter((item) => !filter.company || item.companyId === filter.company)
    .map((item) => {
      const states = (item.preview?.targetAccountIds ?? []).flatMap((id) => {
        const account = accountOf(id);
        return account
          ? [
              accountPublishState({
                item,
                versionTargetIds: item.preview?.targetAccountIds ?? [],
                account,
                company: companies.find((entry) => entry.id === item.companyId),
                publications: everything.data ?? [],
                freezes: can('publishing.freeze') && freezes.data ? freezes.data : null,
              }),
            ]
          : [];
      });
      return { item, states, free: states.filter((state) => !state.existing).length };
    })
    .filter((entry) => entry.free > 0);

  const todayKey = dayKey(new Date());
  const monthName = cursor.toLocaleString(undefined, { month: 'long', year: 'numeric' });
  const heading =
    view === 'week'
      ? `${formatDayHeading(range.from).replace(/^[^,]*, /, '')} – ${formatDayHeading(addDays(range.to, -1)).replace(/^[^,]*, /, '')}`
      : monthName;
  const step = (direction: -1 | 1) =>
    setCursor((value) =>
      view === 'week'
        ? addDays(value, 7 * direction)
        : new Date(value.getFullYear(), value.getMonth() + direction, 1),
    );
  const dayLabels = range.weeks[0]!.map((day) =>
    day.toLocaleDateString(undefined, { weekday: 'short' }),
  );
  const inRange = (key: string) => key >= dayKey(range.from) && key < dayKey(range.to);
  const shownDay =
    selected && inRange(selected)
      ? selected
      : inRange(todayKey)
        ? todayKey
        : ([...byDay.keys()].sort()[0] ?? dayKey(range.from));
  const dayEvents = byDay.get(shownDay) ?? [];
  const mayPublish = can('content.publish');
  const periodCount = (status: PublicationDto['status']) =>
    events.filter((event) => event.publication.status === status).length;

  const eventButton = (event: CalEvent, compact: boolean) => (
    <button
      key={event.publication.id}
      type="button"
      className="wk-cal-event"
      data-tone={event.tone}
      aria-label={TEXT.eventLabel(
        formatTime(event.at),
        event.accountName,
        PUBLICATION_STATUS[event.publication.status].label,
        event.text,
      )}
      onClick={() => setLooking(event.publication)}
    >
      <b>{formatTime(event.at)}</b>
      <span>
        {event.account
          ? PLATFORM_LABELS[event.account.platform]
          : shortId(event.publication.socialAccountId)}
      </span>
      <span className="wk-cal-state">{PUBLICATION_STATUS[event.publication.status].label}</span>
      {!compact && (
        <span className="wk-sub" style={{ flexBasis: '100%', margin: 0 }}>
          {excerpt(event.text, 60)}
        </span>
      )}
    </button>
  );

  const agendaItem = (event: CalEvent) => (
    <li key={event.publication.id}>
      <button
        type="button"
        className="wk-agenda-item"
        data-tone={event.tone}
        onClick={() => setLooking(event.publication)}
      >
        <span className="wk-agenda-time">{formatTime(event.at)}</span>
        <span className="wk-agenda-main">
          <strong>{event.accountName}</strong>
          <span>
            {excerpt(event.text, 140)}
            {event.newer ? ` (${TEXT.newer})` : ''}
          </span>
          <span>
            {companyName(event.publication.companyId)}
            {event.publication.scheduledAt ? ` · ${TEXT.planned}` : ''}
          </span>
        </span>
        <StatusChip status={PUBLICATION_STATUS[event.publication.status]} />
      </button>
    </li>
  );

  const selectFilter = (
    id: keyof typeof filter,
    label: string,
    options: { value: string; label: string }[],
  ) => (
    <div key={id}>
      <label className="visually-hidden" htmlFor={`cal-${id}`}>
        {label}
      </label>
      <select
        id={`cal-${id}`}
        className="select-field"
        value={filter[id]}
        onChange={(event) => setFilter({ ...filter, [id]: event.target.value })}
      >
        <option value="">{`${label}: ${TEXT.all}`}</option>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );

  const loading = !publications.data && publications.loading;

  return (
    <div className="wk-grid">
      <PageHeader
        title={TEXT.title}
        description={TEXT.description}
        actions={
          <>
            {screenAllowed('publishing') && (
              <button type="button" className="btn btn-outline" onClick={() => go('publishing')}>
                {TEXT.openPublishing}
              </button>
            )}
            <ReconcileButton
              onDone={() => {
                publications.reload();
                everything.reload();
                refreshNotifications();
              }}
              disabled={!mayPublish}
              title={mayPublish ? undefined : needsRoleHint('content.publish')}
            />
          </>
        }
      />
      <ErrorBox
        error={publications.error ?? items.error ?? accounts.error}
        title={TEXT.loadError}
        loading
      />
      <div className="wk-facts">
        <Fact label={TEXT.facts.inView} value={events.length} note={TEXT.facts.inViewNote} />
        <Fact
          label={TEXT.facts.scheduled}
          value={periodCount('scheduled')}
          note={TEXT.facts.scheduledNote}
        />
        <Fact
          label={TEXT.facts.published}
          value={periodCount('published')}
          note={TEXT.facts.publishedNote}
        />
        <Fact
          label={TEXT.facts.attention}
          value={periodCount('failed') + periodCount('pending')}
          note={TEXT.facts.attentionNote}
        />
        <Fact label={TEXT.facts.free} value={unscheduled.length} note={TEXT.facts.freeNote} />
      </div>

      <div className="wk-cal-layout">
        <section className="wk-card" aria-label={TEXT.title}>
          <div className="wk-cal-bar">
            <div className="wk-cal-nav">
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => setCursor(startOfDay(new Date()))}
              >
                {TEXT.today}
              </button>
              <button
                type="button"
                className="btn btn-outline"
                aria-label={TEXT.previous(view)}
                onClick={() => step(-1)}
              >
                ‹
              </button>
              <h2 aria-live="polite">{heading}</h2>
              <button
                type="button"
                className="btn btn-outline"
                aria-label={TEXT.next(view)}
                onClick={() => step(1)}
              >
                ›
              </button>
            </div>
            <div className="wk-version-switch" role="group" aria-label={TEXT.viewLabel}>
              {VIEWS.map((id) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={view === id}
                  onClick={() => setView(id)}
                >
                  {TEXT.views[id]}
                </button>
              ))}
            </div>
          </div>
          <div className="wk-cal-filters" role="group" aria-label={TEXT.filtersLabel}>
            {companies.length > 1 &&
              !companyId &&
              selectFilter(
                'company',
                TEXT.filters.company,
                companies.map((entry) => ({ value: entry.id, label: entry.name })),
              )}
            {selectFilter(
              'account',
              TEXT.filters.account,
              accountsInScope.map((account) => ({ value: account.id, label: nameOf(account.id) })),
            )}
            {selectFilter(
              'platform',
              TEXT.filters.platform,
              SOCIAL_PLATFORMS.map((value) => ({ value, label: PLATFORM_LABELS[value] })),
            )}
            {selectFilter(
              'status',
              TEXT.filters.status,
              PUBLICATION_STATUSES.map((value) => ({
                value,
                label: PUBLICATION_STATUS[value].label,
              })),
            )}
          </div>
          <p className="wk-hint" style={{ marginBottom: 12 }}>
            {TEXT.zone(zone)}
          </p>

          {loading ? (
            <Skeletons rows={8} />
          ) : view === 'agenda' ? (
            events.length === 0 ? (
              <EmptyBlock title={TEXT.emptyPeriod}>{TEXT.emptyPeriodBody}</EmptyBlock>
            ) : (
              <ol className="wk-agenda">
                {[...byDay.entries()]
                  .sort(([a], [b]) => a.localeCompare(b))
                  .map(([key, list]) => (
                    <li key={key}>
                      <h3>
                        {formatDayHeading(new Date(`${key}T00:00:00`))}
                        {key === todayKey ? ` · ${TEXT.today}` : ''}
                      </h3>
                      <ul className="wk-agenda-list">{list.map(agendaItem)}</ul>
                    </li>
                  ))}
              </ol>
            )
          ) : view === 'week' ? (
            <div className="wk-week">
              {range.weeks[0]!.map((day) => {
                const key = dayKey(day);
                const list = byDay.get(key) ?? [];
                return (
                  <div
                    key={key}
                    className="wk-week-day"
                    data-today={key === todayKey}
                    data-selected={key === shownDay}
                  >
                    <h3>
                      <button
                        type="button"
                        className="wk-cal-day"
                        aria-current={key === todayKey ? 'date' : undefined}
                        onClick={() => setSelected(key)}
                      >
                        {day.getDate()}
                      </button>{' '}
                      {day.toLocaleDateString(undefined, { weekday: 'long' })}
                    </h3>
                    {list.length === 0 ? (
                      <span className="wk-hint">—</span>
                    ) : (
                      list.map((event) => eventButton(event, false))
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="wk-cal-scroll">
              <table className="wk-cal-table">
                <caption className="visually-hidden">{TEXT.tableCaption(monthName)}</caption>
                <thead>
                  <tr>
                    {dayLabels.map((label) => (
                      <th key={label} scope="col" aria-label={label}>
                        {label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {range.weeks.map((week) => (
                    <tr key={dayKey(week[0]!)}>
                      {week.map((day) => {
                        const key = dayKey(day);
                        const list = byDay.get(key) ?? [];
                        const outside = day.getMonth() !== cursor.getMonth();
                        return (
                          <td key={key} data-outside={outside} data-selected={key === shownDay}>
                            <button
                              type="button"
                              className="wk-cal-day"
                              aria-current={key === todayKey ? 'date' : undefined}
                              aria-label={TEXT.openDay(formatDayHeading(day), list.length)}
                              onClick={() => setSelected(key)}
                            >
                              {day.getDate()}
                            </button>
                            {list.length > 0 && (
                              <>
                                <div className="wk-cal-events">
                                  {list.slice(0, 2).map((event) => eventButton(event, true))}
                                  {list.length > 2 && (
                                    <button
                                      type="button"
                                      className="wk-cal-more"
                                      onClick={() => setSelected(key)}
                                    >
                                      {TEXT.more(list.length - 2)}
                                    </button>
                                  )}
                                </div>
                                <div className="wk-cal-count" aria-hidden="true">
                                  {TEXT.count(list.length)}
                                </div>
                              </>
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view !== 'agenda' && !loading && (
            <div style={{ marginTop: 18 }}>
              <h3 className="label" style={{ fontSize: 15 }}>
                {TEXT.dayTitle(formatDayHeading(new Date(`${shownDay}T00:00:00`)))}
              </h3>
              {dayEvents.length === 0 ? (
                <p className="wk-hint">{TEXT.noEventsDay}</p>
              ) : (
                <ul className="wk-agenda-list">{dayEvents.map(agendaItem)}</ul>
              )}
              {events.length === 0 && (
                <div style={{ marginTop: 14 }}>
                  <EmptyBlock title={TEXT.emptyPeriod}>{TEXT.emptyPeriodBody}</EmptyBlock>
                </div>
              )}
            </div>
          )}
        </section>

        <section className="wk-card" aria-label={TEXT.unscheduled}>
          <div className="wk-card-head">
            <div>
              <h2>{TEXT.unscheduled}</h2>
              <p>{TEXT.unscheduledHint}</p>
            </div>
          </div>
          {!mayPublish && (
            <p className="wk-hint">
              {TEXT.mayNotSchedule} {needsRoleHint('content.publish')}
            </p>
          )}
          {items.loading && !items.data ? (
            <Skeletons rows={3} />
          ) : unscheduled.length === 0 ? (
            <EmptyBlock title={TEXT.unscheduledEmpty}>{TEXT.unscheduledEmptyBody}</EmptyBlock>
          ) : (
            <ul className="wk-unscheduled">
              {unscheduled.map(({ item, states, free }) => (
                <li key={item.id}>
                  <strong>{item.preview?.excerpt ?? TEXT.noText}</strong>
                  <span className="wk-hint">
                    {companyName(item.companyId)} · {TEXT.accountsFree(free, states.length)}
                  </span>
                  <span className="wk-row">
                    <button
                      type="button"
                      className="btn btn-primary"
                      disabled={
                        !can('content.publish', item.companyId) ||
                        !states.some((state) => state.ready)
                      }
                      title={
                        !can('content.publish', item.companyId)
                          ? needsRoleHint('content.publish')
                          : (states.find((state) => !state.ready && !state.existing)?.blockers[0] ??
                            undefined)
                      }
                      onClick={() => setScheduling(item)}
                    >
                      {TEXT.scheduleAction}
                    </button>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => open('content', item.id)}
                    >
                      {TEXT.openPost}
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {looking && (
        <PublicationDrawer
          publication={looking}
          accounts={accountList}
          onClose={() => setLooking(null)}
          onCancel={(row) => {
            setLooking(null);
            setCancelling(row);
          }}
        />
      )}
      {cancelling && (
        <CancelPublicationDialog
          publication={cancelling}
          accountName={nameOf(cancelling.socialAccountId)}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            publications.reload();
            everything.reload();
          }}
        />
      )}
      {scheduling && (
        <PublishDialog
          item={scheduling}
          accounts={accountList}
          publications={everything.data ?? []}
          freezes={can('publishing.freeze') && freezes.data ? freezes.data : null}
          initialLater
          onClose={() => setScheduling(null)}
          onDone={(created) => {
            setScheduling(null);
            publications.reload();
            everything.reload();
            items.reload();
            refreshNotifications();
            if (created.scheduledAt) setCursor(startOfDay(new Date(created.scheduledAt)));
          }}
        />
      )}
    </div>
  );
}
