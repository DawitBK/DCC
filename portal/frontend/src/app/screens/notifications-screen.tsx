'use client';

import { useMemo } from 'react';
import { NOTIFICATION_EVENT_TYPES, type MarkedReadDto, type NotificationDto } from '@dcc/contracts';
import { ErrorBox } from '@/components/error-box';
import { DataGrid, type GridColumn, type GridFilter } from '@/components/kit/data-grid';
import { PageHeader } from '@/components/kit/page-header';
import { Fact } from '@/components/kit/parts';
import { StatusChip } from '@/components/status-chip';
import { EmptyBlock, Skeletons } from '@/components/work/parts';
import { useToast } from '@/components/toast';
import { apiSend } from '@/lib/browser-api';
import { formatDateTime } from '@/lib/format';
import { NOTIFICATION_EVENT_LABELS } from '@/lib/labels';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import type { WorkspaceScreen } from '@/lib/workspace-routes';
import '@/app/screens/work-shared.css';

const TEXT = {
  title: 'Notifications',
  description:
    'Everything DCC told you: posts waiting for you, decisions on your posts, freezes, incidents and messages assigned to you. Only you can see these.',
  caption: 'Your notifications',
  loadError: 'Your notifications could not be loaded',
  markAll: 'Mark all as read',
  markAllWhy: 'There is nothing unread.',
  markRead: 'Mark as read',
  markReadLabel: (summary: string) => `Mark as read: ${summary}`,
  open: 'Open',
  openLabel: (summary: string) => `Open what this is about: ${summary}`,
  allRead: 'Marked as read.',
  allMarked: (n: number) =>
    n === 1 ? '1 notification marked as read.' : `${n} notifications marked as read.`,
  unreadChip: 'Unread',
  readChip: 'Read',
  facts: { unread: 'Unread', total: 'In the list', today: 'Today' },
  notes: {
    unread: 'Waiting for you',
    total: 'All you have received',
    today: 'Received since midnight',
  },
  columns: {
    message: 'What happened',
    event: 'Kind',
    company: 'Company',
    state: 'State',
    when: 'Received',
    actions: 'Actions',
  },
  filters: { state: 'State', event: 'Kind', company: 'Company' },
  stateUnread: 'Unread only',
  stateRead: 'Read only',
  emptyTitle: 'No notifications yet',
  emptyBody:
    'When something needs you, such as a post to review or an incident, it appears here and in the bell at the top.',
  search: 'Search the message, kind and company',
};

/** Where a notification takes the person: the screen (and record) it is about. */
function targetOf(item: NotificationDto): {
  screen: WorkspaceScreen;
  id?: string;
  params?: Record<string, string>;
} {
  switch (item.eventType) {
    case 'content.submitted':
      return { screen: 'content', id: item.targetId, params: { tab: 'approval' } };
    case 'content.approved':
    case 'content.rejected':
      return { screen: 'content', id: item.targetId };
    case 'publishing.frozen':
      return { screen: 'publishing' };
    case 'incident.opened':
      return { screen: 'incidents', id: item.targetId };
    case 'inbox.assigned':
    case 'inbox.escalated':
    case 'inbox.reply_requested':
    case 'inbox.reply_decided':
      return { screen: 'inbox' };
    case 'approval.reminder':
    case 'approval.escalated':
    case 'approval.expired':
    case 'approval.emergency':
    case 'approval.followup_due':
      return { screen: 'content', id: item.targetId, params: { tab: 'approval' } };
    case 'incident.freeze_lift_requested':
    case 'incident.freeze_lifted':
      return { screen: 'publishing' };
    case 'incident.review_due':
    case 'incident.review_overdue':
    case 'incident.closed':
    case 'alert.delivery_failed':
      return { screen: 'incidents', id: item.targetId };
    case 'publication.removed':
    case 'publication.correction_requested':
      return { screen: 'publishing' };
  }
}

/** The full page behind the bell: `GET /api/notifications`, mark one read, mark all read, each with a way into what it is about. */
export function NotificationsScreen() {
  const { companyId, companyName, open, refreshNotifications, companies } = useWorkspace();
  const showToast = useToast();
  const list = useApiData<NotificationDto[]>('/notifications');
  const action = useAction();

  const rows = useMemo(
    () => (list.data ?? []).filter((row) => !companyId || row.companyId === companyId),
    [list.data, companyId],
  );
  const unread = rows.filter((row) => !row.readAt).length;
  const midnight = new Date();
  midnight.setHours(0, 0, 0, 0);
  const today = rows.filter((row) => new Date(row.createdAt) >= midnight).length;

  const reread = () => {
    list.reload();
    refreshNotifications();
  };

  const markOne = async (item: NotificationDto) => {
    const failure = await action.run(() => apiSend('POST', `/notifications/${item.id}/read`));
    reread();
    if (!failure) showToast(TEXT.allRead);
  };
  const markAll = async () => {
    let marked = 0;
    const failure = await action.run(async () => {
      marked = (await apiSend<MarkedReadDto>('POST', '/notifications/read-all')).marked;
    });
    reread();
    if (!failure) showToast(TEXT.allMarked(marked));
  };
  const openTarget = (item: NotificationDto) => {
    const target = targetOf(item);
    if (!item.readAt) void markOneQuiet(item);
    open(target.screen, target.id ?? null, target.params);
  };
  const markOneQuiet = async (item: NotificationDto) => {
    await action.run(() => apiSend('POST', `/notifications/${item.id}/read`));
    refreshNotifications();
  };

  const columns: GridColumn<NotificationDto>[] = [
    {
      id: 'message',
      header: TEXT.columns.message,
      sortValue: (row) => row.summary,
      cell: (row) => (
        <>
          <button
            type="button"
            className="text-link"
            aria-label={TEXT.openLabel(row.summary)}
            onClick={() => openTarget(row)}
          >
            <span className="post-title">{row.summary}</span>
          </button>
        </>
      ),
    },
    {
      id: 'event',
      header: TEXT.columns.event,
      sortValue: (row) => NOTIFICATION_EVENT_LABELS[row.eventType],
      cell: (row) => NOTIFICATION_EVENT_LABELS[row.eventType],
    },
    {
      id: 'company',
      header: TEXT.columns.company,
      sortValue: (row) => companyName(row.companyId),
      cell: (row) => companyName(row.companyId),
    },
    {
      id: 'state',
      header: TEXT.columns.state,
      sortValue: (row) => (row.readAt ? 1 : 0),
      exportValue: (row) => (row.readAt ? TEXT.readChip : TEXT.unreadChip),
      cell: (row) => (
        <StatusChip
          label={row.readAt ? TEXT.readChip : TEXT.unreadChip}
          tone={row.readAt ? 'gray' : 'amber'}
        />
      ),
    },
    {
      id: 'when',
      header: TEXT.columns.when,
      sortValue: (row) => row.createdAt,
      exportValue: (row) => row.createdAt,
      cell: (row) => formatDateTime(row.createdAt),
    },
    {
      id: 'actions',
      header: TEXT.columns.actions,
      cell: (row) => (
        <span className="row-actions" style={{ marginTop: 0 }}>
          <button type="button" className="text-link" onClick={() => openTarget(row)}>
            {TEXT.open}
          </button>
          {!row.readAt && (
            <button
              type="button"
              className="text-link"
              disabled={action.busy}
              aria-label={TEXT.markReadLabel(row.summary)}
              onClick={() => void markOne(row)}
            >
              {TEXT.markRead}
            </button>
          )}
        </span>
      ),
    },
  ];

  const filters: GridFilter<NotificationDto>[] = [
    {
      id: 'state',
      label: TEXT.filters.state,
      options: [
        { value: 'unread', label: TEXT.stateUnread },
        { value: 'read', label: TEXT.stateRead },
      ],
      test: (row, value) => (value === 'unread' ? !row.readAt : !!row.readAt),
    },
    {
      id: 'event',
      label: TEXT.filters.event,
      options: NOTIFICATION_EVENT_TYPES.map((type) => ({
        value: type,
        label: NOTIFICATION_EVENT_LABELS[type],
      })),
      test: (row, value) => row.eventType === value,
    },
    {
      id: 'company',
      label: TEXT.filters.company,
      options: companies.map((company) => ({ value: company.id, label: company.name })),
      test: (row, value) => row.companyId === value,
    },
  ];

  return (
    <div className="kit-stack">
      <PageHeader
        title={TEXT.title}
        description={TEXT.description}
        actions={
          <button
            type="button"
            className="btn btn-outline"
            disabled={action.busy || unread === 0}
            title={unread === 0 ? TEXT.markAllWhy : undefined}
            onClick={() => void markAll()}
          >
            {TEXT.markAll}
          </button>
        }
      />
      <ErrorBox error={list.error} title={TEXT.loadError} loading />
      <ErrorBox error={action.error} />
      {list.loading && !list.data ? (
        <Skeletons />
      ) : (
        <>
          <div className="kit-facts">
            <Fact label={TEXT.facts.unread} value={unread} note={TEXT.notes.unread} />
            <Fact label={TEXT.facts.total} value={rows.length} note={TEXT.notes.total} />
            <Fact label={TEXT.facts.today} value={today} note={TEXT.notes.today} />
          </div>
          <section className="panel">
            <DataGrid
              caption={TEXT.caption}
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              searchText={(row) =>
                `${row.summary} ${NOTIFICATION_EVENT_LABELS[row.eventType]} ${companyName(row.companyId)}`
              }
              filters={filters}
              defaultSort={{ id: 'when', direction: 'desc' }}
              exportName="notifications"
              onOpen={openTarget}
              rowTone={(row) => (row.readAt ? undefined : 'kit-row-unread')}
              empty={<EmptyBlock title={TEXT.emptyTitle}>{TEXT.emptyBody}</EmptyBlock>}
            />
          </section>
        </>
      )}
    </div>
  );
}
