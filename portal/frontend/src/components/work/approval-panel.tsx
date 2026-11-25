'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DecideApprovalRequest,
  ReviewContentRequest,
  ROLE_LABELS,
  type ApprovalRequestDto,
  type ContentVersionDto,
} from '@dcc/contracts';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { StatusChip } from '@/components/status-chip';
import { useToast } from '@/components/toast';
import { Callout, Timeline, type TimelineItem } from '@/components/kit/parts';
import { apiSend } from '@/lib/browser-api';
import { fieldErrorsFromApi, maxLengthOf, validate, type FieldErrors } from '@/lib/forms';
import { formatDateTime } from '@/lib/format';
import { APPROVAL_DECISION, APPROVAL_REQUEST_STATUS } from '@/lib/labels';
import { useAction } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { decisionGate } from '@/lib/work';
import { ApprovalProgress, WhyBox } from './parts';
import '@/app/screens/work-shared.css';

const TEXT = {
  ruleTitle: 'The rule this request was opened under',
  ruleCount: (needed: number) =>
    needed === 1
      ? 'One approval is needed.'
      : `${needed} approvals are needed, each from a different person.`,
  ruleRoles: (roles: string) => `Only these roles may decide: ${roles}.`,
  ruleAnyRole: 'Any role that may approve content may decide.',
  ruleDuty:
    'Nobody who wrote any version of the post can review, approve or reject it. A comment is not a decision.',
  ruleFixed:
    'The rule was fixed when the post was sent for review. Changing the rule later does not change this request.',
  status: 'State of the request',
  progress: 'Progress',
  history: 'Decisions and comments',
  noDecisions: 'Nobody has commented or decided yet.',
  requested: 'Sent for review',
  requestedBy: (name: string) => `by ${name}`,
  decide: 'Your decision',
  comment: 'Comment',
  commentHint:
    'A review comment needs words. When you approve or reject, a comment is optional but helps the author.',
  commentPlaceholder: 'Say what is good and what must change…',
  review: 'Add review comment',
  reject: 'Reject',
  approve: 'Approve',
  decided: (status: string) => `This request is ${status}. Nothing more can be decided on it.`,
  commentRecorded: 'Comment recorded.',
  approvedRecorded: 'Approval recorded.',
  rejectedRecorded: 'Rejection recorded.',
  confirmApprove: 'Approve this version?',
  confirmReject: 'Reject this version?',
  confirmApproveBody: (left: number) =>
    left <= 1
      ? 'Your approval completes the rule. The post becomes approved and can be published by someone who may publish.'
      : `This is one of ${left} approvals still needed. The post becomes approved when enough different people have approved.`,
  confirmRejectBody:
    'The post goes back to its author as rejected. They can edit it and send it for review again, which starts a new request.',
  yourComment: 'Your comment',
  noComment: '(no comment)',
  cancel: 'Cancel',
  working: 'Working…',
  superseded:
    'This request is for an older version. The post was edited afterwards and went back to draft, so a decision here only closes this old request: it does not change the post.',
  why: 'Why you cannot decide on this',
};

/** What the approval rule says, in words: how many people, which roles, and the separation of duties. */
export function ApprovalRuleBox({ request }: { request: ApprovalRequestDto }) {
  return (
    <div className="wk-rule">
      <strong>{TEXT.ruleTitle}</strong>
      <p>{TEXT.ruleCount(request.requiredApprovals)}</p>
      <p>
        {request.approverRoles.length > 0
          ? TEXT.ruleRoles(request.approverRoles.map((role) => ROLE_LABELS[role]).join(', '))
          : TEXT.ruleAnyRole}
      </p>
      <p>{TEXT.ruleDuty}</p>
      <p className="wk-muted">{TEXT.ruleFixed}</p>
    </div>
  );
}

/** The request and every comment and decision on it, newest first. Each carries a word, not only a colour. */
export function ApprovalTimeline({ request }: { request: ApprovalRequestDto }) {
  const { personName } = useWorkspace();
  const items: TimelineItem[] = [
    ...[...request.decisions]
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
      .map((decision) => ({
        id: decision.id,
        when: formatDateTime(decision.decidedAt),
        tone: (decision.decision === 'approved'
          ? 'green'
          : decision.decision === 'rejected'
            ? 'red'
            : 'blue') as TimelineItem['tone'],
        title: (
          <>
            {APPROVAL_DECISION[decision.decision].label} · {personName(decision.decidedBy)}
          </>
        ),
        detail: decision.comment ?? undefined,
      })),
    {
      id: `${request.id}-requested`,
      when: formatDateTime(request.requestedAt),
      tone: 'gray',
      title: (
        <>
          {TEXT.requested} {TEXT.requestedBy(personName(request.requestedBy))}
        </>
      ),
    },
  ];
  return <Timeline items={items} />;
}

/** The request as a whole: its state and progress, the rule and the history. No form. */
export function ApprovalSummary({ request }: { request: ApprovalRequestDto }) {
  return (
    <div className="wk-stack">
      <div className="wk-row">
        <StatusChip status={APPROVAL_REQUEST_STATUS[request.status]} />
        <ApprovalProgress done={request.approvals} needed={request.requiredApprovals} />
      </div>
      <ApprovalRuleBox request={request} />
      <div>
        <h3 className="label">{TEXT.history}</h3>
        {request.decisions.length === 0 && <p className="wk-hint">{TEXT.noDecisions}</p>}
        <ApprovalTimeline request={request} />
      </div>
    </div>
  );
}

/**
 * Comment, approve or reject: `POST /api/approval-requests/:id/review | approve | reject`. A control this
 * person cannot use stays visible and disabled, with the reason beside it (you wrote a version, your role is
 * not in the rule, you already approved, the request is closed). The API repeats every check.
 */
export function DecidePanel({
  request,
  versions,
  superseded,
  onChanged,
}: {
  request: ApprovalRequestDto;
  /** Every version of the post: the writers of any of them may not decide. null = not read yet. */
  versions: readonly ContentVersionDto[] | null;
  superseded: boolean;
  /** The API recorded something: read the lists again. */
  onChanged: () => void;
}) {
  const { me, can, refreshNotifications } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const [comment, setComment] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirm, setConfirm] = useState<'approve' | 'reject' | null>(null);
  const confirmButton = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (confirm) confirmButton.current?.focus();
  }, [confirm]);

  const authorIds = useMemo(
    () => (versions ? [...new Set(versions.map((version) => version.createdBy))] : null),
    [versions],
  );
  const gate = (kind: 'review' | 'decide') =>
    decisionGate({
      me,
      can,
      kind,
      request,
      authorIds,
      decisions: request.decisions,
    });
  const reviewGate = gate('review');
  const decideGate = gate('decide');
  const shownReasons = decideGate.ok ? reviewGate.reasons : decideGate.reasons;

  const run = async (kind: 'review' | 'approve' | 'reject') => {
    const checked =
      kind === 'review'
        ? validate(ReviewContentRequest, { comment })
        : validate(DecideApprovalRequest, { comment: comment.trim() || undefined });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() =>
      apiSend('POST', `/approval-requests/${request.id}/${kind}`, checked.data),
    );
    setConfirm(null);
    onChanged();
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    setComment('');
    showToast(
      kind === 'review'
        ? TEXT.commentRecorded
        : kind === 'approve'
          ? TEXT.approvedRecorded
          : TEXT.rejectedRecorded,
    );
    refreshNotifications();
  };

  if (request.status !== 'pending')
    return (
      <Callout tone={request.status === 'approved' ? 'ok' : 'danger'}>
        {TEXT.decided(APPROVAL_REQUEST_STATUS[request.status].label.toLowerCase())}
      </Callout>
    );

  return (
    <div className="wk-decide">
      <h3 className="label" style={{ margin: 0 }}>
        {TEXT.decide}
      </h3>
      {superseded && <Callout tone="warn">{TEXT.superseded}</Callout>}
      <ErrorBox error={action.error} />
      <FormField label={TEXT.comment} hint={TEXT.commentHint} error={errors.comment}>
        {(control) => (
          <textarea
            className="textarea-field"
            {...control}
            value={comment}
            maxLength={maxLengthOf(ReviewContentRequest.shape.comment)}
            placeholder={TEXT.commentPlaceholder}
            onChange={(event) => setComment(event.target.value)}
          />
        )}
      </FormField>
      <div className="wk-row">
        <button
          type="button"
          className="btn btn-outline"
          disabled={action.busy || !reviewGate.ok}
          onClick={() => void run('review')}
        >
          {TEXT.review}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={action.busy || !decideGate.ok}
          onClick={() => setConfirm('reject')}
        >
          {TEXT.reject}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy || !decideGate.ok}
          onClick={() => setConfirm('approve')}
        >
          {TEXT.approve}
        </button>
      </div>
      <WhyBox reasons={shownReasons} title={TEXT.why} />
      {confirm && (
        <div
          className="wk-confirm"
          role="group"
          aria-labelledby="wk-confirm-title"
          data-tone={confirm}
        >
          <strong id="wk-confirm-title">
            {confirm === 'approve' ? TEXT.confirmApprove : TEXT.confirmReject}
          </strong>
          <p>
            {confirm === 'approve'
              ? TEXT.confirmApproveBody(request.requiredApprovals - request.approvals)
              : TEXT.confirmRejectBody}
          </p>
          <p>
            <strong>{TEXT.yourComment}:</strong> {comment.trim() || TEXT.noComment}
          </p>
          <div className="wk-row">
            <button type="button" className="btn btn-outline" onClick={() => setConfirm(null)}>
              {TEXT.cancel}
            </button>
            <button
              type="button"
              ref={confirmButton}
              className={confirm === 'approve' ? 'btn btn-primary' : 'btn btn-danger'}
              disabled={action.busy}
              onClick={() => void run(confirm)}
            >
              {action.busy ? TEXT.working : confirm === 'approve' ? TEXT.approve : TEXT.reject}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
