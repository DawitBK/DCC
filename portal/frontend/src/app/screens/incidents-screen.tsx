'use client';

import { useState } from 'react';
import {
  CreateIncidentRequest,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  UpdateIncidentRequest,
  type IncidentDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { DataTable } from '@/components/data-table';
import { Dialog, DialogActions } from '@/components/dialog';
import { EmptyState, LoadingState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { useToast } from '@/components/toast';
import { apiSend } from '@/lib/browser-api';
import {
  blankToUndefined,
  fieldErrorsFromApi,
  maxLengthOf,
  validate,
  type FieldErrors,
} from '@/lib/forms';
import { formatDateTime, shortId } from '@/lib/format';
import { INCIDENT_SEVERITY, INCIDENT_STATUS, PLATFORM_LABELS } from '@/lib/labels';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const TEXT = {
  title: 'Incidents',
  description: 'Register an incident, follow it, and record when it is resolved.',
  report: '＋ Report incident',
  allStatuses: 'All statuses',
  allSeverities: 'All severities',
  filterStatus: 'Filter incidents by status',
  filterSeverity: 'Filter incidents by severity',
  register: 'Incident register',
  subtitle: (count: number) => `${count} incidents from DCC`,
  caption: 'Incidents',
  incident: 'Incident',
  company: 'Company',
  severity: 'Severity',
  status: 'Status',
  opened: 'Opened',
  actions: 'Actions',
  open: 'Open',
  openLabel: (title: string) => `Open incident: ${title}`,
  emptyTitle: 'No matching incidents',
  emptyBody: 'Nothing is registered for this selection.',
  dialogNew: 'Report an incident',
  titleField: 'Title',
  descriptionField: 'What happened',
  account: 'Social account',
  noAccount: 'No particular account',
  cancel: 'Cancel',
  close: 'Close',
  save: 'Save',
  saving: 'Saving…',
  saved: 'Saved. The register was read again from DCC.',
  openedBy: 'Opened by',
  resolved: 'Resolved',
  notResolved: 'Not resolved',
  readOnly: 'Your role can read incidents but not change them.',
};

/** `GET /api/incidents`, `GET /api/incidents/:id`, `POST /api/incidents`, `PATCH /api/incidents/:id`. */
export function IncidentsScreen() {
  const { companyId, companyName, can, companiesWhere, refreshNotifications } = useWorkspace();
  const incidents = useApiData<IncidentDto[]>('/incidents');
  const accounts = useApiData<SocialAccountDto[]>(can('account.read') ? '/social-accounts' : null);
  const [status, setStatus] = useState('');
  const [severity, setSeverity] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const visible = (incidents.data ?? []).filter(
    (row) =>
      (!companyId || row.companyId === companyId) &&
      (!status || row.status === status) &&
      (!severity || row.severity === severity),
  );

  return (
    <>
      <PageTitle
        title={TEXT.title}
        description={TEXT.description}
        action={
          companiesWhere('incident.manage').length > 0 && (
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              {TEXT.report}
            </button>
          )
        }
      />
      <ErrorBox error={incidents.error} loading />
      <div className="filter-row">
        <select
          className="select-field"
          aria-label={TEXT.filterStatus}
          value={status}
          onChange={(event) => setStatus(event.target.value)}
        >
          <option value="">{TEXT.allStatuses}</option>
          {INCIDENT_STATUSES.map((value) => (
            <option key={value} value={value}>
              {INCIDENT_STATUS[value].label}
            </option>
          ))}
        </select>
        <select
          className="select-field"
          aria-label={TEXT.filterSeverity}
          value={severity}
          onChange={(event) => setSeverity(event.target.value)}
        >
          <option value="">{TEXT.allSeverities}</option>
          {INCIDENT_SEVERITIES.map((value) => (
            <option key={value} value={value}>
              {INCIDENT_SEVERITY[value].label}
            </option>
          ))}
        </select>
      </div>
      <SectionPanel title={TEXT.register} subtitle={TEXT.subtitle(visible.length)}>
        {!incidents.data && incidents.loading ? (
          <LoadingState />
        ) : (
          <DataTable
            caption={TEXT.caption}
            rows={visible}
            rowKey={(row) => row.id}
            empty={<EmptyState title={TEXT.emptyTitle}>{TEXT.emptyBody}</EmptyState>}
            columns={[
              {
                header: TEXT.incident,
                cell: (row) => (
                  <>
                    <span className="post-title">{row.title}</span>
                    <span className="subline">{shortId(row.id)}</span>
                  </>
                ),
              },
              { header: TEXT.company, cell: (row) => companyName(row.companyId) },
              {
                header: TEXT.severity,
                cell: (row) => <StatusChip status={INCIDENT_SEVERITY[row.severity]} />,
              },
              {
                header: TEXT.status,
                cell: (row) => <StatusChip status={INCIDENT_STATUS[row.status]} />,
              },
              { header: TEXT.opened, cell: (row) => formatDateTime(row.openedAt) },
              {
                header: TEXT.actions,
                cell: (row) => (
                  <button
                    className="text-link"
                    aria-label={TEXT.openLabel(row.title)}
                    onClick={() => setOpenId(row.id)}
                  >
                    {TEXT.open}
                  </button>
                ),
              },
            ]}
          />
        )}
      </SectionPanel>
      {creating && (
        <CreateDialog
          accounts={accounts.data ?? []}
          onClose={() => setCreating(false)}
          onSaved={() => {
            setCreating(false);
            incidents.reload();
            refreshNotifications();
          }}
        />
      )}
      {openId && (
        <IncidentDialog
          id={openId}
          accounts={accounts.data ?? []}
          onClose={() => setOpenId(null)}
          onChanged={incidents.reload}
        />
      )}
    </>
  );
}

function CreateDialog({
  accounts,
  onClose,
  onSaved,
}: {
  accounts: SocialAccountDto[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const { companiesWhere } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const companies = companiesWhere('incident.manage');
  const [form, setForm] = useState({
    companyId: companies[0]?.id ?? '',
    socialAccountId: '',
    title: '',
    description: '',
    severity: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const shape = CreateIncidentRequest.shape;

  const submit = async () => {
    const checked = validate(CreateIncidentRequest, blankToUndefined(form));
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() => apiSend('POST', '/incidents', checked.data));
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.saved);
    onSaved();
  };

  return (
    <Dialog title={TEXT.dialogNew} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        <FormField label={TEXT.company} error={errors.companyId} required>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={form.companyId}
              onChange={(event) =>
                setForm({ ...form, companyId: event.target.value, socialAccountId: '' })
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
        <FormField label={TEXT.titleField} error={errors.title} required>
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
        <FormField label={TEXT.descriptionField} error={errors.description}>
          {(control) => (
            <textarea
              className="textarea-field"
              style={{ minHeight: 90 }}
              {...control}
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
                <option value="">—</option>
                {INCIDENT_SEVERITIES.map((value) => (
                  <option key={value} value={value}>
                    {INCIDENT_SEVERITY[value].label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={TEXT.account} error={errors.socialAccountId}>
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

function IncidentDialog({
  id,
  accounts,
  onClose,
  onChanged,
}: {
  id: string;
  accounts: SocialAccountDto[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const { companyName, personName, can } = useWorkspace();
  const incident = useApiData<IncidentDto>(`/incidents/${id}`);
  const data = incident.data;
  return (
    <Dialog title={data?.title ?? TEXT.incident} onClose={onClose} wide>
      <ErrorBox error={incident.error} loading />
      {!data && incident.loading && <LoadingState />}
      {data && (
        <>
          <dl className="definition-grid">
            <div>
              <dt>{TEXT.company}</dt>
              <dd>{companyName(data.companyId)}</dd>
            </div>
            <div>
              <dt>{TEXT.account}</dt>
              <dd>
                {data.socialAccountId
                  ? (accounts.find((account) => account.id === data.socialAccountId)?.displayName ??
                    shortId(data.socialAccountId))
                  : TEXT.noAccount}
              </dd>
            </div>
            <div>
              <dt>{TEXT.openedBy}</dt>
              <dd>
                {personName(data.openedBy)} · {formatDateTime(data.openedAt)}
              </dd>
            </div>
            <div>
              <dt>{TEXT.resolved}</dt>
              <dd>{data.resolvedAt ? formatDateTime(data.resolvedAt) : TEXT.notResolved}</dd>
            </div>
          </dl>
          {can('incident.manage', data.companyId) ? (
            <IncidentForm
              key={`${data.id}:${data.status}:${data.severity}:${data.title}`}
              incident={data}
              onClose={onClose}
              onSaved={() => {
                incident.reload();
                onChanged();
              }}
            />
          ) : (
            <>
              <p style={{ whiteSpace: 'pre-wrap' }}>{data.description}</p>
              <p>
                <StatusChip status={INCIDENT_SEVERITY[data.severity]} />{' '}
                <StatusChip status={INCIDENT_STATUS[data.status]} />
              </p>
              <small className="hint">{TEXT.readOnly}</small>
              <DialogActions>
                <button className="btn btn-primary" onClick={onClose}>
                  {TEXT.close}
                </button>
              </DialogActions>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}

function IncidentForm({
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
  });
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async () => {
    const checked = validate(UpdateIncidentRequest, blankToUndefined(form));
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() =>
      apiSend('PATCH', `/incidents/${incident.id}`, checked.data),
    );
    onSaved();
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.saved);
  };

  return (
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
      <FormField label={TEXT.descriptionField} error={errors.description}>
        {(control) => (
          <textarea
            className="textarea-field"
            style={{ minHeight: 90 }}
            {...control}
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
      <DialogActions>
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {TEXT.close}
        </button>
        <button type="submit" className="btn btn-primary" disabled={action.busy}>
          {action.busy ? TEXT.saving : TEXT.save}
        </button>
      </DialogActions>
    </form>
  );
}
