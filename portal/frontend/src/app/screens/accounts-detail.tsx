'use client';

import { useMemo, useState } from 'react';
import {
  AssignAccountRequest,
  ROLE_LABELS,
  SOCIAL_ACCOUNT_STATUSES,
  SetAccountBackupAdminRequest,
  SetAccountStatusRequest,
  UpdateSocialAccountRequest,
  type AccountAssignmentDto,
  type BrandDto,
  type EngineChannelDto,
  type EngineStatusDto,
  type IncidentDto,
  type PublicationDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { EmptyState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { DataGrid, type GridColumn } from '@/components/kit/data-grid';
import { PageHeader } from '@/components/kit/page-header';
import { Callout, CopyId, DescriptionList, Fact } from '@/components/kit/parts';
import { TabPanel, Tabs, useTabParam, type TabDef } from '@/components/kit/tabs';
import { useToast } from '@/components/toast';
import { apiSend } from '@/lib/browser-api';
import { fieldErrorsFromApi, maxLengthOf, validate, type FieldErrors } from '@/lib/forms';
import { ACCOUNT_STATUS, PLATFORM_LABELS } from '@/lib/labels';
import { needsRoleHint } from '@/lib/permissions-ui';
import { useAction, useApiData, type ApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { PersonSelect } from './accounts-dialogs';
import {
  AccountIncidentsTab,
  AnalyticsTab,
  EngineTab,
  PublicationsTab,
} from './accounts-detail-tabs';
import { GAP_LABELS, accountGaps, type AccountGap } from './accounts-grid';
import {
  CompanyLink,
  ConfirmDialog,
  FactStrip,
  GatedButton,
  LoadingBlock,
  NoAccessNote,
  PersonName,
  PlatformBadge,
  ViewOnlyNote,
  isPracticeChannel,
} from './registry-shared';
import './accounts-screen.css';

const TEXT = {
  accounts: 'Social accounts',
  notFoundTitle: 'This account is not available',
  notFoundBody:
    'It does not exist, or it belongs to a company your role does not reach. Accounts you cannot see are never listed.',
  backToList: 'Back to all accounts',
  loadError: 'The account could not be loaded',
  description: (platform: string, company: string) =>
    `An official ${platform} account of ${company}: who owns it, who works on it, how it is connected for publishing and what has happened to it.`,
  publicLink: 'Public page',
  newTab: '(opens in a new tab)',
  noBrand: 'No brand',
  tabsLabel: 'Sections of this account',
  tabs: {
    profile: 'Profile',
    assignments: 'Assignments',
    engine: 'Engine link',
    publications: 'Publications',
    incidents: 'Incidents',
    analytics: 'Analytics',
  },
  linkEngine: 'Link to the engine',
  gapsTitle: 'This account has gaps in the register',
  gapsBody: 'Each gap is a risk: fix them from the tab named beside it.',
  gapFix: 'Fix it',
  // facts
  factStatus: 'Status',
  factOwner: 'Owner',
  factBackup: 'Backup administrator',
  factEngine: 'Engine',
  factEngineLinked: 'Connected',
  factEngineNot: 'Not connected',
  factEngineNoteNot: 'Cannot be published to',
  factEngineNotePractice: 'Practice channel',
  factAssigned: 'People assigned',
  factPublications: 'Publications',
  factPublicationsNote: (failed: number) => (failed === 0 ? 'None failed' : `${failed} failed`),
  factIncidents: 'Open incidents',
  missing: 'Missing',
  hidden: '—',
  // profile
  detailsTitle: 'Details',
  detailsSubtitle: 'How the account is named in DCC and where it can be found on the network.',
  displayName: 'Display name',
  displayNameHint: 'The name of the page as people see it on the network.',
  handle: 'Handle',
  handleHint: 'The @name or address on the network. With the network it must be unique in DCC.',
  publicUrl: 'Public link',
  publicUrlHint: 'Optional. The full address, starting with https://',
  brand: 'Brand',
  saveDetails: 'Save details',
  nothingChanged: 'Nothing was changed.',
  saved: 'Saved. The account was read again from DCC.',
  peopleTitle: 'People responsible',
  peopleSubtitle:
    'Every account has an owner. A backup administrator is a second person who can step in; the two must be different people.',
  owner: 'Owner',
  ownerHint: 'The person accountable for this account.',
  saveOwner: 'Save owner',
  backup: 'Backup administrator',
  backupHint: 'A backup administrator can be replaced but not removed. Must differ from the owner.',
  backupChoose: 'Choose a person…',
  saveBackup: 'Save backup administrator',
  statusTitle: 'Status',
  statusSubtitle: 'What the account may be used for right now.',
  statusLabel: 'Set the status',
  saveStatus: 'Save status',
  statusEffects: {
    active:
      'In normal use. Posts can be published to it when it is connected to the engine, and its inbox is read.',
    needs_attention:
      'Flagged for someone to look at, for example a login that stopped working. It does not block publishing; it shows in the registry gaps so the owner acts.',
    disconnected:
      'The connection to the network is lost or removed. Nothing can be published to it until the status is changed back. Its inbox is still read.',
    archived:
      'Taken out of use. Nothing is published to it, its inbox is no longer read, replies and assignments are refused, and it is left out of the registry gaps. It stays in the register for the record.',
  } satisfies Record<SocialAccountDto['status'], string>,
  confirmDisconnect: 'Mark this account as disconnected?',
  confirmArchive: 'Archive this account?',
  confirmBody: (name: string) => `What changes for ${name} the moment you confirm:`,
  recordTitle: 'Registry record',
  recordSubtitle: 'Everything DCC records about this account.',
  dlNetwork: 'Network',
  dlCompany: 'Company',
  dlBrand: 'Brand',
  dlHandle: 'Handle',
  dlPublic: 'Public link',
  dlStatus: 'Status',
  dlOwner: 'Owner',
  dlBackup: 'Backup administrator',
  dlChannel: 'Engine channel id',
  dlId: 'Account id',
  rulesTitle: 'Rules of the register',
  rules: [
    'Every account has an owner. There is no ownerless account.',
    'The backup administrator must be a different person from the owner.',
    'DCC never stores a network password or token. The only connection detail kept is the engine channel id.',
    'Every change on this page is written to the audit trail, with who did it.',
    'Another company’s account never shows here: it answers “not found”, not “not allowed”.',
  ],
  // assignments
  assignIntro:
    'Assignment is the record of who works on this account day to day. It does not give or take away any permission: access comes only from roles.',
  assignTitle: 'People assigned',
  assignCaption: 'People assigned to this account',
  assignPerson: 'Person',
  assignEmail: 'Email',
  assignRoles: 'Roles that reach this company',
  assignRemove: 'Remove',
  assignRemoveLabel: (name: string) => `Remove ${name} from this account`,
  assignNone: 'Nobody is assigned yet',
  assignNoneBody:
    'Assign the people who work on this account, for example whoever writes and publishes for it.',
  assignForm: 'Assign a person',
  assignHint: 'Choose someone who holds a role in this company; they are listed first.',
  assign: 'Assign',
  assigned: 'The person was assigned to the account.',
  unassigned: 'The assignment was removed.',
  assignError: 'The assigned people could not be loaded',
  removeTitle: 'Remove this assignment?',
  removeBody: (person: string, account: string) =>
    `${person} stops being listed as working on ${account}. Their roles and access do not change.`,
  assignHidden: 'Assignments',
  noRole: 'No role here',
  cancel: 'Cancel',
};

type TabId = keyof typeof TEXT.tabs;
const TAB_IDS = Object.keys(TEXT.tabs) as TabId[];

/** The account page. `/social-accounts/<id>`. */
export function AccountDetail({ accountId }: { accountId: string }) {
  const { open } = useWorkspace();
  const accountsApi = useApiData<SocialAccountDto[]>('/social-accounts');
  const account = accountsApi.data?.find((item) => item.id === accountId) ?? null;
  if (!accountsApi.data) {
    return (
      <>
        <ErrorBox error={accountsApi.error} title={TEXT.loadError} loading />
        {!accountsApi.error && <LoadingBlock lines={6} />}
      </>
    );
  }
  if (!account)
    return (
      <>
        <PageHeader
          title={TEXT.notFoundTitle}
          crumbs={[{ label: TEXT.accounts, onClick: () => open('accounts') }, { label: '…' }]}
        />
        <EmptyState title={TEXT.notFoundTitle}>{TEXT.notFoundBody}</EmptyState>
        <div className="rg-empty-action">
          <button type="button" className="btn btn-outline" onClick={() => open('accounts')}>
            {TEXT.backToList}
          </button>
        </div>
      </>
    );
  return <AccountHub account={account} accounts={accountsApi.data} reload={accountsApi.reload} />;
}

function AccountHub({
  account,
  accounts,
  reload,
}: {
  account: SocialAccountDto;
  accounts: SocialAccountDto[];
  reload: () => void;
}) {
  const { can, open, personName, companyName } = useWorkspace();
  const [tab, setTab] = useTabParam(TAB_IDS, 'profile');
  const mayManage = can('account.manage', account.companyId);
  const brands = useApiData<BrandDto[]>(
    can('brand.read', account.companyId) ? `/companies/${account.companyId}/brands` : null,
  );
  const engine = useApiData<EngineStatusDto>(
    can('account.read', account.companyId) ? '/engine/status' : null,
  );
  const channels = useApiData<EngineChannelDto[]>(mayManage ? '/engine/channels' : null);
  const assignments = useApiData<AccountAssignmentDto[]>(
    mayManage ? `/social-accounts/${account.id}/assignments` : null,
  );
  const publications = useApiData<PublicationDto[]>(
    can('content.read', account.companyId) ? '/publications' : null,
  );
  const incidents = useApiData<IncidentDto[]>(
    can('incident.read', account.companyId) ? '/incidents' : null,
  );

  const mine = (publications.data ?? []).filter((item) => item.socialAccountId === account.id);
  const incidentsHere = (incidents.data ?? []).filter(
    (item) => item.socialAccountId === account.id,
  );
  const openIncidents = incidentsHere.filter(
    (item) => item.status === 'open' || item.status === 'investigating',
  ).length;
  const brandName = account.brandId
    ? (brands.data?.find((item) => item.id === account.brandId)?.name ?? null)
    : null;
  const gaps = accountGaps(account);
  const gapTab = (gap: AccountGap): TabId => (gap === 'engine_channel' ? 'engine' : 'profile');

  const tabs: TabDef[] = [
    { id: 'profile', label: TEXT.tabs.profile },
    {
      id: 'assignments',
      label: TEXT.tabs.assignments,
      count: assignments.data ? assignments.data.length : null,
    },
    { id: 'engine', label: TEXT.tabs.engine },
    {
      id: 'publications',
      label: TEXT.tabs.publications,
      count: publications.data ? mine.length : null,
    },
    {
      id: 'incidents',
      label: TEXT.tabs.incidents,
      count: incidents.data ? incidentsHere.length : null,
    },
    { id: 'analytics', label: TEXT.tabs.analytics },
  ];

  return (
    <>
      <PageHeader
        eyebrow={PLATFORM_LABELS[account.platform]}
        title={account.displayName}
        description={TEXT.description(
          PLATFORM_LABELS[account.platform],
          companyName(account.companyId),
        )}
        crumbs={[
          { label: TEXT.accounts, onClick: () => open('accounts') },
          { label: account.displayName },
        ]}
        meta={
          <>
            <PlatformBadge platform={account.platform} />
            <StatusChip status={ACCOUNT_STATUS[account.status]} />
            <span className="rg-id-line">{account.handle}</span>
            {account.publicUrl && (
              <a
                className="rg-link"
                href={account.publicUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {TEXT.publicLink} ↗<span className="visually-hidden"> {TEXT.newTab}</span>
              </a>
            )}
            <CopyId value={account.id} label="Copy account id" />
            <CompanyLink companyId={account.companyId} />
          </>
        }
        actions={
          !account.engineChannelId ? (
            <GatedButton
              allowed={mayManage}
              permission="account.manage"
              compact
              className="btn btn-primary"
              onClick={() => setTab('engine')}
            >
              {TEXT.linkEngine}
            </GatedButton>
          ) : undefined
        }
        tabs={<Tabs tabs={tabs} active={tab} onChange={setTab} label={TEXT.tabsLabel} />}
      />
      <FactStrip>
        <Fact label={TEXT.factStatus} value={ACCOUNT_STATUS[account.status].label} />
        <Fact
          label={TEXT.factOwner}
          value={
            <span className="rg-fact-text">
              {account.ownerUserId ? personName(account.ownerUserId) : TEXT.missing}
            </span>
          }
        />
        <Fact
          label={TEXT.factBackup}
          value={
            <span className="rg-fact-text">
              {account.backupAdminUserId ? personName(account.backupAdminUserId) : TEXT.missing}
            </span>
          }
        />
        <Fact
          label={TEXT.factEngine}
          value={account.engineChannelId ? TEXT.factEngineLinked : TEXT.factEngineNot}
          note={
            account.engineChannelId
              ? isPracticeChannel(account.engineChannelId)
                ? TEXT.factEngineNotePractice
                : undefined
              : TEXT.factEngineNoteNot
          }
        />
        <Fact
          label={TEXT.factAssigned}
          value={assignments.data ? assignments.data.length : TEXT.hidden}
        />
        <Fact
          label={TEXT.factPublications}
          value={publications.data ? mine.length : TEXT.hidden}
          note={
            publications.data
              ? TEXT.factPublicationsNote(mine.filter((item) => item.status === 'failed').length)
              : undefined
          }
        />
        <Fact label={TEXT.factIncidents} value={incidents.data ? openIncidents : TEXT.hidden} />
      </FactStrip>
      {gaps.length > 0 && (
        <div className="rg-gap-below">
          <Callout tone="warn" title={TEXT.gapsTitle}>
            <ul className="rg-plain-list">
              {gaps.map((gap) => (
                <li key={gap}>
                  <span>{GAP_LABELS[gap]}</span>
                  <button type="button" className="text-link" onClick={() => setTab(gapTab(gap))}>
                    {TEXT.gapFix}
                  </button>
                </li>
              ))}
            </ul>
          </Callout>
        </div>
      )}
      <TabPanel id={tab}>
        {tab === 'profile' && (
          <ProfileTab
            account={account}
            brands={brands.data ?? []}
            brandName={brandName}
            mayManage={mayManage}
            onChanged={reload}
          />
        )}
        {tab === 'assignments' && (
          <AssignmentsTab account={account} assignments={assignments} mayManage={mayManage} />
        )}
        {tab === 'engine' && (
          <EngineTab
            account={account}
            accounts={accounts}
            engine={engine.data}
            channels={channels}
            mayManage={mayManage}
            onChanged={reload}
          />
        )}
        {tab === 'publications' && <PublicationsTab account={account} />}
        {tab === 'incidents' && <AccountIncidentsTab account={account} />}
        {tab === 'analytics' && <AnalyticsTab account={account} />}
      </TabPanel>
    </>
  );
}

/* ------------------------------------------------------------------ profile */

function ProfileTab({
  account,
  brands,
  brandName,
  mayManage,
  onChanged,
}: {
  account: SocialAccountDto;
  brands: BrandDto[];
  brandName: string | null;
  mayManage: boolean;
  onChanged: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const [details, setDetails] = useState({
    displayName: account.displayName,
    handle: account.handle,
    publicUrl: account.publicUrl ?? '',
    brandId: account.brandId ?? '',
  });
  const [owner, setOwner] = useState(account.ownerUserId ?? '');
  const [backup, setBackup] = useState(account.backupAdminUserId ?? '');
  const [status, setStatus] = useState<string>(account.status);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirmStatus, setConfirmStatus] = useState(false);
  const base = `/social-accounts/${account.id}`;
  const shape = UpdateSocialAccountRequest.shape;

  /** Check with the contract's schema, send, then read the account again from the API. */
  const save = async (
    checked: { ok: true; data: unknown } | { ok: false; errors: FieldErrors },
    path: string,
    method: 'PATCH' = 'PATCH',
  ) => {
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() => apiSend(method, path, checked.data));
    onChanged();
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.saved);
  };

  const saveDetails = () => {
    const patch = {
      ...(details.displayName.trim() !== account.displayName
        ? { displayName: details.displayName }
        : {}),
      ...(details.handle.trim() !== account.handle ? { handle: details.handle } : {}),
      ...(details.publicUrl.trim() !== (account.publicUrl ?? '')
        ? { publicUrl: details.publicUrl.trim() === '' ? null : details.publicUrl.trim() }
        : {}),
      ...(details.brandId !== (account.brandId ?? '')
        ? { brandId: details.brandId === '' ? null : details.brandId }
        : {}),
    };
    if (Object.keys(patch).length === 0) return setErrors({ _form: TEXT.nothingChanged });
    void save(validate(UpdateSocialAccountRequest, patch), base);
  };

  const risky = status === 'disconnected' || status === 'archived';

  return (
    <div className="kit-split">
      <div className="rg-stack">
        {!mayManage && <ViewOnlyNote permission="account.manage" />}
        <ErrorBox error={action.error} />
        <SectionPanel title={TEXT.detailsTitle} subtitle={TEXT.detailsSubtitle}>
          {mayManage ? (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                saveDetails();
              }}
            >
              {errors._form && (
                <small className="field-error" role="alert">
                  {errors._form}
                </small>
              )}
              <div className="grid grid-2">
                <FormField
                  label={TEXT.displayName}
                  hint={TEXT.displayNameHint}
                  error={errors.displayName}
                  required
                >
                  {(control) => (
                    <input
                      className="field"
                      {...control}
                      value={details.displayName}
                      maxLength={maxLengthOf(shape.displayName)}
                      onChange={(event) =>
                        setDetails((now) => ({ ...now, displayName: event.target.value }))
                      }
                    />
                  )}
                </FormField>
                <FormField
                  label={TEXT.handle}
                  hint={TEXT.handleHint}
                  error={errors.handle}
                  required
                >
                  {(control) => (
                    <input
                      className="field"
                      {...control}
                      value={details.handle}
                      maxLength={maxLengthOf(shape.handle)}
                      onChange={(event) =>
                        setDetails((now) => ({ ...now, handle: event.target.value }))
                      }
                    />
                  )}
                </FormField>
                <FormField
                  label={TEXT.publicUrl}
                  hint={TEXT.publicUrlHint}
                  error={errors.publicUrl}
                >
                  {(control) => (
                    <input
                      className="field"
                      type="url"
                      {...control}
                      value={details.publicUrl}
                      onChange={(event) =>
                        setDetails((now) => ({ ...now, publicUrl: event.target.value }))
                      }
                    />
                  )}
                </FormField>
                <FormField label={TEXT.brand} error={errors.brandId}>
                  {(control) => (
                    <select
                      className="select-field"
                      {...control}
                      value={details.brandId}
                      onChange={(event) =>
                        setDetails((now) => ({ ...now, brandId: event.target.value }))
                      }
                    >
                      <option value="">{TEXT.noBrand}</option>
                      {brands.map((brand) => (
                        <option key={brand.id} value={brand.id}>
                          {brand.name}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              </div>
              <button type="submit" className="btn btn-primary" disabled={action.busy}>
                {TEXT.saveDetails}
              </button>
            </form>
          ) : (
            <DescriptionList
              items={[
                { label: TEXT.displayName, value: account.displayName },
                { label: TEXT.handle, value: account.handle },
                { label: TEXT.publicUrl, value: account.publicUrl },
                { label: TEXT.brand, value: brandName ?? TEXT.noBrand },
              ]}
            />
          )}
        </SectionPanel>
        <SectionPanel title={TEXT.peopleTitle} subtitle={TEXT.peopleSubtitle}>
          {mayManage ? (
            <div className="rg-two">
              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(
                    validate(UpdateSocialAccountRequest, { ownerUserId: owner || undefined }),
                    base,
                  );
                }}
              >
                <FormField label={TEXT.owner} hint={TEXT.ownerHint} error={errors.ownerUserId}>
                  {(control) => (
                    <PersonSelect
                      control={control}
                      companyId={account.companyId}
                      value={owner}
                      onChange={setOwner}
                    />
                  )}
                </FormField>
                <button
                  type="submit"
                  className="btn btn-outline"
                  disabled={action.busy || owner === (account.ownerUserId ?? '')}
                >
                  {TEXT.saveOwner}
                </button>
              </form>
              <form
                noValidate
                onSubmit={(event) => {
                  event.preventDefault();
                  void save(
                    validate(SetAccountBackupAdminRequest, {
                      backupAdminUserId: backup || undefined,
                    }),
                    `${base}/backup-admin`,
                  );
                }}
              >
                <FormField
                  label={TEXT.backup}
                  hint={TEXT.backupHint}
                  error={errors.backupAdminUserId}
                >
                  {(control) => (
                    <PersonSelect
                      control={control}
                      companyId={account.companyId}
                      value={backup}
                      onChange={setBackup}
                      emptyLabel={TEXT.backupChoose}
                      exclude={account.ownerUserId ? [account.ownerUserId] : []}
                    />
                  )}
                </FormField>
                <button
                  type="submit"
                  className="btn btn-outline"
                  disabled={action.busy || backup === (account.backupAdminUserId ?? '')}
                >
                  {TEXT.saveBackup}
                </button>
              </form>
            </div>
          ) : (
            <DescriptionList
              items={[
                {
                  label: TEXT.owner,
                  value: <PersonName userId={account.ownerUserId} emptyText={TEXT.missing} />,
                },
                {
                  label: TEXT.backup,
                  value: <PersonName userId={account.backupAdminUserId} emptyText={TEXT.missing} />,
                },
              ]}
            />
          )}
        </SectionPanel>
        <SectionPanel title={TEXT.statusTitle} subtitle={TEXT.statusSubtitle}>
          {mayManage && (
            <form
              noValidate
              onSubmit={(event) => {
                event.preventDefault();
                const checked = validate(SetAccountStatusRequest, { status });
                if (!checked.ok) return setErrors(checked.errors);
                if (risky && status !== account.status) return setConfirmStatus(true);
                void save(checked, `${base}/status`);
              }}
            >
              <FormField label={TEXT.statusLabel} error={errors.status}>
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
              <button
                type="submit"
                className="btn btn-outline"
                disabled={action.busy || status === account.status}
              >
                {TEXT.saveStatus}
              </button>
            </form>
          )}
          <ul className="rg-explain" data-current="" style={{ marginTop: mayManage ? 16 : 0 }}>
            {SOCIAL_ACCOUNT_STATUSES.map((value) => (
              <li key={value} aria-current={value === account.status ? 'true' : undefined}>
                <span>
                  <StatusChip status={ACCOUNT_STATUS[value]} />
                </span>
                <span>{TEXT.statusEffects[value]}</span>
              </li>
            ))}
          </ul>
        </SectionPanel>
      </div>
      <div className="rg-stack">
        <SectionPanel title={TEXT.recordTitle} subtitle={TEXT.recordSubtitle}>
          <DescriptionList
            columns={1}
            items={[
              { label: TEXT.dlNetwork, value: PLATFORM_LABELS[account.platform] },
              { label: TEXT.dlCompany, value: <CompanyLink companyId={account.companyId} /> },
              { label: TEXT.dlBrand, value: brandName ?? TEXT.noBrand },
              { label: TEXT.dlHandle, value: account.handle },
              {
                label: TEXT.dlPublic,
                value: account.publicUrl ? (
                  <a
                    className="rg-link"
                    href={account.publicUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {account.publicUrl}
                  </a>
                ) : null,
              },
              {
                label: TEXT.dlStatus,
                value: <StatusChip status={ACCOUNT_STATUS[account.status]} />,
              },
              {
                label: TEXT.dlOwner,
                value: <PersonName userId={account.ownerUserId} emptyText={TEXT.missing} />,
              },
              {
                label: TEXT.dlBackup,
                value: <PersonName userId={account.backupAdminUserId} emptyText={TEXT.missing} />,
              },
              {
                label: TEXT.dlChannel,
                value: account.engineChannelId ? (
                  <CopyId value={account.engineChannelId} label="Copy channel id" />
                ) : null,
              },
              { label: TEXT.dlId, value: <CopyId value={account.id} label="Copy account id" /> },
            ]}
          />
        </SectionPanel>
        <SectionPanel title={TEXT.rulesTitle}>
          <ul className="rg-plain-list">
            {TEXT.rules.map((rule) => (
              <li key={rule}>
                <span>{rule}</span>
              </li>
            ))}
          </ul>
        </SectionPanel>
      </div>
      {confirmStatus && (
        <ConfirmDialog
          title={status === 'archived' ? TEXT.confirmArchive : TEXT.confirmDisconnect}
          confirmLabel={TEXT.saveStatus}
          danger
          onClose={() => setConfirmStatus(false)}
          onConfirm={async () => {
            await apiSend('PATCH', `${base}/status`, { status });
            onChanged();
            showToast(TEXT.saved);
          }}
        >
          <p>{TEXT.confirmBody(account.displayName)}</p>
          <p>{TEXT.statusEffects[status as SocialAccountDto['status']]}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ assignments */

function AssignmentsTab({
  account,
  assignments,
  mayManage,
}: {
  account: SocialAccountDto;
  assignments: ApiData<AccountAssignmentDto[]>;
  mayManage: boolean;
}) {
  const { people, personName } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const [person, setPerson] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [removing, setRemoving] = useState<AccountAssignmentDto | null>(null);
  const rows = assignments.data ?? [];
  const base = `/social-accounts/${account.id}/assignments`;

  const assign = async () => {
    const checked = validate(AssignAccountRequest, { userId: person || undefined });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() => apiSend('POST', base, checked.data));
    assignments.reload();
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    setPerson('');
    showToast(TEXT.assigned);
  };

  const columns = useMemo<GridColumn<AccountAssignmentDto>[]>(
    () => [
      {
        id: 'person',
        header: TEXT.assignPerson,
        sortValue: (row) => personName(row.userId),
        exportValue: (row) => personName(row.userId),
        cell: (row) => (
          <span className="post-title">
            <PersonName userId={row.userId} />
          </span>
        ),
      },
      {
        id: 'email',
        header: TEXT.assignEmail,
        sortValue: (row) => people?.find((item) => item.id === row.userId)?.email ?? '',
        exportValue: (row) => people?.find((item) => item.id === row.userId)?.email ?? '',
        cell: (row) => people?.find((item) => item.id === row.userId)?.email ?? '—',
      },
      {
        id: 'roles',
        header: TEXT.assignRoles,
        exportValue: (row) =>
          (people?.find((item) => item.id === row.userId)?.memberships ?? [])
            .filter((m) => m.companyId === null || m.companyId === account.companyId)
            .map((m) => ROLE_LABELS[m.role])
            .join('; '),
        cell: (row) => {
          const roles = (people?.find((item) => item.id === row.userId)?.memberships ?? []).filter(
            (m) => m.companyId === null || m.companyId === account.companyId,
          );
          return roles.length === 0 ? (
            <span className="rg-muted">{TEXT.noRole}</span>
          ) : (
            <span className="rg-chips">
              {roles.map((m) => (
                <StatusChip key={m.id} label={ROLE_LABELS[m.role]} tone="blue" />
              ))}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        cell: (row) => (
          <GatedButton
            allowed={mayManage}
            permission="account.manage"
            compact
            className="text-link"
            label={TEXT.assignRemoveLabel(personName(row.userId))}
            onClick={() => setRemoving(row)}
          >
            {TEXT.assignRemove}
          </GatedButton>
        ),
      },
    ],
    [people, personName, mayManage, account.companyId],
  );

  if (!mayManage) return <NoAccessNote permission="account.manage" what={TEXT.assignHidden} />;
  return (
    <div className="rg-stack">
      <p className="rg-tab-intro">{TEXT.assignIntro}</p>
      <ErrorBox error={assignments.error} title={TEXT.assignError} loading />
      <ErrorBox error={action.error} />
      <div className="kit-split">
        <SectionPanel title={TEXT.assignTitle}>
          {!assignments.data ? (
            !assignments.error && <LoadingBlock lines={3} />
          ) : (
            <DataGrid
              caption={TEXT.assignCaption}
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              defaultSort={{ id: 'person', direction: 'asc' }}
              empty={<EmptyState title={TEXT.assignNone}>{TEXT.assignNoneBody}</EmptyState>}
            />
          )}
        </SectionPanel>
        <SectionPanel title={TEXT.assignForm}>
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void assign();
            }}
          >
            <FormField label={TEXT.assignPerson} hint={TEXT.assignHint} error={errors.userId}>
              {(control) => (
                <PersonSelect
                  control={control}
                  companyId={account.companyId}
                  value={person}
                  onChange={setPerson}
                  exclude={rows.map((row) => row.userId)}
                />
              )}
            </FormField>
            {!people && <p className="rg-note">{needsRoleHint('user.read')}</p>}
            <button type="submit" className="btn btn-primary" disabled={action.busy || !person}>
              {TEXT.assign}
            </button>
          </form>
        </SectionPanel>
      </div>
      {removing && (
        <ConfirmDialog
          title={TEXT.removeTitle}
          confirmLabel={TEXT.assignRemove}
          danger
          onClose={() => setRemoving(null)}
          onConfirm={async () => {
            await apiSend('DELETE', `${base}/${removing.userId}`);
            assignments.reload();
            showToast(TEXT.unassigned);
          }}
        >
          <p>{TEXT.removeBody(personName(removing.userId), account.displayName)}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}
