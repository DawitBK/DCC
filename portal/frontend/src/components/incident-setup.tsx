'use client';

import { useState } from 'react';
import {
  CreateIncidentCategoryRequest,
  CreateIncidentContactRequest,
  INCIDENT_CONTACT_CHANNELS,
  MAX_RECOVERY_CONTACTS_PER_COMPANY,
  UpdateIncidentCategoryRequest,
  UpdateIncidentContactRequest,
  type IncidentCategoryDto,
  type IncidentContactDto,
} from '@dcc/contracts';
import { canAtGroup } from '@/lib/access';
import { apiSend, queryString } from '@/lib/browser-api';
import { fieldErrorsFromApi, validate, type FieldErrors } from '@/lib/forms';
import { CATEGORY_STATUS, CONTACT_CHANNEL } from '@/lib/labels';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { DataTable } from './data-table';
import { Dialog, DialogActions } from './dialog';
import { EmptyState, LoadingState } from './empty-state';
import { ErrorBox } from './error-box';
import { FormField } from './form-field';
import { ContactValue } from './incident-detail';
import { SectionPanel } from './section-panel';
import { StatusChip } from './status-chip';
import { useToast } from './toast';

const TEXT = {
  title: 'Incident setup',
  subtitle:
    'Categories with their playbooks, and the people to call. Nothing is pre-filled: the Group enters its own. Nothing is ever deleted; an entry is archived.',
  company: 'Company',
  categories: 'Categories and playbooks',
  categoriesCaption: 'Incident categories',
  addCategory: 'Add a category',
  editCategory: 'Edit',
  editCategoryLabel: (name: string) => `Edit category: ${name}`,
  name: 'Name',
  scope: 'For',
  groupDefault: 'Group default (every company)',
  thisCompany: 'This company',
  status: 'Status',
  playbook: 'Playbook',
  noPlaybook: 'No playbook',
  steps: (count: number, title: string) => `${title} (${count} ${count === 1 ? 'step' : 'steps'})`,
  noCategories: 'No category yet',
  noCategoriesBody: 'Add the first one. An incident can be filed without a category.',
  actions: 'Actions',
  key: 'Short name (key)',
  keyHint: 'Lower-case letters, digits and single dashes. It cannot be changed later.',
  scopeCompany: 'This company only',
  scopeGroup: 'Group default: offered to every company of the Group',
  playbookTitle: 'Playbook title',
  playbookTitleHint: 'Optional. Leave the title and the steps empty for no playbook.',
  playbookSteps: 'Playbook steps',
  playbookStepsHint: 'One step per line, in order. Plain text.',
  playbookBoth: 'A playbook needs a title and at least one step. Fill both, or leave both empty.',
  playbookKeepEmpty: 'Leaving both empty removes the playbook.',
  contacts: 'Recovery contacts',
  contactsSubtitle: (active: number) =>
    `${active} of at most ${MAX_RECOVERY_CONTACTS_PER_COMPANY} active contacts. They need no DCC account. Names, addresses and numbers are personal data: enter only what is needed.`,
  contactsCaption: 'Recovery contacts of the company',
  addContact: 'Add a contact',
  editContact: 'Edit',
  editContactLabel: (name: string) => `Edit contact: ${name}`,
  order: 'Order',
  orderHint: 'A number from 0 to 1000. Lower numbers are shown first. Empty puts it last.',
  contactName: 'Name',
  roleLabel: 'Role or why to call',
  channel: 'How to reach',
  value: { email: 'Email address', phone: 'Phone number', other: 'Handle or other detail' },
  contact: 'Contact',
  noContacts: 'No contact yet',
  noContactsBody: 'Add the people to call when something goes wrong.',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Working…',
  archived: 'Archived',
  savedCategory: 'The category was saved.',
  savedContact: 'The contact was saved.',
  nothingChanged: 'Nothing was changed.',
  noCompany: 'You do not manage incidents for any company in view.',
};

/**
 * Managing the incident detail (H-06) for people with `incident.manage`: categories with a playbook, and the
 * company's recovery contacts. `GET/POST/PATCH /api/incident-categories`, `GET/POST/PATCH /api/incident-contacts`.
 * Visibility only: the API decides, and a group default needs a group-level role.
 */
export function IncidentSetup({ onChanged }: { onChanged: () => void }) {
  const { companyId, companiesWhere } = useWorkspace();
  const companies = companiesWhere('incident.manage');
  const [picked, setPicked] = useState<string | null>(null);
  const chosen =
    companies.find((item) => item.id === (picked ?? companyId))?.id ?? companies[0]?.id ?? null;

  if (!chosen) return null;
  return (
    <SectionPanel title={TEXT.title} subtitle={TEXT.subtitle}>
      {companies.length > 1 && (
        <FormField label={TEXT.company}>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={chosen}
              onChange={(event) => setPicked(event.target.value)}
            >
              {companies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}
      <CategoriesPanel key={`c:${chosen}`} companyId={chosen} onChanged={onChanged} />
      <ContactsPanel key={`k:${chosen}`} companyId={chosen} onChanged={onChanged} />
    </SectionPanel>
  );
}

function CategoriesPanel({ companyId, onChanged }: { companyId: string; onChanged: () => void }) {
  const { me } = useWorkspace();
  const categories = useApiData<IncidentCategoryDto[]>(
    `/incident-categories${queryString({ companyId })}`,
  );
  const [editing, setEditing] = useState<IncidentCategoryDto | 'new' | null>(null);
  const mayGroup = canAtGroup(me, 'incident.manage');

  return (
    <div className="setup-block">
      <div className="setup-heading">
        <h3>{TEXT.categories}</h3>
        <button type="button" className="btn btn-outline" onClick={() => setEditing('new')}>
          {TEXT.addCategory}
        </button>
      </div>
      <ErrorBox error={categories.error} loading />
      {!categories.data && categories.loading ? (
        <LoadingState />
      ) : (
        categories.data && (
          <DataTable
            caption={TEXT.categoriesCaption}
            rows={categories.data}
            rowKey={(row) => row.id}
            empty={<EmptyState title={TEXT.noCategories}>{TEXT.noCategoriesBody}</EmptyState>}
            columns={[
              {
                header: TEXT.name,
                cell: (row) => (
                  <>
                    <span className="post-title">{row.name}</span>
                    <span className="subline">{row.key}</span>
                  </>
                ),
              },
              {
                header: TEXT.scope,
                cell: (row) => (row.companyId === null ? TEXT.groupDefault : TEXT.thisCompany),
              },
              {
                header: TEXT.status,
                cell: (row) => <StatusChip status={CATEGORY_STATUS[row.status]} />,
              },
              {
                header: TEXT.playbook,
                cell: (row) =>
                  row.playbook
                    ? TEXT.steps(row.playbook.steps.length, row.playbook.title)
                    : TEXT.noPlaybook,
              },
              {
                header: TEXT.actions,
                cell: (row) =>
                  row.companyId !== null || mayGroup ? (
                    <button
                      type="button"
                      className="text-link"
                      aria-label={TEXT.editCategoryLabel(row.name)}
                      onClick={() => setEditing(row)}
                    >
                      {TEXT.editCategory}
                    </button>
                  ) : null,
              },
            ]}
          />
        )
      )}
      {editing && (
        <CategoryDialog
          companyId={companyId}
          category={editing === 'new' ? null : editing}
          mayGroup={mayGroup}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            categories.reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

/** One playbook step per line; blank lines are ignored. */
function stepsFromText(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function CategoryDialog({
  companyId,
  category,
  mayGroup,
  onClose,
  onSaved,
}: {
  companyId: string;
  category: IncidentCategoryDto | null;
  mayGroup: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const [form, setForm] = useState({
    key: '',
    name: category?.name ?? '',
    scope: 'company' as 'company' | 'group',
    status: category?.status ?? 'active',
    playbookTitle: category?.playbook?.title ?? '',
    playbookSteps: category?.playbook?.steps.join('\n') ?? '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async () => {
    const steps = stepsFromText(form.playbookSteps);
    const title = form.playbookTitle.trim();
    if ((title === '') !== (steps.length === 0)) {
      return setErrors({ playbook: TEXT.playbookBoth });
    }
    const playbook = title ? { title, steps } : undefined;
    let checked;
    if (category) {
      const changes: Record<string, unknown> = {};
      if (form.name.trim() !== category.name) changes.name = form.name;
      if (form.status !== category.status) changes.status = form.status;
      const before = category.playbook;
      const same =
        (!before && !playbook) ||
        (before &&
          playbook &&
          before.title === playbook.title &&
          before.steps.length === playbook.steps.length &&
          before.steps.every((step, index) => step === playbook.steps[index]));
      if (!same) changes.playbook = playbook ?? null;
      if (Object.keys(changes).length === 0) return setErrors({ _form: TEXT.nothingChanged });
      checked = validate(UpdateIncidentCategoryRequest, changes);
    } else {
      checked = validate(CreateIncidentCategoryRequest, {
        ...(form.scope === 'company' ? { companyId } : {}),
        key: form.key,
        name: form.name,
        ...(playbook ? { playbook } : {}),
      });
    }
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const data = checked.data;
    const failure = await action.run(() =>
      category
        ? apiSend('PATCH', `/incident-categories/${category.id}`, data)
        : apiSend('POST', '/incident-categories', data),
    );
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.savedCategory);
    onSaved();
  };

  return (
    <Dialog title={category ? category.name : TEXT.addCategory} onClose={onClose} wide>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        {errors._form && (
          <p className="field-error" role="alert">
            {errors._form}
          </p>
        )}
        {!category && (
          <>
            <FormField label={TEXT.scope}>
              {(control) => (
                <select
                  className="select-field"
                  {...control}
                  value={form.scope}
                  onChange={(event) =>
                    setForm({ ...form, scope: event.target.value as 'company' | 'group' })
                  }
                >
                  <option value="company">{TEXT.scopeCompany}</option>
                  {mayGroup && <option value="group">{TEXT.scopeGroup}</option>}
                </select>
              )}
            </FormField>
            <FormField label={TEXT.key} hint={TEXT.keyHint} error={errors.key} required>
              {(control) => (
                <input
                  className="field"
                  {...control}
                  value={form.key}
                  autoComplete="off"
                  onChange={(event) => setForm({ ...form, key: event.target.value })}
                />
              )}
            </FormField>
          </>
        )}
        <FormField label={TEXT.name} error={errors.name} required>
          {(control) => (
            <input
              className="field"
              {...control}
              value={form.name}
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          )}
        </FormField>
        {category && (
          <FormField label={TEXT.status} error={errors.status}>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={form.status}
                onChange={(event) =>
                  setForm({ ...form, status: event.target.value as 'active' | 'archived' })
                }
              >
                <option value="active">{CATEGORY_STATUS.active.label}</option>
                <option value="archived">{CATEGORY_STATUS.archived.label}</option>
              </select>
            )}
          </FormField>
        )}
        <FormField label={TEXT.playbookTitle} hint={TEXT.playbookTitleHint} error={errors.playbook}>
          {(control) => (
            <input
              className="field"
              {...control}
              value={form.playbookTitle}
              onChange={(event) => setForm({ ...form, playbookTitle: event.target.value })}
            />
          )}
        </FormField>
        <FormField
          label={TEXT.playbookSteps}
          hint={
            category?.playbook
              ? `${TEXT.playbookStepsHint} ${TEXT.playbookKeepEmpty}`
              : TEXT.playbookStepsHint
          }
        >
          {(control) => (
            <textarea
              className="textarea-field"
              style={{ minHeight: 120 }}
              {...control}
              value={form.playbookSteps}
              onChange={(event) => setForm({ ...form, playbookSteps: event.target.value })}
            />
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

function ContactsPanel({ companyId, onChanged }: { companyId: string; onChanged: () => void }) {
  const contacts = useApiData<IncidentContactDto[]>(
    `/incident-contacts${queryString({ companyId })}`,
  );
  const [editing, setEditing] = useState<IncidentContactDto | 'new' | null>(null);
  const rows = [...(contacts.data ?? [])].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );
  const active = rows.filter((row) => row.status === 'active').length;

  return (
    <div className="setup-block">
      <div className="setup-heading">
        <h3>{TEXT.contacts}</h3>
        <button type="button" className="btn btn-outline" onClick={() => setEditing('new')}>
          {TEXT.addContact}
        </button>
      </div>
      <p className="hint">{TEXT.contactsSubtitle(active)}</p>
      <ErrorBox error={contacts.error} loading />
      {!contacts.data && contacts.loading ? (
        <LoadingState />
      ) : (
        contacts.data && (
          <DataTable
            caption={TEXT.contactsCaption}
            rows={rows}
            rowKey={(row) => row.id}
            empty={<EmptyState title={TEXT.noContacts}>{TEXT.noContactsBody}</EmptyState>}
            columns={[
              { header: TEXT.order, cell: (row) => String(row.position) },
              {
                header: TEXT.contactName,
                cell: (row) => (
                  <>
                    <span className="post-title">{row.name}</span>
                    <span className="subline">{row.roleLabel}</span>
                  </>
                ),
              },
              {
                header: TEXT.contact,
                cell: (row) => (
                  <>
                    {CONTACT_CHANNEL[row.channel]}
                    <span className="subline">
                      <ContactValue contact={row} />
                    </span>
                  </>
                ),
              },
              {
                header: TEXT.status,
                cell: (row) => <StatusChip status={CATEGORY_STATUS[row.status]} />,
              },
              {
                header: TEXT.actions,
                cell: (row) => (
                  <button
                    type="button"
                    className="text-link"
                    aria-label={TEXT.editContactLabel(row.name)}
                    onClick={() => setEditing(row)}
                  >
                    {TEXT.editContact}
                  </button>
                ),
              },
            ]}
          />
        )
      )}
      {editing && (
        <ContactDialog
          companyId={companyId}
          contact={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            contacts.reload();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

function ContactDialog({
  companyId,
  contact,
  onClose,
  onSaved,
}: {
  companyId: string;
  contact: IncidentContactDto | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const [form, setForm] = useState({
    name: contact?.name ?? '',
    roleLabel: contact?.roleLabel ?? '',
    channel: contact?.channel ?? ('email' as (typeof INCIDENT_CONTACT_CHANNELS)[number]),
    value: contact?.value ?? '',
    position: contact ? String(contact.position) : '',
    status: contact?.status ?? 'active',
  });
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async () => {
    const position = form.position.trim() === '' ? undefined : Number(form.position);
    let checked;
    if (contact) {
      const changes: Record<string, unknown> = {};
      if (form.name.trim() !== contact.name) changes.name = form.name;
      if (form.roleLabel.trim() !== contact.roleLabel) changes.roleLabel = form.roleLabel;
      if (form.channel !== contact.channel) changes.channel = form.channel;
      if (form.value.trim() !== contact.value) changes.value = form.value;
      if (position !== undefined && position !== contact.position) changes.position = position;
      if (form.status !== contact.status) changes.status = form.status;
      // A new channel needs its value checked with it, even when the value did not change.
      if (changes.channel !== undefined && changes.value === undefined) changes.value = form.value;
      if (Object.keys(changes).length === 0) return setErrors({ _form: TEXT.nothingChanged });
      checked = validate(UpdateIncidentContactRequest, changes);
    } else {
      checked = validate(CreateIncidentContactRequest, {
        companyId,
        name: form.name,
        roleLabel: form.roleLabel,
        channel: form.channel,
        value: form.value,
        ...(position === undefined ? {} : { position }),
      });
    }
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const data = checked.data;
    const failure = await action.run(() =>
      contact
        ? apiSend('PATCH', `/incident-contacts/${contact.id}`, data)
        : apiSend('POST', '/incident-contacts', data),
    );
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.savedContact);
    onSaved();
  };

  return (
    <Dialog title={contact ? contact.name : TEXT.addContact} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        {errors._form && (
          <p className="field-error" role="alert">
            {errors._form}
          </p>
        )}
        <FormField label={TEXT.contactName} error={errors.name} required>
          {(control) => (
            <input
              className="field"
              {...control}
              value={form.name}
              autoComplete="off"
              onChange={(event) => setForm({ ...form, name: event.target.value })}
            />
          )}
        </FormField>
        <FormField label={TEXT.roleLabel} error={errors.roleLabel} required>
          {(control) => (
            <input
              className="field"
              {...control}
              value={form.roleLabel}
              autoComplete="off"
              onChange={(event) => setForm({ ...form, roleLabel: event.target.value })}
            />
          )}
        </FormField>
        <div className="grid grid-2">
          <FormField label={TEXT.channel} error={errors.channel} required>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={form.channel}
                onChange={(event) =>
                  setForm({
                    ...form,
                    channel: event.target.value as (typeof INCIDENT_CONTACT_CHANNELS)[number],
                  })
                }
              >
                {INCIDENT_CONTACT_CHANNELS.map((value) => (
                  <option key={value} value={value}>
                    {CONTACT_CHANNEL[value]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={TEXT.value[form.channel]} error={errors.value} required>
            {(control) => (
              <input
                className="field"
                {...control}
                value={form.value}
                autoComplete="off"
                inputMode={
                  form.channel === 'phone' ? 'tel' : form.channel === 'email' ? 'email' : 'text'
                }
                onChange={(event) => setForm({ ...form, value: event.target.value })}
              />
            )}
          </FormField>
        </div>
        <div className="grid grid-2">
          <FormField label={TEXT.order} hint={TEXT.orderHint} error={errors.position}>
            {(control) => (
              <input
                className="field"
                {...control}
                inputMode="numeric"
                value={form.position}
                onChange={(event) => setForm({ ...form, position: event.target.value })}
              />
            )}
          </FormField>
          {contact && (
            <FormField label={TEXT.status} error={errors.status}>
              {(control) => (
                <select
                  className="select-field"
                  {...control}
                  value={form.status}
                  onChange={(event) =>
                    setForm({ ...form, status: event.target.value as 'active' | 'archived' })
                  }
                >
                  <option value="active">{CATEGORY_STATUS.active.label}</option>
                  <option value="archived">{TEXT.archived}</option>
                </select>
              )}
            </FormField>
          )}
        </div>
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
