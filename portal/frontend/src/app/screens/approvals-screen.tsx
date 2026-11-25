'use client';

import { useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import {
  type ApprovalQueueItemDto,
  type ApprovalRequestDto,
  type ApprovalRequestStatus,
  type ContentCategoryDto,
  type ContentItemDto,
  type ContentVersionDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { ErrorBox } from '@/components/error-box';
import { PostPreviews } from '@/components/previews/post-previews';
import { StatusChip } from '@/components/status-chip';
import { DataGrid, type GridColumn, type GridFilter } from '@/components/kit/data-grid';
import { Drawer } from '@/components/kit/drawer';
import { PageHeader } from '@/components/kit/page-header';
import { Callout, Fact } from '@/components/kit/parts';
import { TabPanel, Tabs, useTabParam } from '@/components/kit/tabs';
import { ApprovalSummary, DecidePanel } from '@/components/work/approval-panel';
import {
  ApprovalProgress,
  EmptyBlock,
  PlatformChips,
  Skeletons,
  TargetChips,
} from '@/components/work/parts';
import { excerpt, formatDateTime } from '@/lib/format';
import { APPROVAL_REQUEST_STATUS, CONTENT_STATUS } from '@/lib/labels';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { ageInDays, relativeAge } from '@/lib/work';
import './approvals-screen.css';
import './work-shared.css';

const STATUSES: ApprovalRequestStatus[] = ['pending', 'approved', 'rejected'];

const TEXT = {
  title: 'Review and approvals',
  description:
    'Posts that were sent for review. Read the text and how it will look, see the rule it is held to and who has decided, then comment, approve or reject. DCC never lets the author of any version decide on it.',
  duty: 'Separation of duties enforced by DCC',
  loadError: 'The review queue could not be loaded',
  tabsLabel: 'Requests by state',
  tabs: { pending: 'Waiting for a decision', approved: 'Approved', rejected: 'Rejected' },
  facts: {
    waiting: 'Waiting for a decision',
    waitingNote: 'In the companies in view',
    oldest: 'Waiting longest',
    oldestNote: (when: string) => `Sent ${when}`,
    none: '—',
    noneNote: 'Nothing is waiting',
    approved: 'Approved',
    approvedNote: 'Their posts can be published',
    rejected: 'Rejected',
    rejectedNote: 'Sent back to their authors',
    long: 'Waiting over 3 days',
    longNote: 'These need attention first',
  },
  caption: (status: string) => `Approval requests: ${status}`,
  columns: {
    post: 'Post',
    company: 'Company',
    kind: 'Kind',
    networks: 'Networks',
    by: 'Sent by',
    sent: 'Sent',
    progress: 'Approvals',
    status: 'State',
    action: '',
  },
  filters: {
    company: 'Company',
    requester: 'Sent by',
    age: 'Waiting for',
    kind: 'Kind of content',
  },
  ages: {
    day: 'Less than a day',
    few: '1 to 3 days',
    long: 'More than 3 days',
    week: 'More than a week',
  },
  noKind: 'No kind chosen',
  noText: '(text not available)',
  olderVersion: 'A newer version exists',
  longWait: 'Over 3 days',
  review: 'Open',
  openLabel: (text: string) => `Open the request for: ${text}`,
  empty: {
    pending: 'Nothing is waiting for a decision',
    pendingBody:
      'When someone sends a post for review it appears here, oldest first. You are told in the bell when that happens.',
    approved: 'No approved requests in view',
    approvedBody: 'Requests whose approvals are complete are listed here.',
    rejected: 'No rejected requests in view',
    rejectedBody: 'Requests that were rejected are listed here. The author edits and sends again.',
  },
  drawerTitle: (text: string) => excerpt(text, 70),
  drawerSub: (company: string, status: string) => `${company} · ${status}`,
  text: 'Text that was sent for review',
  version: (n: number) => `Version ${n}`,
  writtenBy: (name: string, when: string) => `written by ${name} · ${when}`,
  previews: 'How it will look',
  accounts: 'For these accounts',
  older:
    'This request is for an older version. The post was edited afterwards and went back to draft. Only the current version has its decisions on this screen.',
  olderFacts: 'Requested by',
  openPost: 'Open the post',
  close: 'Close',
  cannotRead: 'This request could not be read in full',
  requestId: 'Request id',
  noVersion: 'The text of this version could not be found.',
  rule: 'Rule and decisions',
};

/** Reads `?request=<id>` once: a link from "My work" or the bell opens that request straight away. */
function useInitialRequest(): string | null {
  const params = useSearchParams();
  const [initial] = useState(() => params.get('request'));
  return initial;
}

/**
 * `GET /api/approval-requests?status=` (all three states, for the counts), `GET /api/content-items` (text, kind,
 * networks), and for one open request `GET /content-items/:id/versions` and `/approval`,
 * `POST /api/approval-requests/:id/review|approve|reject`.
 */
export function ApprovalsScreen() {
  const { companyId, companyName, personName, open } = useWorkspace();
  const [tab, setTab] = useTabParam([...STATUSES], 'pending');
  const initial = useInitialRequest();
  const [selectedId, setSelectedId] = useState<string | null>(initial);
  const pending = useApiData<ApprovalQueueItemDto[]>('/approval-requests?status=pending');
  const approved = useApiData<ApprovalQueueItemDto[]>('/approval-requests?status=approved');
  const rejected = useApiData<ApprovalQueueItemDto[]>('/approval-requests?status=rejected');
  const items = useApiData<ContentItemDto[]>('/content-items');
  const accounts = useApiData<SocialAccountDto[]>('/social-accounts');
  const categories = useApiData<ContentCategoryDto[]>('/content-categories');

  const inScope = (rows: ApprovalQueueItemDto[] | null) =>
    (rows ?? []).filter((row) => !companyId || row.companyId === companyId);
  const lists = {
    pending: inScope(pending.data),
    approved: inScope(approved.data),
    rejected: inScope(rejected.data),
  };
  const queues = { pending, approved, rejected };
  const rows = lists[tab as ApprovalRequestStatus];
  const itemById = useMemo(
    () => new Map((items.data ?? []).map((item) => [item.id, item])),
    [items.data],
  );
  const accountList = useMemo(() => accounts.data ?? [], [accounts.data]);
  const everyRow = [...lists.pending, ...lists.approved, ...lists.rejected];
  const selected = everyRow.find((row) => row.id === selectedId) ?? null;

  const reread = () => {
    pending.reload();
    approved.reload();
    rejected.reload();
    items.reload();
  };
  const categoryName = (id: string | null) =>
    id ? (categories.data?.find((entry) => entry.id === id)?.name ?? '…') : null;
  const textOf = (row: ApprovalQueueItemDto) =>
    itemById.get(row.contentItemId)?.preview?.excerpt ?? TEXT.noText;
  const olderThan = (row: ApprovalQueueItemDto) => {
    const item = itemById.get(row.contentItemId);
    return Boolean(item && item.currentVersionId !== row.contentVersionId);
  };

  const waiting = lists.pending;
  const oldest = [...waiting].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt))[0];
  const longWaiting = waiting.filter((row) => ageInDays(row.requestedAt) > 3).length;

  const columns: GridColumn<ApprovalQueueItemDto>[] = [
    {
      id: 'post',
      header: TEXT.columns.post,
      cell: (row) => (
        <>
          <button
            type="button"
            className="wk-link wk-excerpt-link"
            aria-label={TEXT.openLabel(textOf(row))}
            onClick={() => setSelectedId(row.id)}
          >
            <span className="wk-excerpt">{textOf(row)}</span>
          </button>
          {olderThan(row) && <StatusChip label={TEXT.olderVersion} tone="amber" />}
        </>
      ),
      sortValue: (row) => textOf(row),
      exportValue: (row) => textOf(row),
    },
    {
      id: 'company',
      header: TEXT.columns.company,
      cell: (row) => companyName(row.companyId),
      sortValue: (row) => companyName(row.companyId),
    },
    {
      id: 'kind',
      header: TEXT.columns.kind,
      cell: (row) =>
        categoryName(itemById.get(row.contentItemId)?.categoryId ?? null) ?? (
          <span className="wk-muted">{TEXT.noKind}</span>
        ),
      sortValue: (row) => categoryName(itemById.get(row.contentItemId)?.categoryId ?? null) ?? '',
      exportValue: (row) => categoryName(itemById.get(row.contentItemId)?.categoryId ?? null) ?? '',
    },
    {
      id: 'networks',
      header: TEXT.columns.networks,
      cell: (row) => (
        <PlatformChips
          ids={itemById.get(row.contentItemId)?.preview?.targetAccountIds ?? []}
          accounts={accountList}
        />
      ),
      hiddenByDefault: true,
      exportValue: () => '',
    },
    {
      id: 'by',
      header: TEXT.columns.by,
      cell: (row) => personName(row.requestedBy),
      sortValue: (row) => personName(row.requestedBy),
    },
    {
      id: 'sent',
      header: TEXT.columns.sent,
      cell: (row) => (
        <>
          {formatDateTime(row.requestedAt)}
          <span className="wk-sub">
            {relativeAge(row.requestedAt)}
            {row.status === 'pending' && ageInDays(row.requestedAt) > 3
              ? ` · ${TEXT.longWait}`
              : ''}
          </span>
        </>
      ),
      sortValue: (row) => row.requestedAt,
      exportValue: (row) => row.requestedAt,
    },
    {
      id: 'progress',
      header: TEXT.columns.progress,
      cell: (row) => <ApprovalProgress done={row.approvals} needed={row.requiredApprovals} />,
      sortValue: (row) => row.approvals / Math.max(1, row.requiredApprovals),
      exportValue: (row) => `${row.approvals} of ${row.requiredApprovals}`,
    },
    {
      id: 'status',
      header: TEXT.columns.status,
      cell: (row) => <StatusChip status={APPROVAL_REQUEST_STATUS[row.status]} />,
      sortValue: (row) => APPROVAL_REQUEST_STATUS[row.status].label,
      exportValue: (row) => APPROVAL_REQUEST_STATUS[row.status].label,
    },
    {
      id: 'action',
      header: TEXT.columns.action,
      cell: (row) => (
        <button type="button" className="btn btn-outline" onClick={() => setSelectedId(row.id)}>
          {TEXT.review}
        </button>
      ),
      exportValue: () => '',
    },
  ];

  const filters: GridFilter<ApprovalQueueItemDto>[] = [
    {
      id: 'company',
      label: TEXT.filters.company,
      options: [...new Set(rows.map((row) => row.companyId))]
        .map((id) => ({ value: id, label: companyName(id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      test: (row, value) => row.companyId === value,
    },
    {
      id: 'requester',
      label: TEXT.filters.requester,
      options: [...new Set(rows.map((row) => row.requestedBy))]
        .map((id) => ({ value: id, label: personName(id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      test: (row, value) => row.requestedBy === value,
    },
    {
      id: 'age',
      label: TEXT.filters.age,
      options: [
        { value: 'day', label: TEXT.ages.day },
        { value: 'few', label: TEXT.ages.few },
        { value: 'long', label: TEXT.ages.long },
        { value: 'week', label: TEXT.ages.week },
      ],
      test: (row, value) => {
        const days = ageInDays(row.requestedAt);
        return value === 'day'
          ? days < 1
          : value === 'few'
            ? days >= 1 && days <= 3
            : value === 'long'
              ? days > 3
              : days > 7;
      },
    },
    {
      id: 'kind',
      label: TEXT.filters.kind,
      options: [
        { value: 'none', label: TEXT.noKind },
        ...(categories.data ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
      ],
      test: (row, value) => {
        const category = itemById.get(row.contentItemId)?.categoryId ?? null;
        return value === 'none' ? category === null : category === value;
      },
    },
  ];

  const error = pending.error ?? approved.error ?? rejected.error ?? items.error;
  const loading = !pending.data && pending.loading;

  return (
    <div className="wk-grid">
      <PageHeader
        title={TEXT.title}
        description={TEXT.description}
        actions={<StatusChip label={TEXT.duty} tone="amber" />}
        tabs={
          <Tabs
            label={TEXT.tabsLabel}
            active={tab}
            onChange={setTab}
            tabs={STATUSES.map((status) => ({
              id: status,
              label: TEXT.tabs[status],
              count: queues[status].data ? lists[status].length : null,
            }))}
          />
        }
      />
      <ErrorBox error={error} title={TEXT.loadError} loading />
      <div className="wk-facts">
        <Fact label={TEXT.facts.waiting} value={waiting.length} note={TEXT.facts.waitingNote} />
        <Fact
          label={TEXT.facts.oldest}
          value={oldest ? relativeAge(oldest.requestedAt).replace(' ago', '') : TEXT.facts.none}
          note={
            oldest ? TEXT.facts.oldestNote(formatDateTime(oldest.requestedAt)) : TEXT.facts.noneNote
          }
        />
        <Fact label={TEXT.facts.long} value={longWaiting} note={TEXT.facts.longNote} />
        <Fact
          label={TEXT.facts.approved}
          value={lists.approved.length}
          note={TEXT.facts.approvedNote}
        />
        <Fact
          label={TEXT.facts.rejected}
          value={lists.rejected.length}
          note={TEXT.facts.rejectedNote}
        />
      </div>
      <TabPanel id={tab}>
        {loading ? (
          <Skeletons rows={6} />
        ) : (
          <DataGrid
            key={tab}
            caption={TEXT.caption(TEXT.tabs[tab as ApprovalRequestStatus])}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            filters={filters}
            searchText={(row) =>
              [
                textOf(row),
                companyName(row.companyId),
                personName(row.requestedBy),
                categoryName(itemById.get(row.contentItemId)?.categoryId ?? null) ?? '',
              ].join(' ')
            }
            defaultSort={{ id: 'sent', direction: tab === 'pending' ? 'asc' : 'desc' }}
            exportName={`approval-requests-${tab}`}
            onOpen={(row) => setSelectedId(row.id)}
            rowTone={(row) =>
              row.status === 'pending' && ageInDays(row.requestedAt) > 3
                ? 'kit-row-overdue'
                : undefined
            }
            empty={
              <EmptyBlock title={TEXT.empty[tab as ApprovalRequestStatus]}>
                {TEXT.empty[`${tab as ApprovalRequestStatus}Body`]}
              </EmptyBlock>
            }
          />
        )}
      </TabPanel>
      {selected && (
        <ApprovalDrawer
          row={selected}
          item={itemById.get(selected.contentItemId) ?? null}
          accounts={accountList}
          onClose={() => setSelectedId(null)}
          onOpenPost={() => open('content', selected.contentItemId, { tab: 'approval' })}
          onChanged={reread}
        />
      )}
    </div>
  );
}

function ApprovalDrawer({
  row,
  item,
  accounts,
  onClose,
  onOpenPost,
  onChanged,
}: {
  row: ApprovalQueueItemDto;
  item: ContentItemDto | null;
  accounts: readonly SocialAccountDto[];
  onClose: () => void;
  onOpenPost: () => void;
  onChanged: () => void;
}) {
  const { companyName, personName } = useWorkspace();
  const base = `/content-items/${row.contentItemId}`;
  const versions = useApiData<ContentVersionDto[]>(`${base}/versions`);
  const approval = useApiData<ApprovalRequestDto | null>(`${base}/approval`);
  const version = versions.data?.find((entry) => entry.id === row.contentVersionId);
  // `/approval` answers for the CURRENT version: it is this request only when the ids match.
  const request = approval.data && approval.data.id === row.id ? approval.data : null;
  const superseded = Boolean(item && item.currentVersionId !== row.contentVersionId);
  const reread = () => {
    versions.reload();
    approval.reload();
    onChanged();
  };

  return (
    <Drawer
      title={TEXT.drawerTitle(version?.body ?? item?.preview?.excerpt ?? TEXT.noText)}
      subtitle={TEXT.drawerSub(
        companyName(row.companyId),
        APPROVAL_REQUEST_STATUS[row.status].label,
      )}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn btn-outline" onClick={onOpenPost}>
            {TEXT.openPost}
          </button>
          <button type="button" className="btn btn-primary" onClick={onClose}>
            {TEXT.close}
          </button>
        </>
      }
    >
      <div className="wk-stack">
        <ErrorBox error={versions.error ?? approval.error} title={TEXT.cannotRead} loading />
        {superseded && <Callout tone="warn">{TEXT.older}</Callout>}
        <div>
          <span className="label">{TEXT.text}</span>
          {versions.loading && !version ? (
            <Skeletons rows={3} />
          ) : version ? (
            <>
              <div className="wk-text-box">
                <p className="wk-body-text">{version.body}</p>
              </div>
              <small className="hint">
                {TEXT.version(version.versionNumber)} ·{' '}
                {TEXT.writtenBy(personName(version.createdBy), formatDateTime(version.createdAt))}
              </small>
            </>
          ) : (
            <p className="wk-hint">{TEXT.noVersion}</p>
          )}
        </div>
        {version && (
          <>
            <div>
              <span className="label">{TEXT.accounts}</span>
              <TargetChips ids={version.targetAccountIds} accounts={accounts} />
            </div>
            <div>
              <h3 className="label">{TEXT.previews}</h3>
              <PostPreviews
                key={version.id}
                accounts={accounts.filter((account) =>
                  version.targetAccountIds.includes(account.id),
                )}
                body={version.body}
                media={version.media}
              />
            </div>
          </>
        )}
        <div>
          <h3 className="label">{TEXT.rule}</h3>
          {approval.loading && !approval.data ? (
            <Skeletons rows={3} />
          ) : request ? (
            <div className="wk-stack">
              <ApprovalSummary request={request} />
              <DecidePanel
                request={request}
                versions={versions.data}
                superseded={false}
                onChanged={reread}
              />
            </div>
          ) : (
            <div className="wk-stack">
              <div className="wk-row">
                <StatusChip status={APPROVAL_REQUEST_STATUS[row.status]} />
                <ApprovalProgress done={row.approvals} needed={row.requiredApprovals} />
              </div>
              <p className="wk-hint">
                {TEXT.olderFacts} {personName(row.requestedBy)} · {formatDateTime(row.requestedAt)}
              </p>
              {item && (
                <p className="wk-hint">
                  Post: {CONTENT_STATUS[item.status].label}. The rule and the decisions of an older
                  request are not kept on this screen.
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </Drawer>
  );
}
