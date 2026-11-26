'use client';

import { useState } from 'react';
import {
  RecordIncidentReviewRequest,
  SEVERITY_SEV,
  type IncidentReviewDto,
  type IncidentWithReviewDto,
} from '@dcc/contracts';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { GatedButton } from '@/components/gov-parts';
import { Callout, DescriptionList } from '@/components/kit/parts';
import { SectionPanel } from '@/components/section-panel';
import { useToast } from '@/components/toast';
import { apiSend } from '@/lib/browser-api';
import { fieldErrorsFromApi, validate, type FieldErrors } from '@/lib/forms';
import { formatDateTime } from '@/lib/format';
import { useAction } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const TEXT = {
  title: 'Post-incident review',
  subtitle:
    'What happened, what it cost, what was done and what will stop it happening again. A SEV1 or SEV2 incident cannot be closed until this is recorded.',
  notRequiredTitle: 'No review is needed for this incident',
  notRequiredBody:
    'Only SEV1 (critical) and SEV2 (high) incidents need a review. You can still record one if it helps.',
  requiredTitle: (sev: string) => `${sev}: a review is required before this incident can be closed`,
  waitingResolve:
    'The review is due within 5 business days of the moment the incident is first marked resolved. That clock has not started yet.',
  due: (when: string) => `The review is due by ${when}.`,
  overdueTitle: 'The review is overdue',
  overdueBody: (when: string) =>
    `It was due by ${when}. The incident stays open until the review is recorded.`,
  recordedTitle: 'The review is recorded',
  recordedBody: (who: string, when: string) => `Recorded by ${who}, last saved ${when}.`,
  record: 'Record the review',
  correct: 'Correct the review',
  cancel: 'Cancel',
  save: 'Save the review',
  saving: 'Saving…',
  saved: 'The review was saved.',
  closedNote:
    'The incident is closed, so its review can no longer be changed. Reopen the incident to correct it.',
  cause: 'Cause',
  causeHint: 'What caused it.',
  impact: 'Impact',
  impactHint: 'Who or what was affected, and for how long.',
  response: 'Response',
  responseHint: 'What was done, and how quickly.',
  corrective: 'Corrective actions',
  correctiveHint: 'What is being done to put it right.',
  preventive: 'Preventive measures',
  preventiveHint: 'What will stop it happening again.',
  participants: 'Who took part',
  participantsHint: 'One name per line. They need no DCC account.',
  heldAt: 'When the review was held',
  heldAtHint: 'Date and time of the review meeting.',
  rowHeldAt: 'Held',
  rowParticipants: 'Took part',
};

/** `datetime-local` wants local time without a zone; the API wants an exact moment. */
const toLocalInput = (iso: string | null): string => {
  const date = iso ? new Date(iso) : new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

function ReviewForm({
  incident,
  existing,
  onCancel,
  onSaved,
}: {
  incident: IncidentWithReviewDto;
  existing: IncidentReviewDto | null;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const [form, setForm] = useState({
    cause: existing?.cause ?? '',
    impact: existing?.impact ?? '',
    response: existing?.response ?? '',
    correctiveActions: existing?.correctiveActions ?? '',
    preventiveMeasures: existing?.preventiveMeasures ?? '',
    participants: (existing?.participants ?? []).join('\n'),
    heldAt: toLocalInput(existing?.heldAt ?? null),
  });
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async () => {
    const held = new Date(form.heldAt);
    const checked = validate(RecordIncidentReviewRequest, {
      ...form,
      participants: form.participants
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean),
      heldAt: Number.isNaN(held.getTime()) ? '' : held.toISOString(),
    });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() =>
      apiSend('PUT', `/incidents/${incident.id}/review`, checked.data),
    );
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.saved);
    onSaved();
  };

  const text = (
    key: 'cause' | 'impact' | 'response' | 'correctiveActions' | 'preventiveMeasures',
    label: string,
    hint: string,
  ) => (
    <FormField label={label} hint={hint} error={errors[key]} required>
      {(control) => (
        <textarea
          className="textarea-field"
          style={{ minHeight: 84 }}
          {...control}
          maxLength={5000}
          value={form[key]}
          onChange={(event) => setForm({ ...form, [key]: event.target.value })}
        />
      )}
    </FormField>
  );

  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <ErrorBox error={action.error} />
      {text('cause', TEXT.cause, TEXT.causeHint)}
      {text('impact', TEXT.impact, TEXT.impactHint)}
      {text('response', TEXT.response, TEXT.responseHint)}
      {text('correctiveActions', TEXT.corrective, TEXT.correctiveHint)}
      {text('preventiveMeasures', TEXT.preventive, TEXT.preventiveHint)}
      <FormField
        label={TEXT.participants}
        hint={TEXT.participantsHint}
        error={errors.participants}
        required
      >
        {(control) => (
          <textarea
            className="textarea-field"
            style={{ minHeight: 70 }}
            {...control}
            value={form.participants}
            onChange={(event) => setForm({ ...form, participants: event.target.value })}
          />
        )}
      </FormField>
      <FormField label={TEXT.heldAt} hint={TEXT.heldAtHint} error={errors.heldAt} required>
        {(control) => (
          <input
            className="field"
            type="datetime-local"
            {...control}
            value={form.heldAt}
            onChange={(event) => setForm({ ...form, heldAt: event.target.value })}
          />
        )}
      </FormField>
      <div className="gov-cluster">
        <button type="button" className="btn btn-outline" onClick={onCancel}>
          {TEXT.cancel}
        </button>
        <button type="submit" className="btn btn-primary" disabled={action.busy}>
          {action.busy ? TEXT.saving : TEXT.save}
        </button>
      </div>
    </form>
  );
}

/** `PUT /api/incidents/:id/review`: the post-incident review (D2-23), with its due and overdue state. */
export function IncidentReviewPanel({
  incident,
  onChanged,
}: {
  incident: IncidentWithReviewDto;
  onChanged: () => void;
}) {
  const { can, personName } = useWorkspace();
  const [editing, setEditing] = useState(false);
  const mayManage = can('incident.manage', incident.companyId);
  const closed = incident.status === 'closed';
  const review = incident.review;
  const sev = SEVERITY_SEV[incident.severity];

  return (
    <SectionPanel title={TEXT.title} subtitle={TEXT.subtitle}>
      {review ? (
        <Callout tone="ok" title={TEXT.recordedTitle}>
          {TEXT.recordedBody(
            review.recordedByName ?? personName(review.recordedBy),
            formatDateTime(review.updatedAt),
          )}
        </Callout>
      ) : !incident.reviewRequired ? (
        <Callout tone="info" title={TEXT.notRequiredTitle}>
          {TEXT.notRequiredBody}
        </Callout>
      ) : incident.reviewOverdue && incident.reviewDueAt ? (
        <Callout tone="danger" title={TEXT.overdueTitle}>
          {TEXT.overdueBody(formatDateTime(incident.reviewDueAt))}
        </Callout>
      ) : (
        <Callout tone="warn" title={TEXT.requiredTitle(sev)}>
          {incident.reviewDueAt
            ? TEXT.due(formatDateTime(incident.reviewDueAt))
            : TEXT.waitingResolve}
        </Callout>
      )}

      {review && !editing && (
        <>
          <DescriptionList
            columns={1}
            items={[
              { label: TEXT.cause, value: <p className="inc-desc">{review.cause}</p> },
              { label: TEXT.impact, value: <p className="inc-desc">{review.impact}</p> },
              { label: TEXT.response, value: <p className="inc-desc">{review.response}</p> },
              {
                label: TEXT.corrective,
                value: <p className="inc-desc">{review.correctiveActions}</p>,
              },
              {
                label: TEXT.preventive,
                value: <p className="inc-desc">{review.preventiveMeasures}</p>,
              },
              { label: TEXT.rowParticipants, value: review.participants.join(', ') },
              { label: TEXT.rowHeldAt, value: formatDateTime(review.heldAt) },
            ]}
          />
        </>
      )}

      {editing ? (
        <ReviewForm
          incident={incident}
          existing={review}
          onCancel={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            onChanged();
          }}
        />
      ) : closed ? (
        review ? (
          <p className="hint">{TEXT.closedNote}</p>
        ) : null
      ) : (
        <div className="gov-cluster" style={{ marginTop: 12 }}>
          <GatedButton
            allowed={mayManage}
            permission="incident.manage"
            className="btn btn-primary"
            onClick={() => setEditing(true)}
          >
            {review ? TEXT.correct : TEXT.record}
          </GatedButton>
        </div>
      )}
    </SectionPanel>
  );
}
