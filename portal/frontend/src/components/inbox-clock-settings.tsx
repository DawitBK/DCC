'use client';

import { useState } from 'react';
import {
  DEFAULT_INBOX_TARGETS,
  MAX_RESPONSE_TARGET_MINUTES,
  SetInboxClockSettingsRequest,
  SetWorkingHoursRequest,
  type CompanyDto,
  type InboxClockSettingsDto,
  type WorkingHoursDto,
} from '@dcc/contracts';
import { apiSend } from '@/lib/browser-api';
import { fieldErrorsFromApi, validate, type FieldErrors } from '@/lib/forms';
import { formatDateTime } from '@/lib/format';
import { useAction, useApiData } from '@/lib/use-api';
import { ErrorBox } from './error-box';
import { FormField } from './form-field';
import { SectionPanel } from './section-panel';
import { useToast } from './toast';
import '../app/screens/inbox-clock.css';

const TEXT = {
  title: 'Response times and working hours',
  subtitle:
    'Each message has a time to be answered, counted in working hours. Urgent is 1 working hour, normal 4 working hours and low 24 working hours until a company changes them here. A message handed to someone else keeps its original clock.',
  targetsTitle: 'Response targets',
  urgent: 'Urgent (minutes)',
  normal: 'Normal (minutes)',
  low: 'Low (minutes)',
  targetHint: `A whole number of minutes from 1 to ${MAX_RESPONSE_TARGET_MINUTES.toLocaleString()}.`,
  invalid: `Enter a whole number of minutes from 1 to ${MAX_RESPONSE_TARGET_MINUTES.toLocaleString()}.`,
  roundClock: 'Count urgent messages round the clock, nights and Sundays included',
  roundClockHint:
    'Off: urgent counts 1 working hour like the others. On: the hour runs on the clock, day and night.',
  saveTargets: 'Save targets',
  hoursTitle: 'Working hours',
  days: 'Working days',
  start: 'Day starts',
  end: 'Day ends',
  offset: 'Hours ahead of UTC',
  offsetHint: 'Ethiopia is 3.',
  holidays: 'Public holidays',
  holidaysHint: 'One date per line, as year-month-day, for example 2026-12-25.',
  saveHours: 'Save working hours',
  saving: 'Saving…',
  defaultHours: 'No one has set these yet: the default is Monday to Saturday, 08:30 to 17:30.',
  hoursSetOn: (when: string) => `Last changed ${when}.`,
  savedTargets: (company: string) => `${company}: response targets saved.`,
  savedHours: (company: string) => `${company}: working hours saved.`,
  invalidHours: 'Check the working hours: the day must end after it starts.',
  loading: 'Loading working hours…',
  timeInvalid: 'Enter a time.',
  offsetInvalid: 'Enter a number of hours, for example 3 or 5.5.',
  dayInvalid: 'Choose at least one working day.',
};

/** Monday first, as the working week is read; the number is the day in the API (0 = Sunday). */
const DAYS: { value: number; label: string }[] = [
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
  { value: 0, label: 'Sunday' },
];

const pad = (n: number) => String(n).padStart(2, '0');
const toTime = (minute: number) => `${pad(Math.floor(minute / 60))}:${pad(minute % 60)}`;
const fromTime = (value: string): number | null => {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
};

/**
 * `PUT /api/inbox/settings` (the three targets and the urgent clock) and `GET/PUT /api/working-hours`, one panel per
 * company where the person holds `inbox.manage` (UI visibility only; the API decides and answers 403 otherwise).
 */
export function InboxClockSettings({
  companies,
  settings,
  onSaved,
}: {
  companies: CompanyDto[];
  settings: InboxClockSettingsDto[];
  onSaved: () => void;
}) {
  return (
    <SectionPanel title={TEXT.title} subtitle={TEXT.subtitle}>
      <div className="clock-companies">
        {companies.map((company) => (
          <div key={company.id} className="clock-company">
            <h3 className="clock-company-name">{company.name}</h3>
            <TargetsForm
              company={company}
              setting={settings.find((entry) => entry.companyId === company.id) ?? null}
              onSaved={onSaved}
            />
            <HoursForm company={company} onSaved={onSaved} />
          </div>
        ))}
      </div>
    </SectionPanel>
  );
}

type TargetsDraft = { urgent: string; normal: string; low: string; roundClock: boolean };

function TargetsForm({
  company,
  setting,
  onSaved,
}: {
  company: CompanyDto;
  setting: InboxClockSettingsDto | null;
  onSaved: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const saved: TargetsDraft = {
    urgent: String(setting?.urgentTargetMinutes ?? DEFAULT_INBOX_TARGETS.urgent),
    normal: String(setting?.normalTargetMinutes ?? DEFAULT_INBOX_TARGETS.normal),
    low: String(setting?.lowTargetMinutes ?? DEFAULT_INBOX_TARGETS.low),
    roundClock: setting?.urgentRoundTheClock ?? false,
  };
  // null = nothing typed yet: the boxes show what is saved.
  const [draft, setDraft] = useState<TargetsDraft | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const value = draft ?? saved;
  const change = (patch: Partial<TargetsDraft>) => {
    setDraft({ ...value, ...patch });
    setErrors({});
  };
  const minutes = (text: string) => (/^\d+$/.test(text.trim()) ? Number(text.trim()) : Number.NaN);

  const submit = async () => {
    const checked = validate(SetInboxClockSettingsRequest, {
      companyId: company.id,
      urgentTargetMinutes: minutes(value.urgent),
      normalTargetMinutes: minutes(value.normal),
      lowTargetMinutes: minutes(value.low),
      urgentRoundTheClock: value.roundClock,
    });
    if (!checked.ok) {
      const bad: FieldErrors = {};
      if (checked.errors.urgentTargetMinutes) bad.urgent = TEXT.invalid;
      if (checked.errors.normalTargetMinutes) bad.normal = TEXT.invalid;
      if (checked.errors.lowTargetMinutes) bad.low = TEXT.invalid;
      return setErrors(bad);
    }
    setErrors({});
    const failure = await action.run(() => apiSend('PUT', '/inbox/settings', checked.data));
    if (failure) return;
    showToast(TEXT.savedTargets(company.name));
    setDraft(null);
    onSaved();
  };

  return (
    <form
      className="clock-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h4 className="clock-form-title">{TEXT.targetsTitle}</h4>
      <ErrorBox error={action.error} />
      <div className="clock-fields">
        {(
          [
            ['urgent', TEXT.urgent],
            ['normal', TEXT.normal],
            ['low', TEXT.low],
          ] as const
        ).map(([key, label]) => (
          <FormField key={key} label={label} hint={TEXT.targetHint} error={errors[key]}>
            {(control) => (
              <input
                className="field"
                {...control}
                inputMode="numeric"
                autoComplete="off"
                value={value[key]}
                onChange={(event) => change({ [key]: event.target.value })}
              />
            )}
          </FormField>
        ))}
      </div>
      <label className="platform-option">
        <input
          type="checkbox"
          checked={value.roundClock}
          onChange={(event) => change({ roundClock: event.target.checked })}
        />
        {TEXT.roundClock}
      </label>
      <p className="hint">{TEXT.roundClockHint}</p>
      <button type="submit" className="btn btn-outline" disabled={action.busy}>
        {action.busy ? TEXT.saving : TEXT.saveTargets}
      </button>
    </form>
  );
}

type HoursDraft = {
  days: number[];
  start: string;
  end: string;
  offset: string;
  holidays: string;
};

const draftOf = (hours: WorkingHoursDto): HoursDraft => ({
  days: hours.workDays,
  start: toTime(hours.startMinute),
  end: toTime(hours.endMinute),
  offset: String(hours.utcOffsetMinutes / 60),
  holidays: hours.holidays.join('\n'),
});

function HoursForm({ company, onSaved }: { company: CompanyDto; onSaved: () => void }) {
  const showToast = useToast();
  const action = useAction();
  const hours = useApiData<WorkingHoursDto>(`/working-hours?companyId=${company.id}`);
  const [draft, setDraft] = useState<HoursDraft | null>(null);
  const [errors, setErrors] = useState<FieldErrors>({});
  if (hours.error) return <ErrorBox error={hours.error} loading />;
  if (!hours.data) return <p className="hint">{TEXT.loading}</p>;
  const value = draft ?? draftOf(hours.data);
  const change = (patch: Partial<HoursDraft>) => {
    setDraft({ ...value, ...patch });
    setErrors({});
  };

  const submit = async () => {
    const problems: FieldErrors = {};
    const start = fromTime(value.start);
    const end = fromTime(value.end);
    if (start === null) problems.start = TEXT.timeInvalid;
    if (end === null) problems.end = TEXT.timeInvalid;
    const offsetHours = Number(value.offset.trim());
    const offsetMinutes = Math.round(offsetHours * 60);
    if (
      value.offset.trim() === '' ||
      !Number.isFinite(offsetHours) ||
      offsetMinutes !== offsetHours * 60
    )
      problems.offset = TEXT.offsetInvalid;
    if (value.days.length === 0) problems.days = TEXT.dayInvalid;
    if (Object.keys(problems).length) return setErrors(problems);
    const checked = validate(SetWorkingHoursRequest, {
      companyId: company.id,
      workDays: value.days,
      startMinute: start,
      endMinute: end,
      utcOffsetMinutes: offsetMinutes,
      holidays: value.holidays
        .split(/[\s,;]+/)
        .map((entry) => entry.trim())
        .filter(Boolean),
    });
    if (!checked.ok)
      return setErrors({
        ...checked.errors,
        _form: checked.errors._form ?? checked.errors.endMinute ?? TEXT.invalidHours,
      });
    setErrors({});
    const failure = await action.run(() => apiSend('PUT', '/working-hours', checked.data));
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.savedHours(company.name));
    setDraft(null);
    hours.reload();
    onSaved();
  };

  return (
    <form
      className="clock-form"
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <h4 className="clock-form-title">{TEXT.hoursTitle}</h4>
      <p className="target-state">
        {hours.data.custom
          ? TEXT.hoursSetOn(formatDateTime(hours.data.updatedAt))
          : TEXT.defaultHours}
      </p>
      <ErrorBox error={action.error} />
      {errors._form && (
        <p className="field-error" role="alert">
          {errors._form}
        </p>
      )}
      <fieldset className="clock-days">
        <legend className="label">{TEXT.days}</legend>
        <div className="clock-day-list">
          {DAYS.map((entry) => (
            <label key={entry.value} className="platform-option">
              <input
                type="checkbox"
                checked={value.days.includes(entry.value)}
                onChange={(event) =>
                  change({
                    days: event.target.checked
                      ? [...value.days, entry.value]
                      : value.days.filter((d) => d !== entry.value),
                  })
                }
              />
              {entry.label}
            </label>
          ))}
        </div>
        {errors.days && (
          <p className="field-error" role="alert">
            {errors.days}
          </p>
        )}
      </fieldset>
      <div className="clock-fields">
        <FormField label={TEXT.start} error={errors.start}>
          {(control) => (
            <input
              className="field"
              type="time"
              {...control}
              value={value.start}
              onChange={(event) => change({ start: event.target.value })}
            />
          )}
        </FormField>
        <FormField label={TEXT.end} error={errors.end}>
          {(control) => (
            <input
              className="field"
              type="time"
              {...control}
              value={value.end}
              onChange={(event) => change({ end: event.target.value })}
            />
          )}
        </FormField>
        <FormField label={TEXT.offset} hint={TEXT.offsetHint} error={errors.offset}>
          {(control) => (
            <input
              className="field"
              {...control}
              inputMode="decimal"
              autoComplete="off"
              value={value.offset}
              onChange={(event) => change({ offset: event.target.value })}
            />
          )}
        </FormField>
      </div>
      <FormField label={TEXT.holidays} hint={TEXT.holidaysHint} error={errors.holidays}>
        {(control) => (
          <textarea
            className="textarea-field"
            style={{ minHeight: 80 }}
            {...control}
            value={value.holidays}
            onChange={(event) => change({ holidays: event.target.value })}
          />
        )}
      </FormField>
      <button type="submit" className="btn btn-outline" disabled={action.busy}>
        {action.busy ? TEXT.saving : TEXT.saveHours}
      </button>
    </form>
  );
}
