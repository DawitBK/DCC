'use client';

import { useState } from 'react';
import {
  RejectReplyRequest,
  type ReplyApprovalDto,
  type ReplyApprovalStatus,
} from '@dcc/contracts';
import { apiSend, queryString } from '@/lib/browser-api';
import { fieldErrorsFromApi, validate, type FieldErrors } from '@/lib/forms';
import { formatDateTime } from '@/lib/format';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { EmptyState, LoadingState } from './empty-state';
import { ErrorBox } from './error-box';
import { FormField } from './form-field';
import { SENSITIVE_KIND_LABELS } from './inbox-sensitive-reply';
import { SectionPanel } from './section-panel';
import { StatusChip } from './status-chip';
import { useToast } from './toast';

const STATUS: Record<
  ReplyApprovalStatus,
  { label: string; tone: 'amber' | 'green' | 'red' | 'gray' }
> = {
  pending: { label: 'Waiting for approval', tone: 'amber' },
  approved: { label: 'Approved, being sent', tone: 'amber' },
  sent: { label: 'Approved and sent', tone: 'green' },
  rejected: { label: 'Rejected', tone: 'red' },
  failed: { label: 'Approved, but not sent', tone: 'red' },
};

const TEXT = {
  title: 'Replies waiting for approval',
  subtitle:
    'Sensitive replies are not sent until enough different approvers agree. The person who wrote a reply cannot approve it.',
  empty: 'No replies are waiting',
  emptyBody: 'A reply marked sensitive in the inbox appears here until it is approved or rejected.',
  recent: 'Settled recently',
  you: 'you',
  by: (name: string) => `Written by ${name}`,
  asked: (when: string) => `Asked ${when}`,
  due: (when: string) => `Decide by ${when}`,
  needs: (have: number, need: number) => `${have} of ${need} approval${need === 1 ? '' : 's'}`,
  late: (level: number) => `Overdue, level ${level}`,
  messageFrom: (name: string) => `Replying to ${name}`,
  noMessage: 'The original message cannot be shown now.',
  proposed: 'The reply',
  rolesOnly: (roles: string) => `Only these roles may decide: ${roles}.`,
  approve: 'Approve and send',
  approving: 'Sending…',
  reject: 'Reject',
  rejecting: 'Rejecting…',
  reasonLabel: 'Why is it rejected? The writer is told.',
  reasonShort: 'Write a reason of at least 5 characters.',
  confirmReject: 'Reject the reply',
  cancel: 'Cancel',
  sent: 'Approved and sent.',
  counted: 'Your approval is recorded. More approvals are needed before it is sent.',
  rejected: 'The reply was rejected and the writer was told.',
  cannot: 'You wrote this reply, so you cannot decide it.',
};

/**
 * Round 2, E-08: sensitive replies and their decisions. `GET /api/inbox/reply-approvals`, `POST .../:id/approve`,
 * `POST .../:id/reject`. Approvers see the requests of their companies; a writer sees their own. What a person may do
 * comes from the API (`canDecide`), which re-checks everything.
 */
export function ReplyApprovals({
  companyId,
  accountName,
  onChanged,
}: {
  companyId: string | null;
  accountName: (accountId: string) => string;
  onChanged: () => void;
}) {
  const list = useApiData<ReplyApprovalDto[]>(
    `/inbox/reply-approvals${queryString({ companyId })}`,
  );
  const rows = list.data ?? [];
  const waiting = rows.filter((row) => row.status === 'pending');
  const settled = rows.filter((row) => row.status !== 'pending').slice(0, 5);
  // Nothing to show and nothing to decide: keep the inbox page quiet.
  if (list.data && rows.length === 0)
    return (
      <div style={{ marginBottom: 18 }}>
        <SectionPanel title={TEXT.title} subtitle={TEXT.subtitle}>
          <EmptyState title={TEXT.empty}>{TEXT.emptyBody}</EmptyState>
        </SectionPanel>
      </div>
    );
  return (
    <div style={{ marginBottom: 18 }}>
      <SectionPanel title={TEXT.title} subtitle={TEXT.subtitle}>
        <ErrorBox error={list.error} loading />
        {!list.data && list.loading && <LoadingState />}
        <div className="activity-list">
          {waiting.map((row) => (
            <ApprovalCard
              key={row.id}
              row={row}
              accountName={accountName}
              onChanged={() => {
                list.reload();
                onChanged();
              }}
            />
          ))}
        </div>
        {settled.length > 0 && (
          <>
            <h3 style={{ margin: '16px 0 8px', fontSize: 15 }}>{TEXT.recent}</h3>
            <div className="activity-list">
              {settled.map((row) => (
                <ApprovalCard
                  key={row.id}
                  row={row}
                  accountName={accountName}
                  onChanged={() => undefined}
                />
              ))}
            </div>
          </>
        )}
      </SectionPanel>
    </div>
  );
}

function ApprovalCard({
  row,
  accountName,
  onChanged,
}: {
  row: ReplyApprovalDto;
  accountName: (accountId: string) => string;
  onChanged: () => void;
}) {
  const { me, companyName } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const mine = row.writtenBy === me.user.id;

  const approve = async () => {
    let answer: ReplyApprovalDto | undefined;
    const failure = await action.run(async () => {
      answer = await apiSend<ReplyApprovalDto>(
        'POST',
        `/inbox/reply-approvals/${row.id}/approve`,
        {},
      );
    });
    onChanged(); // always re-read: a refusal may still have changed the request (for example it failed in the engine)
    if (failure || !answer) return;
    showToast(answer.status === 'sent' ? TEXT.sent : TEXT.counted);
  };

  const reject = async () => {
    const checked = validate(RejectReplyRequest, { reason });
    if (!checked.ok) return setErrors({ reason: TEXT.reasonShort });
    setErrors({});
    const failure = await action.run(() =>
      apiSend('POST', `/inbox/reply-approvals/${row.id}/reject`, checked.data),
    );
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    setRejecting(false);
    setReason('');
    showToast(TEXT.rejected);
    onChanged();
  };

  const status = STATUS[row.status];
  return (
    <article
      className="preview-card"
      style={{ marginBottom: 12 }}
      aria-label={`${SENSITIVE_KIND_LABELS[row.kind]}, ${status.label}`}
    >
      <div className="chip-stack" style={{ marginBottom: 8 }}>
        <StatusChip label={status.label} tone={status.tone} />
        <StatusChip label={SENSITIVE_KIND_LABELS[row.kind]} tone="gray" />
        {row.status === 'pending' && row.escalationLevel > 0 && (
          <StatusChip label={TEXT.late(row.escalationLevel)} tone="red" />
        )}
      </div>
      <small className="hint">
        {accountName(row.socialAccountId)} · {companyName(row.companyId)} ·{' '}
        {TEXT.by(mine ? TEXT.you : (row.writtenByName ?? 'a colleague'))} ·{' '}
        {TEXT.asked(formatDateTime(row.requestedAt))}
      </small>
      {row.messageText ? (
        <>
          <p style={{ margin: '10px 0 2px' }}>
            <strong>{TEXT.messageFrom(row.messageAuthor ?? 'the customer')}</strong>
          </p>
          <div className="preview-body" style={{ whiteSpace: 'pre-wrap' }}>
            {row.messageText}
          </div>
        </>
      ) : (
        row.status === 'pending' && <small className="hint">{TEXT.noMessage}</small>
      )}
      <p style={{ margin: '10px 0 2px' }}>
        <strong>{TEXT.proposed}</strong>
      </p>
      <div className="preview-body" style={{ whiteSpace: 'pre-wrap' }}>
        {row.text}
      </div>
      <p className="hint" style={{ marginTop: 8 }}>
        {TEXT.needs(row.approvals, row.requiredApprovals)}
        {row.status === 'pending' ? ` · ${TEXT.due(formatDateTime(row.dueAt))}` : ''}
        {row.settledAt ? ` · ${formatDateTime(row.settledAt)}` : ''}
      </p>
      {row.approverRoles.length > 0 && row.status === 'pending' && (
        <small className="hint">
          {TEXT.rolesOnly(row.approverRoles.join(', ').replaceAll('_', ' '))}
        </small>
      )}
      {row.settledReason && <p className="hint">{row.settledReason}</p>}
      {row.decisions.length > 0 && (
        <ul className="hint" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {row.decisions.map((d) => (
            <li key={`${d.decidedBy}-${d.decidedAt}`}>
              {d.decidedBy === me.user.id ? 'You' : (d.decidedByName ?? 'An approver')}{' '}
              {d.decision === 'approved' ? 'approved' : 'rejected'} on {formatDateTime(d.decidedAt)}
              {d.comment ? `: ${d.comment}` : ''}
            </li>
          ))}
        </ul>
      )}
      <ErrorBox error={action.error} />
      {row.status === 'pending' && mine && <small className="hint">{TEXT.cannot}</small>}
      {row.canDecide && !rejecting && (
        <div className="assign-actions" style={{ marginTop: 10 }}>
          <button
            type="button"
            className="btn btn-primary"
            disabled={action.busy}
            onClick={() => void approve()}
          >
            {action.busy ? TEXT.approving : TEXT.approve}
          </button>
          <button
            type="button"
            className="btn btn-outline"
            disabled={action.busy}
            onClick={() => {
              setRejecting(true);
              action.clear();
            }}
          >
            {TEXT.reject}
          </button>
        </div>
      )}
      {row.canDecide && rejecting && (
        <form
          noValidate
          style={{ marginTop: 10 }}
          onSubmit={(event) => {
            event.preventDefault();
            void reject();
          }}
        >
          <FormField label={TEXT.reasonLabel} error={errors.reason} required>
            {(control) => (
              <textarea
                className="textarea-field"
                style={{ minHeight: 70 }}
                {...control}
                value={reason}
                maxLength={1000}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </FormField>
          <div className="assign-actions">
            <button type="submit" className="btn btn-danger" disabled={action.busy}>
              {action.busy ? TEXT.rejecting : TEXT.confirmReject}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => setRejecting(false)}>
              {TEXT.cancel}
            </button>
          </div>
        </form>
      )}
    </article>
  );
}
