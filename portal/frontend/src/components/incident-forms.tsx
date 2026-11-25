'use client';

import { useState } from 'react';
import {
  CreateIncidentRequest,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  UpdateIncidentRequest,
  type IncidentDto,
  type IncidentStatus,
  type SocialAccountDto,
} from '@dcc/contracts';
import { apiSend } from '@/lib/browser-api';
import {
  blankToUndefined,
  fieldErrorsFromApi,
  maxLengthOf,
  validate,
  type FieldErrors,
} from '@/lib/forms';
import { INCIDENT_SEVERITY, INCIDENT_STATUS, PLATFORM_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { Dialog, DialogActions } from './dialog';
import { ErrorBox } from './error-box';
import { FormField } from './form-field';
import { categoryOptionLabel, useCategoryOptions } from './incident-detail';
import { useToast } from './toast';

const TEXT = {
  newTitle: 'Report an incident',
  newBody:
    'Register what happened so the right people are told and the playbook is at hand. You can change every detail later.',
  editTitle: 'Edit the incident',
  company: 'Company',
  titleField: 'Title',
  titleHint: 'A short line that says what happened.',
  descriptionField: 'What happened',
  descriptionHint: (used: number, max: number | undefined) =>
    max ? `${used} of ${max} characters. Plain text.` : '',
  severity: 'Severity',
  severityDefault: 'Not set (DCC records Medium)',
  severityHint: 'Low, Medium, High or Critical. You can raise or lower it later.',
  status: 'Status',
  account: 'Social account',
  noAccount: 'No particular account',
  accountHint: 'Optional. Only accounts of the chosen company are offered.',
  categoryField: 'Category',
  categoryHint: 'Optional. It decides which playbook is shown with the incident.',
  noCategory: 'No category',
  loadingCategories: 'Loading categories…',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Saving…',
  report: 'Report the incident',
  saved: 'Saved. The incident was read again from DCC.',
  reported: 'The incident was registered. People who can read incidents were told.',
  noCompany: 'You do not manage incidents for any company in view.',
  statusTitle: (name: string) => `Change the status to “${name}”`,
  confirm: 'Change the status',
  changing: 'Changing…',
  statusSaved: (name: string) => `The incident is now “${name}”.`,
  now: (name: string) => `Now: ${name}.`,
};

/** What moving to each status does, in words, so the person knows before they confirm. */
export const STATUS_CONSEQUENCE: Record<IncidentStatus, string> = {
  open: 'Counts the incident as open again, on the dashboard and in the security center. If it had a resolved time, that time is cleared.',
  investigating:
    'Tells everyone that someone is working on it. It still counts as open on the dashboard and in the security center.',
  resolved:
    'Records the time it was resolved. It no longer counts as open. The check for posts DCC did not send leaves resolved incidents alone, so a repeat of the same evidence will not reopen it.',
  closed:
    'Records the time it was closed and ends the work. It no longer counts as open. Use this when nothing more will be done. You can still reopen it.',
};

/** `POST /api/incidents` (incident.manage). Every field of `CreateIncidentRequest`. */
export function CreateIncidentDialog({
  accounts,
  initialCompanyId,
  onClose,
  onSaved,
}: {
  accounts: SocialAccountDto[];
  initialCompanyId?: string | null;
  onClose: () => void;
  onSaved: (created: IncidentDto) => void;
}) {
  const { companiesWhere } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const companies = companiesWhere('incident.manage');
  const [form, setForm] = useState({
    companyId: companies.find((item) => item.id === initialCompanyId)?.id ?? companies[0]?.id ?? '',
    socialAccountId: '',
    title: '',
    description: '',
    severity: '',
    categoryId: '',
  });
  const categories = useCategoryOptions(form.companyId || null);
  const [errors, setErrors] = useState<FieldErrors>({});
  const shape = CreateIncidentRequest.shape;
  const descriptionMax = maxLengthOf(shape.description.unwrap());

  const submit = async () => {
    const checked = validate(CreateIncidentRequest, blankToUndefined(form));
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    let created: IncidentDto | undefined;
    const failure = await action.run(async () => {
      created = await apiSend<IncidentDto>('POST', '/incidents', checked.data);
    });
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.reported);
    if (created) onSaved(created);
  };

  return (
    <Dialog title={TEXT.newTitle} description={TEXT.newBody} onClose={onClose} wide>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        {companies.length === 0 && <p className="field-error">{TEXT.noCompany}</p>}
        <FormField label={TEXT.company} error={errors.companyId} required>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={form.companyId}
              onChange={(event) =>
                setForm({
                  ...form,
                  companyId: event.target.value,
                  socialAccountId: '',
                  categoryId: '',
                })
              }
            >
              {companies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label={TEXT.titleField} hint={TEXT.titleHint} error={errors.title} required>
          {(control) => (
            <input
              className="field"
              {...control}
              value={form.title}
              maxLength={maxLengthOf(shape.title)}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          )}
        </FormField>
        <FormField
          label={TEXT.descriptionField}
          hint={TEXT.descriptionHint(form.description.length, descriptionMax)}
          error={errors.description}
        >
          {(control) => (
            <textarea
              className="textarea-field"
              style={{ minHeight: 110 }}
              {...control}
              maxLength={descriptionMax}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          )}
        </FormField>
        <div className="grid grid-2">
          <FormField label={TEXT.severity} hint={TEXT.severityHint} error={errors.severity}>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={form.severity}
                onChange={(event) => setForm({ ...form, severity: event.target.value })}
              >
                <option value="">{TEXT.severityDefault}</option>
                {INCIDENT_SEVERITIES.map((value) => (
                  <option key={value} value={value}>
                    {INCIDENT_SEVERITY[value].label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={TEXT.account} hint={TEXT.accountHint} error={errors.socialAccountId}>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={form.socialAccountId}
                onChange={(event) => setForm({ ...form, socialAccountId: event.target.value })}
              >
                <option value="">{TEXT.noAccount}</option>
                {accounts
                  .filter((account) => account.companyId === form.companyId)
                  .map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.displayName} ({PLATFORM_LABELS[account.platform]})
                    </option>
                  ))}
              </select>
            )}
          </FormField>
        </div>
        <FormField label={TEXT.categoryField} hint={TEXT.categoryHint} error={errors.categoryId}>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={form.categoryId}
              disabled={categories.loading && !categories.data}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
            >
              <option value="">
                {categories.loading && !categories.data ? TEXT.loadingCategories : TEXT.noCategory}
              </option>
              {categories.options.map((category) => (
                <option key={category.id} value={category.id}>
                  {categoryOptionLabel(category)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {TEXT.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            {action.busy ? TEXT.saving : TEXT.report}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** `PATCH /api/incidents/:id` (incident.manage). Every field of `UpdateIncidentRequest`. */
export function EditIncidentDialog({
  incident,
  onClose,
  onSaved,
}: {
  incident: IncidentDto;
  onClose: () => void;
  onSaved: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const [form, setForm] = useState({
    title: incident.title,
    description: incident.description ?? '',
    severity: incident.severity as string,
    status: incident.status as string,
    categoryId: incident.categoryId ?? '',
  });
  const categories = useCategoryOptions(incident.companyId, incident.categoryId);
  const [errors, setErrors] = useState<FieldErrors>({});
  const descriptionMax = maxLengthOf(CreateIncidentRequest.shape.description.unwrap());

  const submit = async () => {
    const { categoryId, ...rest } = form;
    // Send the category only when it changed ('' = remove it): an archived one stays on an incident that has it.
    const categoryChange =
      categoryId === (incident.categoryId ?? '') ? {} : { categoryId: categoryId || null };
    const checked = validate(UpdateIncidentRequest, {
      ...blankToUndefined(rest),
      ...categoryChange,
    });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() =>
      apiSend('PATCH', `/incidents/${incident.id}`, checked.data),
    );
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.saved);
    onSaved();
  };

  return (
    <Dialog title={TEXT.editTitle} onClose={onClose} wide>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        <FormField label={TEXT.titleField} error={errors.title} required>
          {(control) => (
            <input
              className="field"
              {...control}
              value={form.title}
              maxLength={maxLengthOf(CreateIncidentRequest.shape.title)}
              onChange={(event) => setForm({ ...form, title: event.target.value })}
            />
          )}
        </FormField>
        <FormField
          label={TEXT.descriptionField}
          hint={TEXT.descriptionHint(form.description.length, descriptionMax)}
          error={errors.description}
        >
          {(control) => (
            <textarea
              className="textarea-field"
              style={{ minHeight: 120 }}
              {...control}
              maxLength={descriptionMax}
              value={form.description}
              onChange={(event) => setForm({ ...form, description: event.target.value })}
            />
          )}
        </FormField>
        <div className="grid grid-2">
          <FormField label={TEXT.severity} error={errors.severity}>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={form.severity}
                onChange={(event) => setForm({ ...form, severity: event.target.value })}
              >
                {INCIDENT_SEVERITIES.map((value) => (
                  <option key={value} value={value}>
                    {INCIDENT_SEVERITY[value].label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={TEXT.status} error={errors.status}>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={form.status}
                onChange={(event) => setForm({ ...form, status: event.target.value })}
              >
                {INCIDENT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {INCIDENT_STATUS[value].label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        </div>
        <FormField label={TEXT.categoryField} hint={TEXT.categoryHint} error={errors.categoryId}>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={form.categoryId}
              disabled={categories.loading && !categories.data}
              onChange={(event) => setForm({ ...form, categoryId: event.target.value })}
            >
              <option value="">
                {categories.loading && !categories.data ? TEXT.loadingCategories : TEXT.noCategory}
              </option>
              {categories.options.map((category) => (
                <option key={category.id} value={category.id}>
                  {categoryOptionLabel(category)}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {TEXT.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            {action.busy ? TEXT.saving : TEXT.save}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** Confirms a change of status, saying first what it does. */
export function StatusDialog({
  incident,
  to,
  onClose,
  onSaved,
}: {
  incident: IncidentDto;
  to: IncidentStatus;
  onClose: () => void;
  onSaved: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const target = INCIDENT_STATUS[to].label;
  const submit = async () => {
    const failure = await action.run(() =>
      apiSend('PATCH', `/incidents/${incident.id}`, { status: to }),
    );
    if (failure) return;
    showToast(TEXT.statusSaved(target));
    onSaved();
  };
  return (
    <Dialog
      title={TEXT.statusTitle(target)}
      description={TEXT.now(INCIDENT_STATUS[incident.status].label)}
      onClose={onClose}
    >
      <ErrorBox error={action.error} />
      <p className="inc-consequence">{STATUS_CONSEQUENCE[to]}</p>
      <DialogActions>
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {TEXT.cancel}
        </button>
        <button
          type="button"
          className="btn btn-primary"
          disabled={action.busy}
          onClick={() => void submit()}
        >
          {action.busy ? TEXT.changing : TEXT.confirm}
        </button>
      </DialogActions>
    </Dialog>
  );
}
