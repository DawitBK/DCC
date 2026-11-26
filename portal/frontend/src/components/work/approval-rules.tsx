'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  APPROVAL_VALIDITY_DAYS,
  CATEGORY_CHANGE_REASON_MIN,
  ChangeContentCategoryRequest,
  ConfirmEmergencyRequest,
  EMERGENCY_REASON_MIN,
  EmergencyApproveRequest,
  type ApprovalRequestFullDto,
  type ContentCategoryDto,
  type ContentVersionDto,
} from '@dcc/contracts';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { StatusChip } from '@/components/status-chip';
import { useToast } from '@/components/toast';
import { apiSend } from '@/lib/browser-api';
import { fieldErrorsFromApi, validate, type FieldErrors } from '@/lib/forms';
import { formatDateTime } from '@/lib/format';
import { ESCALATION_LEVEL_LABEL } from '@/lib/labels';
import { needsRoleHint } from '@/lib/permissions-ui';
import { useAction } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { WhyBox } from './parts';
import '@/app/screens/work-shared.css';

const TEXT = {
  clockTitle: 'Time limit and validity',
  limit: (hours: number, clock: 'working' | 'continuous') =>
    clock === 'continuous'
      ? `Time limit: ${hours} ${hours === 1 ? 'hour' : 'hours'}, counted round the clock (day and night).`
      : `Time limit: ${hours} ${hours === 1 ? 'hour' : 'hours'} of office time (Monday to Saturday, 08:30 to 17:30, public holidays excluded), counted from the moment the post was sent for review.`,
  noLimit: 'No time limit is set for this kind of content, so no reminders are sent.',
  due: (when: string) => `Decision due by ${when}.`,
  overdue: (when: string) => `The decision was due by ${when} and is overdue.`,
  ladderNote:
    'Reminders and escalation only tell people. Nothing is ever approved, rejected or published because time ran out.',
  approvedOn: (when: string) => `Approved ${when}.`,
  validUntil: (when: string) =>
    `Valid until ${when}. An approval lasts ${APPROVAL_VALIDITY_DAYS} days: publish or schedule the post for before then.`,
  expiredOn: (when: string) =>
    `This approval expired on ${when}. The post can no longer be published. Send it for review again to start the approval process from the beginning.`,
  emergencyTitle: 'Approved in an emergency',
  emergencyBy: (name: string, when: string, reason: string) =>
    `${name} approved this alone on ${when}. Reason given: “${reason}”`,
  emergencyOwed: (when: string) =>
    `A second approver must confirm it by ${when}. Until then the post is only provisionally approved.`,
  emergencyConfirmed: (name: string, when: string) => `Confirmed by ${name} on ${when}.`,
  emergencyLate: 'The confirmation is overdue. The management has been told.',

  emergencyOpen: 'Approve in an emergency',
  emergencyIntro:
    'Use this only when the post cannot wait for the normal approval. You approve it alone, you write down why, and a second approver must confirm it within 24 hours. Everything is recorded.',
  emergencyReason: 'Why is this an emergency?',
  emergencyHint: (n: number) => `At least ${n} characters. This is kept in the record.`,
  emergencyCount: (n: number, min: number) => `${n} of ${min} characters`,
  emergencyConfirmTitle: 'Approve this post in an emergency?',
  emergencyConfirmBody:
    'The post becomes approved straight away and can be published. A second approver is asked to confirm within 24 hours, and the management is told now.',
  emergencyDone: 'Emergency approval recorded. A second approver was asked to confirm.',
  confirmOpen: 'Confirm the emergency approval',
  confirmIntro:
    'Another approver gave this approval alone in an emergency. Read the text and the reason, then confirm that you agree. You cannot confirm your own emergency approval, and nobody who wrote the post can.',
  confirmComment: 'Comment (optional)',
  confirmButton: 'Confirm as second approver',
  confirmDone: 'Emergency approval confirmed.',
  mayNotEmergency: 'Why you cannot approve this in an emergency',
  mayNotConfirm: 'Why you cannot confirm this emergency approval',
  wroteVersion:
    'You wrote a version of this post. Nobody who wrote any version can approve it, not even in an emergency.',
  authorsUnknown: 'The versions of this post are still being read.',
  isEmergencyApprover:
    'You gave the emergency approval yourself. A different approver must confirm it.',
  cancel: 'Cancel',
  working: 'Working…',

  categoryTitle: 'Change the kind of content',
  categoryIntro:
    'If the post belongs to a stricter kind of content, change it while it is in review. Only a kind that needs at least as many approvals is accepted. The waiting request takes the new rule (approvals, roles, time limit); the decisions already given are kept.',
  categoryNew: 'New kind of content',
  categoryChoose: 'Choose a kind…',
  categoryReason: 'Why does it change?',
  categoryReasonHint: (n: number) => `At least ${n} characters. This is kept in the record.`,
  categorySave: 'Change the kind',
  categoryDone: 'The kind of content was changed and the request now follows the new rule.',
  categoryMay: 'Why you cannot change the kind of content',
};

/** Whether this person wrote any version of the post (the API refuses them anything on it). */
function useWroteVersion(versions: readonly ContentVersionDto[] | null) {
  const { me } = useWorkspace();
  const authorIds = useMemo(
    () => (versions ? [...new Set(versions.map((version) => version.createdBy))] : null),
    [versions],
  );
  return authorIds === null ? null : authorIds.includes(me.user.id);
}

/** The time limit, the escalation level, how long the approval is valid, and the emergency facts of a request. */
export function ApprovalClockBox({ request }: { request: ApprovalRequestFullDto }) {
  const { personName } = useWorkspace();
  const level = ESCALATION_LEVEL_LABEL[Math.min(4, request.escalationLevel)];
  return (
    <div className="wk-rule">
      <strong>{TEXT.clockTitle}</strong>
      <p>
        {request.timeLimitHours === null
          ? TEXT.noLimit
          : TEXT.limit(request.timeLimitHours, request.clock)}
      </p>
      {request.status === 'pending' && request.dueAt && (
        <p>
          {request.overdue
            ? TEXT.overdue(formatDateTime(request.dueAt))
            : TEXT.due(formatDateTime(request.dueAt))}{' '}
          {level && request.escalationLevel > 0 && <StatusChip status={level} />}
        </p>
      )}
      {request.timeLimitHours !== null && <p className="wk-muted">{TEXT.ladderNote}</p>}
      {request.approvedAt && (
        <p>
          {TEXT.approvedOn(formatDateTime(request.approvedAt))}{' '}
          {request.validUntil &&
            (request.expired
              ? TEXT.expiredOn(formatDateTime(request.validUntil))
              : TEXT.validUntil(formatDateTime(request.validUntil)))}
        </p>
      )}
      {!request.approvedAt && request.expired && <p>{TEXT.expiredOn('—')}</p>}
      {request.emergency && request.emergencyAt && (
        <>
          <p>
            <StatusChip label={TEXT.emergencyTitle} tone="red" />{' '}
            {TEXT.emergencyBy(
              personName(request.emergencyBy),
              formatDateTime(request.emergencyAt),
              request.emergencyReason ?? '',
            )}
          </p>
          <p>
            {request.emergencyConfirmedAt
              ? TEXT.emergencyConfirmed(
                  personName(request.emergencyConfirmedBy),
                  formatDateTime(request.emergencyConfirmedAt),
                )
              : TEXT.emergencyOwed(formatDateTime(request.emergencyConfirmDueAt))}
            {!request.emergencyConfirmedAt &&
              request.emergencyConfirmDueAt &&
              new Date(request.emergencyConfirmDueAt).getTime() < Date.now() && (
                <> {TEXT.emergencyLate}</>
              )}
          </p>
        </>
      )}
    </div>
  );
}

/**
 * `POST /api/approval-requests/:id/emergency-approve` (a pending request, for holders of the emergency permission) and
 * `POST /api/approval-requests/:id/confirm-emergency` (the second approver of an emergency approval). A control this
 * person cannot use stays visible and disabled with the reason beside it; the API repeats every check.
 */
export function EmergencyPanel({
  request,
  versions,
  onChanged,
}: {
  request: ApprovalRequestFullDto;
  versions: readonly ContentVersionDto[] | null;
  onChanged: () => void;
}) {
  const { me, can, refreshNotifications } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const wrote = useWroteVersion(versions);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const confirmRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  const owesConfirmation =
    request.status === 'approved' &&
    request.emergency &&
    !request.emergencyConfirmedAt &&
    !request.expired;
  const mode: 'approve' | 'confirm' | null =
    request.status === 'pending' && can('content.emergency_approve', request.companyId)
      ? 'approve'
      : owesConfirmation
        ? 'confirm'
        : null;
  if (mode === null) return null;

  const reasons: string[] = [];
  if (wrote === null) reasons.push(TEXT.authorsUnknown);
  else if (wrote) reasons.push(TEXT.wroteVersion);
  if (mode === 'confirm') {
    if (!can('content.approve', request.companyId)) reasons.push(needsRoleHint('content.approve'));
    if (request.emergencyBy === me.user.id) reasons.push(TEXT.isEmergencyApprover);
  }
  const allowed = reasons.length === 0;

  const run = async () => {
    const checked =
      mode === 'approve'
        ? validate(EmergencyApproveRequest, { reason: text })
        : validate(ConfirmEmergencyRequest, { comment: text.trim() || undefined });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() =>
      apiSend(
        'POST',
        `/approval-requests/${request.id}/${mode === 'approve' ? 'emergency-approve' : 'confirm-emergency'}`,
        checked.data,
      ),
    );
    onChanged();
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    setOpen(false);
    setText('');
    showToast(mode === 'approve' ? TEXT.emergencyDone : TEXT.confirmDone);
    refreshNotifications();
  };

  return (
    <div className="wk-decide">
      <h3 className="label" style={{ margin: 0 }}>
        {mode === 'approve' ? TEXT.emergencyOpen : TEXT.confirmOpen}
      </h3>
      <p className="wk-hint">{mode === 'approve' ? TEXT.emergencyIntro : TEXT.confirmIntro}</p>
      <ErrorBox error={action.error} />
      {!open ? (
        <div className="wk-row">
          <button
            type="button"
            className={mode === 'approve' ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={!allowed}
            onClick={() => setOpen(true)}
          >
            {mode === 'approve' ? TEXT.emergencyOpen : TEXT.confirmOpen}
          </button>
        </div>
      ) : (
        <div
          className="wk-confirm"
          role="group"
          aria-labelledby="wk-emergency-title"
          data-tone="reject"
        >
          <strong id="wk-emergency-title">
            {mode === 'approve' ? TEXT.emergencyConfirmTitle : TEXT.confirmButton}
          </strong>
          {mode === 'approve' && <p>{TEXT.emergencyConfirmBody}</p>}
          <FormField
            label={mode === 'approve' ? TEXT.emergencyReason : TEXT.confirmComment}
            hint={mode === 'approve' ? TEXT.emergencyHint(EMERGENCY_REASON_MIN) : undefined}
            error={errors.reason ?? errors.comment}
            required={mode === 'approve'}
          >
            {(control) => (
              <textarea
                className="textarea-field"
                {...control}
                value={text}
                maxLength={2000}
                onChange={(event) => setText(event.target.value)}
              />
            )}
          </FormField>
          {mode === 'approve' && (
            <small className="hint" aria-live="polite">
              {TEXT.emergencyCount(text.trim().length, EMERGENCY_REASON_MIN)}
            </small>
          )}
          <div className="wk-row">
            <button type="button" className="btn btn-outline" onClick={() => setOpen(false)}>
              {TEXT.cancel}
            </button>
            <button
              type="button"
              ref={confirmRef}
              className={mode === 'approve' ? 'btn btn-danger' : 'btn btn-primary'}
              disabled={
                action.busy || (mode === 'approve' && text.trim().length < EMERGENCY_REASON_MIN)
              }
              onClick={() => void run()}
            >
              {action.busy
                ? TEXT.working
                : mode === 'approve'
                  ? TEXT.emergencyOpen
                  : TEXT.confirmButton}
            </button>
          </div>
        </div>
      )}
      <WhyBox
        reasons={reasons}
        title={mode === 'approve' ? TEXT.mayNotEmergency : TEXT.mayNotConfirm}
      />
    </div>
  );
}

/**
 * `POST /api/content-items/:id/category`: a reviewer or manager moves the post to a stricter kind of content while it is
 * in review, with a written reason. Shown for a pending request of the current version only.
 */
export function CategoryChangePanel({
  contentItemId,
  companyId,
  currentCategoryId,
  request,
  categories,
  versions,
  onChanged,
}: {
  contentItemId: string;
  companyId: string;
  currentCategoryId: string | null;
  request: ApprovalRequestFullDto;
  categories: readonly ContentCategoryDto[];
  versions: readonly ContentVersionDto[] | null;
  onChanged: () => void;
}) {
  const { can, refreshNotifications } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const wrote = useWroteVersion(versions);
  const [categoryId, setCategoryId] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  if (request.status !== 'pending') return null;
  if (!can('content.review', companyId) && !can('content.approve', companyId)) return null;

  const reasons: string[] = [];
  if (wrote === null) reasons.push(TEXT.authorsUnknown);
  else if (wrote) reasons.push(TEXT.wroteVersion);
  const options = categories.filter(
    (category) => category.status === 'active' && category.id !== currentCategoryId,
  );

  const run = async () => {
    const checked = validate(ChangeContentCategoryRequest, { categoryId, reason });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() =>
      apiSend('POST', `/content-items/${contentItemId}/category`, checked.data),
    );
    onChanged();
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    setCategoryId('');
    setReason('');
    showToast(TEXT.categoryDone);
    refreshNotifications();
  };

  return (
    <div className="wk-decide">
      <h3 className="label" style={{ margin: 0 }}>
        {TEXT.categoryTitle}
      </h3>
      <p className="wk-hint">{TEXT.categoryIntro}</p>
      <ErrorBox error={action.error} />
      <FormField label={TEXT.categoryNew} error={errors.categoryId} required>
        {(control) => (
          <select
            className="select-field"
            {...control}
            value={categoryId}
            onChange={(event) => setCategoryId(event.target.value)}
          >
            <option value="">{TEXT.categoryChoose}</option>
            {options.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField
        label={TEXT.categoryReason}
        hint={TEXT.categoryReasonHint(CATEGORY_CHANGE_REASON_MIN)}
        error={errors.reason}
        required
      >
        {(control) => (
          <textarea
            className="textarea-field"
            {...control}
            value={reason}
            maxLength={2000}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </FormField>
      <div className="wk-row">
        <button
          type="button"
          className="btn btn-outline"
          disabled={action.busy || reasons.length > 0 || !categoryId}
          onClick={() => void run()}
        >
          {action.busy ? TEXT.working : TEXT.categorySave}
        </button>
      </div>
      <WhyBox reasons={reasons} title={TEXT.categoryMay} />
    </div>
  );
}
