'use client';

import { useState } from 'react';
import {
  CreateIncidentCategoryRequest,
  CreateIncidentContactRequest,
  INCIDENT_CONTACT_CHANNELS,
  MAX_PLAYBOOK_STEPS,
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
import { Dialog, DialogActions } from './dialog';
import { EmptyState } from './empty-state';
import { ErrorBox } from './error-box';
import { FormField } from './form-field';
import { FactStrip, GatedButton, PanelSkeleton } from './gov-parts';
import { ContactValue } from './incident-detail';
import { DataGrid, type GridColumn } from './kit/data-grid';
import { Drawer } from './kit/drawer';
import { Callout, Fact } from './kit/parts';
import { SectionPanel } from './section-panel';
import { StatusChip } from './status-chip';
import { useToast } from './toast';
import '@/app/screens/governance.css';
import '@/app/screens/incidents-screen.css';

const TEXT = {
  intro:
    'Categories with their playbooks, and the people to call. Nothing is pre-filled: the Group enters its own. Nothing is ever deleted: an entry is archived.',
  company: 'Company',
  companyHint: 'The setup is kept per company; group defaults are offered to every company.',
  factCategories: 'Active categories',
  factCategoriesNote: 'Offered when an incident is reported',
  factPlaybooks: 'With a playbook',
  factPlaybooksNote: 'Shown as a checklist on the incident',
  factArchived: 'Archived categories',
  factArchivedNote: 'Kept on the incidents that already have them',
  factContacts: 'Active contacts',
  factContactsNote: (max: number) => `At most ${max} per company`,
  categories: 'Categories and playbooks',
  categoriesSubtitle:
    'A category decides which playbook is shown with an incident. A company has its own list and also sees the Group defaults.',
  categoriesCaption: 'Incident categories',
  addCategory: 'Add a category',
  editCategory: 'Edit',
  editCategoryLabel: (name: string) => `Edit category: ${name}`,
  viewPlaybook: 'View playbook',
  viewPlaybookLabel: (name: string) => `View the playbook of ${name}`,
  name: 'Name',
  scope: 'For',
  scopeFilter: 'Scope',
  groupDefault: 'Group default',
  groupDefaultLong: 'Group default (every company)',
  thisCompany: 'This company',
  status: 'Status',
  playbook: 'Playbook',
  noPlaybook: 'No playbook',
  steps: (count: number) => `${count} ${count === 1 ? 'step' : 'steps'}`,
  noCategories: 'No category yet',
  noCategoriesBody: 'Add the first one. An incident can be filed without a category.',
  actions: 'Actions',
  groupOnly: 'A group-level role is needed to change a Group default.',
  key: 'Short name (key)',
  keyHint: 'Lower-case letters, digits and single dashes. It cannot be changed later.',
  scopeCompany: 'This company only',
  scopeGroup: 'Group default: offered to every company of the Group',
  playbookTitle: 'Playbook title',
  playbookTitleHint: 'Optional. Leave the title and the steps empty for no playbook.',
  playbookSteps: 'Playbook steps',
  playbookStepsHint: `One step per line, in order. Plain text, up to 500 characters a line, at most ${MAX_PLAYBOOK_STEPS} steps.`,
  playbookStepsCount: (count: number) => `${count} of ${MAX_PLAYBOOK_STEPS} steps`,
  playbookBoth: 'A playbook needs a title and at least one step. Fill both, or leave both empty.',
  playbookKeepEmpty: 'Leaving both empty removes the playbook.',
  archiveNote:
    'Archiving hides a category from new incidents. Incidents that already have it keep it, with its playbook as it is now.',
  contacts: 'Recovery contacts',
  contactsSubtitle:
    'The people to call, in order. They need no DCC account. Names, addresses and numbers are personal data: enter only what is needed.',
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
  meter: (active: number, max: number) => `${active} of ${max} active contacts`,
  contactsFull: 'The company already has the most active contacts. Archive one first.',
  cancel: 'Cancel',
  save: 'Save',
  saving: 'Working…',
  archived: 'Archived',
  savedCategory: 'The category was saved.',
  savedContact: 'The contact was saved.',
  nothingChanged: 'Nothing was changed.',
  noCompany: 'No company in view has incident setup you may read.',
  readOnly: 'Your role can read the setup but not change it.',
  playbookOf: (name: string) => `Playbook: ${name}`,
  playbookClose: 'Close',
};

/**
 * The incident setup (H-06) as a tab: categories with a playbook, and the company's recovery contacts.
 * `GET/POST/PATCH /api/incident-categories`, `GET/POST/PATCH /api/incident-contacts`. People who can read
 * incidents see it all; the buttons that change it are shown to everyone and say why when they are off.
 * A group default also needs a group-level role.
 */
export function IncidentSetup({ onChanged }: { onChanged: () => void }) {
  const { me, companyId, companiesWhere, can } = useWorkspace();
  const companies = companiesWhere('incident.read');
  const [picked, setPicked] = useState<string | null>(null);
  const chosen =
    companies.find((item) => item.id === (picked ?? companyId))?.id ?? companies[0]?.id ?? null;
  const categories = useApiData<IncidentCategoryDto[]>(
    chosen ? `/incident-categories${queryString({ companyId: chosen })}` : null,
  );
  const contacts = useApiData<IncidentContactDto[]>(
    chosen ? `/incident-contacts${queryString({ companyId: chosen })}` : null,
  );
  const [editingCategory, setEditingCategory] = useState<IncidentCategoryDto | 'new' | null>(null);
  const [editingContact, setEditingContact] = useState<IncidentContactDto | 'new' | null>(null);
  const [viewing, setViewing] = useState<IncidentCategoryDto | null>(null);

  if (!chosen) {
    return (
      <SectionPanel title="Incident setup">
        <EmptyState title={TEXT.noCompany} />
      </SectionPanel>
    );
  }
  const mayManage = can('incident.manage', chosen);
  const mayGroup = canAtGroup(me, 'incident.manage');
  const rows = categories.data ?? [];
  const contactRows = [...(contacts.data ?? [])].sort(
    (a, b) => a.position - b.position || a.name.localeCompare(b.name),
  );
  const activeContacts = contactRows.filter((row) => row.status === 'active').length;
  const contactsFull = activeContacts >= MAX_RECOVERY_CONTACTS_PER_COMPANY;

  const categoryColumns: GridColumn<IncidentCategoryDto>[] = [
    {
      id: 'name',
      header: TEXT.name,
      sortValue: (row) => row.name,
      cell: (row) => (
        <>
          <span className="post-title">{row.name}</span>
          <span className="subline gov-mono">{row.key}</span>
        </>
      ),
    },
    {
      id: 'scope',
      header: TEXT.scope,
      sortValue: (row) => (row.companyId === null ? TEXT.groupDefault : TEXT.thisCompany),
      cell: (row) => (
        <StatusChip
          label={row.companyId === null ? TEXT.groupDefault : TEXT.thisCompany}
          tone={row.companyId === null ? 'blue' : 'gray'}
        />
      ),
    },
    {
      id: 'status',
      header: TEXT.status,
      sortValue: (row) => row.status,
      cell: (row) => <StatusChip status={CATEGORY_STATUS[row.status]} />,
    },
    {
      id: 'playbook',
      header: TEXT.playbook,
      sortValue: (row) => row.playbook?.steps.length ?? 0,
      exportValue: (row) =>
        row.playbook ? `${row.playbook.title} (${TEXT.steps(row.playbook.steps.length)})` : '',
      cell: (row) =>
        row.playbook ? (
          <>
            <span className="post-title">{row.playbook.title}</span>
            <span className="subline">{TEXT.steps(row.playbook.steps.length)}</span>
            <button
              type="button"
              className="text-link"
              aria-label={TEXT.viewPlaybookLabel(row.name)}
              onClick={() => setViewing(row)}
            >
              {TEXT.viewPlaybook}
            </button>
          </>
        ) : (
          <span className="gov-muted">{TEXT.noPlaybook}</span>
        ),
    },
    {
      id: 'actions',
      header: TEXT.actions,
      cell: (row) => {
        const allowed = mayManage && (row.companyId !== null || mayGroup);
        return (
          <>
            <button
              type="button"
              className="text-link"
              disabled={!allowed}
              aria-label={TEXT.editCategoryLabel(row.name)}
              onClick={() => setEditingCategory(row)}
            >
              {TEXT.editCategory}
            </button>
            {mayManage && row.companyId === null && !mayGroup && (
              <span className="subline">{TEXT.groupOnly}</span>
            )}
          </>
        );
      },
    },
  ];

  const contactColumns: GridColumn<IncidentContactDto>[] = [
    {
      id: 'order',
      header: TEXT.order,
      sortValue: (row) => row.position,
      cell: (row) => String(row.position),
    },
    {
      id: 'name',
      header: TEXT.contactName,
      sortValue: (row) => row.name,
      cell: (row) => (
        <>
          <span className="post-title">{row.name}</span>
          <span className="subline">{row.roleLabel}</span>
        </>
      ),
    },
    {
      id: 'contact',
      header: TEXT.contact,
      sortValue: (row) => `${row.channel} ${row.value}`,
      exportValue: (row) => `${CONTACT_CHANNEL[row.channel]}: ${row.value}`,
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
      id: 'status',
      header: TEXT.status,
      sortValue: (row) => row.status,
      cell: (row) => <StatusChip status={CATEGORY_STATUS[row.status]} />,
    },
    {
      id: 'actions',
      header: TEXT.actions,
      cell: (row) => (
        <button
          type="button"
          className="text-link"
          disabled={!mayManage}
          aria-label={TEXT.editContactLabel(row.name)}
          onClick={() => setEditingContact(row)}
        >
          {TEXT.editContact}
        </button>
      ),
    },
  ];

  return (
    <div className="gov-stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Incident setup</h2>
            <p>{TEXT.intro}</p>
          </div>
          {companies.length > 1 && (
            <FormField label={TEXT.company} hint={TEXT.companyHint}>
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
        </div>
        {!mayManage && (
          <Callout tone="info" title={TEXT.readOnly}>
            Changing the setup needs the incident-manage permission in this company.
          </Callout>
        )}
      </section>

      <FactStrip label="Setup at a glance">
        <Fact
          label={TEXT.factCategories}
          value={rows.filter((row) => row.status === 'active').length}
          note={TEXT.factCategoriesNote}
        />
        <Fact
          label={TEXT.factPlaybooks}
          value={rows.filter((row) => row.playbook).length}
          note={TEXT.factPlaybooksNote}
        />
        <Fact
          label={TEXT.factArchived}
          value={rows.filter((row) => row.status === 'archived').length}
          note={TEXT.factArchivedNote}
        />
        <Fact
          label={TEXT.factContacts}
          value={`${activeContacts} / ${MAX_RECOVERY_CONTACTS_PER_COMPANY}`}
          note={TEXT.factContactsNote(MAX_RECOVERY_CONTACTS_PER_COMPANY)}
        />
      </FactStrip>

      <SectionPanel
        title={TEXT.categories}
        subtitle={TEXT.categoriesSubtitle}
        action={
          <GatedButton
            allowed={mayManage}
            permission="incident.manage"
            onClick={() => setEditingCategory('new')}
          >
            {TEXT.addCategory}
          </GatedButton>
        }
      >
        <ErrorBox error={categories.error} loading />
        {!categories.data && categories.loading ? (
          <PanelSkeleton lines={4} />
        ) : (
          categories.data && (
            <DataGrid
              caption={TEXT.categoriesCaption}
              columns={categoryColumns}
              rows={rows}
              rowKey={(row) => row.id}
              searchText={(row) =>
                `${row.name} ${row.key} ${row.playbook?.title ?? ''} ${row.playbook?.steps.join(' ') ?? ''}`
              }
              filters={[
                {
                  id: 'status',
                  label: TEXT.status,
                  options: [
                    { value: 'active', label: CATEGORY_STATUS.active.label },
                    { value: 'archived', label: CATEGORY_STATUS.archived.label },
                  ],
                  test: (row, value) => row.status === value,
                },
                {
                  id: 'scope',
                  label: TEXT.scopeFilter,
                  options: [
                    { value: 'group', label: TEXT.groupDefault },
                    { value: 'company', label: TEXT.thisCompany },
                  ],
                  test: (row, value) => (value === 'group') === (row.companyId === null),
                },
              ]}
              defaultSort={{ id: 'name', direction: 'asc' }}
              exportName="incident-categories"
              empty={<EmptyState title={TEXT.noCategories}>{TEXT.noCategoriesBody}</EmptyState>}
            />
          )
        )}
      </SectionPanel>

      <SectionPanel
        title={TEXT.contacts}
        subtitle={TEXT.contactsSubtitle}
        action={
          <GatedButton
            allowed={mayManage && !contactsFull}
            permission="incident.manage"
            reason={mayManage && contactsFull ? TEXT.contactsFull : undefined}
            onClick={() => setEditingContact('new')}
          >
            {TEXT.addContact}
          </GatedButton>
        }
      >
        <div className="inc-meter">
          <span>{TEXT.meter(activeContacts, MAX_RECOVERY_CONTACTS_PER_COMPANY)}</span>
          <span className="kit-bar-track" aria-hidden="true">
            <span
              className={`kit-bar-fill kit-tone-${contactsFull ? 'red' : 'blue'}`}
              style={{
                width: `${Math.min(100, Math.round((activeContacts / MAX_RECOVERY_CONTACTS_PER_COMPANY) * 100))}%`,
              }}
            />
          </span>
        </div>
        <ErrorBox error={contacts.error} loading />
        {!contacts.data && contacts.loading ? (
          <PanelSkeleton lines={4} />
        ) : (
          contacts.data && (
            <DataGrid
              caption={TEXT.contactsCaption}
              columns={contactColumns}
              rows={contactRows}
              rowKey={(row) => row.id}
              searchText={(row) => `${row.name} ${row.roleLabel} ${row.value}`}
              filters={[
                {
                  id: 'status',
                  label: TEXT.status,
                  options: [
                    { value: 'active', label: CATEGORY_STATUS.active.label },
                    { value: 'archived', label: CATEGORY_STATUS.archived.label },
                  ],
                  test: (row, value) => row.status === value,
                },
                {
                  id: 'channel',
                  label: TEXT.channel,
                  options: INCIDENT_CONTACT_CHANNELS.map((value) => ({
                    value,
                    label: CONTACT_CHANNEL[value],
                  })),
                  test: (row, value) => row.channel === value,
                },
              ]}
              defaultSort={{ id: 'order', direction: 'asc' }}
              exportName="recovery-contacts"
              empty={<EmptyState title={TEXT.noContacts}>{TEXT.noContactsBody}</EmptyState>}
            />
          )
        )}
      </SectionPanel>

      {editingCategory && (
        <CategoryDialog
          companyId={chosen}
          category={editingCategory === 'new' ? null : editingCategory}
          mayGroup={mayGroup}
          onClose={() => setEditingCategory(null)}
          onSaved={() => {
            setEditingCategory(null);
            categories.reload();
            onChanged();
          }}
        />
      )}
      {editingContact && (
        <ContactDialog
          companyId={chosen}
          contact={editingContact === 'new' ? null : editingContact}
          onClose={() => setEditingContact(null)}
          onSaved={() => {
            setEditingContact(null);
            contacts.reload();
            onChanged();
          }}
        />
      )}
      {viewing?.playbook && (
        <Drawer
          title={TEXT.playbookOf(viewing.name)}
          subtitle={viewing.playbook.title}
          onClose={() => setViewing(null)}
          footer={
            <button type="button" className="btn btn-outline" onClick={() => setViewing(null)}>
              {TEXT.playbookClose}
            </button>
          }
        >
          <ol className="inc-playbook-preview">
            {viewing.playbook.steps.map((step, index) => (
              <li key={`${index}:${step}`}>{step}</li>
            ))}
          </ol>
        </Drawer>
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
  const stepCount = stepsFromText(form.playbookSteps).length;

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
          <FormField label={TEXT.status} hint={TEXT.archiveNote} error={errors.status}>
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
              maxLength={200}
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
              style={{ minHeight: 140 }}
              {...control}
              value={form.playbookSteps}
              onChange={(event) => setForm({ ...form, playbookSteps: event.target.value })}
            />
          )}
        </FormField>
        <p className="inc-steps-counter" role="status">
          {TEXT.playbookStepsCount(stepCount)}
        </p>
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
