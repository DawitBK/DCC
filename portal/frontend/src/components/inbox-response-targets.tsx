'use client';

import { useState } from 'react';
import {
  MAX_RESPONSE_TARGET_MINUTES,
  SetInboxSettingsRequest,
  type CompanyDto,
  type InboxSettingsDto,
} from '@dcc/contracts';
import { apiSend } from '@/lib/browser-api';
import { validate } from '@/lib/forms';
import { formatDateTime, formatDuration } from '@/lib/format';
import { useAction } from '@/lib/use-api';
import { ErrorBox } from './error-box';
import { FormField } from './form-field';
import { SectionPanel } from './section-panel';
import { useToast } from './toast';

const TEXT = {
  title: 'Response targets',
  subtitle:
    'How long a company has to answer a normal message, in working hours. Until a number is set here the default of 240 minutes (4 working hours) applies. Urgent and low messages are set in the inbox.',
  label: (company: string) => `Response target for ${company} (minutes)`,
  hint: `A whole number of minutes from 1 to ${MAX_RESPONSE_TARGET_MINUTES.toLocaleString()}. Leave it empty for the default (240 minutes).`,
  invalid: `Enter a whole number of minutes from 1 to ${MAX_RESPONSE_TARGET_MINUTES.toLocaleString()}, or leave it empty for the default.`,
  save: 'Save target',
  saving: 'Saving…',
  none: 'No target of its own is set: the default of 240 minutes applies.',
  current: (minutes: number, when: string | null) =>
    `Current target: ${minutes} min (${formatDuration(minutes * 60)})${when ? `, set ${when}` : ''}.`,
  savedTarget: (company: string, minutes: number) =>
    `${company}: messages are now due after ${minutes} minutes.`,
  savedNone: (company: string) => `${company}: back to the default of 240 minutes.`,
  unknown: 'The current target could not be read.',
};

/**
 * `GET /api/inbox/settings` (read by the screen) and `PUT /api/inbox/settings`, one form per company
 * where the person holds `approval_policy.manage` (UI visibility only; the API decides).
 * An empty box means "no target" and is sent as `null`.
 */
export function ResponseTargets({
  companies,
  settings,
  onSaved,
}: {
  companies: CompanyDto[];
  settings: InboxSettingsDto[];
  onSaved: () => void;
}) {
  return (
    <SectionPanel title={TEXT.title} subtitle={TEXT.subtitle}>
      <div className="target-list">
        {companies.map((company) => (
          <TargetForm
            key={company.id}
            company={company}
            setting={settings.find((entry) => entry.companyId === company.id) ?? null}
            onSaved={onSaved}
          />
        ))}
      </div>
    </SectionPanel>
  );
}

export function TargetForm({
  company,
  setting,
  onSaved,
}: {
  company: CompanyDto;
  setting: InboxSettingsDto | null;
  onSaved: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const saved = setting?.responseTargetMinutes ?? null;
  // null = the person has not typed anything: the box shows what is saved.
  const [draft, setDraft] = useState<string | null>(null);
  const [error, setError] = useState<string | undefined>();
  const value = draft ?? (saved === null ? '' : String(saved));

  const submit = async () => {
    const text = value.trim();
    const checked = validate(SetInboxSettingsRequest, {
      companyId: company.id,
      responseTargetMinutes: text === '' ? null : /^\d+$/.test(text) ? Number(text) : Number.NaN,
    });
    if (!checked.ok) return setError(TEXT.invalid);
    setError(undefined);
    const failure = await action.run(() => apiSend('PUT', '/inbox/settings', checked.data));
    if (failure) return;
    const minutes = checked.data.responseTargetMinutes;
    showToast(
      minutes === null ? TEXT.savedNone(company.name) : TEXT.savedTarget(company.name, minutes),
    );
    setDraft(null);
    onSaved();
  };

  return (
    <form
      className="target-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <ErrorBox error={action.error} />
      <FormField label={TEXT.label(company.name)} hint={TEXT.hint} error={error}>
        {(control) => (
          <input
            className="field"
            {...control}
            inputMode="numeric"
            autoComplete="off"
            value={value}
            onChange={(event) => {
              setDraft(event.target.value);
              setError(undefined);
            }}
          />
        )}
      </FormField>
      <p className="target-state">
        {setting === null
          ? TEXT.unknown
          : saved === null
            ? TEXT.none
            : TEXT.current(saved, setting.updatedAt ? formatDateTime(setting.updatedAt) : null)}
      </p>
      <button type="submit" className="btn btn-outline" disabled={action.busy}>
        {action.busy ? TEXT.saving : TEXT.save}
      </button>
    </form>
  );
}
