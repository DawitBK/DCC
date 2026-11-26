'use client';

import { useState } from 'react';
import {
  CorrectPublicationRequest,
  MAX_REMOVAL_REASON_LENGTH,
  MIN_REMOVAL_REASON_LENGTH,
  RemovePublicationRequest,
  ROLE_LABELS,
  type CorrectionResultDto,
  type IncidentDto,
  type PublicationDto,
  type PublicationRecordDto,
} from '@dcc/contracts';
import { Dialog, DialogActions } from '@/components/dialog';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { Callout } from '@/components/kit/parts';
import { useToast } from '@/components/toast';
import { apiSend } from '@/lib/browser-api';
import { fieldErrorsFromApi, type FieldErrors, validate } from '@/lib/forms';
import { formatDateTime } from '@/lib/format';
import { correctionsOf, isRemoved, recordOf } from '@/lib/removal';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const TEXT = {
  remove: 'Remove',
  correct: 'Correct',
  removeLabel: (account: string) => `Remove the published post on ${account}`,
  correctLabel: (account: string) => `Correct the published post on ${account}`,
  removeTitle: 'Remove this published post?',
  removeBody: (account: string) =>
    `DCC asks the publishing engine to delete the post on ${account}. The record, the text and the whole history stay in DCC, marked as removed, with your reason. The writer and the approvers are told. Look at the network afterwards to be sure the post is gone.`,
  correctTitle: 'Correct this published post',
  correctBody:
    'This makes a new draft with the same text, pictures, accounts and kind of content. You then change it and send it for approval like any other post. Nobody who wrote any version of it can approve it, and you become its writer.',
  reason: 'Why is this being done?',
  reasonHint: `A written reason of ${MIN_REMOVAL_REASON_LENGTH} to ${MAX_REMOVAL_REASON_LENGTH} characters. It is kept with the record and in the audit trail.`,
  count: (n: number) => `${n} of ${MAX_REMOVAL_REASON_LENGTH} characters`,
  incident: 'Part of an incident (optional)',
  incidentNone: 'Not linked to an incident',
  incidentHint: 'Only open incidents of this company. The incident managers are told.',
  removeOriginal: 'Also remove the original post now',
  removeOriginalHint:
    'The original is taken down first. If the engine does not confirm, nothing is changed and no draft is made.',
  removeOriginalWhy: (roles: string) =>
    `Only a published post can be removed here, and only by ${roles}.`,
  keep: 'Keep the post',
  cancel: 'Cancel',
  confirmRemove: 'Remove the post',
  confirmCorrect: 'Make the correction draft',
  working: 'Working…',
  removed: 'The post was removed. DCC keeps its record.',
  corrected: 'A correction draft was made. Change it and send it for approval.',
  correctedAndRemoved:
    'The original post was removed and a correction draft was made. Change it and send it for approval.',
  removedBy: (who: string, when: string) => `Removed by ${who} on ${when}.`,
  reasonLabel: 'Reason',
  incidentLink: 'Recorded against an incident.',
  corrections: (n: number) =>
    n === 1
      ? 'A correction of this post was drafted:'
      : `${n} corrections of this post were drafted:`,
  openDraft: (index: number) => `Open the draft ${index}`,
  noReason: 'No reason was recorded.',
};

/**
 * `POST /api/publications/:id/remove` and `POST /api/publications/:id/correct`. The buttons show only when the API said the caller may
 * (`canRemove`, `canCorrect` on the publication: the roles of the post's category, checked by the server again when pressed).
 * `onDone` reads the lists again.
 */
export function PublicationRemovalButtons({
  publication,
  accountName,
  onDone,
  variant = 'link',
}: {
  publication: PublicationDto;
  accountName: string;
  onDone: () => void;
  /** `link` in a table row, `button` in a page header. */
  variant?: 'link' | 'button';
}) {
  const record = recordOf(publication);
  const [dialog, setDialog] = useState<'remove' | 'correct' | null>(null);
  if (!record.canRemove && !record.canCorrect) return null;
  return (
    <>
      {record.canRemove && (
        <button
          type="button"
          className={variant === 'button' ? 'btn btn-danger' : 'wk-link'}
          aria-label={TEXT.removeLabel(accountName)}
          onClick={() => setDialog('remove')}
        >
          {TEXT.remove}
        </button>
      )}
      {record.canCorrect && (
        <button
          type="button"
          className={variant === 'button' ? 'btn btn-outline' : 'wk-link'}
          aria-label={TEXT.correctLabel(accountName)}
          onClick={() => setDialog('correct')}
        >
          {TEXT.correct}
        </button>
      )}
      {dialog === 'remove' && (
        <RemoveDialog
          publication={record}
          accountName={accountName}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            onDone();
          }}
        />
      )}
      {dialog === 'correct' && (
        <CorrectDialog
          publication={record}
          onClose={() => setDialog(null)}
          onDone={() => {
            setDialog(null);
            onDone();
          }}
        />
      )}
    </>
  );
}

/** The open incidents of the publication's company that the person may read, to tie a removal to one. */
function useOpenIncidents(companyId: string) {
  const { can } = useWorkspace();
  const incidents = useApiData<IncidentDto[]>(
    can('incident.read', companyId) ? '/incidents' : null,
  );
  return (incidents.data ?? []).filter(
    (incident) => incident.companyId === companyId && incident.status !== 'closed',
  );
}

function ReasonField({
  value,
  error,
  onChange,
}: {
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  return (
    <FormField
      label={TEXT.reason}
      hint={`${TEXT.reasonHint} ${TEXT.count(value.length)}.`}
      error={error}
      required
    >
      {(control) => (
        <textarea
          className="textarea-field"
          style={{ minHeight: 90 }}
          {...control}
          value={value}
          maxLength={MAX_REMOVAL_REASON_LENGTH}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </FormField>
  );
}

function IncidentField({
  companyId,
  value,
  error,
  onChange,
}: {
  companyId: string;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}) {
  const open = useOpenIncidents(companyId);
  if (open.length === 0) return null;
  return (
    <FormField label={TEXT.incident} hint={TEXT.incidentHint} error={error}>
      {(control) => (
        <select
          className="select-field"
          {...control}
          value={value}
          onChange={(event) => onChange(event.target.value)}
        >
          <option value="">{TEXT.incidentNone}</option>
          {open.map((incident) => (
            <option key={incident.id} value={incident.id}>
              {incident.title}
            </option>
          ))}
        </select>
      )}
    </FormField>
  );
}

function RemoveDialog({
  publication,
  accountName,
  onClose,
  onDone,
}: {
  publication: PublicationRecordDto;
  accountName: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const [reason, setReason] = useState('');
  const [incidentId, setIncidentId] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async () => {
    const checked = validate(RemovePublicationRequest, {
      reason,
      ...(incidentId ? { incidentId } : {}),
    });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() =>
      apiSend<PublicationRecordDto>('POST', `/publications/${publication.id}/remove`, checked.data),
    );
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.removed);
    onDone();
  };

  return (
    <Dialog title={TEXT.removeTitle} description={TEXT.removeBody(accountName)} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        <ReasonField
          value={reason}
          error={errors.reason}
          onChange={(value) => {
            setReason(value);
            setErrors({});
          }}
        />
        <IncidentField
          companyId={publication.companyId}
          value={incidentId}
          error={errors.incidentId}
          onChange={setIncidentId}
        />
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {TEXT.keep}
          </button>
          <button type="submit" className="btn btn-danger" disabled={action.busy}>
            {action.busy ? TEXT.working : TEXT.confirmRemove}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

function CorrectDialog({
  publication,
  onClose,
  onDone,
}: {
  publication: PublicationRecordDto;
  onClose: () => void;
  onDone: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const { open } = useWorkspace();
  const [reason, setReason] = useState('');
  const [removeOriginal, setRemoveOriginal] = useState(false);
  const [incidentId, setIncidentId] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const mayRemove = publication.canRemove;

  const submit = async () => {
    const checked = validate(CorrectPublicationRequest, {
      reason,
      removeOriginal,
      ...(removeOriginal && incidentId ? { incidentId } : {}),
    });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    let result: CorrectionResultDto | undefined;
    const failure = await action.run(async () => {
      result = await apiSend<CorrectionResultDto>(
        'POST',
        `/publications/${publication.id}/correct`,
        checked.data,
      );
    });
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(result?.originalRemoved ? TEXT.correctedAndRemoved : TEXT.corrected);
    onDone();
    // The draft is where the person goes next: to change the text and send it for approval.
    if (result) open('content', result.contentItem.id);
  };

  return (
    <Dialog title={TEXT.correctTitle} description={TEXT.correctBody} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        <ReasonField
          value={reason}
          error={errors.reason}
          onChange={(value) => {
            setReason(value);
            setErrors({});
          }}
        />
        <div className="field-group">
          <label className="platform-option">
            <input
              type="checkbox"
              checked={removeOriginal && mayRemove}
              disabled={!mayRemove}
              aria-describedby="correct-remove-hint"
              onChange={(event) => setRemoveOriginal(event.target.checked)}
            />
            {TEXT.removeOriginal}
          </label>
          <small className="hint" id="correct-remove-hint">
            {mayRemove
              ? TEXT.removeOriginalHint
              : TEXT.removeOriginalWhy(
                  publication.removeRoles.map((role) => ROLE_LABELS[role]).join(', ') ||
                    'the roles named for its kind of content',
                )}
          </small>
        </div>
        {removeOriginal && mayRemove && (
          <IncidentField
            companyId={publication.companyId}
            value={incidentId}
            error={errors.incidentId}
            onChange={setIncidentId}
          />
        )}
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {TEXT.cancel}
          </button>
          <button
            type="submit"
            className={removeOriginal && mayRemove ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={action.busy}
          >
            {action.busy ? TEXT.working : TEXT.confirmCorrect}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/**
 * What the record says about a removal and about the corrections made of it (shown on the publication page): who removed it, when, why,
 * and the drafts that correct it. Nothing is shown for a post that was never removed or corrected.
 */
export function RemovalNotice({ publication }: { publication: PublicationDto }) {
  const { open, personName } = useWorkspace();
  const record = recordOf(publication);
  const corrections = correctionsOf(publication);
  if (!isRemoved(publication) && corrections.length === 0) return null;
  return (
    <div className="wk-stack">
      {isRemoved(publication) && (
        <Callout
          tone="danger"
          title={TEXT.removedBy(personName(record.removedBy), formatDateTime(record.removedAt))}
        >
          <p>
            <strong>{TEXT.reasonLabel}:</strong> {record.removalReason ?? TEXT.noReason}
          </p>
          {record.removalIncidentId && (
            <p>
              <button
                type="button"
                className="wk-link"
                onClick={() => open('incidents', record.removalIncidentId)}
              >
                {TEXT.incidentLink}
              </button>
            </p>
          )}
        </Callout>
      )}
      {corrections.length > 0 && (
        <Callout tone="info" title={TEXT.corrections(corrections.length)}>
          <p>
            {corrections.map((id, index) => (
              <button
                key={id}
                type="button"
                className="wk-link"
                style={{ marginRight: 12 }}
                onClick={() => open('content', id)}
              >
                {TEXT.openDraft(index + 1)}
              </button>
            ))}
          </p>
        </Callout>
      )}
    </div>
  );
}
