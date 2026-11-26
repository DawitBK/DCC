'use client';

import { useMemo, useState } from 'react';
import {
  PUBLICATION_STATUSES,
  SOCIAL_PLATFORMS,
  type ContentCategoryDto,
  type ContentItemDto,
  type FreezeDto,
  type FreezeWithLiftDto,
  type PublicationDto,
  type ReconcileResultDto,
  type SettleStuckKeyResultDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import {
  BypassCheckButton,
  BypassCheckHint,
  BypassCheckResult,
  type BypassCheckState,
} from '@/components/bypass-check';
import { ErrorBox } from '@/components/error-box';
import {
  CancelPublicationDialog,
  ReconcileButton,
  UnresolvedKeysPanel,
} from '@/components/publication-actions';
import { StatusChip } from '@/components/status-chip';
import { DataGrid, type GridColumn, type GridFilter } from '@/components/kit/data-grid';
import { PageHeader } from '@/components/kit/page-header';
import { Callout, Fact } from '@/components/kit/parts';
import { TabPanel, Tabs, useTabParam } from '@/components/kit/tabs';
import { EngineBanner } from '@/components/work/engine-banner';
import { FreezeDialog, LiftFreezeDialog } from '@/components/work/freeze-dialogs';
import { AccountChip, EmptyBlock, Skeletons, WhyBox } from '@/components/work/parts';
import { PublishDialog } from '@/components/work/publish-dialog';
import { queryString } from '@/lib/browser-api';
import { excerpt, formatDateTime, shortId } from '@/lib/format';
import { PLATFORM_LABELS, PUBLICATION_STATUS } from '@/lib/labels';
import { needsRoleHint, whoCanText } from '@/lib/permissions-ui';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { accountPublishState, publicationMoment, relativeAge } from '@/lib/work';
import { PublicationDetail } from './publication-detail';
import './publishing-screen.css';
import './work-shared.css';

const TABS = ['ready', 'scheduled', 'published', 'failed', 'all', 'freezes'] as const;

const TEXT = {
  title: 'Publishing',
  description:
    'Approved posts that are ready to go out, what is scheduled, what was sent, what failed or is waiting for the engine, and the emergency freeze. Every send is recorded and nothing goes out that was not approved.',
  loadError: 'Publishing could not be loaded',
  checkEngine: 'Check with the engine',
  checkEngineWhy: 'Only someone who may publish can ask the engine what became of a post.',
  bypass: 'Check for posts DCC did not send',
  bypassWhy: 'Handling incidents needs this role.',
  freeze: 'Freeze publishing',
  freezeWhy: 'Only a role that may freeze publishing can use the emergency switch.',
  tabsLabel: 'Publishing by state',
  tabs: {
    ready: 'Ready to publish',
    scheduled: 'Scheduled',
    published: 'Published',
    failed: 'Failed and unresolved',
    all: 'Every publication',
    freezes: 'Freezes',
  },
  facts: {
    ready: 'Ready to publish',
    readyNote: 'Approved, waiting for a publisher',
    scheduled: 'Scheduled',
    scheduledNote: (when: string | null) =>
      when ? `Next: ${when}` : 'Held by the engine until their time',
    published: 'Published',
    publishedNote: (n: number) => `${n} in the last 7 days`,
    failed: 'Failed or unresolved',
    failedNote: 'Need a look',
    freezes: 'Freezes in force',
    freezesNote: 'Publishing stopped there',
    freezesUnknown: '—',
    freezesUnknownNote: 'Listed for roles that may freeze',
  },
  range: {
    from: 'From',
    to: 'To',
    note: 'Narrows the list to publications planned or sent in this window (the API filters it). Leave both empty for all.',
    clear: 'Clear dates',
  },
  filters: {
    company: 'Company',
    account: 'Account',
    platform: 'Network',
    status: 'State',
    kind: 'Kind of content',
    requester: 'Requested by',
    ready: 'Can be sent',
  },
  columns: {
    post: 'Post',
    company: 'Company',
    kind: 'Kind',
    where: 'Where it can go',
    updated: 'Changed',
    action: '',
    when: 'Planned or sent',
    account: 'Account',
    status: 'State',
    by: 'Requested by',
    result: 'Result',
  },
  publishAction: 'Publish…',
  noReady: 'No account can take it yet',
  readyYes: 'Ready',
  readyNo: 'Blocked',
  openPost: 'Open the post',
  details: 'Details',
  cancel: 'Cancel',
  noText: '(text not available)',
  newer: 'A newer version of the post exists',
  inProgress: 'Waiting for the engine',
  emptyReady: 'Nothing is approved and waiting to be published',
  emptyReadyBody:
    'A post appears here once enough people have approved it. Then someone who may publish sends it now or schedules it.',
  emptyScheduled: 'Nothing is scheduled',
  emptyScheduledBody:
    'Schedule an approved post from the Ready to publish tab and it waits here until its time.',
  emptyPublished: 'Nothing has been published in this view',
  emptyPublishedBody: 'Posts that went out through DCC are listed here with a link to the network.',
  emptyFailed: 'Nothing failed and nothing is waiting for the engine',
  emptyFailedBody: 'A send that failed, or that the engine did not confirm, is listed here.',
  emptyAll: 'No publications yet',
  emptyAllBody: 'Every attempt to send a post through DCC is recorded and listed here.',
  failedExplain:
    'A failed send never reached the network. A send marked “waiting for the engine” is one where DCC does not know the outcome: DCC will not send it again by itself. Use “Check with the engine” to ask, and settle by hand what the engine cannot answer.',
  freezesTitle: 'Publishing freezes',
  freezesNote:
    'A freeze stops publishing through DCC for a company or one account. It cannot stop someone posting directly on a network. Lifting a freeze asks you to sign in again first.',
  freezeColumns: { scope: 'Scope', reason: 'Reason', by: 'Frozen by', since: 'Since', action: '' },
  wholeCompany: 'Whole company',
  noReason: 'No reason recorded',
  lift: 'Lift freeze…',
  twoPeople: 'Needs two people to lift',
  openToConfirm: 'Open the company to confirm',
  noFreezes: 'Publishing is not frozen anywhere you can see',
  noFreezesBody:
    'If something goes wrong, a freeze stops every send for a company or an account at once.',
  freezeCaption: 'Publishing freezes in force',
  freezeNeeds: 'You cannot list freezes',
  gridCaption: (name: string) => `Publications: ${name}`,
  readyCaption: 'Approved posts ready to publish',
  readyFilterYes: 'At least one account can take it',
  readyFilterNo: 'No account can take it yet',
};

/** `/publishing` is the working screen; `/publishing/<publicationId>` is one publication. */
export function PublishingScreen() {
  const { detailId } = useWorkspace();
  return detailId ? <PublicationDetail id={detailId} /> : <PublishingBoard />;
}

function dayStart(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}
function dayEnd(value: string): string | undefined {
  if (!value) return undefined;
  const date = new Date(`${value}T23:59:59.999`);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function PublishingBoard() {
  const {
    companyId,
    companyName,
    personName,
    open,
    can,
    companies,
    companiesWhere,
    refreshNotifications,
  } = useWorkspace();
  const [tab, setTab] = useTabParam([...TABS], 'ready');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const ranged = Boolean(from || to);
  const items = useApiData<ContentItemDto[]>('/content-items');
  const everything = useApiData<PublicationDto[]>('/publications');
  const windowed = useApiData<PublicationDto[]>(
    ranged ? `/publications${queryString({ from: dayStart(from), to: dayEnd(to) })}` : null,
  );
  const accounts = useApiData<SocialAccountDto[]>('/social-accounts');
  const categories = useApiData<ContentCategoryDto[]>('/content-categories');
  const mayFreeze = can('publishing.freeze');
  const freezes = useApiData<FreezeWithLiftDto[]>(mayFreeze ? '/publishing-freezes' : null);

  const [publishing, setPublishing] = useState<ContentItemDto | null>(null);
  const [cancelling, setCancelling] = useState<PublicationDto | null>(null);
  const [freezing, setFreezing] = useState(false);
  const [lifting, setLifting] = useState<FreezeWithLiftDto | null>(null);
  const [reconciled, setReconciled] = useState<{ result: ReconcileResultDto; at: Date } | null>(
    null,
  );
  const [settled, setSettled] = useState<Record<string, SettleStuckKeyResultDto>>({});
  const [bypass, setBypass] = useState<BypassCheckState | null>(null);

  const accountList = useMemo(() => accounts.data ?? [], [accounts.data]);
  const accountsInScope = accountList.filter(
    (account) => !companyId || account.companyId === companyId,
  );
  const itemById = useMemo(
    () => new Map((items.data ?? []).map((item) => [item.id, item])),
    [items.data],
  );
  const inScope = <T extends { companyId: string }>(rows: readonly T[] | null): T[] =>
    (rows ?? []).filter((row) => !companyId || row.companyId === companyId);
  const allPublications = inScope(everything.data);
  const shown = inScope(ranged ? windowed.data : everything.data);
  const freezeRows = inScope(freezes.data);
  const freezeList = mayFreeze && freezes.data && !freezes.error ? freezes.data : null;

  const reread = () => {
    items.reload();
    everything.reload();
    windowed.reload();
    freezes.reload();
    refreshNotifications();
  };
  const accountOf = (id: string) => accountList.find((account) => account.id === id);
  const accountName = (id: string) => {
    const account = accountOf(id);
    return account
      ? `${PLATFORM_LABELS[account.platform]} · ${account.displayName}`
      : `Account ${shortId(id)}`;
  };
  const categoryName = (id: string | null) =>
    id ? (categories.data?.find((entry) => entry.id === id)?.name ?? '…') : null;
  const textOf = (row: PublicationDto) =>
    itemById.get(row.contentItemId)?.preview?.excerpt ?? TEXT.noText;
  const newerThan = (row: PublicationDto) => {
    const item = itemById.get(row.contentItemId);
    return Boolean(item && item.currentVersionId !== row.contentVersionId);
  };
  const freezeScope = (freeze: FreezeDto) =>
    `${companyName(freeze.companyId)} · ${freeze.socialAccountId ? accountName(freeze.socialAccountId) : TEXT.wholeCompany}`;

  // --- ready to publish ---
  const readyItems = inScope(items.data).filter((item) => item.status === 'approved');
  const readyStates = (item: ContentItemDto) =>
    (item.preview?.targetAccountIds ?? []).flatMap((id) => {
      const account = accountOf(id);
      return account
        ? [
            accountPublishState({
              item,
              versionTargetIds: item.preview?.targetAccountIds ?? [],
              account,
              company: companies.find((entry) => entry.id === item.companyId),
              publications: everything.data ?? [],
              freezes: freezeList,
            }),
          ]
        : [];
    });
  const canSend = (item: ContentItemDto) =>
    can('content.publish', item.companyId) && readyStates(item).some((state) => state.ready);

  const readyColumns: GridColumn<ContentItemDto>[] = [
    {
      id: 'post',
      header: TEXT.columns.post,
      cell: (row) => (
        <button
          type="button"
          className="wk-link wk-excerpt-link"
          onClick={() => open('content', row.id, { tab: 'publications' })}
        >
          <span className="wk-excerpt">{row.preview?.excerpt ?? TEXT.noText}</span>
        </button>
      ),
      sortValue: (row) => row.preview?.excerpt ?? '',
      exportValue: (row) => row.preview?.excerpt ?? '',
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
      cell: (row) => categoryName(row.categoryId) ?? <span className="wk-muted">—</span>,
      sortValue: (row) => categoryName(row.categoryId) ?? '',
      exportValue: (row) => categoryName(row.categoryId) ?? '',
      hiddenByDefault: true,
    },
    {
      id: 'where',
      header: TEXT.columns.where,
      cell: (row) => (
        <ul className="wk-ready-targets">
          {readyStates(row).map((state) => (
            <li key={state.account.id}>
              <AccountChip account={state.account} />
              {state.existing ? (
                <StatusChip
                  label={PUBLICATION_STATUS[state.existing.status].label}
                  tone={PUBLICATION_STATUS[state.existing.status].tone}
                />
              ) : state.ready ? (
                <StatusChip label={TEXT.readyYes} tone="green" />
              ) : (
                <span className="wk-muted" title={state.blockers.join(' ')}>
                  <StatusChip label={TEXT.readyNo} tone="amber" />{' '}
                  {excerpt(state.blockers[0] ?? '', 60)}
                </span>
              )}
            </li>
          ))}
        </ul>
      ),
      sortValue: (row) => readyStates(row).filter((state) => state.ready).length,
      exportValue: (row) =>
        readyStates(row)
          .map((state) => `${accountName(state.account.id)}: ${state.ready ? 'ready' : 'blocked'}`)
          .join('; '),
    },
    {
      id: 'updated',
      header: TEXT.columns.updated,
      cell: (row) => (
        <>
          {formatDateTime(row.updatedAt)}
          <span className="wk-sub">{relativeAge(row.updatedAt)}</span>
        </>
      ),
      sortValue: (row) => row.updatedAt,
      exportValue: (row) => row.updatedAt,
    },
    {
      id: 'action',
      header: TEXT.columns.action,
      cell: (row) => (
        <button
          type="button"
          className="btn btn-primary"
          disabled={!canSend(row)}
          title={
            !can('content.publish', row.companyId)
              ? needsRoleHint('content.publish')
              : canSend(row)
                ? undefined
                : (readyStates(row).find((state) => !state.ready)?.blockers[0] ?? TEXT.noReady)
          }
          onClick={() => setPublishing(row)}
        >
          {TEXT.publishAction}
        </button>
      ),
      exportValue: () => '',
    },
  ];
  const readyFilters: GridFilter<ContentItemDto>[] = [
    {
      id: 'company',
      label: TEXT.filters.company,
      options: [...new Set(readyItems.map((row) => row.companyId))].map((id) => ({
        value: id,
        label: companyName(id),
      })),
      test: (row, value) => row.companyId === value,
    },
    {
      id: 'account',
      label: TEXT.filters.account,
      options: accountsInScope.map((account) => ({
        value: account.id,
        label: accountName(account.id),
      })),
      test: (row, value) => (row.preview?.targetAccountIds ?? []).includes(value),
    },
    {
      id: 'platform',
      label: TEXT.filters.platform,
      options: SOCIAL_PLATFORMS.map((value) => ({ value, label: PLATFORM_LABELS[value] })),
      test: (row, value) =>
        (row.preview?.targetAccountIds ?? []).some((id) => accountOf(id)?.platform === value),
    },
    {
      id: 'kind',
      label: TEXT.filters.kind,
      options: (categories.data ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
      test: (row, value) => row.categoryId === value,
    },
    {
      id: 'ready',
      label: TEXT.filters.ready,
      options: [
        { value: 'yes', label: TEXT.readyFilterYes },
        { value: 'no', label: TEXT.readyFilterNo },
      ],
      test: (row, value) => readyStates(row).some((state) => state.ready) === (value === 'yes'),
    },
  ];

  // --- publications ---
  const publicationColumns: GridColumn<PublicationDto>[] = [
    {
      id: 'when',
      header: TEXT.columns.when,
      cell: (row) => (
        <>
          {formatDateTime(publicationMoment(row).toISOString())}
          <span className="wk-sub">
            {row.scheduledAt ? 'Planned' : relativeAge(row.requestedAt)}
          </span>
        </>
      ),
      sortValue: (row) => publicationMoment(row).getTime(),
      exportValue: (row) => publicationMoment(row).toISOString(),
    },
    {
      id: 'account',
      header: TEXT.columns.account,
      cell: (row) => (
        <AccountChip account={accountOf(row.socialAccountId)} id={row.socialAccountId} />
      ),
      sortValue: (row) => accountName(row.socialAccountId),
      exportValue: (row) => accountName(row.socialAccountId),
    },
    {
      id: 'post',
      header: TEXT.columns.post,
      cell: (row) => (
        <>
          <button
            type="button"
            className="wk-link wk-excerpt-link"
            onClick={() => open('publishing', row.id)}
          >
            <span className="wk-excerpt">{textOf(row)}</span>
          </button>
          {newerThan(row) && <small className="wk-sub">{TEXT.newer}</small>}
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
      hiddenByDefault: true,
    },
    {
      id: 'status',
      header: TEXT.columns.status,
      cell: (row) => (
        <>
          <StatusChip status={PUBLICATION_STATUS[row.status]} />
          {row.status === 'pending' && <small className="wk-sub">{TEXT.inProgress}</small>}
        </>
      ),
      sortValue: (row) => PUBLICATION_STATUS[row.status].label,
      exportValue: (row) => PUBLICATION_STATUS[row.status].label,
    },
    {
      id: 'by',
      header: TEXT.columns.by,
      cell: (row) => personName(row.requestedBy),
      sortValue: (row) => personName(row.requestedBy),
      hiddenByDefault: true,
    },
    {
      id: 'result',
      header: TEXT.columns.result,
      cell: (row) =>
        row.error ? (
          <span>{excerpt(row.error, 90)}</span>
        ) : row.externalPostUrl ? (
          <a
            className="wk-link"
            href={row.externalPostUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open on the network
          </a>
        ) : (
          <span className="wk-muted">—</span>
        ),
      exportValue: (row) => row.error ?? row.externalPostUrl ?? '',
    },
    {
      id: 'action',
      header: TEXT.columns.action,
      cell: (row) => (
        <span className="wk-row">
          <button type="button" className="wk-link" onClick={() => open('publishing', row.id)}>
            {TEXT.details}
          </button>
          {row.status === 'scheduled' && can('content.publish', row.companyId) && (
            <button type="button" className="wk-link" onClick={() => setCancelling(row)}>
              {TEXT.cancel}
            </button>
          )}
        </span>
      ),
      exportValue: () => '',
    },
  ];
  const publicationFilters = (
    rows: PublicationDto[],
    withStatus: boolean,
  ): GridFilter<PublicationDto>[] => [
    {
      id: 'company',
      label: TEXT.filters.company,
      options: [...new Set(rows.map((row) => row.companyId))].map((id) => ({
        value: id,
        label: companyName(id),
      })),
      test: (row, value) => row.companyId === value,
    },
    {
      id: 'account',
      label: TEXT.filters.account,
      options: [...new Set(rows.map((row) => row.socialAccountId))].map((id) => ({
        value: id,
        label: accountName(id),
      })),
      test: (row, value) => row.socialAccountId === value,
    },
    {
      id: 'platform',
      label: TEXT.filters.platform,
      options: SOCIAL_PLATFORMS.map((value) => ({ value, label: PLATFORM_LABELS[value] })),
      test: (row, value) => accountOf(row.socialAccountId)?.platform === value,
    },
    ...(withStatus
      ? [
          {
            id: 'status',
            label: TEXT.filters.status,
            options: PUBLICATION_STATUSES.map((value) => ({
              value,
              label: PUBLICATION_STATUS[value].label,
            })),
            test: (row: PublicationDto, value: string) => row.status === value,
          },
        ]
      : []),
    {
      id: 'requester',
      label: TEXT.filters.requester,
      options: [...new Set(rows.map((row) => row.requestedBy))].map((id) => ({
        value: id,
        label: personName(id),
      })),
      test: (row, value) => row.requestedBy === value,
    },
  ];
  const publicationGrid = (
    rows: PublicationDto[],
    name: string,
    empty: { title: string; body: string },
    options: { withStatus?: boolean; sort?: 'asc' | 'desc' } = {},
  ) => (
    <DataGrid
      key={name}
      caption={TEXT.gridCaption(name)}
      columns={publicationColumns}
      rows={rows}
      rowKey={(row) => row.id}
      filters={publicationFilters(rows, options.withStatus ?? false)}
      searchText={(row) =>
        [
          textOf(row),
          accountName(row.socialAccountId),
          companyName(row.companyId),
          personName(row.requestedBy),
          row.error ?? '',
        ].join(' ')
      }
      defaultSort={{ id: 'when', direction: options.sort ?? 'desc' }}
      exportName={`publications-${name.toLowerCase().replace(/\W+/g, '-')}`}
      onOpen={(row) => open('publishing', row.id)}
      empty={<EmptyBlock title={empty.title}>{empty.body}</EmptyBlock>}
    />
  );

  const scheduled = shown.filter((row) => row.status === 'scheduled');
  const published = shown.filter((row) => row.status === 'published');
  const failed = shown.filter((row) => row.status === 'failed' || row.status === 'pending');
  const nextScheduled = allPublications
    .filter((row) => row.status === 'scheduled' && row.scheduledAt)
    .sort((a, b) => a.scheduledAt!.localeCompare(b.scheduledAt!))[0];
  const weekAgo = Date.now() - 7 * 86_400_000;
  const publishedWeek = allPublications.filter(
    (row) =>
      row.status === 'published' &&
      new Date(row.completedAt ?? row.requestedAt).getTime() >= weekAgo,
  ).length;
  const counts = {
    ready: readyItems.length,
    scheduled: allPublications.filter((row) => row.status === 'scheduled').length,
    published: allPublications.filter((row) => row.status === 'published').length,
    failed: allPublications.filter((row) => row.status === 'failed' || row.status === 'pending')
      .length,
    all: allPublications.length,
    freezes: freezeList ? freezeRows.length : null,
  };

  const mayCheck = can('content.publish');
  const mayBypass = can('incident.manage');
  const loading = (!items.data && items.loading) || (!everything.data && everything.loading);
  const dateRange = tab !== 'ready' && tab !== 'freezes' && (
    <div className="wk-range">
      <label>
        {TEXT.range.from}
        <input
          className="field"
          type="date"
          value={from}
          max={to || undefined}
          onChange={(event) => setFrom(event.target.value)}
        />
      </label>
      <label>
        {TEXT.range.to}
        <input
          className="field"
          type="date"
          value={to}
          min={from || undefined}
          onChange={(event) => setTo(event.target.value)}
        />
      </label>
      {ranged && (
        <button
          type="button"
          className="text-link"
          onClick={() => {
            setFrom('');
            setTo('');
          }}
        >
          {TEXT.range.clear}
        </button>
      )}
      <p>{TEXT.range.note}</p>
    </div>
  );

  return (
    <div className="wk-grid">
      <PageHeader
        title={TEXT.title}
        description={TEXT.description}
        actions={
          <>
            <ReconcileButton
              onDone={reread}
              onResult={(result) => {
                setSettled({});
                setReconciled({ result, at: new Date() });
                setTab('failed');
              }}
              disabled={!mayCheck}
              title={
                mayCheck ? undefined : `${TEXT.checkEngineWhy} ${needsRoleHint('content.publish')}`
              }
            />
            {mayBypass ? (
              <BypassCheckButton onChange={setBypass} onDone={reread} />
            ) : (
              <button
                type="button"
                className="btn btn-outline"
                disabled
                title={`${TEXT.bypassWhy} ${needsRoleHint('incident.manage')}`}
              >
                {TEXT.bypass}
              </button>
            )}
            <button
              type="button"
              className="btn btn-danger"
              disabled={!mayFreeze}
              title={
                mayFreeze ? undefined : `${TEXT.freezeWhy} ${needsRoleHint('publishing.freeze')}`
              }
              onClick={() => setFreezing(true)}
            >
              {TEXT.freeze}
            </button>
          </>
        }
        meta={mayBypass ? <BypassCheckHint /> : undefined}
        tabs={
          <Tabs
            label={TEXT.tabsLabel}
            active={tab}
            onChange={setTab}
            tabs={TABS.map((id) => ({ id, label: TEXT.tabs[id], count: counts[id] }))}
          />
        }
      />
      <ErrorBox
        error={items.error ?? everything.error ?? windowed.error}
        title={TEXT.loadError}
        loading
      />
      <BypassCheckResult state={bypass} />
      <div className="wk-facts">
        <Fact label={TEXT.facts.ready} value={counts.ready} note={TEXT.facts.readyNote} />
        <Fact
          label={TEXT.facts.scheduled}
          value={counts.scheduled}
          note={TEXT.facts.scheduledNote(
            nextScheduled ? formatDateTime(nextScheduled.scheduledAt) : null,
          )}
        />
        <Fact
          label={TEXT.facts.published}
          value={counts.published}
          note={TEXT.facts.publishedNote(publishedWeek)}
        />
        <Fact label={TEXT.facts.failed} value={counts.failed} note={TEXT.facts.failedNote} />
        {freezeList ? (
          <Fact
            label={TEXT.facts.freezes}
            value={freezeRows.length}
            note={TEXT.facts.freezesNote}
          />
        ) : (
          <Fact
            label={TEXT.facts.freezes}
            value={TEXT.facts.freezesUnknown}
            note={TEXT.facts.freezesUnknownNote}
          />
        )}
      </div>
      <div style={{ marginBottom: 18 }}>
        <EngineBanner accounts={accountsInScope} />
      </div>
      {dateRange}
      <TabPanel id={tab}>
        {loading ? (
          <Skeletons rows={6} />
        ) : tab === 'ready' ? (
          <DataGrid
            caption={TEXT.readyCaption}
            columns={readyColumns}
            rows={readyItems}
            rowKey={(row) => row.id}
            filters={readyFilters}
            searchText={(row) =>
              [
                row.preview?.excerpt ?? '',
                companyName(row.companyId),
                categoryName(row.categoryId) ?? '',
              ].join(' ')
            }
            defaultSort={{ id: 'updated', direction: 'desc' }}
            exportName="ready-to-publish"
            onOpen={(row) => open('content', row.id, { tab: 'publications' })}
            empty={<EmptyBlock title={TEXT.emptyReady}>{TEXT.emptyReadyBody}</EmptyBlock>}
          />
        ) : tab === 'scheduled' ? (
          publicationGrid(
            scheduled,
            'Scheduled',
            { title: TEXT.emptyScheduled, body: TEXT.emptyScheduledBody },
            { sort: 'asc' },
          )
        ) : tab === 'published' ? (
          publicationGrid(published, 'Published', {
            title: TEXT.emptyPublished,
            body: TEXT.emptyPublishedBody,
          })
        ) : tab === 'failed' ? (
          <div className="wk-stack">
            <Callout tone="warn">{TEXT.failedExplain}</Callout>
            {reconciled && (
              <UnresolvedKeysPanel
                result={reconciled.result}
                checkedAt={reconciled.at}
                accountOf={(publicationId) => {
                  const row = everything.data?.find((entry) => entry.id === publicationId);
                  return row ? accountName(row.socialAccountId) : null;
                }}
                onHide={() => setReconciled(null)}
                canSettle={mayCheck}
                settled={settled}
                onSettled={(answer) => {
                  setSettled((current) => ({ ...current, [answer.key]: answer }));
                  reread();
                }}
              />
            )}
            {publicationGrid(
              failed,
              'Failed and unresolved',
              { title: TEXT.emptyFailed, body: TEXT.emptyFailedBody },
              { withStatus: true },
            )}
          </div>
        ) : tab === 'all' ? (
          publicationGrid(
            shown,
            'Every publication',
            { title: TEXT.emptyAll, body: TEXT.emptyAllBody },
            { withStatus: true },
          )
        ) : (
          <div className="wk-stack">
            <p className="wk-toolbar-note">{TEXT.freezesNote}</p>
            {!mayFreeze ? (
              <WhyBox
                title={TEXT.freezeNeeds}
                reasons={[
                  needsRoleHint('publishing.freeze'),
                  `These roles can: ${whoCanText('publishing.freeze')}.`,
                ]}
              />
            ) : freezes.error ? (
              <ErrorBox error={freezes.error} title={TEXT.freezesTitle} loading />
            ) : (
              <DataGrid
                caption={TEXT.freezeCaption}
                rows={freezeRows}
                rowKey={(row) => row.id}
                defaultSort={{ id: 'since', direction: 'desc' }}
                exportName="publishing-freezes"
                searchText={(row) =>
                  `${freezeScope(row)} ${row.reason ?? ''} ${personName(row.frozenBy)}`
                }
                columns={[
                  {
                    id: 'scope',
                    header: TEXT.freezeColumns.scope,
                    cell: (row) => freezeScope(row),
                    sortValue: (row) => freezeScope(row),
                  },
                  {
                    id: 'reason',
                    header: TEXT.freezeColumns.reason,
                    cell: (row) => row.reason ?? <span className="wk-muted">{TEXT.noReason}</span>,
                    sortValue: (row) => row.reason ?? '',
                    exportValue: (row) => row.reason ?? '',
                  },
                  {
                    id: 'by',
                    header: TEXT.freezeColumns.by,
                    cell: (row) => personName(row.frozenBy),
                    sortValue: (row) => personName(row.frozenBy),
                  },
                  {
                    id: 'since',
                    header: TEXT.freezeColumns.since,
                    cell: (row) => (
                      <>
                        {formatDateTime(row.frozenAt)}
                        <span className="wk-sub">{relativeAge(row.frozenAt)}</span>
                      </>
                    ),
                    sortValue: (row) => row.frozenAt,
                    exportValue: (row) => row.frozenAt,
                  },
                  {
                    id: 'action',
                    header: TEXT.freezeColumns.action,
                    cell: (row) =>
                      row.twoPersonLift ? (
                        <>
                          <StatusChip label={TEXT.twoPeople} tone="amber" />
                          <button
                            type="button"
                            className="btn btn-outline"
                            onClick={() => open('companies', row.companyId, { tab: 'publishing' })}
                          >
                            {TEXT.openToConfirm}
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          className="btn btn-outline"
                          disabled={!can('publishing.freeze', row.companyId)}
                          title={
                            can('publishing.freeze', row.companyId)
                              ? undefined
                              : needsRoleHint('publishing.freeze')
                          }
                          onClick={() => setLifting(row)}
                        >
                          {TEXT.lift}
                        </button>
                      ),
                    exportValue: () => '',
                  },
                ]}
                empty={
                  <EmptyBlock
                    title={TEXT.noFreezes}
                    action={
                      <button
                        type="button"
                        className="btn btn-danger"
                        onClick={() => setFreezing(true)}
                      >
                        {TEXT.freeze}
                      </button>
                    }
                  >
                    {TEXT.noFreezesBody}
                  </EmptyBlock>
                }
              />
            )}
          </div>
        )}
      </TabPanel>
      {publishing && (
        <PublishDialog
          item={publishing}
          accounts={accountList}
          publications={everything.data ?? []}
          freezes={freezeList}
          onClose={() => setPublishing(null)}
          onDone={() => {
            setPublishing(null);
            reread();
          }}
        />
      )}
      {cancelling && (
        <CancelPublicationDialog
          publication={cancelling}
          accountName={accountName(cancelling.socialAccountId)}
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            reread();
          }}
        />
      )}
      {freezing && (
        <FreezeDialog
          accounts={accountList}
          initialCompanyId={companyId ?? companiesWhere('publishing.freeze')[0]?.id}
          onClose={() => setFreezing(false)}
          onDone={() => {
            setFreezing(false);
            reread();
            setTab('freezes');
          }}
        />
      )}
      {lifting && (
        <LiftFreezeDialog
          freeze={lifting}
          scope={freezeScope(lifting)}
          onClose={() => setLifting(null)}
          onDone={() => {
            setLifting(null);
            reread();
          }}
        />
      )}
    </div>
  );
}
