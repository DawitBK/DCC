'use client';

import { useState } from 'react';
import {
  SettleStuckKeyRequest,
  type ReconcileResultDto,
  type SettleStuckKeyResultDto,
} from '@dcc/contracts';
import { apiSend } from '@/lib/browser-api';
import { fieldErrorsFromApi, maxLengthOf, validate, type FieldErrors } from '@/lib/forms';
import { useAction } from '@/lib/use-api';
import { Dialog, DialogActions } from './dialog';
import { ErrorBox } from './error-box';
import { FormField } from './form-field';
import { useToast } from './toast';

export type UnresolvedKey = ReconcileResultDto['unresolvedKeys'][number];
export type SettleOutcome = 'published' | 'not_published';

export const SETTLE_TEXT = {
  published: 'This post was published',
  notPublished: 'This was not published',
  publishedLabel: (key: string) => `Record that the send ${key} was published`,
  notPublishedLabel: (key: string) => `Record that the send ${key} was not published`,
  settled: 'Settled',
  outcome: {
    published: 'Recorded as published.',
    scheduled: 'Recorded as scheduled: the engine holds the post until its time.',
    not_published: 'Released. The publish can be tried again.',
  } satisfies Record<SettleStuckKeyResultDto['outcome'], string>,
  toast: {
    published: 'The send was recorded as published.',
    scheduled: 'The send was recorded as scheduled.',
    not_published: 'The send was released. The publish can be tried again.',
  } satisfies Record<SettleStuckKeyResultDto['outcome'], string>,
  publishedBody:
    'Use this when you have seen the post on the network. DCC checks with the engine that the post you name is on the right account, was sent through DCC and is not already recorded as another publication. This sends nothing.',
  notPublishedBody:
    'This releases the send reference so the same approved post can be published again. Use it only when you have checked the network and the post is not there. If it was in fact sent, publishing again would post it twice: DCC asks the engine first and refuses while the engine still holds a matching post.',
  sendReference: 'Send reference',
  candidates: 'Which engine post is this publication?',
  candidatesHint:
    'The engine holds more than one post that looks like this one. Choose the one you have seen on the network.',
  engineId: 'Engine post id',
  engineIdHint: 'The id the engine shows for the post. DCC checks it with the engine.',
  chooseCandidate: 'Choose the post that was published.',
  engineIdRequired: 'Type the engine post id.',
  reasonRequired: 'Say why you are sure. This is kept in the audit trail.',
  reason: 'Reason',
  reasonHint: 'Why you are sure. It is kept in the audit trail.',
  confirmNotSent: 'I have checked the network and nothing was posted.',
  confirmNotSentRequired: 'Tick the box to confirm that nothing was posted.',
  confirmPublished: 'Record as published',
  confirmNotPublished: 'Release the send',
  close: 'Close without changing anything',
  working: 'Working…',
};

/**
 * Settle one stuck send by hand: `POST /api/publications/stuck-keys/:key/settle`. Both answers need a reason.
 * "Published" names the engine post (chosen from the engine's candidates when it gave some, else typed);
 * "not published" releases the key so the publish can be tried again, so it asks for a plain confirmation.
 * Success is shown only when the API said so. A refusal (for example a 409 because the engine still holds
 * a matching post) is shown in the API's own words and nothing is recorded. The API decides who may do this.
 */
export function SettleStuckKeyDialog({
  row,
  outcome,
  accountName,
  onClose,
  onDone,
}: {
  row: UnresolvedKey;
  outcome: SettleOutcome;
  accountName: string | null;
  onClose: () => void;
  onDone: (answer: SettleStuckKeyResultDto) => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const candidates = row.candidateEngineOperationIds ?? [];
  const published = outcome === 'published';
  const [engineOperationId, setEngineOperationId] = useState('');
  const [reason, setReason] = useState('');
  const [confirmed, setConfirmed] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const clearError = (field: string) =>
    setErrors((current) => {
      if (!current[field]) return current;
      const { [field]: _removed, ...rest } = current;
      return rest;
    });
  const reasonMax = maxLengthOf(SettleStuckKeyRequest.options[0].shape.reason);

  const submit = async () => {
    const checked = validate(
      SettleStuckKeyRequest,
      published ? { outcome, engineOperationId, reason } : { outcome, reason },
    );
    const problems: FieldErrors = checked.ok ? {} : { ...checked.errors };
    if (published && !engineOperationId.trim()) {
      problems.engineOperationId =
        candidates.length > 0 ? SETTLE_TEXT.chooseCandidate : SETTLE_TEXT.engineIdRequired;
    }
    if (!reason.trim()) problems.reason = SETTLE_TEXT.reasonRequired;
    if (!published && !confirmed) problems.confirmed = SETTLE_TEXT.confirmNotSentRequired;
    if (!checked.ok || Object.keys(problems).length > 0) return setErrors(problems);
    setErrors({});
    let answer: SettleStuckKeyResultDto | undefined;
    const failure = await action.run(async () => {
      answer = await apiSend<SettleStuckKeyResultDto>(
        'POST',
        `/publications/stuck-keys/${encodeURIComponent(row.key)}/settle`,
        checked.data,
      );
    });
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    if (!answer) return;
    showToast(SETTLE_TEXT.toast[answer.outcome]);
    onDone(answer);
  };

  return (
    <Dialog
      title={published ? SETTLE_TEXT.published : SETTLE_TEXT.notPublished}
      description={published ? SETTLE_TEXT.publishedBody : SETTLE_TEXT.notPublishedBody}
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        <p className="settle-key">
          {accountName ? <strong>{accountName}. </strong> : null}
          {SETTLE_TEXT.sendReference}: <code>{row.key}</code>
        </p>
        {published &&
          (candidates.length > 0 ? (
            <fieldset
              className="field-group"
              style={{ border: 0, padding: 0 }}
              aria-describedby="settle-candidates-hint"
            >
              <legend className="label">
                {SETTLE_TEXT.candidates}
                <span className="required-mark" aria-hidden="true">
                  {' '}
                  *
                </span>
              </legend>
              <div className="platform-list stack-list">
                {candidates.map((id) => (
                  <label key={id} className="platform-option">
                    <input
                      type="radio"
                      name="settle-candidate"
                      value={id}
                      checked={engineOperationId === id}
                      onChange={() => {
                        setEngineOperationId(id);
                        clearError('engineOperationId');
                      }}
                    />
                    <code>{id}</code>
                  </label>
                ))}
              </div>
              <small className="hint" id="settle-candidates-hint">
                {SETTLE_TEXT.candidatesHint}
              </small>
              {errors.engineOperationId && (
                <small className="field-error" role="alert">
                  {errors.engineOperationId}
                </small>
              )}
            </fieldset>
          ) : (
            <FormField
              label={SETTLE_TEXT.engineId}
              hint={SETTLE_TEXT.engineIdHint}
              error={errors.engineOperationId}
              required
            >
              {(control) => (
                <input
                  className="field"
                  {...control}
                  value={engineOperationId}
                  maxLength={200}
                  autoComplete="off"
                  onChange={(event) => {
                    setEngineOperationId(event.target.value);
                    clearError('engineOperationId');
                  }}
                />
              )}
            </FormField>
          ))}
        <FormField
          label={SETTLE_TEXT.reason}
          hint={SETTLE_TEXT.reasonHint}
          error={errors.reason}
          required
        >
          {(control) => (
            <textarea
              className="textarea-field"
              style={{ minHeight: 80 }}
              {...control}
              value={reason}
              maxLength={reasonMax}
              onChange={(event) => {
                setReason(event.target.value);
                clearError('reason');
              }}
            />
          )}
        </FormField>
        {!published && (
          <div className="field-group">
            <label className="platform-option">
              <input
                type="checkbox"
                checked={confirmed}
                aria-invalid={errors.confirmed ? true : undefined}
                aria-describedby={errors.confirmed ? 'settle-confirm-error' : undefined}
                onChange={(event) => {
                  setConfirmed(event.target.checked);
                  clearError('confirmed');
                }}
              />
              {SETTLE_TEXT.confirmNotSent}
            </label>
            {errors.confirmed && (
              <small className="field-error" id="settle-confirm-error" role="alert">
                {errors.confirmed}
              </small>
            )}
          </div>
        )}
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {SETTLE_TEXT.close}
          </button>
          <button
            type="submit"
            className={published ? 'btn btn-primary' : 'btn btn-danger'}
            disabled={action.busy}
          >
            {action.busy
              ? SETTLE_TEXT.working
              : published
                ? SETTLE_TEXT.confirmPublished
                : SETTLE_TEXT.confirmNotPublished}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
