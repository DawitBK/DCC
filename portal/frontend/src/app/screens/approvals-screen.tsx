'use client';

import { useState } from 'react';
import {
  APPROVAL_REQUEST_STATUSES,
  DecideApprovalRequest,
  ReviewContentRequest,
  ROLE_LABELS,
  type ApprovalQueueItemDto,
  type ApprovalRequestDto,
  type ApprovalRequestStatus,
  type ContentItemDto,
  type ContentVersionDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { EmptyState, LoadingState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { useToast } from '@/components/toast';
import { apiSend } from '@/lib/browser-api';
import { fieldErrorsFromApi, maxLengthOf, validate, type FieldErrors } from '@/lib/forms';
import { formatDateTime, initials, shortId } from '@/lib/format';
import {
  APPROVAL_DECISION,
  APPROVAL_REQUEST_STATUS,
  CONTENT_STATUS,
  PLATFORM_LABELS,
} from '@/lib/labels';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const TEXT = {
  title: 'Review & approvals',
  description: 'Read what was submitted, leave clear feedback, and record the decision.',
  duty: 'Separation of duties enforced by DCC',
  filter: 'Show requests that are',
  count: (count: number) => (count === 1 ? '1 request' : `${count} requests`),
  queue: 'Review queue',
  queueSubtitle: 'Oldest first. Choose a request to read it.',
  emptyTitle: 'Nothing in this view',
  emptyBody: 'New submissions appear here.',
  select: 'Select a request',
  selectSubtitle: 'The post, its versions and the decisions so far',
  noneTitle: 'No request selected',
  noneBody: 'Choose a request from the queue to review it.',
  request: (id: string) => `Request ${id}`,
  submittedBy: (name: string) => `submitted by ${name}`,
  progress: (done: number, needed: number) => `${done} of ${needed} approvals`,
  version: (number: number) => `Version ${number}`,
  versionUnknown: 'Submitted version',
  superseded:
    'This request is for an older version. The post was edited afterwards, so a decision here no longer changes the post.',
  submitted: 'Submitted',
  itemStatus: 'Post status',
  needed: 'Approvals',
  whoMayDecide: 'Who may decide',
  anyApprover: 'Any role that may approve',
  targets: 'For accounts',
  history: 'Decisions and comments',
  noHistory: 'No comments or decisions yet.',
  historyOlder: 'The decision history of an older request is not available.',
  versions: 'All versions',
  writtenBy: (name: string, when: string) => `written by ${name} · ${when}`,
  comment: 'Comment',
  commentHint: 'Needed for a review comment; optional when you approve or reject.',
  commentPlaceholder: 'Share specific, helpful feedback…',
  review: 'Add review comment',
  reject: 'Reject',
  approve: 'Approve',
  reviewed: 'Comment recorded.',
  approved: 'Approval recorded.',
  rejected: 'Rejection recorded.',
  decided: 'This request is already decided.',
};

/**
 * `GET /api/approval-requests?status=`, `GET /api/content-items/:id` (+ `/versions`, `/approval`),
 * `POST /api/approval-requests/:id/review|approve|reject`.
 */
export function ApprovalsScreen() {
  const { companyId, companyName, personName, can, refreshNotifications } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const [status, setStatus] = useState<ApprovalRequestStatus>('pending');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const queue = useApiData<ApprovalQueueItemDto[]>(`/approval-requests?status=${status}`);
  const visible = (queue.data ?? []).filter((row) => !companyId || row.companyId === companyId);
  const selected = visible.find((row) => row.id === activeId) ?? visible[0] ?? null;
  const itemPath = selected ? `/content-items/${selected.contentItemId}` : null;
  const item = useApiData<ContentItemDto>(itemPath);
  const versions = useApiData<ContentVersionDto[]>(itemPath && `${itemPath}/versions`);
  const approval = useApiData<ApprovalRequestDto | null>(itemPath && `${itemPath}/approval`);
  const accounts = useApiData<SocialAccountDto[]>('/social-accounts');

  const version = versions.data?.find((entry) => entry.id === selected?.contentVersionId);
  // /approval answers for the CURRENT version; it is this request only when the ids match.
  const request = approval.data && approval.data.id === selected?.id ? approval.data : null;
  const superseded = Boolean(
    selected && item.data && item.data.currentVersionId !== selected.contentVersionId,
  );
  const accountName = (id: string) => {
    const account = accounts.data?.find((entry) => entry.id === id);
    return account
      ? `${account.displayName} (${PLATFORM_LABELS[account.platform]})`
      : `Account ${shortId(id)}`;
  };

  const decide = async (kind: 'review' | 'approve' | 'reject') => {
    if (!selected) return;
    const checked =
      kind === 'review'
        ? validate(ReviewContentRequest, { comment })
        : validate(DecideApprovalRequest, { comment: comment.trim() || undefined });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() =>
      apiSend('POST', `/approval-requests/${selected.id}/${kind}`, checked.data),
    );
    queue.reload();
    item.reload();
    approval.reload();
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    setComment('');
    showToast(
      kind === 'review' ? TEXT.reviewed : kind === 'approve' ? TEXT.approved : TEXT.rejected,
    );
    refreshNotifications();
  };

  return (
    <>
      <PageTitle
        title={TEXT.title}
        description={TEXT.description}
        action={<span className="status status-amber">{TEXT.duty}</span>}
      />
      <div className="filter-row">
        <select
          className="select-field"
          aria-label={TEXT.filter}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as ApprovalRequestStatus);
            setActiveId(null);
            action.clear();
          }}
        >
          {APPROVAL_REQUEST_STATUSES.map((value) => (
            <option key={value} value={value}>
              {APPROVAL_REQUEST_STATUS[value].label}
            </option>
          ))}
        </select>
        <span className="status status-gray">{TEXT.count(visible.length)}</span>
      </div>
      <ErrorBox error={queue.error} loading />
      <div className="grid grid-2">
        <SectionPanel title={TEXT.queue} subtitle={TEXT.queueSubtitle}>
          {!queue.data && queue.loading && <LoadingState />}
          {queue.data && visible.length === 0 && (
            <EmptyState title={TEXT.emptyTitle}>{TEXT.emptyBody}</EmptyState>
          )}
          <div className="activity-list">
            {visible.map((row) => (
              <button
                key={row.id}
                className="activity-row queue-row"
                aria-pressed={selected?.id === row.id}
                onClick={() => {
                  setActiveId(row.id);
                  setComment('');
                  setErrors({});
                  action.clear();
                }}
              >
                <span className="activity-dot" aria-hidden="true" />
                <span className="activity-copy" style={{ flex: 1 }}>
                  <strong>{TEXT.request(shortId(row.id))}</strong>
                  <small>
                    {personName(row.requestedBy)} · {companyName(row.companyId)} ·{' '}
                    {formatDateTime(row.requestedAt)} ·{' '}
                    {TEXT.progress(row.approvals, row.requiredApprovals)}
                  </small>
                </span>
                <StatusChip status={APPROVAL_REQUEST_STATUS[row.status]} />
              </button>
            ))}
          </div>
        </SectionPanel>
        <SectionPanel
          title={selected ? TEXT.request(shortId(selected.id)) : TEXT.select}
          subtitle={
            selected ? TEXT.submittedBy(personName(selected.requestedBy)) : TEXT.selectSubtitle
          }
        >
          {!selected ? (
            <EmptyState title={TEXT.noneTitle}>{TEXT.noneBody}</EmptyState>
          ) : (
            <>
              <ErrorBox error={item.error ?? versions.error ?? approval.error} loading />
              {superseded && (
                <div className="demo-banner" role="note">
                  <span aria-hidden="true">ⓘ</span>
                  <div>{TEXT.superseded}</div>
                </div>
              )}
              <div className="preview-card" style={{ marginBottom: 14 }}>
                <div className="preview-head">
                  <div className="preview-avatar" aria-hidden="true">
                    {initials(personName(selected.requestedBy))}
                  </div>
                  <div>
                    <strong>{companyName(selected.companyId)}</strong>
                    <small>
                      {version ? TEXT.version(version.versionNumber) : TEXT.versionUnknown}
                    </small>
                  </div>
                </div>
                <div className="preview-body" style={{ whiteSpace: 'pre-wrap' }}>
                  {version ? version.body : versions.loading ? '…' : ''}
                </div>
              </div>
              <dl className="definition-grid">
                <div>
                  <dt>{TEXT.submitted}</dt>
                  <dd>{formatDateTime(selected.requestedAt)}</dd>
                </div>
                <div>
                  <dt>{TEXT.itemStatus}</dt>
                  <dd>{item.data ? CONTENT_STATUS[item.data.status].label : '…'}</dd>
                </div>
                <div>
                  <dt>{TEXT.needed}</dt>
                  <dd>{TEXT.progress(selected.approvals, selected.requiredApprovals)}</dd>
                </div>
                <div>
                  <dt>{TEXT.whoMayDecide}</dt>
                  <dd>
                    {request
                      ? request.approverRoles.length
                        ? request.approverRoles.map((role) => ROLE_LABELS[role]).join(', ')
                        : TEXT.anyApprover
                      : '—'}
                  </dd>
                </div>
                <div>
                  <dt>{TEXT.targets}</dt>
                  <dd>{version ? version.targetAccountIds.map(accountName).join(', ') : '…'}</dd>
                </div>
              </dl>
              <h3 className="label">{TEXT.history}</h3>
              {request ? (
                request.decisions.length ? (
                  <ul className="plain-list" style={{ marginBottom: 14 }}>
                    {request.decisions.map((decision) => (
                      <li key={decision.id}>
                        <strong>{APPROVAL_DECISION[decision.decision].label}</strong> ·{' '}
                        {personName(decision.decidedBy)} · {formatDateTime(decision.decidedAt)}
                        {decision.comment && <span className="subline">{decision.comment}</span>}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <small className="hint" style={{ marginBottom: 14 }}>
                    {TEXT.noHistory}
                  </small>
                )
              ) : (
                <small className="hint" style={{ marginBottom: 14 }}>
                  {approval.loading ? '…' : TEXT.historyOlder}
                </small>
              )}
              <details style={{ marginBottom: 14 }}>
                <summary className="label" style={{ cursor: 'pointer' }}>
                  {TEXT.versions} ({versions.data?.length ?? 0})
                </summary>
                <ul className="plain-list">
                  {(versions.data ?? []).map((entry) => (
                    <li key={entry.id}>
                      <strong>{TEXT.version(entry.versionNumber)}</strong> ·{' '}
                      {TEXT.writtenBy(personName(entry.createdBy), formatDateTime(entry.createdAt))}
                      <span className="subline" style={{ whiteSpace: 'pre-wrap' }}>
                        {entry.body}
                      </span>
                    </li>
                  ))}
                </ul>
              </details>
              <ErrorBox error={action.error} />
              {selected.status !== 'pending' ? (
                <small className="hint">{TEXT.decided}</small>
              ) : (
                <>
                  <FormField label={TEXT.comment} hint={TEXT.commentHint} error={errors.comment}>
                    {(control) => (
                      <textarea
                        className="textarea-field"
                        style={{ minHeight: 80 }}
                        {...control}
                        value={comment}
                        maxLength={maxLengthOf(ReviewContentRequest.shape.comment)}
                        placeholder={TEXT.commentPlaceholder}
                        onChange={(event) => setComment(event.target.value)}
                      />
                    )}
                  </FormField>
                  <div className="heading-actions" style={{ marginTop: 13 }}>
                    {can('content.review', selected.companyId) && (
                      <button
                        className="btn btn-outline"
                        disabled={action.busy}
                        onClick={() => void decide('review')}
                      >
                        {TEXT.review}
                      </button>
                    )}
                    {can('content.approve', selected.companyId) && (
                      <>
                        <button
                          className="btn btn-danger"
                          disabled={action.busy}
                          onClick={() => void decide('reject')}
                        >
                          {TEXT.reject}
                        </button>
                        <button
                          className="btn btn-primary"
                          disabled={action.busy}
                          onClick={() => void decide('approve')}
                        >
                          {TEXT.approve}
                        </button>
                      </>
                    )}
                  </div>
                </>
              )}
            </>
          )}
        </SectionPanel>
      </div>
    </>
  );
}
