'use client';

import { useMemo, useState } from 'react';
import type {
  ApprovalQueueRowDto,
  ApprovalRequestFullDto,
  BrandDto,
  ContentCategoryDto,
  ContentItemDto,
  ContentVersionDto,
  FreezeDto,
  PublicationDto,
  SocialAccountDto,
} from '@dcc/contracts';
import { ErrorBox } from '@/components/error-box';
import { PostPreviews } from '@/components/previews/post-previews';
import { CancelPublicationDialog, ReconcileButton } from '@/components/publication-actions';
import { StatusChip } from '@/components/status-chip';
import { DataGrid, type GridColumn } from '@/components/kit/data-grid';
import { PageHeader } from '@/components/kit/page-header';
import {
  Callout,
  CopyId,
  DescriptionList,
  Fact,
  Timeline,
  type TimelineItem,
} from '@/components/kit/parts';
import { TabPanel, Tabs, useTabParam } from '@/components/kit/tabs';
import { ApprovalSummary, DecidePanel } from '@/components/work/approval-panel';
import { CategoryChangePanel } from '@/components/work/approval-rules';
import {
  AccountChip,
  ApprovalProgress,
  EmptyBlock,
  MediaGallery,
  Skeletons,
  WhyBox,
} from '@/components/work/parts';
import { PublicationDrawer } from '@/components/work/publication-parts';
import { PublishDialog } from '@/components/work/publish-dialog';
import { RuleSummary, SubmitReviewDialog, useRule } from '@/components/work/submit-dialog';
import { VersionHistory } from '@/components/work/version-history';
import { queryString } from '@/lib/browser-api';
import { formatDateTime, shortId } from '@/lib/format';
import {
  APPROVAL_DECISION,
  APPROVAL_REQUEST_STATUS,
  CONTENT_STATUS,
  PLATFORM_LABELS,
  PUBLICATION_STATUS,
} from '@/lib/labels';
import { needsRoleHint } from '@/lib/permissions-ui';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { accountPublishState, accountReadiness, relativeAge } from '@/lib/work';
import { excerpt } from '@/lib/format';
import './content-screen.css';
import './work-shared.css';

/** One row of `GET /api/audit`: the stored row as the API sends it. */
type AuditEvent = {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  details: Record<string, unknown> | null;
};

const TABS = ['overview', 'versions', 'approval', 'publications', 'activity'] as const;

const TEXT = {
  library: 'Content library',
  loadError: 'This post could not be opened',
  back: 'Back to the library',
  versionLine: (version: number | undefined, accounts: number) =>
    `${version ? `Version ${version}` : 'No version yet'} · written for ${accounts} ${accounts === 1 ? 'account' : 'accounts'}`,
  noText: '(this post has no text yet)',
  edit: 'Edit in the composer',
  submit: 'Send for review',
  submitAgain: 'Send for review again',
  publish: 'Publish…',
  tabs: {
    overview: 'Overview',
    versions: 'Versions',
    approval: 'Approval',
    publications: 'Publications',
    activity: 'Activity',
  },
  tabsLabel: 'About this post',
  facts: {
    status: 'Status',
    version: 'Current version',
    approvals: 'Approvals',
    publications: 'Publications',
    accounts: 'Target accounts',
    files: 'Pictures and videos',
    updated: 'Last changed',
    notSent: 'Not sent for review',
    none: 'None yet',
  },
  currentText: 'Text of the current version',
  previews: 'How it looks on each network',
  previewsHint: 'The networks may show it slightly differently.',
  media: 'Pictures and videos',
  targets: 'Target accounts',
  noTargets: 'No target accounts.',
  facts2: 'About this post',
  company: 'Company',
  brand: 'Brand',
  category: 'Kind of content',
  author: 'First written by',
  created: 'Created',
  updated: 'Last changed',
  ids: 'Post id',
  noBrand: 'No brand',
  noCategory: 'No kind chosen (the company’s default rule applies)',
  can: 'What you can do with this post',
  canEdit: 'Edit the text, accounts and files',
  canSubmit: 'Send for review',
  canDecide: 'Review, approve or reject',
  canPublish: 'Publish or schedule',
  yes: 'You can',
  editNote: (status: string) =>
    status === 'draft'
      ? 'Saving makes a new version of this draft.'
      : 'Saving makes a new version and puts the post back to draft: every earlier approval no longer counts and a new one is needed.',
  versionsNote:
    'Every edit is a new version and no version is ever changed. A new version needs a new approval.',
  approvalNone: 'This version has not been sent for review',
  approvalNoneBody:
    'Nobody can approve it until it is sent. When it is sent, this rule applies and is fixed for that request.',
  approvalError: 'The approval of this post could not be read',
  earlier: 'Earlier requests, for older versions',
  earlierHint:
    'Requests opened for versions that were edited afterwards. They are history: a decision there no longer changes the post.',
  earlierNeeds:
    'The list of earlier requests is read from the review queue, which needs a reviewer role.',
  reqVersion: 'Version',
  reqStatus: 'State',
  reqProgress: 'Approvals',
  reqBy: 'Sent by',
  reqAt: 'Sent',
  reqCaption: 'Earlier approval requests of this post',
  mayNotDecide: 'You can read the decisions here. Deciding needs a reviewer or approver role.',
  publishTo: 'Publish to its accounts',
  publishToHint:
    'Each account is a separate publication. Only an approved post can be published, and only to the accounts its current version was written for.',
  publishNow: 'Publish now',
  schedule: 'Schedule',
  alreadyHas: (status: string) => `Already ${status.toLowerCase()}`,
  freezeNow: 'Publishing is frozen',
  freezeCompany: 'The whole company is frozen',
  freezeAccount: (name: string) => `Frozen for ${name}`,
  freezeReason: (reason: string) => `Reason: ${reason}`,
  freezesUnknown:
    'You may not list freezes, so this page cannot show them. DCC checks again when you publish and refuses if publishing is frozen.',
  allPublications: 'Every publication of this post',
  pubCaption: 'Publications of this post',
  pubAccount: 'Account',
  pubVersion: 'Version',
  pubStatus: 'State',
  pubWhen: 'Planned for',
  pubRequested: 'Requested',
  pubResult: 'Result',
  pubActions: 'Actions',
  pubNone: 'Nothing has been published or scheduled for this post',
  pubNoneBody:
    'When someone who may publish sends it to an account, the publication appears here with its state.',
  view: 'Details',
  cancelSchedule: 'Cancel',
  openPost: 'Open on the network',
  sentNow: 'Sent now',
  mayNotPublish: 'Publishing needs a publisher role in this company.',
  activityNote:
    'What happened to this post, built from its versions, its approval and its publications. Newest first.',
  auditTitle: 'Audit trail',
  auditNote: 'The record of who did what to this post, kept by DCC. Read-only.',
  auditNeeds:
    'The audit trail itself is read by people with the audit role. You can still see the history above.',
  auditEmpty: 'The audit trail holds nothing for this post yet.',
  auditError: 'The audit trail could not be read',
  actor: 'Who',
  system: 'System',
  created2: 'Post created',
  versionWritten: (n: number) => `Version ${n} written`,
  requestedReview: 'Sent for review',
  by: (name: string) => `by ${name}`,
  pubRequestedEvent: (account: string) => `Publish requested for ${account}`,
  pubOutcome: (account: string, status: string) => `${account}: ${status}`,
  refresh: 'Read again',
};

const AUDIT_ACTIONS: Record<string, string> = {
  'content.drafted': 'Draft created',
  'content.version_created': 'New version written',
  'content.submitted': 'Sent for review',
  'content.reviewed': 'Review comment added',
  'content.approved': 'Approved',
  'content.rejected': 'Rejected',
  'publication.published': 'Published',
  'publication.scheduled': 'Scheduled',
  'publication.cancelled': 'Schedule cancelled',
  'publication.failed': 'Publication failed',
  'publication.outcome_unknown': 'Publication outcome unknown',
};

/**
 * `GET /api/content-items/:id` (+ `/versions`, `/approval`), `GET /api/publications`, `GET /api/audit`
 * (with `audit.read`), `POST /api/content-items/:id/submit`, `/publish`, `POST /api/publications/:id/cancel`,
 * `POST /api/approval-requests/:id/review|approve|reject`. The tab is kept in `?tab=`.
 */
export function ContentDetail({ id }: { id: string }) {
  const workspace = useWorkspace();
  const { open, can, companyName, personName, screenAllowed, companies, refreshNotifications } =
    workspace;
  const [tab, setTab] = useTabParam([...TABS], 'overview');
  const item = useApiData<ContentItemDto>(`/content-items/${id}`);
  const versions = useApiData<ContentVersionDto[]>(`/content-items/${id}/versions`);
  const approval = useApiData<ApprovalRequestFullDto | null>(`/content-items/${id}/approval`);
  const publicationsAll = useApiData<PublicationDto[]>('/publications');
  const accounts = useApiData<SocialAccountDto[]>('/social-accounts');
  const categories = useApiData<ContentCategoryDto[]>('/content-categories');
  const companyId = item.data?.companyId ?? null;
  const brands = useApiData<BrandDto[]>(companyId ? `/companies/${companyId}/brands` : null);
  const freezes = useApiData<FreezeDto[]>(can('publishing.freeze') ? '/publishing-freezes' : null);
  const queue = useApiData<ApprovalQueueRowDto[]>(
    can('content.review') ? '/approval-requests?status=pending' : null,
  );
  const decidedQueue = useApiData<ApprovalQueueRowDto[]>(
    can('content.review') ? '/approval-requests?status=approved' : null,
  );
  const rejectedQueue = useApiData<ApprovalQueueRowDto[]>(
    can('content.review') ? '/approval-requests?status=rejected' : null,
  );
  const expiredQueue = useApiData<ApprovalQueueRowDto[]>(
    can('content.review') ? '/approval-requests?status=expired' : null,
  );
  const audit = useApiData<AuditEvent[]>(
    item.data && can('audit.read', item.data.companyId)
      ? `/audit${queryString({ targetType: 'content_item', targetId: id, limit: 200 })}`
      : null,
  );
  const rule = useRule(companyId, item.data?.categoryId ?? null);

  const [submitting, setSubmitting] = useState(false);
  const [publishing, setPublishing] = useState<{ accountId?: string; later: boolean } | null>(null);
  const [cancelling, setCancelling] = useState<PublicationDto | null>(null);
  const [looking, setLooking] = useState<PublicationDto | null>(null);

  const reread = () => {
    item.reload();
    versions.reload();
    approval.reload();
    publicationsAll.reload();
    queue.reload();
    decidedQueue.reload();
    rejectedQueue.reload();
    expiredQueue.reload();
    audit.reload();
    freezes.reload();
    refreshNotifications();
  };

  const data = item.data;
  const sortedVersions = useMemo(
    () => [...(versions.data ?? [])].sort((a, b) => b.versionNumber - a.versionNumber),
    [versions.data],
  );
  const current = data
    ? sortedVersions.find((entry) => entry.id === data.currentVersionId)
    : undefined;
  const publications = useMemo(
    () => (publicationsAll.data ?? []).filter((row) => row.contentItemId === id),
    [publicationsAll.data, id],
  );
  const accountList = useMemo(() => accounts.data ?? [], [accounts.data]);
  const category = categories.data?.find((entry) => entry.id === data?.categoryId);
  const brand = brands.data?.find((entry) => entry.id === data?.brandId);
  const company = companies.find((entry) => entry.id === companyId);
  const request = approval.data;

  if (item.error)
    return (
      <>
        <PageHeader
          title={TEXT.loadError}
          crumbs={[{ label: TEXT.library, onClick: () => open('content') }, { label: shortId(id) }]}
          actions={
            <button type="button" className="btn btn-outline" onClick={() => open('content')}>
              {TEXT.back}
            </button>
          }
        />
        <ErrorBox error={item.error} title={TEXT.loadError} loading />
      </>
    );
  if (!data)
    return (
      <>
        <PageHeader title="…" crumbs={[{ label: TEXT.library, onClick: () => open('content') }]} />
        <Skeletons rows={6} />
      </>
    );

  const title = current ? excerpt(current.body, 90) : TEXT.noText;
  const mayEdit = can('content.create', data.companyId);
  // An item whose approval ran out (`expired`) is sent for review again, like a draft or a rejected post.
  const itemStatus: string = data.status;
  const maySubmitStatus =
    itemStatus === 'draft' || itemStatus === 'rejected' || itemStatus === 'expired';
  const maySubmit = can('content.submit', data.companyId) && maySubmitStatus;
  const mayPublish = can('content.publish', data.companyId);
  const readyToPublish = data.status === 'approved';
  const freezesKnown = can('publishing.freeze') && !freezes.error && freezes.data !== null;
  const freezeList = freezesKnown ? (freezes.data ?? []) : null;
  const activeFreezes = (freezeList ?? []).filter((freeze) => freeze.companyId === data.companyId);
  const accountOf = (accountId: string) => accountList.find((entry) => entry.id === accountId);
  const versionNumberOf = (versionId: string) =>
    sortedVersions.find((entry) => entry.id === versionId)?.versionNumber;
  const earlier = [
    ...(queue.data ?? []),
    ...(decidedQueue.data ?? []),
    ...(rejectedQueue.data ?? []),
    ...(expiredQueue.data ?? []),
  ].filter((row) => row.contentItemId === id && row.contentVersionId !== data.currentVersionId);

  const mayNot: string[] = [];
  if (!mayEdit) mayNot.push(needsRoleHint('content.create'));
  if (!can('content.submit', data.companyId)) mayNot.push(needsRoleHint('content.submit'));
  else if (!maySubmitStatus)
    mayNot.push(
      `Only a draft, a rejected post or one whose approval expired can be sent for review. This one is ${CONTENT_STATUS[data.status].label.toLowerCase()}.`,
    );

  const publicationColumns: GridColumn<PublicationDto>[] = [
    {
      id: 'account',
      header: TEXT.pubAccount,
      cell: (row) => (
        <AccountChip account={accountOf(row.socialAccountId)} id={row.socialAccountId} />
      ),
      sortValue: (row) => {
        const account = accountOf(row.socialAccountId);
        return account ? `${account.platform} ${account.displayName}` : row.socialAccountId;
      },
      exportValue: (row) => {
        const account = accountOf(row.socialAccountId);
        return account
          ? `${PLATFORM_LABELS[account.platform]} ${account.displayName}`
          : row.socialAccountId;
      },
    },
    {
      id: 'version',
      header: TEXT.pubVersion,
      cell: (row) => `v${versionNumberOf(row.contentVersionId) ?? '?'}`,
      sortValue: (row) => versionNumberOf(row.contentVersionId) ?? 0,
    },
    {
      id: 'status',
      header: TEXT.pubStatus,
      cell: (row) => <StatusChip status={PUBLICATION_STATUS[row.status]} />,
      sortValue: (row) => PUBLICATION_STATUS[row.status].label,
    },
    {
      id: 'planned',
      header: TEXT.pubWhen,
      cell: (row) => (row.scheduledAt ? formatDateTime(row.scheduledAt) : TEXT.sentNow),
      sortValue: (row) => row.scheduledAt ?? row.requestedAt,
      exportValue: (row) => row.scheduledAt ?? '',
    },
    {
      id: 'requested',
      header: TEXT.pubRequested,
      cell: (row) => (
        <>
          {formatDateTime(row.requestedAt)}
          <span className="wk-sub">{personName(row.requestedBy)}</span>
        </>
      ),
      sortValue: (row) => row.requestedAt,
      exportValue: (row) => `${row.requestedAt} ${personName(row.requestedBy)}`,
    },
    {
      id: 'result',
      header: TEXT.pubResult,
      cell: (row) =>
        row.error ? (
          <span>{excerpt(row.error, 110)}</span>
        ) : row.externalPostUrl ? (
          <a
            className="wk-link"
            href={row.externalPostUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {TEXT.openPost}
          </a>
        ) : (
          '—'
        ),
      exportValue: (row) => row.error ?? row.externalPostUrl ?? '',
    },
    {
      id: 'actions',
      header: TEXT.pubActions,
      cell: (row) => (
        <span className="wk-row">
          <button type="button" className="wk-link" onClick={() => setLooking(row)}>
            {TEXT.view}
          </button>
          {row.status === 'scheduled' && can('content.publish', row.companyId) && (
            <button type="button" className="wk-link" onClick={() => setCancelling(row)}>
              {TEXT.cancelSchedule}
            </button>
          )}
        </span>
      ),
      exportValue: () => '',
    },
  ];

  const activity: (TimelineItem & { at: string })[] = [
    {
      id: 'created',
      at: data.createdAt,
      when: formatDateTime(data.createdAt),
      tone: 'gray' as const,
      title: `${TEXT.created2} ${TEXT.by(personName(data.createdBy))}`,
    },
    ...sortedVersions
      .filter((entry) => entry.versionNumber > 1)
      .map((entry) => ({
        id: `version-${entry.id}`,
        at: entry.createdAt,
        when: formatDateTime(entry.createdAt),
        tone: 'blue' as const,
        title: `${TEXT.versionWritten(entry.versionNumber)} ${TEXT.by(personName(entry.createdBy))}`,
      })),
    ...(request
      ? [
          {
            id: `request-${request.id}`,
            at: request.requestedAt,
            when: formatDateTime(request.requestedAt),
            tone: 'amber' as const,
            title: `${TEXT.requestedReview} ${TEXT.by(personName(request.requestedBy))}`,
            detail: `Version ${versionNumberOf(request.contentVersionId) ?? '?'}`,
          },
          ...request.decisions.map((decision) => ({
            id: `decision-${decision.id}`,
            at: decision.decidedAt,
            when: formatDateTime(decision.decidedAt),
            tone: (decision.decision === 'approved'
              ? 'green'
              : decision.decision === 'rejected'
                ? 'red'
                : 'blue') as TimelineItem['tone'],
            title: `${APPROVAL_DECISION[decision.decision].label} ${TEXT.by(personName(decision.decidedBy))}`,
            detail: decision.comment ?? undefined,
          })),
        ]
      : []),
    ...publications.flatMap((row) => {
      const account = accountOf(row.socialAccountId);
      const name = account
        ? `${PLATFORM_LABELS[account.platform]} · ${account.displayName}`
        : shortId(row.socialAccountId);
      return [
        {
          id: `pub-req-${row.id}`,
          at: row.requestedAt,
          when: formatDateTime(row.requestedAt),
          tone: 'blue' as const,
          title: `${TEXT.pubRequestedEvent(name)} ${TEXT.by(personName(row.requestedBy))}`,
          detail: row.scheduledAt ? `For ${formatDateTime(row.scheduledAt)}` : undefined,
        },
        ...(row.completedAt
          ? [
              {
                id: `pub-done-${row.id}`,
                at: row.completedAt,
                when: formatDateTime(row.completedAt),
                tone: PUBLICATION_STATUS[row.status].tone,
                title: TEXT.pubOutcome(name, PUBLICATION_STATUS[row.status].label),
                detail: row.error ?? undefined,
              },
            ]
          : []),
      ];
    }),
  ].sort((a, b) => b.at.localeCompare(a.at));

  const approvalBlock = (
    <div className="wk-stack">
      <ErrorBox error={approval.error} title={TEXT.approvalError} loading />
      {approval.loading && !approval.data && !approval.error && <Skeletons rows={3} />}
      {!approval.loading && !approval.error && !request && (
        <>
          <EmptyBlock title={TEXT.approvalNone}>{TEXT.approvalNoneBody}</EmptyBlock>
          {rule.rule && <RuleSummary rule={rule.rule} categoryName={category?.name} />}
          <ErrorBox error={rule.error} loading />
          {maySubmit ? (
            <div>
              <button type="button" className="btn btn-primary" onClick={() => setSubmitting(true)}>
                {TEXT.submit}
              </button>
            </div>
          ) : (
            <WhyBox
              reasons={mayNot.filter((reason) => /send|Send/.test(reason))}
              title="Why you cannot send it for review"
            />
          )}
        </>
      )}
      {request && (
        <>
          <ApprovalSummary request={request} />
          {can('content.review', data.companyId) ? (
            <DecidePanel
              request={request}
              versions={versions.data}
              superseded={request.contentVersionId !== data.currentVersionId}
              onChanged={reread}
            />
          ) : (
            <p className="wk-hint">{TEXT.mayNotDecide}</p>
          )}
          {request.contentVersionId === data.currentVersionId && (
            <CategoryChangePanel
              contentItemId={id}
              companyId={data.companyId}
              currentCategoryId={data.categoryId}
              request={request}
              categories={categories.data ?? []}
              versions={versions.data}
              onChanged={reread}
            />
          )}
          {request.status === 'expired' && maySubmit && (
            <div>
              <button type="button" className="btn btn-primary" onClick={() => setSubmitting(true)}>
                {TEXT.submitAgain}
              </button>
            </div>
          )}
          {request.status === 'rejected' && maySubmit && (
            <div>
              <button
                type="button"
                className="btn btn-outline"
                onClick={() => open('composer', null, { item: id })}
              >
                {TEXT.edit}
              </button>
            </div>
          )}
        </>
      )}
      <div>
        <h3 className="label">{TEXT.earlier}</h3>
        {can('content.review') ? (
          earlier.length === 0 ? (
            <p className="wk-hint">None. {TEXT.earlierHint}</p>
          ) : (
            <>
              <p className="wk-hint">{TEXT.earlierHint}</p>
              <DataGrid
                caption={TEXT.reqCaption}
                rows={earlier}
                rowKey={(row) => row.id}
                defaultSort={{ id: 'at', direction: 'desc' }}
                columns={[
                  {
                    id: 'version',
                    header: TEXT.reqVersion,
                    cell: (row) => `v${versionNumberOf(row.contentVersionId) ?? '?'}`,
                    sortValue: (row) => versionNumberOf(row.contentVersionId) ?? 0,
                  },
                  {
                    id: 'status',
                    header: TEXT.reqStatus,
                    cell: (row) => <StatusChip status={APPROVAL_REQUEST_STATUS[row.status]} />,
                    sortValue: (row) => row.status,
                  },
                  {
                    id: 'progress',
                    header: TEXT.reqProgress,
                    cell: (row) => (
                      <ApprovalProgress done={row.approvals} needed={row.requiredApprovals} />
                    ),
                    sortValue: (row) => row.approvals,
                  },
                  {
                    id: 'by',
                    header: TEXT.reqBy,
                    cell: (row) => personName(row.requestedBy),
                    sortValue: (row) => personName(row.requestedBy),
                  },
                  {
                    id: 'at',
                    header: TEXT.reqAt,
                    cell: (row) => formatDateTime(row.requestedAt),
                    sortValue: (row) => row.requestedAt,
                  },
                ]}
              />
            </>
          )
        ) : (
          <p className="wk-hint">{TEXT.earlierNeeds}</p>
        )}
      </div>
    </div>
  );

  return (
    <div className="wk-grid">
      <PageHeader
        eyebrow="Content library"
        crumbs={[
          { label: TEXT.library, onClick: () => open('content') },
          { label: excerpt(title, 48) },
        ]}
        title={title}
        description={TEXT.versionLine(
          current?.versionNumber,
          current?.targetAccountIds.length ?? 0,
        )}
        meta={
          <>
            <StatusChip status={CONTENT_STATUS[data.status]} />
            <span className="wk-chip">{companyName(data.companyId)}</span>
            {category && <span className="wk-chip">{category.name}</span>}
            {brand && <span className="wk-chip">{brand.name}</span>}
            <CopyId value={data.id} />
          </>
        }
        actions={
          <>
            <button
              type="button"
              className="btn btn-outline"
              disabled={!mayEdit}
              title={mayEdit ? TEXT.editNote(data.status) : needsRoleHint('content.create')}
              onClick={() => open('composer', null, { item: id })}
            >
              {TEXT.edit}
            </button>
            <button
              type="button"
              className="btn btn-outline"
              disabled={!maySubmit}
              title={maySubmit ? undefined : mayNot.find((reason) => /send|Send/.test(reason))}
              onClick={() => setSubmitting(true)}
            >
              {TEXT.submit}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!mayPublish || !readyToPublish}
              title={
                !mayPublish
                  ? needsRoleHint('content.publish')
                  : !readyToPublish
                    ? 'Only an approved post can be published.'
                    : undefined
              }
              onClick={() => setPublishing({ later: false })}
            >
              {TEXT.publish}
            </button>
          </>
        }
        tabs={
          <Tabs
            label={TEXT.tabsLabel}
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'overview', label: TEXT.tabs.overview },
              { id: 'versions', label: TEXT.tabs.versions, count: sortedVersions.length },
              {
                id: 'approval',
                label: TEXT.tabs.approval,
                count: request ? request.approvals : null,
              },
              { id: 'publications', label: TEXT.tabs.publications, count: publications.length },
              { id: 'activity', label: TEXT.tabs.activity },
            ]}
          />
        }
      />

      <div className="wk-facts">
        <Fact
          label={TEXT.facts.status}
          value={CONTENT_STATUS[data.status].label}
          note={`Changed ${relativeAge(data.updatedAt)}`}
        />
        <Fact
          label={TEXT.facts.version}
          value={current ? `v${current.versionNumber}` : '—'}
          note={current ? `by ${personName(current.createdBy)}` : undefined}
        />
        <Fact
          label={TEXT.facts.approvals}
          value={request ? `${request.approvals} / ${request.requiredApprovals}` : '—'}
          note={
            request
              ? `${APPROVAL_REQUEST_STATUS[request.status].label}${
                  request.status === 'approved' && request.validUntil
                    ? `, valid until ${formatDateTime(request.validUntil)}`
                    : ''
                }${request.emergency && !request.emergencyConfirmedAt ? ', emergency' : ''}`
              : TEXT.facts.notSent
          }
        />
        <Fact
          label={TEXT.facts.publications}
          value={publications.length}
          note={
            publications.length === 0
              ? TEXT.facts.none
              : `${publications.filter((row) => row.status === 'published').length} published, ${publications.filter((row) => row.status === 'scheduled').length} scheduled`
          }
        />
        <Fact
          label={TEXT.facts.accounts}
          value={current?.targetAccountIds.length ?? 0}
          note="In the current version"
        />
        <Fact
          label={TEXT.facts.files}
          value={current?.media.length ?? 0}
          note="In the current version"
        />
      </div>

      <ErrorBox error={versions.error} loading />
      <ErrorBox error={publicationsAll.error} loading />

      {tab === 'overview' && (
        <TabPanel id="overview">
          <div className="kit-split">
            <div className="wk-stack">
              <section className="wk-card">
                <div className="wk-card-head">
                  <h2>{TEXT.currentText}</h2>
                </div>
                {versions.loading && !current ? (
                  <Skeletons rows={3} />
                ) : (
                  <div className="wk-text-box">
                    <p className="wk-body-text">{current?.body ?? TEXT.noText}</p>
                  </div>
                )}
              </section>
              <section className="wk-card">
                <div className="wk-card-head">
                  <div>
                    <h2>{TEXT.previews}</h2>
                    <p>{TEXT.previewsHint}</p>
                  </div>
                </div>
                {current ? (
                  <PostPreviews
                    key={current.id}
                    accounts={accountList.filter((account) =>
                      current.targetAccountIds.includes(account.id),
                    )}
                    body={current.body}
                    media={current.media}
                  />
                ) : (
                  <Skeletons rows={3} />
                )}
              </section>
              <section className="wk-card">
                <div className="wk-card-head">
                  <h2>{TEXT.media}</h2>
                </div>
                <MediaGallery media={current?.media ?? []} />
              </section>
            </div>
            <div className="wk-stack">
              <section className="wk-card">
                <div className="wk-card-head">
                  <h2>{TEXT.facts2}</h2>
                </div>
                <DescriptionList
                  columns={1}
                  items={[
                    {
                      label: TEXT.company,
                      value: screenAllowed('companies') ? (
                        <button
                          type="button"
                          className="wk-link"
                          onClick={() => open('companies', data.companyId)}
                        >
                          {companyName(data.companyId)}
                        </button>
                      ) : (
                        companyName(data.companyId)
                      ),
                      hint:
                        company && company.status !== 'active'
                          ? `This company is ${company.status}.`
                          : undefined,
                    },
                    {
                      label: TEXT.brand,
                      value: data.brandId ? (brand?.name ?? shortId(data.brandId)) : TEXT.noBrand,
                    },
                    {
                      label: TEXT.category,
                      value: data.categoryId
                        ? (category?.name ?? shortId(data.categoryId))
                        : TEXT.noCategory,
                    },
                    { label: TEXT.author, value: personName(data.createdBy) },
                    { label: TEXT.created, value: formatDateTime(data.createdAt) },
                    { label: TEXT.updated, value: formatDateTime(data.updatedAt) },
                    { label: TEXT.ids, value: <CopyId value={data.id} /> },
                  ]}
                />
              </section>
              <section className="wk-card">
                <div className="wk-card-head">
                  <h2>{TEXT.targets}</h2>
                </div>
                {!current || current.targetAccountIds.length === 0 ? (
                  <p className="wk-hint">{TEXT.noTargets}</p>
                ) : (
                  <ul className="wk-targets">
                    {current.targetAccountIds.map((accountId) => {
                      const account = accountOf(accountId);
                      const readiness = account ? accountReadiness(account) : null;
                      return (
                        <li key={accountId}>
                          <span>
                            {account && screenAllowed('accounts') ? (
                              <button
                                type="button"
                                className="wk-link"
                                onClick={() => open('accounts', account.id)}
                              >
                                {PLATFORM_LABELS[account.platform]} · {account.displayName}
                              </button>
                            ) : (
                              <AccountChip account={account} id={accountId} />
                            )}
                          </span>
                          {readiness && (
                            <StatusChip label={readiness.label} tone={readiness.tone} />
                          )}
                        </li>
                      );
                    })}
                  </ul>
                )}
              </section>
              <section className="wk-card">
                <div className="wk-card-head">
                  <h2>{TEXT.can}</h2>
                </div>
                <ul className="wk-can">
                  <li>
                    <strong>{TEXT.canEdit}</strong>
                    <span>
                      {mayEdit
                        ? `${TEXT.yes}. ${TEXT.editNote(data.status)}`
                        : needsRoleHint('content.create')}
                    </span>
                  </li>
                  <li>
                    <strong>{TEXT.canSubmit}</strong>
                    <span>
                      {maySubmit
                        ? TEXT.yes
                        : (mayNot.find((reason) => /send|Send/.test(reason)) ?? '')}
                    </span>
                  </li>
                  <li>
                    <strong>{TEXT.canDecide}</strong>
                    <span>
                      {can('content.review', data.companyId)
                        ? 'See the Approval tab. It tells you if you wrote a version or your role is not in the rule.'
                        : needsRoleHint('content.review')}
                    </span>
                  </li>
                  <li>
                    <strong>{TEXT.canPublish}</strong>
                    <span>
                      {!mayPublish
                        ? needsRoleHint('content.publish')
                        : readyToPublish
                          ? 'See the Publications tab.'
                          : 'Only an approved post can be published.'}
                    </span>
                  </li>
                </ul>
              </section>
            </div>
          </div>
        </TabPanel>
      )}

      {tab === 'versions' && (
        <TabPanel id="versions">
          <p className="wk-toolbar-note">{TEXT.versionsNote}</p>
          {versions.loading && !versions.data ? (
            <Skeletons rows={5} />
          ) : (
            <VersionHistory
              versions={sortedVersions}
              accounts={accountList}
              currentVersionId={data.currentVersionId}
            />
          )}
        </TabPanel>
      )}

      {tab === 'approval' && <TabPanel id="approval">{approvalBlock}</TabPanel>}

      {tab === 'publications' && (
        <TabPanel id="publications">
          <div className="wk-stack">
            {activeFreezes.length > 0 && (
              <Callout tone="danger" title={TEXT.freezeNow}>
                <ul className="wk-changes">
                  {activeFreezes.map((freeze) => (
                    <li key={freeze.id}>
                      {freeze.socialAccountId === null
                        ? TEXT.freezeCompany
                        : TEXT.freezeAccount(
                            accountOf(freeze.socialAccountId)?.displayName ??
                              shortId(freeze.socialAccountId),
                          )}
                      . {freeze.reason ? TEXT.freezeReason(freeze.reason) : ''} (
                      {personName(freeze.frozenBy)}, {formatDateTime(freeze.frozenAt)})
                    </li>
                  ))}
                </ul>
              </Callout>
            )}
            {freezeList === null && mayPublish && <p className="wk-hint">{TEXT.freezesUnknown}</p>}
            <section className="wk-card">
              <div className="wk-card-head">
                <div>
                  <h2>{TEXT.publishTo}</h2>
                  <p>{TEXT.publishToHint}</p>
                </div>
                {mayPublish &&
                  publications.some(
                    (row) => row.status === 'pending' || row.status === 'scheduled',
                  ) && <ReconcileButton onDone={reread} />}
              </div>
              {!current || current.targetAccountIds.length === 0 ? (
                <p className="wk-hint">{TEXT.noTargets}</p>
              ) : (
                <ul className="wk-targets wk-targets-wide">
                  {current.targetAccountIds.map((accountId) => {
                    const account = accountOf(accountId);
                    if (!account)
                      return (
                        <li key={accountId}>
                          <AccountChip account={undefined} id={accountId} />
                        </li>
                      );
                    const state = accountPublishState({
                      item: data,
                      versionTargetIds: current.targetAccountIds,
                      account,
                      company,
                      publications,
                      freezes: freezeList,
                    });
                    const readiness = accountReadiness(account);
                    return (
                      <li key={accountId}>
                        <div>
                          <strong>
                            {PLATFORM_LABELS[account.platform]} · {account.displayName}
                          </strong>{' '}
                          {state.existing ? (
                            <StatusChip
                              label={TEXT.alreadyHas(
                                PUBLICATION_STATUS[state.existing.status].label,
                              )}
                              tone={PUBLICATION_STATUS[state.existing.status].tone}
                            />
                          ) : (
                            <StatusChip label={readiness.label} tone={readiness.tone} />
                          )}
                          {state.blockers.length > 0 && (
                            <small className="wk-sub">{state.blockers.join(' ')}</small>
                          )}
                        </div>
                        <span className="wk-row">
                          <button
                            type="button"
                            className="btn btn-primary"
                            disabled={!mayPublish || !state.ready}
                            title={
                              !mayPublish ? needsRoleHint('content.publish') : state.blockers[0]
                            }
                            onClick={() => setPublishing({ accountId, later: false })}
                          >
                            {TEXT.publishNow}
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline"
                            disabled={!mayPublish || !state.ready}
                            title={
                              !mayPublish ? needsRoleHint('content.publish') : state.blockers[0]
                            }
                            onClick={() => setPublishing({ accountId, later: true })}
                          >
                            {TEXT.schedule}
                          </button>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              {!mayPublish && (
                <WhyBox reasons={[TEXT.mayNotPublish, needsRoleHint('content.publish')]} />
              )}
            </section>
            <section className="wk-card">
              <div className="wk-card-head">
                <h2>{TEXT.allPublications}</h2>
              </div>
              <DataGrid
                caption={TEXT.pubCaption}
                rows={publications}
                rowKey={(row) => row.id}
                columns={publicationColumns}
                defaultSort={{ id: 'requested', direction: 'desc' }}
                exportName={`publications-${shortId(id)}`}
                onOpen={(row) => setLooking(row)}
                empty={<EmptyBlock title={TEXT.pubNone}>{TEXT.pubNoneBody}</EmptyBlock>}
              />
            </section>
          </div>
        </TabPanel>
      )}

      {tab === 'activity' && (
        <TabPanel id="activity">
          <div className="kit-split">
            <section className="wk-card">
              <div className="wk-card-head">
                <div>
                  <h2>{TEXT.tabs.activity}</h2>
                  <p>{TEXT.activityNote}</p>
                </div>
              </div>
              <Timeline items={activity} />
            </section>
            <section className="wk-card">
              <div className="wk-card-head">
                <div>
                  <h2>{TEXT.auditTitle}</h2>
                  <p>{TEXT.auditNote}</p>
                </div>
              </div>
              {!can('audit.read', data.companyId) ? (
                <WhyBox
                  reasons={[needsRoleHint('audit.read'), TEXT.auditNeeds]}
                  title="Why you cannot see it"
                />
              ) : audit.error ? (
                <ErrorBox error={audit.error} title={TEXT.auditError} loading />
              ) : audit.loading && !audit.data ? (
                <Skeletons rows={4} />
              ) : (audit.data ?? []).length === 0 ? (
                <p className="wk-hint">{TEXT.auditEmpty}</p>
              ) : (
                <ol className="wk-audit-list">
                  {(audit.data ?? []).map((event) => (
                    <li key={event.id} className="wk-audit">
                      <strong>{AUDIT_ACTIONS[event.action] ?? event.action}</strong>
                      <span>
                        {event.actor_user_id ? personName(event.actor_user_id) : TEXT.system} ·{' '}
                        {formatDateTime(event.occurred_at)}
                      </span>
                      <code>{event.action}</code>
                    </li>
                  ))}
                </ol>
              )}
            </section>
          </div>
        </TabPanel>
      )}

      {submitting && (
        <SubmitReviewDialog
          itemId={data.id}
          companyId={data.companyId}
          categoryId={data.categoryId}
          categoryName={category?.name}
          onClose={() => setSubmitting(false)}
          onDone={() => {
            setSubmitting(false);
            reread();
            setTab('approval');
          }}
        />
      )}
      {publishing && (
        <PublishDialog
          item={data}
          accounts={accountList}
          publications={publications}
          freezes={freezeList}
          initialAccountId={publishing.accountId}
          initialLater={publishing.later}
          onClose={() => setPublishing(null)}
          onDone={() => {
            setPublishing(null);
            reread();
            setTab('publications');
          }}
        />
      )}
      {cancelling && (
        <CancelPublicationDialog
          publication={cancelling}
          accountName={
            accountOf(cancelling.socialAccountId)
              ? `${PLATFORM_LABELS[accountOf(cancelling.socialAccountId)!.platform]} · ${accountOf(cancelling.socialAccountId)!.displayName}`
              : shortId(cancelling.socialAccountId)
          }
          onClose={() => setCancelling(null)}
          onDone={() => {
            setCancelling(null);
            reread();
          }}
        />
      )}
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
    </div>
  );
}
