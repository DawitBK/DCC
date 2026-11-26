'use client';

import type { ReactNode } from 'react';
import {
  ROLE_LABELS,
  type ApprovalQueueRowDto,
  type ContentItemDto,
  type DashboardDto,
  type FreezeDto,
  type IncidentDto,
  type InboxMessageDto,
  type NotificationDto,
  type PublicationDto,
} from '@dcc/contracts';
import { ErrorBox } from '@/components/error-box';
import { PageHeader } from '@/components/kit/page-header';
import { Callout, Fact } from '@/components/kit/parts';
import { StatusChip } from '@/components/status-chip';
import { EmptyBlock, Skeletons } from '@/components/work/parts';
import { formatDateTime, excerpt } from '@/lib/format';
import {
  CONTENT_STATUS,
  INCIDENT_SEVERITY,
  NOTIFICATION_EVENT_LABELS,
  ROLE_SUMMARY,
} from '@/lib/labels';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { relativeAge } from '@/lib/work';
import '@/app/screens/work-shared.css';

const SHOW = 6;

const TEXT = {
  title: 'My work',
  description:
    'What is waiting for you across the companies you work in, from your role. Everything links to the page where you do it.',
  roleHeading: 'You are working as',
  nothing: 'Nothing is waiting for you right now.',
  nothingBody:
    'New items appear here as soon as something needs you. The bell at the top tells you too.',
  loadError: 'Something on this page could not be loaded',
  facts: {
    approvals: 'Posts waiting for your decision',
    mine: 'Your drafts and rejected posts',
    ready: 'Approved, ready to publish',
    inbox: 'Messages for you',
    incidents: 'Open incidents',
    unread: 'Unread notifications',
  },
  seeAll: 'See all',
  more: (n: number) => `and ${n} more`,
  blocks: {
    approvals: {
      title: 'Waiting for your decision',
      body: 'Posts sent for review that you may review or approve.',
      open: 'Review',
    },
    mine: {
      title: 'Your posts that need you',
      body: 'Drafts you have not sent yet and posts that were sent back to you.',
      open: 'Open',
    },
    ready: {
      title: 'Approved, ready to publish',
      body: 'Approved posts nobody has published or scheduled yet.',
      open: 'Publish',
    },
    scheduled: {
      title: 'Scheduled to go out',
      body: 'Posts waiting for their time.',
      open: 'Open',
    },
    inbox: {
      title: 'Messages assigned to you',
      body: 'Comments and messages a colleague gave you to answer.',
      open: 'Answer',
    },
    incidents: {
      title: 'Open incidents',
      body: 'Incidents still open or being investigated.',
      open: 'Open',
    },
    freezes: {
      title: 'Publishing is frozen',
      body: 'While a freeze is on, nothing is published for that company or account.',
      open: 'See freezes',
    },
    notifications: {
      title: 'Unread notifications',
      body: 'What DCC told you and you have not read.',
      open: 'Open',
    },
  },
  version: (n: number) => `version ${n}`,
  noText: '(no text)',
  required: (done: number, needed: number) => `${done} of ${needed} approvals`,
  overdue: 'Overdue',
  dueAt: (when: string) => `Answer by ${when}`,
  whole: 'The whole company',
  scheduledFor: (when: string) => `Goes out ${when}`,
  overdueTone: 'Overdue',
  pointsTo: 'Open',
};

function Block({
  title,
  body,
  count,
  onSeeAll,
  children,
}: {
  title: string;
  body: string;
  count: number;
  onSeeAll?: () => void;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>
            {title} <span className="kit-tab-count">{count}</span>
          </h2>
          <p>{body}</p>
        </div>
        {onSeeAll && (
          <button type="button" className="text-link" onClick={onSeeAll}>
            {TEXT.seeAll}
          </button>
        )}
      </div>
      {children}
    </section>
  );
}

function Todo({
  rows,
}: {
  rows: {
    id: string;
    title: string;
    note?: ReactNode;
    chip?: ReactNode;
    onOpen: () => void;
    open: string;
  }[];
}) {
  return (
    <>
      <ul className="kit-todo">
        {rows.slice(0, SHOW).map((row) => (
          <li key={row.id}>
            <div className="kit-todo-main">
              <strong>{row.title}</strong>
              {row.note && <small>{row.note}</small>}
            </div>
            <span className="kit-row" style={{ gap: 10 }}>
              {row.chip}
              <button type="button" className="btn btn-outline" onClick={row.onOpen}>
                {row.open}
              </button>
            </span>
          </li>
        ))}
      </ul>
      {rows.length > SHOW && <p className="kit-more">{TEXT.more(rows.length - SHOW)}</p>}
    </>
  );
}

/** Everything waiting on this person, built from what their role may read. A block they may not read is not shown. */
export function MyWorkScreen() {
  const { me, can, companyId, companyName, open, personName } = useWorkspace();
  const queryCompany = companyId ? `?companyId=${companyId}` : '';

  const counts = useApiData<DashboardDto>('/dashboard');
  const approvals = useApiData<ApprovalQueueRowDto[]>(
    can('content.review') ? '/approval-requests' : null,
  );
  const items = useApiData<ContentItemDto[]>(can('content.read') ? '/content-items' : null);
  const publications = useApiData<PublicationDto[]>(can('content.read') ? '/publications' : null);
  const inbox = useApiData<InboxMessageDto[]>(
    can('inbox.read')
      ? `/inbox${queryCompany ? `${queryCompany}&` : '?'}assignedTo=${me.user.id}`
      : null,
  );
  const incidents = useApiData<IncidentDto[]>(can('incident.read') ? '/incidents' : null);
  const freezes = useApiData<FreezeDto[]>(can('publishing.freeze') ? '/publishing-freezes' : null);
  const notifications = useApiData<NotificationDto[]>('/notifications?unreadOnly=true');

  const inScope = <T extends { companyId: string }>(rows: T[] | null) =>
    (rows ?? []).filter((row) => !companyId || row.companyId === companyId);

  const pending = inScope(approvals.data).filter((row) => row.status === 'pending');
  const mine = inScope(items.data).filter(
    (row) => row.createdBy === me.user.id && (row.status === 'draft' || row.status === 'rejected'),
  );
  const busyIds = new Set(
    (publications.data ?? [])
      .filter((p) => p.status === 'published' || p.status === 'scheduled' || p.status === 'pending')
      .map((p) => p.contentItemId),
  );
  const ready = can('content.publish')
    ? inScope(items.data).filter((row) => row.status === 'approved' && !busyIds.has(row.id))
    : [];
  const scheduled = inScope(publications.data)
    .filter((p) => p.status === 'scheduled')
    .sort((a, b) => (a.scheduledAt ?? '').localeCompare(b.scheduledAt ?? ''));
  const openIncidents = can('incident.manage')
    ? inScope(incidents.data).filter(
        (row) => row.status === 'open' || row.status === 'investigating',
      )
    : [];
  const itemById = new Map((items.data ?? []).map((row) => [row.id, row]));
  const messages = inScope(inbox.data);
  const activeFreezes = inScope(freezes.data);
  const unread = (notifications.data ?? []).filter(
    (row) => !companyId || row.companyId === companyId,
  );

  const loading = counts.loading || approvals.loading || items.loading || publications.loading;
  const firstError =
    [counts, approvals, items, publications, inbox, incidents, freezes, notifications]
      .map((r) => r.error)
      .find(Boolean) ?? null;
  const total =
    pending.length +
    mine.length +
    ready.length +
    messages.length +
    openIncidents.length +
    unread.length;
  const roles = [...new Set(me.memberships.map((m) => m.role))];
  const textOf = (id: string) => excerpt(itemById.get(id)?.preview?.excerpt ?? TEXT.noText, 90);

  return (
    <div className="kit-stack">
      <PageHeader title={TEXT.title} description={TEXT.description} />
      <ErrorBox error={firstError} title={TEXT.loadError} loading />
      <Callout title={TEXT.roleHeading}>
        {roles.map((role) => (
          <span key={role} style={{ display: 'block' }}>
            <strong>{ROLE_LABELS[role]}</strong>: {ROLE_SUMMARY[role]}
          </span>
        ))}
      </Callout>
      {loading ? (
        <Skeletons />
      ) : (
        <>
          <div className="kit-facts">
            {can('content.review') && <Fact label={TEXT.facts.approvals} value={pending.length} />}
            {can('content.create') && <Fact label={TEXT.facts.mine} value={mine.length} />}
            {can('content.publish') && <Fact label={TEXT.facts.ready} value={ready.length} />}
            {can('inbox.read') && <Fact label={TEXT.facts.inbox} value={messages.length} />}
            {can('incident.manage') && (
              <Fact label={TEXT.facts.incidents} value={openIncidents.length} />
            )}
            <Fact
              label={TEXT.facts.unread}
              value={unread.length || counts.data?.unreadNotifications || 0}
            />
          </div>
          {total === 0 && scheduled.length === 0 && activeFreezes.length === 0 && (
            <EmptyBlock title={TEXT.nothing}>{TEXT.nothingBody}</EmptyBlock>
          )}

          {pending.length > 0 && (
            <Block
              {...TEXT.blocks.approvals}
              count={pending.length}
              onSeeAll={() => open('approvals')}
            >
              <Todo
                rows={pending.map((row) => ({
                  id: row.id,
                  title: textOf(row.contentItemId),
                  note: `${companyName(row.companyId)} · sent by ${personName(row.requestedBy)} ${relativeAge(row.requestedAt)} · ${TEXT.required(row.approvals, row.requiredApprovals)}`,
                  onOpen: () => open('content', row.contentItemId, { tab: 'approval' }),
                  open: TEXT.blocks.approvals.open,
                }))}
              />
            </Block>
          )}

          {mine.length > 0 && (
            <Block {...TEXT.blocks.mine} count={mine.length} onSeeAll={() => open('content')}>
              <Todo
                rows={mine.map((row) => ({
                  id: row.id,
                  title: excerpt(row.preview?.excerpt ?? TEXT.noText, 90),
                  note: `${companyName(row.companyId)} · changed ${relativeAge(row.updatedAt)}`,
                  chip: <StatusChip status={CONTENT_STATUS[row.status]} />,
                  onOpen: () => open('content', row.id),
                  open: TEXT.blocks.mine.open,
                }))}
              />
            </Block>
          )}

          {ready.length > 0 && (
            <Block {...TEXT.blocks.ready} count={ready.length} onSeeAll={() => open('publishing')}>
              <Todo
                rows={ready.map((row) => ({
                  id: row.id,
                  title: excerpt(row.preview?.excerpt ?? TEXT.noText, 90),
                  note: `${companyName(row.companyId)} · approved, changed ${relativeAge(row.updatedAt)}`,
                  onOpen: () => open('content', row.id, { tab: 'publications' }),
                  open: TEXT.blocks.ready.open,
                }))}
              />
            </Block>
          )}

          {scheduled.length > 0 && (
            <Block
              {...TEXT.blocks.scheduled}
              count={scheduled.length}
              onSeeAll={() => open('calendar')}
            >
              <Todo
                rows={scheduled.map((row) => ({
                  id: row.id,
                  title: textOf(row.contentItemId),
                  note: `${companyName(row.companyId)} · ${TEXT.scheduledFor(formatDateTime(row.scheduledAt))}`,
                  onOpen: () => open('publishing', row.id),
                  open: TEXT.blocks.scheduled.open,
                }))}
              />
            </Block>
          )}

          {messages.length > 0 && (
            <Block {...TEXT.blocks.inbox} count={messages.length} onSeeAll={() => open('inbox')}>
              <Todo
                rows={messages.map((row) => ({
                  id: `${row.socialAccountId}-${row.engineMessageId}`,
                  title: excerpt(row.text, 90),
                  note: `${row.authorName} · ${companyName(row.companyId)} · received ${relativeAge(row.receivedAt)}${row.dueAt ? ` · ${TEXT.dueAt(formatDateTime(row.dueAt))}` : ''}`,
                  chip: row.overdue ? <StatusChip label={TEXT.overdue} tone="red" /> : undefined,
                  onOpen: () => open('inbox'),
                  open: TEXT.blocks.inbox.open,
                }))}
              />
            </Block>
          )}

          {openIncidents.length > 0 && (
            <Block
              {...TEXT.blocks.incidents}
              count={openIncidents.length}
              onSeeAll={() => open('incidents')}
            >
              <Todo
                rows={openIncidents.map((row) => ({
                  id: row.id,
                  title: row.title,
                  note: `${companyName(row.companyId)} · opened ${relativeAge(row.openedAt)}`,
                  chip: <StatusChip status={INCIDENT_SEVERITY[row.severity]} />,
                  onOpen: () => open('incidents', row.id),
                  open: TEXT.blocks.incidents.open,
                }))}
              />
            </Block>
          )}

          {activeFreezes.length > 0 && (
            <Block
              {...TEXT.blocks.freezes}
              count={activeFreezes.length}
              onSeeAll={() => open('publishing', null, { tab: 'freezes' })}
            >
              <Todo
                rows={activeFreezes.map((row) => ({
                  id: row.id,
                  title: `${companyName(row.companyId)}${row.socialAccountId ? '' : ` · ${TEXT.whole}`}`,
                  note: `${row.reason ?? '—'} · by ${personName(row.frozenBy)} ${relativeAge(row.frozenAt)}`,
                  onOpen: () => open('publishing', null, { tab: 'freezes' }),
                  open: TEXT.blocks.freezes.open,
                }))}
              />
            </Block>
          )}

          {unread.length > 0 && (
            <Block
              {...TEXT.blocks.notifications}
              count={unread.length}
              onSeeAll={() => open('notifications')}
            >
              <Todo
                rows={unread.map((row) => ({
                  id: row.id,
                  title: row.summary,
                  note: `${NOTIFICATION_EVENT_LABELS[row.eventType]} · ${companyName(row.companyId)} · ${relativeAge(row.createdAt)}`,
                  onOpen: () => open('notifications'),
                  open: TEXT.blocks.notifications.open,
                }))}
              />
            </Block>
          )}
        </>
      )}
    </div>
  );
}
