'use client';

import { useState } from 'react';
import {
  CreateSocialAccountRequest,
  LinkEngineChannelRequest,
  SetAccountBackupAdminRequest,
  SetAccountStatusRequest,
  SOCIAL_ACCOUNT_STATUSES,
  SOCIAL_PLATFORMS,
  UpdateSocialAccountRequest,
  type BrandDto,
  type EngineChannelDto,
  type EngineStatusDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { DataTable } from '@/components/data-table';
import { Dialog, DialogActions } from '@/components/dialog';
import { EmptyState, LoadingState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatCard } from '@/components/stat-card';
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
import { ACCOUNT_STATUS, PLATFORM_LABELS } from '@/lib/labels';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const TEXT = {
  title: 'Social accounts',
  description:
    'The register of official accounts: who owns each one, its backup administrator and its state.',
  register: '＋ Register account',
  inView: 'Accounts in view',
  inViewFoot: 'In the chosen company scope',
  active: 'Active',
  activeFoot: 'Marked active in the register',
  attention: 'Needs attention',
  attentionFoot: 'Flagged in the register',
  notConnected: 'Not connected to the engine',
  notConnectedFoot: 'Cannot be published to yet',
  allPlatforms: 'All platforms',
  filterPlatform: 'Filter accounts by platform',
  search: 'Search accounts',
  registry: 'Account registry',
  registrySubtitle: (count: number) => `${count} accounts from DCC`,
  caption: 'Registered social accounts',
  account: 'Account',
  company: 'Company',
  people: 'Owner / backup',
  noBackup: 'No backup administrator',
  engine: 'Publishing engine',
  linked: 'Connected',
  unlinked: 'Not connected',
  status: 'Status',
  actions: 'Actions',
  manage: 'Manage',
  manageLabel: (name: string) => `Manage ${name}`,
  emptyTitle: 'No matching accounts',
  emptyBody: 'Try another search or platform filter, or register an account.',
  engineTitle: 'Publishing engine',
  engineProvider: (provider: string) => `Engine: ${provider}`,
  verified: 'Checked against a live service',
  unverified: 'Not yet checked against a live service',
  canPublish: 'Can publish',
  cannotPublish: 'Cannot publish',
  dialogRegister: 'Register a social account',
  dialogManage: (name: string) => `Manage ${name}`,
  platform: 'Platform',
  displayName: 'Display name',
  handle: 'Handle',
  publicUrl: 'Public link',
  publicUrlHint: 'Optional. The full address, starting with https://',
  brand: 'Brand',
  noBrand: 'No brand',
  owner: 'Owner',
  backup: 'Backup administrator',
  backupHint: 'Must be a different person from the owner.',
  choose: 'Choose…',
  noPeople: 'You cannot see the people list, so you cannot choose a person here.',
  details: 'Details and owner',
  saveDetails: 'Save details',
  saveStatus: 'Save status',
  saveBackup: 'Save backup administrator',
  channel: 'Engine channel',
  channelHint:
    'The page or profile in the publishing engine that this account posts through. Without it nothing can be published.',
  noChannel: 'Not connected',
  channelTaken: ' (linked to another account)',
  channelDisabled: ' (disabled in the engine)',
  saveChannel: 'Save engine channel',
  channelsError: 'Engine channels could not be loaded',
  cancel: 'Cancel',
  close: 'Close',
  save: 'Register',
  saving: 'Saving…',
  saved: 'Saved. The list was read again from DCC.',
};

/**
 * `GET/POST /api/social-accounts`, `PATCH /:id`, `PATCH /:id/status`, `PATCH /:id/backup-admin`,
 * `PATCH /:id/engine-channel`, `GET /api/engine/status`, `GET /api/engine/channels`.
 */
export function AccountsScreen() {
  const { companyId, companyName, can, companiesWhere, personName } = useWorkspace();
  const accounts = useApiData<SocialAccountDto[]>('/social-accounts');
  const engine = useApiData<EngineStatusDto>('/engine/status');
  const [platform, setPlatform] = useState('');
  const [query, setQuery] = useState('');
  const [managingId, setManagingId] = useState<string | null>(null);
  const [registering, setRegistering] = useState(false);

  const scoped = (accounts.data ?? []).filter((item) => !companyId || item.companyId === companyId);
  const visible = scoped.filter(
    (item) =>
      (!platform || item.platform === platform) &&
      `${item.displayName} ${item.handle} ${companyName(item.companyId)}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const managing = scoped.find((item) => item.id === managingId) ?? null;
  const manageCompanies = companiesWhere('account.manage');

  return (
    <>
      <PageTitle
        title={TEXT.title}
        description={TEXT.description}
        action={
          manageCompanies.length > 0 && (
            <button className="btn btn-primary" onClick={() => setRegistering(true)}>
              {TEXT.register}
            </button>
          )
        }
      />
      <ErrorBox error={accounts.error} loading />
      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <StatCard
          label={TEXT.inView}
          value={String(scoped.length)}
          foot={TEXT.inViewFoot}
          icon="◎"
        />
        <StatCard
          label={TEXT.active}
          value={String(scoped.filter((item) => item.status === 'active').length)}
          foot={TEXT.activeFoot}
          icon="✓"
        />
        <StatCard
          label={TEXT.attention}
          value={String(scoped.filter((item) => item.status === 'needs_attention').length)}
          foot={TEXT.attentionFoot}
          icon="!"
        />
        <StatCard
          label={TEXT.notConnected}
          value={String(scoped.filter((item) => !item.engineChannelId).length)}
          foot={TEXT.notConnectedFoot}
          icon="⌁"
        />
      </div>
      {engine.data && (
        <div className="demo-banner" role="note">
          <span aria-hidden="true">ⓘ</span>
          <div>
            <strong>
              {TEXT.engineProvider(engine.data.provider)} ·{' '}
              {engine.data.verification === 'verified' ? TEXT.verified : TEXT.unverified} ·{' '}
              {engine.data.canPublish ? TEXT.canPublish : TEXT.cannotPublish}
            </strong>
            {engine.data.notes.join(' ')}
          </div>
        </div>
      )}
      <div className="filter-row">
        <select
          className="select-field"
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
          aria-label={TEXT.filterPlatform}
        >
          <option value="">{TEXT.allPlatforms}</option>
          {SOCIAL_PLATFORMS.map((value) => (
            <option key={value} value={value}>
              {PLATFORM_LABELS[value]}
            </option>
          ))}
        </select>
        <input
          className="field"
          style={{ maxWidth: 230 }}
          placeholder={TEXT.search}
          aria-label={TEXT.search}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <SectionPanel title={TEXT.registry} subtitle={TEXT.registrySubtitle(visible.length)}>
        {!accounts.data && accounts.loading ? (
          <LoadingState />
        ) : (
          <DataTable
            caption={TEXT.caption}
            rows={visible}
            rowKey={(row) => row.id}
            empty={<EmptyState title={TEXT.emptyTitle}>{TEXT.emptyBody}</EmptyState>}
            columns={[
              {
                header: TEXT.account,
                cell: (row) => (
                  <>
                    <span className="account-icon" aria-hidden="true">
                      {row.platform.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="post-title">{row.displayName}</span>
                    <span className="subline">
                      {PLATFORM_LABELS[row.platform]} · {row.handle}
                    </span>
                  </>
                ),
              },
              { header: TEXT.company, cell: (row) => companyName(row.companyId) },
              {
                header: TEXT.people,
                cell: (row) => (
                  <>
                    {personName(row.ownerUserId)}
                    <span className="subline">
                      {row.backupAdminUserId ? personName(row.backupAdminUserId) : TEXT.noBackup}
                    </span>
                  </>
                ),
              },
              {
                header: TEXT.engine,
                cell: (row) => (
                  <StatusChip
                    label={row.engineChannelId ? TEXT.linked : TEXT.unlinked}
                    tone={row.engineChannelId ? 'green' : 'amber'}
                  />
                ),
              },
              {
                header: TEXT.status,
                cell: (row) => <StatusChip status={ACCOUNT_STATUS[row.status]} />,
              },
              {
                header: TEXT.actions,
                cell: (row) =>
                  can('account.manage', row.companyId) ? (
                    <button
                      className="text-link"
                      aria-label={TEXT.manageLabel(row.displayName)}
                      onClick={() => setManagingId(row.id)}
                    >
                      {TEXT.manage}
                    </button>
                  ) : null,
              },
            ]}
          />
        )}
      </SectionPanel>
      {registering && (
        <RegisterDialog
          onClose={() => setRegistering(false)}
          onSaved={() => {
            setRegistering(false);
            accounts.reload();
          }}
        />
      )}
      {managing && (
        <ManageDialog
          account={managing}
          onClose={() => setManagingId(null)}
          onChanged={accounts.reload}
        />
      )}
    </>
  );
}

function PersonSelect({
  value,
  onChange,
  optional = false,
  control,
}: {
  value: string;
  onChange: (value: string) => void;
  optional?: boolean;
  control: object;
}) {
  const { people } = useWorkspace();
  return (
    <select
      className="select-field"
      {...control}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{optional ? TEXT.noBackup : TEXT.choose}</option>
      {(people ?? []).map((person) => (
        <option key={person.id} value={person.id}>
          {person.displayName || person.email} ({person.email})
        </option>
      ))}
    </select>
  );
}

function RegisterDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { companiesWhere, people } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const companies = companiesWhere('account.manage');
  const [form, setForm] = useState({
    companyId: companies[0]?.id ?? '',
    platform: SOCIAL_PLATFORMS[0] as string,
    displayName: '',
    handle: '',
    publicUrl: '',
    brandId: '',
    ownerUserId: '',
    backupAdminUserId: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const brands = useApiData<BrandDto[]>(
    form.companyId ? `/companies/${form.companyId}/brands` : null,
  );
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const shape = CreateSocialAccountRequest.shape;

  const submit = async () => {
    const checked = validate(CreateSocialAccountRequest, blankToUndefined(form));
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() => apiSend('POST', '/social-accounts', checked.data));
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.saved);
    onSaved();
  };

  return (
    <Dialog title={TEXT.dialogRegister} onClose={onClose} wide>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        {!people && <p>{TEXT.noPeople}</p>}
        <div className="grid grid-2">
          <FormField label={TEXT.company} error={errors.companyId} required>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={form.companyId}
                onChange={(event) => {
                  set('companyId')(event.target.value);
                  set('brandId')('');
                }}
              >
                {companies.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={TEXT.platform} error={errors.platform} required>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={form.platform}
                onChange={(event) => set('platform')(event.target.value)}
              >
                {SOCIAL_PLATFORMS.map((value) => (
                  <option key={value} value={value}>
                    {PLATFORM_LABELS[value]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={TEXT.displayName} error={errors.displayName} required>
            {(control) => (
              <input
                className="field"
                {...control}
                value={form.displayName}
                maxLength={maxLengthOf(shape.displayName)}
                onChange={(event) => set('displayName')(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={TEXT.handle} error={errors.handle} required>
            {(control) => (
              <input
                className="field"
                {...control}
                value={form.handle}
                maxLength={maxLengthOf(shape.handle)}
                onChange={(event) => set('handle')(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={TEXT.publicUrl} hint={TEXT.publicUrlHint} error={errors.publicUrl}>
            {(control) => (
              <input
                className="field"
                type="url"
                {...control}
                value={form.publicUrl}
                onChange={(event) => set('publicUrl')(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={TEXT.brand} error={errors.brandId}>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={form.brandId}
                onChange={(event) => set('brandId')(event.target.value)}
              >
                <option value="">{TEXT.noBrand}</option>
                {(brands.data ?? []).map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={TEXT.owner} error={errors.ownerUserId} required>
            {(control) => (
              <PersonSelect
                control={control}
                value={form.ownerUserId}
                onChange={set('ownerUserId')}
              />
            )}
          </FormField>
          <FormField label={TEXT.backup} hint={TEXT.backupHint} error={errors.backupAdminUserId}>
            {(control) => (
              <PersonSelect
                control={control}
                optional
                value={form.backupAdminUserId}
                onChange={set('backupAdminUserId')}
              />
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

function ManageDialog({
  account,
  onClose,
  onChanged,
}: {
  account: SocialAccountDto;
  onClose: () => void;
  onChanged: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const channels = useApiData<EngineChannelDto[]>('/engine/channels');
  const [details, setDetails] = useState({
    displayName: account.displayName,
    handle: account.handle,
    publicUrl: account.publicUrl ?? '',
    ownerUserId: account.ownerUserId ?? '',
  });
  const [status, setStatus] = useState<string>(account.status);
  const [backup, setBackup] = useState(account.backupAdminUserId ?? '');
  const [channel, setChannel] = useState(account.engineChannelId ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const base = `/social-accounts/${account.id}`;

  /** Check with the contract's schema, send, then re-read the list from the API. */
  const save = async (
    checked: { ok: true; data: unknown } | { ok: false; errors: FieldErrors },
    path: string,
  ) => {
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() => apiSend('PATCH', path, checked.data));
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.saved);
    onChanged();
    channels.reload();
  };
  const setDetail = (key: keyof typeof details) => (value: string) =>
    setDetails((current) => ({ ...current, [key]: value }));
  const shape = UpdateSocialAccountRequest.shape;

  return (
    <Dialog title={TEXT.dialogManage(account.displayName)} onClose={onClose} wide>
      <ErrorBox error={action.error} />
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save(
            validate(UpdateSocialAccountRequest, {
              displayName: details.displayName,
              handle: details.handle,
              publicUrl: details.publicUrl.trim() === '' ? null : details.publicUrl,
              ownerUserId: details.ownerUserId || undefined,
            }),
            base,
          );
        }}
      >
        <h3 className="label">{TEXT.details}</h3>
        <div className="grid grid-2">
          <FormField label={TEXT.displayName} error={errors.displayName} required>
            {(control) => (
              <input
                className="field"
                {...control}
                value={details.displayName}
                maxLength={maxLengthOf(shape.displayName)}
                onChange={(event) => setDetail('displayName')(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={TEXT.handle} error={errors.handle} required>
            {(control) => (
              <input
                className="field"
                {...control}
                value={details.handle}
                maxLength={maxLengthOf(shape.handle)}
                onChange={(event) => setDetail('handle')(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={TEXT.publicUrl} hint={TEXT.publicUrlHint} error={errors.publicUrl}>
            {(control) => (
              <input
                className="field"
                type="url"
                {...control}
                value={details.publicUrl}
                onChange={(event) => setDetail('publicUrl')(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={TEXT.owner} error={errors.ownerUserId} required>
            {(control) => (
              <PersonSelect
                control={control}
                value={details.ownerUserId}
                onChange={setDetail('ownerUserId')}
              />
            )}
          </FormField>
        </div>
        <button type="submit" className="btn btn-outline" disabled={action.busy}>
          {TEXT.saveDetails}
        </button>
      </form>
      <hr style={{ margin: '18px 0', border: 0, borderTop: '1px solid #e8edf2' }} />
      <div className="grid grid-2">
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save(validate(SetAccountStatusRequest, { status }), `${base}/status`);
          }}
        >
          <FormField label={TEXT.status} error={errors.status}>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                {SOCIAL_ACCOUNT_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {ACCOUNT_STATUS[value].label}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <button type="submit" className="btn btn-outline" disabled={action.busy}>
            {TEXT.saveStatus}
          </button>
        </form>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void save(
              validate(SetAccountBackupAdminRequest, { backupAdminUserId: backup || undefined }),
              `${base}/backup-admin`,
            );
          }}
        >
          <FormField label={TEXT.backup} hint={TEXT.backupHint} error={errors.backupAdminUserId}>
            {(control) => <PersonSelect control={control} value={backup} onChange={setBackup} />}
          </FormField>
          <button type="submit" className="btn btn-outline" disabled={action.busy}>
            {TEXT.saveBackup}
          </button>
        </form>
      </div>
      <hr style={{ margin: '18px 0', border: 0, borderTop: '1px solid #e8edf2' }} />
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void save(
            validate(LinkEngineChannelRequest, { engineChannelId: channel || null }),
            `${base}/engine-channel`,
          );
        }}
      >
        <ErrorBox error={channels.error} title={TEXT.channelsError} loading />
        <FormField label={TEXT.channel} hint={TEXT.channelHint} error={errors.engineChannelId}>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={channel}
              onChange={(event) => setChannel(event.target.value)}
            >
              <option value="">{TEXT.noChannel}</option>
              {(channels.data ?? []).map((item) => (
                <option key={item.engineChannelId} value={item.engineChannelId}>
                  {item.name}
                  {item.platform ? ` · ${PLATFORM_LABELS[item.platform]}` : ''}
                  {item.linkedAccountId && item.linkedAccountId !== account.id
                    ? TEXT.channelTaken
                    : ''}
                  {item.disabled ? TEXT.channelDisabled : ''}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <button type="submit" className="btn btn-outline" disabled={action.busy}>
          {TEXT.saveChannel}
        </button>
      </form>
      <DialogActions>
        <button type="button" className="btn btn-primary" onClick={onClose}>
          {TEXT.close}
        </button>
      </DialogActions>
    </Dialog>
  );
}
