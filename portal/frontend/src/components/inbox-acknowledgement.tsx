'use client';

import { useState } from 'react';
import {
  MAX_ACK_TEXT_LENGTH,
  SetAckSettingsRequest,
  type AckSettingsDto,
  type CompanyDto,
} from '@dcc/contracts';
import { apiSend, queryString } from '@/lib/browser-api';
import { fieldErrorsFromApi, validate, type FieldErrors } from '@/lib/forms';
import { formatDateTime } from '@/lib/format';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { ErrorBox } from './error-box';
import { FormField } from './form-field';
import { SectionPanel } from './section-panel';
import { StatusChip } from './status-chip';
import { useToast } from './toast';

const TEXT = {
  title: 'Automatic acknowledgement',
  subtitle:
    'A short reply sent by itself to a message that arrives outside working hours. It never counts as the first response, and it is sent only after a different approver has approved exactly this text.',
  english: 'Text in English',
  amharic: 'Text in Amharic (optional)',
  amharicHint:
    'Used only when the message contains Amharic letters. Otherwise the English text is sent.',
  enabled: 'Send the acknowledgement',
  save: 'Save text',
  saving: 'Saving…',
  saved: 'Text saved. It will not be sent until another approver approves it.',
  savedSame: 'Saved.',
  approve: 'Approve this text',
  approving: 'Approving…',
  approved: 'Approved. The acknowledgement is now active.',
  none: 'No text has been written for this company yet.',
  required: 'Write the text in English.',
  tooLong: `At most ${MAX_ACK_TEXT_LENGTH} characters.`,
  stateActive: 'Active',
  stateOff: 'Switched off',
  stateWaiting: 'Waiting for approval',
  stateNone: 'Not set',
  waitingBody: (who: string | null) =>
    `Nothing is sent yet. Another approver (not ${who ?? 'the person who wrote it'}) must approve this exact text.`,
  approvedBody: (who: string | null, when: string | null) =>
    `Approved by ${who ?? 'an approver'}${when ? ` on ${when}` : ''}. Editing either text removes the approval.`,
  writtenBy: (who: string | null, when: string | null) =>
    `Written by ${who ?? 'someone'}${when ? ` on ${when}` : ''}.`,
  editWarning:
    'Changing a text removes its approval and the acknowledgement stops until it is approved again.',
  readOnly: 'You can approve the text but not change it.',
};

/**
 * Round 2, E-13: the acknowledgement text of each company. `GET/PUT /api/inbox/acknowledgement` (written by a holder of
 * `inbox.manage`) and `POST /api/inbox/acknowledgement/approve` (a different holder of `content.approve`).
 */
export function AckSettings({ companies }: { companies: CompanyDto[] }) {
  if (companies.length === 0) return null;
  return (
    <SectionPanel title={TEXT.title} subtitle={TEXT.subtitle}>
      <div className="target-list">
        {companies.map((company) => (
          <AckForm key={company.id} company={company} />
        ))}
      </div>
    </SectionPanel>
  );
}

function AckForm({ company }: { company: CompanyDto }) {
  const { can } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const approveAction = useAction();
  const settings = useApiData<AckSettingsDto>(
    `/inbox/acknowledgement${queryString({ companyId: company.id })}`,
  );
  const [draft, setDraft] = useState<{ en: string; am: string; enabled: boolean } | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const mayEdit = can('inbox.manage', company.id);
  const data = settings.data;
  const value = draft ?? {
    en: data?.textEn ?? '',
    am: data?.textAm ?? '',
    enabled: data ? data.enabled || data.textEn === null : true,
  };

  const save = async () => {
    const checked = validate(SetAckSettingsRequest, {
      companyId: company.id,
      textEn: value.en,
      textAm: value.am.trim() === '' ? null : value.am,
      enabled: value.enabled,
    });
    if (!checked.ok)
      return setErrors({ textEn: value.en.trim() === '' ? TEXT.required : TEXT.tooLong });
    setErrors({});
    const failure = await action.run(() => apiSend('PUT', '/inbox/acknowledgement', checked.data));
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.saved);
    setDraft(null);
    settings.reload();
  };

  const approve = async () => {
    if (!data) return;
    const failure = await approveAction.run(() =>
      apiSend('POST', '/inbox/acknowledgement/approve', {
        companyId: company.id,
        version: data.version,
      }),
    );
    settings.reload();
    if (failure) return;
    showToast(TEXT.approved);
  };

  const state =
    !data || data.textEn === null
      ? { label: TEXT.stateNone, tone: 'gray' as const }
      : data.active
        ? { label: TEXT.stateActive, tone: 'green' as const }
        : data.approvedBy
          ? { label: TEXT.stateOff, tone: 'gray' as const }
          : { label: TEXT.stateWaiting, tone: 'amber' as const };

  return (
    <form
      className="target-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <h3 style={{ margin: 0, fontSize: 15 }}>
        {company.name} <StatusChip label={state.label} tone={state.tone} />
      </h3>
      <ErrorBox error={settings.error} loading />
      <ErrorBox error={action.error} />
      <ErrorBox error={approveAction.error} />
      {data && data.textEn === null && <p className="target-state">{TEXT.none}</p>}
      <FormField label={TEXT.english} error={errors.textEn} required>
        {(control) => (
          <textarea
            className="textarea-field"
            style={{ minHeight: 70 }}
            {...control}
            value={value.en}
            maxLength={MAX_ACK_TEXT_LENGTH}
            readOnly={!mayEdit}
            onChange={(event) => setDraft({ ...value, en: event.target.value })}
          />
        )}
      </FormField>
      <FormField label={TEXT.amharic} hint={TEXT.amharicHint} error={errors.textAm}>
        {(control) => (
          <textarea
            className="textarea-field"
            style={{ minHeight: 70 }}
            lang="am"
            {...control}
            value={value.am}
            maxLength={MAX_ACK_TEXT_LENGTH}
            readOnly={!mayEdit}
            onChange={(event) => setDraft({ ...value, am: event.target.value })}
          />
        )}
      </FormField>
      {mayEdit && (
        <label className="platform-option">
          <input
            type="checkbox"
            checked={value.enabled}
            onChange={(event) => setDraft({ ...value, enabled: event.target.checked })}
          />
          {TEXT.enabled}
        </label>
      )}
      {data && data.textEn !== null && (
        <p className="target-state">
          {TEXT.writtenBy(data.setByName, data.setAt ? formatDateTime(data.setAt) : null)}{' '}
          {data.approvedBy
            ? TEXT.approvedBody(
                data.approvedByName,
                data.approvedAt ? formatDateTime(data.approvedAt) : null,
              )
            : TEXT.waitingBody(data.setByName)}
        </p>
      )}
      {mayEdit ? (
        <small className="hint">{TEXT.editWarning}</small>
      ) : (
        <small className="hint">{TEXT.readOnly}</small>
      )}
      <div className="assign-actions">
        {mayEdit && (
          <button
            type="submit"
            className="btn btn-outline"
            disabled={action.busy || draft === null}
          >
            {action.busy ? TEXT.saving : TEXT.save}
          </button>
        )}
        {data?.canApprove && draft === null && (
          <button
            type="button"
            className="btn btn-primary"
            disabled={approveAction.busy}
            onClick={() => void approve()}
          >
            {approveAction.busy ? TEXT.approving : TEXT.approve}
          </button>
        )}
      </div>
    </form>
  );
}
