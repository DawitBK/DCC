'use client';

import { useMemo, useState } from 'react';
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  ROLE_LABELS,
  ROLES,
  type ApprovalPolicyDto,
  type BrandDto,
  type CompanyDto,
  type ContentCategoryDto,
  type EngineStatusDto,
  type FreezeWithLiftDto,
  type IncidentDto,
  type InboxMessageDto,
  type InboxSettingsDto,
  type MembershipRecordDto,
  type NotificationDto,
  type OperationsOverviewDto,
  type SocialAccountDto,
  type UserDto,
} from '@dcc/contracts';
import { EmptyState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { TargetForm } from '@/components/inbox-response-targets';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { DataGrid, type GridColumn, type GridFilter } from '@/components/kit/data-grid';
import { PageHeader } from '@/components/kit/page-header';
import { BarList, Callout, CopyId, DescriptionList, Fact } from '@/components/kit/parts';
import { TabPanel, Tabs, useTabParam, type TabDef } from '@/components/kit/tabs';
import { useToast } from '@/components/toast';
import { canAtGroup } from '@/lib/access';
import { apiSend, queryString } from '@/lib/browser-api';
import { formatDateTime, formatDuration } from '@/lib/format';
import {
  ACCOUNT_STATUS,
  COMPANY_STATUS,
  CONTENT_STATUS,
  INCIDENT_SEVERITY,
  INCIDENT_STATUS,
  NOTIFICATION_EVENT_LABELS,
  PUBLICATION_STATUS,
  labelFrom,
  type StatusLabel,
} from '@/lib/labels';
import { needsRoleHint } from '@/lib/permissions-ui';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { GrantDialog, RemoveRoleDialog } from './access-dialogs';
import { RegisterDialog } from './accounts-dialogs';
import { FreezeLiftPanel, TWO_PEOPLE_CHIP } from '@/components/freeze-lift';
import { AccountsGrid, GAP_LABELS, accountGaps, type AccountGap } from './accounts-grid';
import { CompanyForm, FreezeDialog, type CompanyEditing } from './companies-forms';
import {
  AccountLink,
  ConfirmDialog,
  FactStrip,
  GatedButton,
  LoadingBlock,
  MembershipLine,
  NoAccessNote,
  PersonName,
  RecordLink,
  ViewOnlyNote,
} from './registry-shared';

const TEXT = {
  companies: 'Companies',
  notFoundTitle: 'This company is not available',
  notFoundBody:
    'It does not exist, or your role does not reach it. Companies you cannot see are never listed, and asking for one by address looks the same as asking for one that is not there.',
  backToList: 'Back to all companies',
  descriptionFor: (slug: string) =>
    `Everything about this company in one place. Its short name in links is “${slug}”.`,
  edit: 'Edit company',
  editReason: 'Only a Group administrator can rename, suspend or archive a company.',
  addBrand: '＋ Add brand',
  registerAccount: '＋ Register account',
  freezePublishing: 'Freeze publishing',
  tabsLabel: 'Sections of this company',
  tabs: {
    overview: 'Overview',
    brands: 'Brands',
    accounts: 'Accounts',
    people: 'People',
    rules: 'Rules',
    publishing: 'Publishing',
    inbox: 'Inbox',
    incidents: 'Incidents',
  },
  // facts
  factStatus: 'Status',
  factBrands: 'Brands',
  factAccounts: 'Social accounts',
  factAccountsNote: (gaps: number) => (gaps === 0 ? 'Registry complete' : `${gaps} with gaps`),
  factContent: 'Content',
  factContentNote: (review: number) => (review === 0 ? 'None in review' : `${review} in review`),
  factPublications: 'Publications',
  factPublicationsNote: (failed: number) => (failed === 0 ? 'None failed' : `${failed} failed`),
  factIncidents: 'Open incidents',
  factPeople: 'People with a role here',
  factPeopleNote: 'Company roles, not group roles',
  factPublishing: 'Publishing',
  hidden: '—',
  noFigure: 'Needs permission to see reports',
  frozenWhole: 'Frozen',
  freezesSome: (count: number) => (count === 1 ? '1 account frozen' : `${count} accounts frozen`),
  open: 'Open',
  blocked: 'Cannot publish',
  // overview
  attentionTitle: 'Needs attention',
  attentionOk: 'Nothing needs attention',
  attentionOkBody: 'The company is active, its registry is complete and nothing is frozen or open.',
  notActive: (status: string) => `This company is ${status}: nothing can be published for it.`,
  wholeFrozen: 'Publishing is frozen for the whole company.',
  accountFrozen: (count: number) =>
    count === 1
      ? '1 account has a publishing freeze.'
      : `${count} accounts have a publishing freeze.`,
  gapsText: (count: number, what: string) =>
    count === 1 ? `1 account: ${what.toLowerCase()}.` : `${count} accounts: ${what.toLowerCase()}.`,
  incidentsText: (count: number) =>
    count === 1
      ? '1 incident is open or being investigated.'
      : `${count} incidents are open or being investigated.`,
  noTarget: 'No response target is set, so no inbox message is ever marked overdue.',
  seeIt: 'Open',
  opsTitle: 'Operations overview',
  opsSubtitle: 'Counts of what DCC records for this company. These are not engagement figures.',
  opsAccounts: 'Accounts by status',
  opsContent: 'Content by status',
  opsPublications: 'Publications by status',
  opsIncidents: 'Incidents by status',
  opsNone: 'Nothing recorded yet.',
  companyTitle: 'About this company',
  dlName: 'Name',
  dlSlug: 'Short name',
  dlSlugHint: 'Used in links. It cannot be changed.',
  dlStatus: 'Status',
  dlGroup: 'Group',
  dlId: 'Company id',
  dlBrands: 'Brands',
  dlPeople: 'People with a role here',
  dlRule: 'Approval rule',
  dlTarget: 'Inbox response target',
  noTargetShort: 'None',
  ruleDefault: (count: number, roles: string) =>
    `${count} ${count === 1 ? 'approval' : 'approvals'} · ${roles}`,
  ruleBuiltIn: '1 approval by any approver (built-in default)',
  anyApprover: 'any role that may approve',
  minutes: (n: number) => `${n} min (${formatDuration(n * 60)})`,
  notificationsTitle: 'Your recent notifications here',
  notificationsSubtitle: 'Personal: only you see these. They are about this company.',
  notificationsNone: 'No notifications about this company yet.',
  notificationNew: 'New',
  allNotifications: 'All notifications',
  // brands
  brandsIntro:
    'Brands group a company’s accounts and posts, for example one product line. A brand has no status of its own and cannot be removed once added; it can be renamed.',
  brandName: 'Brand',
  brandSlug: 'Short name',
  brandAccounts: 'Accounts using it',
  rename: 'Rename',
  renameLabel: (name: string) => `Rename brand ${name}`,
  brandsEmpty: 'No brands yet',
  brandsEmptyBody: 'Add a brand to group accounts and posts, for example one product line.',
  brandsCaption: 'Brands of this company',
  brandError: 'Brands could not be loaded',
  // accounts
  accountsIntro:
    'The official accounts of this company. Open one to see who owns it, who works on it, which engine channel it posts through and how it is doing.',
  accountsEmpty: 'No accounts registered for this company',
  accountsEmptyBody:
    'Register the company’s official pages and profiles so posts can be approved and published through DCC.',
  accountsError: 'Accounts could not be loaded',
  allAccounts: 'Open the full register',
  // people
  peopleIntro:
    'Everyone who can act in this company: people with a role in this company, and people whose group-level role reaches every company of the Group.',
  giveRole: '＋ Give a role here',
  giveRoleReason: 'Giving a role needs the right to give and remove roles in this company.',
  person: 'Person',
  rolesHere: 'Roles in this company',
  rolesGroup: 'Group-level roles that reach it',
  statusCol: 'Status',
  noneHere: 'None',
  remove: 'Remove',
  removeLabel: (role: string, person: string) => `Remove the role ${role} from ${person}`,
  removeNotAllowed: 'Needs the right to give and remove roles here.',
  removeSelf:
    'Roles you hold yourself are not removed from this screen, so you cannot lock yourself out by accident. Another administrator can remove them.',
  removeSso:
    'This role comes from the Group’s SSO and is renewed at every sign-in. Change it in the SSO instead.',
  peopleEmpty: 'Nobody holds a role in this company yet',
  peopleEmptyBody:
    'Give someone a role so they can work here. A person must have signed in to DCC once.',
  peopleHidden: 'People and roles',
  rolesChart: 'Roles held in this company',
  filterRole: 'Role',
  filterSource: 'Set by',
  filterStatus: 'Status',
  optDcc: 'DCC',
  optSso: 'The SSO',
  optActive: 'Active',
  optDisabled: 'Disabled',
  peopleCaption: 'People with access to this company',
  reachNote: 'Applies to every company of the Group',
  statusActive: 'Active',
  statusDisabled: 'Disabled',
  // rules
  rulesIntro:
    'How many different people must approve a post of this company, and which roles may. A post follows the rule of its kind of content; without one, the company default; without that, one approval by any approver.',
  rulesFixed:
    'Always true, whatever the rules say: nobody who wrote any version of a post may review, approve or reject it.',
  rulesKind: 'Kind of content',
  rulesDefault: 'Company default',
  rulesNeeded: 'Approvals needed',
  rulesWho: 'Who may approve',
  rulesChanged: 'Last changed',
  rulesNone: 'No rule is set for this company',
  rulesNoneBody: 'Until one is set, one approval by any approver is enough.',
  rulesOpen: 'Open approval rules',
  rulesChange:
    'Changing or removing a rule needs the right to set approval rules, and asks for a recent sign-in.',
  rulesError: 'Approval rules could not be loaded',
  rulesCaption: 'Approval rules of this company',
  // publishing
  pubIntro:
    'The emergency brake and the state of publishing for this company. A freeze stops publishing through DCC at once; it does not stop someone posting directly on a network.',
  pubBlocked: (status: string) =>
    `This company is ${status}. Nothing can be published for it, including posts that were already approved, until it is made active again.`,
  freezeWhole: 'Freeze the whole company',
  freezeAccount: 'Freeze one account',
  alreadyFrozen: 'The whole company is already frozen.',
  noAccountsToFreeze: 'This company has no accounts to freeze.',
  freezeState: 'Freeze state',
  notFrozen: 'Publishing is not frozen',
  notFrozenBody: 'Approved posts can be published to this company’s connected accounts.',
  frozenBy: (who: string, when: string) => `Frozen by ${who} on ${when}`,
  noReason: 'No reason was given.',
  lift: 'Lift freeze',
  liftLabel: (what: string) => `Lift the freeze on ${what}`,
  liftTitle: 'Lift this freeze?',
  liftBody: (what: string) => `Publishing for ${what} can start again straight away.`,
  liftReauth:
    'Lifting a freeze is a sensitive action: if your last sign-in is old you are asked to sign in again, then repeat it.',
  lifted: 'Freeze lifted.',
  wholeCompany: 'the whole company',
  accountFreezes: 'Frozen accounts',
  accountFreezesNone: 'No single account is frozen.',
  pubPublications: 'Publications by status',
  openPublishing: 'Open the Publishing screen',
  freezesError: 'The publishing freezes could not be loaded',
  freezeColAccount: 'Account',
  freezeColReason: 'Reason',
  freezeColBy: 'Frozen by',
  freezeColWhen: 'Since',
  freezeCaption: 'Frozen accounts',
  twoPersonTitle: 'Frozen accounts waiting for two confirmations',
  // inbox
  inboxIntro:
    'How fast this company has to answer its comments and direct messages. The target is a number of minutes: a message not answered in that time is marked overdue.',
  inboxTargetTitle: 'Response target',
  inboxTargetReadOnly: (minutes: number | null) =>
    minutes === null
      ? 'No target is set. Nothing is marked overdue.'
      : `Current target: ${TEXT_minutes(minutes)}.`,
  inboxTargetGated: 'Setting the target needs the same right as the approval rules.',
  inboxMessages: 'Messages right now',
  inboxMessagesSubtitle: 'Read live from the engine for the last 30 days. DCC does not store them.',
  inboxTotal: 'Messages',
  inboxWaiting: 'Not replied',
  inboxUnassigned: 'Not assigned',
  inboxOverdue: 'Overdue',
  openInbox: 'Open the inbox for this company',
  inboxError: 'The inbox could not be read',
  engineLimits: 'What the engine can do today',
  inboxNoPermission: 'The inbox',
  // incidents
  incidentsIntro:
    'Incidents registered for this company: a hacked account, a wrong post, a lost login. Open one to follow it and see its playbook.',
  incidentsEmpty: 'No incidents for this company',
  incidentsEmptyBody:
    'Nothing has been registered. Incidents are reported from the Incidents screen.',
  incidentTitle: 'Incident',
  incidentSeverity: 'Severity',
  incidentStatus: 'Status',
  incidentAccount: 'Account',
  incidentOpened: 'Opened',
  incidentResolved: 'Resolved',
  incidentNoAccount: 'Whole company',
  incidentsError: 'Incidents could not be loaded',
  incidentsCaption: 'Incidents of this company',
  incidentsOpenScreen: 'Open the Incidents screen',
  incidentsHidden: 'Incidents',
  cancel: 'Cancel',
};

function TEXT_minutes(n: number): string {
  return `${n} min (${formatDuration(n * 60)})`;
}

type TabId = keyof typeof TEXT.tabs;
const TAB_IDS = Object.keys(TEXT.tabs) as TabId[];

/** The company page. `/companies/<id>`. */
export function CompanyDetail({ companyId }: { companyId: string }) {
  const { companies, open } = useWorkspace();
  const company = companies.find((item) => item.id === companyId);
  if (!company) {
    if (companies.length === 0) return <LoadingBlock lines={6} />;
    return (
      <>
        <PageHeader
          title={TEXT.notFoundTitle}
          crumbs={[{ label: TEXT.companies, onClick: () => open('companies') }, { label: '…' }]}
        />
        <EmptyState title={TEXT.notFoundTitle}>{TEXT.notFoundBody}</EmptyState>
        <div className="rg-empty-action">
          <button type="button" className="btn btn-outline" onClick={() => open('companies')}>
            {TEXT.backToList}
          </button>
        </div>
      </>
    );
  }
  return <CompanyHub company={company} />;
}

function CompanyHub({ company }: { company: CompanyDto }) {
  const ws = useWorkspace();
  const { can, open, people, reloadCompanies, reloadPeople } = ws;
  const [tab, setTab] = useTabParam(TAB_IDS, 'overview');
  const [editing, setEditing] = useState<CompanyEditing | null>(null);
  const [registering, setRegistering] = useState(false);
  const [freezing, setFreezing] = useState<{ accountId?: string } | null>(null);

  const mayReadAccounts = can('account.read', company.id);
  const accountsApi = useApiData<SocialAccountDto[]>(mayReadAccounts ? '/social-accounts' : null);
  const overviewApi = useApiData<OperationsOverviewDto[]>(
    can('report.read', company.id) ? '/reports/overview' : null,
  );
  // The communications side holds no freeze permission, yet must see the freezes it is asked to lift.
  const freezesApi = useApiData<FreezeWithLiftDto[]>(
    can('publishing.freeze', company.id)
      ? '/publishing-freezes'
      : can('publishing.lift_comms', company.id)
        ? '/publishing-freezes/for-communications'
        : null,
  );
  const incidentsApi = useApiData<IncidentDto[]>(
    can('incident.read', company.id) ? '/incidents' : null,
  );
  const brandsApi = useApiData<BrandDto[]>(
    can('brand.read', company.id) ? `/companies/${company.id}/brands` : null,
  );

  const accounts = useMemo(
    () => (accountsApi.data ?? []).filter((item) => item.companyId === company.id),
    [accountsApi.data, company.id],
  );
  const overview = overviewApi.data?.find((item) => item.companyId === company.id) ?? null;
  const freezes = useMemo(
    () => (freezesApi.data ?? []).filter((item) => item.companyId === company.id),
    [freezesApi.data, company.id],
  );
  const incidents = useMemo(
    () => (incidentsApi.data ?? []).filter((item) => item.companyId === company.id),
    [incidentsApi.data, company.id],
  );
  const openIncidents = incidents.filter(
    (item) => item.status === 'open' || item.status === 'investigating',
  ).length;
  const overviewOpenIncidents = overview?.incidents
    ? (overview.incidents.byStatus.open ?? 0) + (overview.incidents.byStatus.investigating ?? 0)
    : null;
  const incidentFigure = incidentsApi.data ? openIncidents : overviewOpenIncidents;

  const peopleHere = useMemo(
    () => (people ?? []).filter((user) => user.memberships.some((m) => m.companyId === company.id)),
    [people, company.id],
  );
  const gapAccounts = accounts.filter((item) => accountGaps(item).length > 0);
  const wholeFreeze = freezes.find((item) => item.socialAccountId === null) ?? null;
  const accountFreezes = freezes.filter((item) => item.socialAccountId !== null);
  const blocked = company.status !== 'active';

  const tabs: TabDef[] = [
    { id: 'overview', label: TEXT.tabs.overview },
    { id: 'brands', label: TEXT.tabs.brands, count: brandsApi.data?.length ?? null },
    {
      id: 'accounts',
      label: TEXT.tabs.accounts,
      count: mayReadAccounts && accountsApi.data ? accounts.length : null,
    },
    { id: 'people', label: TEXT.tabs.people, count: people ? peopleHere.length : null },
    { id: 'rules', label: TEXT.tabs.rules },
    {
      id: 'publishing',
      label: TEXT.tabs.publishing,
      count: freezesApi.data ? freezes.length : null,
    },
    { id: 'inbox', label: TEXT.tabs.inbox },
    {
      id: 'incidents',
      label: TEXT.tabs.incidents,
      count: incidentsApi.data ? incidents.length : null,
    },
  ];

  const reloadAll = () => {
    reloadCompanies();
    accountsApi.reload();
    overviewApi.reload();
    freezesApi.reload();
    incidentsApi.reload();
    brandsApi.reload();
    reloadPeople();
  };

  const attention: { id: string; tone: 'amber' | 'red'; text: string; tab: TabId }[] = [];
  if (blocked)
    attention.push({
      id: 'status',
      tone: 'amber',
      text: TEXT.notActive(COMPANY_STATUS[company.status].label.toLowerCase()),
      tab: 'publishing',
    });
  if (wholeFreeze)
    attention.push({ id: 'freeze', tone: 'red', text: TEXT.wholeFrozen, tab: 'publishing' });
  if (accountFreezes.length > 0)
    attention.push({
      id: 'freezes',
      tone: 'amber',
      text: TEXT.accountFrozen(accountFreezes.length),
      tab: 'publishing',
    });
  (['owner', 'backup_admin', 'engine_channel', 'status'] as AccountGap[]).forEach((gap) => {
    const count = accounts.filter((item) => accountGaps(item).includes(gap)).length;
    if (count > 0)
      attention.push({
        id: `gap-${gap}`,
        tone: gap === 'owner' ? 'red' : 'amber',
        text: TEXT.gapsText(count, GAP_LABELS[gap]),
        tab: 'accounts',
      });
  });
  if (incidentFigure)
    attention.push({
      id: 'incidents',
      tone: 'red',
      text: TEXT.incidentsText(incidentFigure),
      tab: 'incidents',
    });

  const statusText = COMPANY_STATUS[company.status];
  const content = overview?.contentItems;
  const publications = overview?.publications;

  return (
    <>
      <PageHeader
        eyebrow="Company"
        title={company.name}
        description={TEXT.descriptionFor(company.slug)}
        crumbs={[
          { label: TEXT.companies, onClick: () => open('companies') },
          { label: company.name },
        ]}
        meta={
          <>
            <StatusChip status={statusText} />
            {blocked && <StatusChip label={TEXT.blocked} tone="amber" />}
            {wholeFreeze && <StatusChip label={TEXT.frozenWhole} tone="red" />}
            <code className="rg-code">{company.slug}</code>
            <CopyId value={company.id} label="Copy company id" />
          </>
        }
        actions={
          <>
            <GatedButton
              allowed={can('company.manage', company.id)}
              permission="company.manage"
              reason={TEXT.editReason}
              compact
              className="btn btn-primary"
              onClick={() => setEditing({ kind: 'company', company })}
            >
              {TEXT.edit}
            </GatedButton>
            <GatedButton
              allowed={can('brand.manage', company.id)}
              permission="brand.manage"
              compact
              onClick={() => setEditing({ kind: 'new-brand', company })}
            >
              {TEXT.addBrand}
            </GatedButton>
            <GatedButton
              allowed={can('account.manage', company.id)}
              permission="account.manage"
              compact
              onClick={() => setRegistering(true)}
            >
              {TEXT.registerAccount}
            </GatedButton>
            <GatedButton
              allowed={can('publishing.freeze', company.id)}
              permission="publishing.freeze"
              compact
              className="btn btn-danger"
              onClick={() => setFreezing({})}
            >
              {TEXT.freezePublishing}
            </GatedButton>
          </>
        }
        tabs={<Tabs tabs={tabs} active={tab} onChange={setTab} label={TEXT.tabsLabel} />}
      />
      <FactStrip columns={4}>
        <Fact
          label={TEXT.factStatus}
          value={statusText.label}
          note={blocked ? TEXT.blocked : undefined}
        />
        <Fact
          label={TEXT.factBrands}
          value={brandsApi.data ? brandsApi.data.length : TEXT.hidden}
        />
        <Fact
          label={TEXT.factAccounts}
          value={
            mayReadAccounts && accountsApi.data
              ? accounts.length
              : (overview?.socialAccounts.total ?? TEXT.hidden)
          }
          note={
            mayReadAccounts && accountsApi.data
              ? TEXT.factAccountsNote(gapAccounts.length)
              : undefined
          }
        />
        <Fact
          label={TEXT.factContent}
          value={content ? content.total : TEXT.hidden}
          note={content ? TEXT.factContentNote(content.byStatus.in_review ?? 0) : TEXT.noFigure}
        />
        <Fact
          label={TEXT.factPublications}
          value={publications ? publications.total : TEXT.hidden}
          note={
            publications
              ? TEXT.factPublicationsNote(publications.byStatus.failed ?? 0)
              : TEXT.noFigure
          }
        />
        <Fact label={TEXT.factIncidents} value={incidentFigure ?? TEXT.hidden} />
        <Fact
          label={TEXT.factPeople}
          value={people ? peopleHere.length : TEXT.hidden}
          note={TEXT.factPeopleNote}
        />
        <Fact
          label={TEXT.factPublishing}
          value={
            blocked
              ? TEXT.blocked
              : wholeFreeze
                ? TEXT.frozenWhole
                : accountFreezes.length > 0
                  ? TEXT.freezesSome(accountFreezes.length)
                  : freezesApi.data
                    ? TEXT.open
                    : TEXT.hidden
          }
        />
      </FactStrip>
      <TabPanel id={tab}>
        {tab === 'overview' && (
          <OverviewTab
            company={company}
            overview={overview}
            attention={attention}
            brandCount={brandsApi.data?.length ?? null}
            peopleCount={people ? peopleHere.length : null}
            goTab={(id) => setTab(id)}
          />
        )}
        {tab === 'brands' && (
          <BrandsTab
            company={company}
            brands={brandsApi.data}
            error={brandsApi.error}
            accounts={accounts}
            onEdit={setEditing}
          />
        )}
        {tab === 'accounts' && (
          <AccountsTab
            company={company}
            accounts={accounts}
            loaded={Boolean(accountsApi.data)}
            error={accountsApi.error}
            brands={brandsApi.data ?? []}
            onRegister={() => setRegistering(true)}
          />
        )}
        {tab === 'people' && (
          <PeopleTab company={company} people={people} onChanged={reloadPeople} />
        )}
        {tab === 'rules' && <RulesTab company={company} />}
        {tab === 'publishing' && (
          <PublishingTab
            company={company}
            freezes={freezes}
            freezesLoaded={Boolean(freezesApi.data)}
            error={freezesApi.error}
            accounts={accounts}
            overview={overview}
            wholeFreeze={wholeFreeze}
            onFreeze={(accountId) => setFreezing({ accountId })}
            onChanged={() => {
              freezesApi.reload();
              reloadCompanies();
            }}
          />
        )}
        {tab === 'inbox' && <InboxTab company={company} />}
        {tab === 'incidents' && (
          <IncidentsTab
            company={company}
            incidents={incidents}
            loaded={Boolean(incidentsApi.data)}
            error={incidentsApi.error}
            accounts={accounts}
          />
        )}
      </TabPanel>
      {editing && (
        <CompanyForm
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            reloadAll();
          }}
        />
      )}
      {registering && (
        <RegisterDialog
          presetCompanyId={company.id}
          onClose={() => setRegistering(false)}
          onSaved={(account) => {
            setRegistering(false);
            reloadAll();
            open('accounts', account.id, { tab: 'engine' });
          }}
        />
      )}
      {freezing && (
        <FreezeDialog
          company={company}
          accounts={accounts}
          presetAccountId={freezing.accountId}
          onClose={() => setFreezing(null)}
          onSaved={() => {
            setFreezing(null);
            freezesApi.reload();
            setTab('publishing');
          }}
        />
      )}
    </>
  );
}

/* ------------------------------------------------------------------ overview */

function countRows(counts: Record<string, number>, table: Record<string, StatusLabel>) {
  return Object.entries(counts)
    .filter(([, value]) => value > 0)
    .map(([key, value]) => {
      const label = labelFrom(table, key);
      return { label: label.label, value, tone: label.tone };
    });
}

function OverviewTab({
  company,
  overview,
  attention,
  brandCount,
  peopleCount,
  goTab,
}: {
  company: CompanyDto;
  overview: OperationsOverviewDto | null;
  attention: { id: string; tone: 'amber' | 'red'; text: string; tab: TabId }[];
  brandCount: number | null;
  peopleCount: number | null;
  goTab: (id: TabId) => void;
}) {
  const { can, open, companyName } = useWorkspace();
  const policies = useApiData<ApprovalPolicyDto[]>(
    can('content.read', company.id)
      ? `/approval-policies${queryString({ companyId: company.id })}`
      : null,
  );
  const settings = useApiData<InboxSettingsDto[]>(
    can('inbox.read', company.id) ? '/inbox/settings' : null,
  );
  const notifications = useApiData<NotificationDto[]>('/notifications');
  const mine = (notifications.data ?? [])
    .filter((item) => item.companyId === company.id)
    .slice(0, 6);
  const target = settings.data?.find((item) => item.companyId === company.id) ?? null;
  const defaultRule = policies.data?.find((item) => item.categoryId === null) ?? null;
  const statusText = COMPANY_STATUS[company.status];

  const blocks: {
    title: string;
    counts: Record<string, number>;
    table: Record<string, StatusLabel>;
  }[] = overview
    ? [
        {
          title: TEXT.opsAccounts,
          counts: overview.socialAccounts.byStatus,
          table: ACCOUNT_STATUS,
        },
        { title: TEXT.opsContent, counts: overview.contentItems.byStatus, table: CONTENT_STATUS },
        {
          title: TEXT.opsPublications,
          counts: overview.publications.byStatus,
          table: PUBLICATION_STATUS,
        },
        ...(overview.incidents
          ? [
              {
                title: TEXT.opsIncidents,
                counts: overview.incidents.byStatus,
                table: INCIDENT_STATUS,
              },
            ]
          : []),
      ]
    : [];

  return (
    <div className="kit-split">
      <div className="rg-stack">
        <SectionPanel title={TEXT.attentionTitle}>
          {attention.length === 0 ? (
            <Callout tone="ok" title={TEXT.attentionOk}>
              {TEXT.attentionOkBody}
            </Callout>
          ) : (
            <ul className="rg-plain-list">
              {attention.map((item) => (
                <li key={item.id}>
                  <span>
                    <StatusChip label={item.tone === 'red' ? 'Urgent' : 'Check'} tone={item.tone} />{' '}
                    {item.text}
                  </span>
                  <button type="button" className="text-link" onClick={() => goTab(item.tab)}>
                    {TEXT.seeIt}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </SectionPanel>
        <SectionPanel title={TEXT.opsTitle} subtitle={TEXT.opsSubtitle}>
          {!overview ? (
            <NoAccessNote permission="report.read" what={TEXT.opsTitle} />
          ) : (
            <div className="rg-two">
              {blocks.map((block) => {
                const rows = countRows(block.counts, block.table);
                return (
                  <div key={block.title}>
                    <h3 className="rg-section-title">{block.title}</h3>
                    {rows.length === 0 ? (
                      <p className="rg-note">{TEXT.opsNone}</p>
                    ) : (
                      <BarList rows={rows} />
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SectionPanel>
      </div>
      <div className="rg-stack">
        <SectionPanel title={TEXT.companyTitle}>
          <DescriptionList
            columns={1}
            items={[
              { label: TEXT.dlName, value: company.name },
              {
                label: TEXT.dlSlug,
                value: <code className="rg-code">{company.slug}</code>,
                hint: TEXT.dlSlugHint,
              },
              {
                label: TEXT.dlStatus,
                value: <StatusChip status={statusText} />,
              },
              { label: TEXT.dlGroup, value: companyName(null) },
              { label: TEXT.dlId, value: <CopyId value={company.id} label="Copy company id" /> },
              { label: TEXT.dlBrands, value: brandCount },
              { label: TEXT.dlPeople, value: peopleCount },
              {
                label: TEXT.dlRule,
                value: policies.data
                  ? defaultRule
                    ? TEXT.ruleDefault(
                        defaultRule.requiredApprovals,
                        defaultRule.approverRoles.length
                          ? defaultRule.approverRoles.map((role) => ROLE_LABELS[role]).join(', ')
                          : TEXT.anyApprover,
                      )
                    : TEXT.ruleBuiltIn
                  : null,
              },
              {
                label: TEXT.dlTarget,
                value: settings.data
                  ? target?.responseTargetMinutes
                    ? TEXT.minutes(target.responseTargetMinutes)
                    : TEXT.noTargetShort
                  : null,
                hint: settings.data && !target?.responseTargetMinutes ? TEXT.noTarget : undefined,
              },
            ]}
          />
        </SectionPanel>
        <SectionPanel title={TEXT.notificationsTitle} subtitle={TEXT.notificationsSubtitle}>
          <ErrorBox error={notifications.error} loading />
          {notifications.loading && !notifications.data ? (
            <LoadingBlock lines={3} />
          ) : mine.length === 0 ? (
            <p className="rg-note">{TEXT.notificationsNone}</p>
          ) : (
            <ul className="rg-plain-list">
              {mine.map((item) => (
                <li key={item.id}>
                  <span>
                    <strong>{NOTIFICATION_EVENT_LABELS[item.eventType]}</strong>
                    <span className="subline">{item.summary}</span>
                    <span className="subline">{formatDateTime(item.createdAt)}</span>
                  </span>
                  {!item.readAt && <StatusChip label={TEXT.notificationNew} tone="blue" />}
                </li>
              ))}
            </ul>
          )}
          <p className="rg-note rg-gap">
            <button type="button" className="text-link" onClick={() => open('notifications')}>
              {TEXT.allNotifications}
            </button>
          </p>
        </SectionPanel>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ brands */

function BrandsTab({
  company,
  brands,
  error,
  accounts,
  onEdit,
}: {
  company: CompanyDto;
  brands: BrandDto[] | null;
  error: Parameters<typeof ErrorBox>[0]['error'];
  accounts: SocialAccountDto[];
  onEdit: (editing: CompanyEditing) => void;
}) {
  const { can } = useWorkspace();
  const mayManage = can('brand.manage', company.id);
  const useCount = (brand: BrandDto) => accounts.filter((item) => item.brandId === brand.id).length;
  const columns: GridColumn<BrandDto>[] = [
    {
      id: 'name',
      header: TEXT.brandName,
      sortValue: (row) => row.name,
      cell: (row) => <span className="post-title">{row.name}</span>,
    },
    {
      id: 'slug',
      header: TEXT.brandSlug,
      sortValue: (row) => row.slug,
      cell: (row) => <code className="rg-code">{row.slug}</code>,
    },
    {
      id: 'accounts',
      header: TEXT.brandAccounts,
      align: 'right',
      sortValue: (row) => useCount(row),
      cell: (row) => useCount(row),
    },
    {
      id: 'actions',
      header: '',
      cell: (row) => (
        <GatedButton
          allowed={mayManage}
          permission="brand.manage"
          compact
          className="text-link"
          label={TEXT.renameLabel(row.name)}
          onClick={() => onEdit({ kind: 'brand', company, brand: row })}
        >
          {TEXT.rename}
        </GatedButton>
      ),
    },
  ];
  if (!can('brand.read', company.id))
    return <NoAccessNote permission="brand.read" what={TEXT.tabs.brands} />;
  return (
    <div className="rg-stack">
      <p className="rg-tab-intro">{TEXT.brandsIntro}</p>
      <ErrorBox error={error} title={TEXT.brandError} loading />
      {!mayManage && <ViewOnlyNote permission="brand.manage" />}
      {!brands ? (
        !error && <LoadingBlock lines={4} />
      ) : (
        <DataGrid
          caption={TEXT.brandsCaption}
          columns={columns}
          rows={brands}
          rowKey={(row) => row.id}
          searchText={(row) => `${row.name} ${row.slug}`}
          defaultSort={{ id: 'name', direction: 'asc' }}
          exportName={`brands-${company.slug}`}
          toolbar={
            <GatedButton
              allowed={mayManage}
              permission="brand.manage"
              compact
              className="btn btn-primary"
              onClick={() => onEdit({ kind: 'new-brand', company })}
            >
              {TEXT.addBrand}
            </GatedButton>
          }
          empty={
            <EmptyState title={TEXT.brandsEmpty}>
              {TEXT.brandsEmptyBody}
              {mayManage && (
                <div className="rg-empty-action">
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => onEdit({ kind: 'new-brand', company })}
                  >
                    {TEXT.addBrand}
                  </button>
                </div>
              )}
            </EmptyState>
          }
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ accounts */

function AccountsTab({
  company,
  accounts,
  loaded,
  error,
  brands,
  onRegister,
}: {
  company: CompanyDto;
  accounts: SocialAccountDto[];
  loaded: boolean;
  error: Parameters<typeof ErrorBox>[0]['error'];
  brands: BrandDto[];
  onRegister: () => void;
}) {
  const { can, open } = useWorkspace();
  const mayManage = can('account.manage', company.id);
  const assignments = useApiData<{ id: string; socialAccountId: string; userId: string }[]>(
    mayManage ? '/social-accounts/assignments' : null,
  );
  const counts = useMemo(() => {
    if (!assignments.data) return null;
    const out: Record<string, number> = {};
    for (const row of assignments.data)
      out[row.socialAccountId] = (out[row.socialAccountId] ?? 0) + 1;
    return out;
  }, [assignments.data]);
  if (!can('account.read', company.id))
    return <NoAccessNote permission="account.read" what={TEXT.tabs.accounts} />;
  return (
    <div className="rg-stack">
      <p className="rg-tab-intro">{TEXT.accountsIntro}</p>
      <ErrorBox error={error} title={TEXT.accountsError} loading />
      {!mayManage && <ViewOnlyNote permission="account.manage" />}
      {!loaded ? (
        !error && <LoadingBlock lines={5} />
      ) : (
        <AccountsGrid
          accounts={accounts}
          showCompany={false}
          exportName={`accounts-${company.slug}`}
          brandsByCompany={{ [company.id]: brands }}
          assignmentCounts={mayManage ? counts : undefined}
          onOpen={(account) => open('accounts', account.id)}
          toolbar={
            <>
              <GatedButton
                allowed={mayManage}
                permission="account.manage"
                compact
                className="btn btn-primary"
                onClick={onRegister}
              >
                {TEXT.registerAccount}
              </GatedButton>
              <RecordLink screen="accounts" className="btn btn-outline">
                {TEXT.allAccounts}
              </RecordLink>
            </>
          }
          empty={
            <EmptyState title={TEXT.accountsEmpty}>
              {TEXT.accountsEmptyBody}
              {mayManage && (
                <div className="rg-empty-action">
                  <button type="button" className="btn btn-primary" onClick={onRegister}>
                    {TEXT.registerAccount}
                  </button>
                </div>
              )}
            </EmptyState>
          }
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ people */

type PersonRow = { user: UserDto; here: MembershipRecordDto[]; group: MembershipRecordDto[] };

function PeopleTab({
  company,
  people,
  onChanged,
}: {
  company: CompanyDto;
  people: UserDto[] | null;
  onChanged: () => void;
}) {
  const { me, can, companyName, peopleError } = useWorkspace();
  const [granting, setGranting] = useState(false);
  const [removing, setRemoving] = useState<{
    user: UserDto;
    membership: MembershipRecordDto;
  } | null>(null);
  const mayManage = can('user.manage', company.id);
  const rows = useMemo<PersonRow[]>(
    () =>
      (people ?? [])
        .map((user) => ({
          user,
          here: user.memberships.filter((m) => m.companyId === company.id),
          group: user.memberships.filter((m) => m.companyId === null),
        }))
        .filter((row) => row.here.length > 0 || row.group.length > 0),
    [people, company.id],
  );
  const groupAdmins = (people ?? []).filter((user) =>
    user.memberships.some((m) => m.role === 'group_admin' && m.companyId === null),
  ).length;
  const roleCounts = useMemo(() => {
    const out: Record<string, number> = {};
    for (const row of rows) for (const m of row.here) out[m.role] = (out[m.role] ?? 0) + 1;
    return ROLES.filter((role) => out[role]).map((role) => ({
      label: ROLE_LABELS[role],
      value: out[role]!,
    }));
  }, [rows]);

  if (!can('user.read', company.id) && !people)
    return (
      <div className="rg-stack">
        <ErrorBox error={peopleError} loading />
        <NoAccessNote permission="user.read" what={TEXT.peopleHidden} />
      </div>
    );

  const removeCell = (user: UserDto, membership: MembershipRecordDto) => {
    const allowed =
      membership.companyId === null
        ? canAtGroup(me, 'user.manage')
        : can('user.manage', membership.companyId);
    const label = TEXT.removeLabel(ROLE_LABELS[membership.role], user.displayName || user.email);
    if (user.id === me.user.id)
      return (
        <span className="rg-muted" title={TEXT.removeSelf}>
          {TEXT.removeSelf}
        </span>
      );
    if (membership.source === 'idp')
      return (
        <span className="rg-muted" title={TEXT.removeSso}>
          {TEXT.removeSso}
        </span>
      );
    return (
      <GatedButton
        allowed={allowed}
        permission="user.manage"
        reason={TEXT.removeNotAllowed}
        compact
        className="text-link"
        label={label}
        onClick={() => setRemoving({ user, membership })}
      >
        {TEXT.remove}
      </GatedButton>
    );
  };

  const columns: GridColumn<PersonRow>[] = [
    {
      id: 'person',
      header: TEXT.person,
      sortValue: (row) => row.user.displayName || row.user.email,
      exportValue: (row) => `${row.user.displayName} <${row.user.email}>`,
      cell: (row) => (
        <>
          <span className="post-title">
            <PersonName userId={row.user.id} />
          </span>
          <span className="subline">{row.user.email}</span>
        </>
      ),
    },
    {
      id: 'here',
      header: TEXT.rolesHere,
      sortValue: (row) => row.here.length,
      exportValue: (row) => row.here.map((m) => ROLE_LABELS[m.role]).join('; '),
      cell: (row) =>
        row.here.length === 0 ? (
          <span className="rg-muted">{TEXT.noneHere}</span>
        ) : (
          <ul className="rg-plain-list rg-flat">
            {row.here.map((m) => (
              <li key={m.id}>
                <MembershipLine membership={m} companyLabel={companyName(m.companyId)} />
                {removeCell(row.user, m)}
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: 'group',
      header: TEXT.rolesGroup,
      sortValue: (row) => row.group.length,
      exportValue: (row) => row.group.map((m) => ROLE_LABELS[m.role]).join('; '),
      cell: (row) =>
        row.group.length === 0 ? (
          <span className="rg-muted">{TEXT.noneHere}</span>
        ) : (
          <ul className="rg-plain-list rg-flat">
            {row.group.map((m) => (
              <li key={m.id}>
                <MembershipLine membership={m} companyLabel={null} />
                <span className="subline">{TEXT.reachNote}</span>
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: 'status',
      header: TEXT.statusCol,
      sortValue: (row) => row.user.status,
      exportValue: (row) => row.user.status,
      cell: (row) => (
        <StatusChip
          label={row.user.status === 'active' ? TEXT.statusActive : TEXT.statusDisabled}
          tone={row.user.status === 'active' ? 'green' : 'gray'}
        />
      ),
    },
  ];
  const filters: GridFilter<PersonRow>[] = [
    {
      id: 'role',
      label: TEXT.filterRole,
      options: ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
      test: (row, value) => [...row.here, ...row.group].some((m) => m.role === value),
    },
    {
      id: 'source',
      label: TEXT.filterSource,
      options: [
        { value: 'dcc', label: TEXT.optDcc },
        { value: 'idp', label: TEXT.optSso },
      ],
      test: (row, value) => [...row.here, ...row.group].some((m) => m.source === value),
    },
    {
      id: 'status',
      label: TEXT.filterStatus,
      options: [
        { value: 'active', label: TEXT.optActive },
        { value: 'disabled', label: TEXT.optDisabled },
      ],
      test: (row, value) => row.user.status === value,
    },
  ];

  return (
    <div className="rg-stack">
      <p className="rg-tab-intro">{TEXT.peopleIntro}</p>
      <ErrorBox error={peopleError} loading />
      {!mayManage && <ViewOnlyNote permission="user.manage" />}
      {!people ? (
        <LoadingBlock lines={5} />
      ) : (
        <div className="kit-split">
          <DataGrid
            caption={TEXT.peopleCaption}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.user.id}
            searchText={(row) => `${row.user.displayName} ${row.user.email}`}
            filters={filters}
            defaultSort={{ id: 'person', direction: 'asc' }}
            exportName={`people-${company.slug}`}
            toolbar={
              <GatedButton
                allowed={mayManage}
                permission="user.manage"
                reason={TEXT.giveRoleReason}
                compact
                className="btn btn-primary"
                onClick={() => setGranting(true)}
              >
                {TEXT.giveRole}
              </GatedButton>
            }
            empty={
              <EmptyState title={TEXT.peopleEmpty}>
                {TEXT.peopleEmptyBody}
                {mayManage && (
                  <div className="rg-empty-action">
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => setGranting(true)}
                    >
                      {TEXT.giveRole}
                    </button>
                  </div>
                )}
              </EmptyState>
            }
          />
          <SectionPanel title={TEXT.rolesChart}>
            {roleCounts.length === 0 ? (
              <p className="rg-note">{TEXT.noneHere}</p>
            ) : (
              <BarList rows={roleCounts} />
            )}
          </SectionPanel>
        </div>
      )}
      {granting && (
        <GrantDialog
          presetCompanyId={company.id}
          onClose={() => setGranting(false)}
          onSaved={() => {
            setGranting(false);
            onChanged();
          }}
        />
      )}
      {removing && (
        <RemoveRoleDialog
          user={removing.user}
          membership={removing.membership}
          onlyGroupAdmin={
            removing.membership.role === 'group_admin' &&
            removing.membership.companyId === null &&
            groupAdmins <= 1
          }
          onClose={() => setRemoving(null)}
          onDone={onChanged}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ rules */

function RulesTab({ company }: { company: CompanyDto }) {
  const { can, open, screenAllowed, personName } = useWorkspace();
  const policies = useApiData<ApprovalPolicyDto[]>(
    can('content.read', company.id)
      ? `/approval-policies${queryString({ companyId: company.id })}`
      : null,
  );
  const categories = useApiData<ContentCategoryDto[]>(
    can('content.read', company.id) ? '/content-categories' : null,
  );
  if (!can('content.read', company.id))
    return <NoAccessNote permission="content.read" what={TEXT.tabs.rules} />;
  const categoryName = (id: string | null) =>
    id === null
      ? TEXT.rulesDefault
      : (categories.data?.find((item) => item.id === id)?.name ?? `${id.slice(0, 8)}`);
  const rows = (policies.data ?? []).filter((item) => item.companyId === company.id);
  const columns: GridColumn<ApprovalPolicyDto>[] = [
    {
      id: 'kind',
      header: TEXT.rulesKind,
      sortValue: (row) => (row.categoryId === null ? '' : categoryName(row.categoryId)),
      cell: (row) => <span className="post-title">{categoryName(row.categoryId)}</span>,
    },
    {
      id: 'needed',
      header: TEXT.rulesNeeded,
      align: 'right',
      sortValue: (row) => row.requiredApprovals,
      cell: (row) => row.requiredApprovals,
    },
    {
      id: 'who',
      header: TEXT.rulesWho,
      exportValue: (row) =>
        row.approverRoles.length
          ? row.approverRoles.map((role) => ROLE_LABELS[role]).join('; ')
          : TEXT.anyApprover,
      cell: (row) =>
        row.approverRoles.length === 0 ? (
          <span className="rg-muted">{TEXT.anyApprover}</span>
        ) : (
          <span className="rg-chips">
            {row.approverRoles.map((role) => (
              <StatusChip key={role} label={ROLE_LABELS[role]} tone="blue" />
            ))}
          </span>
        ),
    },
    {
      id: 'changed',
      header: TEXT.rulesChanged,
      sortValue: (row) => row.updatedAt,
      exportValue: (row) => `${personName(row.updatedBy)} ${row.updatedAt}`,
      cell: (row) => (
        <>
          {formatDateTime(row.updatedAt)}
          <span className="subline">
            <PersonName userId={row.updatedBy} />
          </span>
        </>
      ),
    },
  ];
  return (
    <div className="rg-stack">
      <p className="rg-tab-intro">{TEXT.rulesIntro}</p>
      <Callout tone="info">{TEXT.rulesFixed}</Callout>
      <ErrorBox error={policies.error ?? categories.error} title={TEXT.rulesError} loading />
      {!policies.data ? (
        !policies.error && <LoadingBlock lines={4} />
      ) : (
        <DataGrid
          caption={TEXT.rulesCaption}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          defaultSort={{ id: 'kind', direction: 'asc' }}
          toolbar={
            screenAllowed('policies') ? (
              <button type="button" className="btn btn-primary" onClick={() => open('policies')}>
                {TEXT.rulesOpen}
              </button>
            ) : (
              <span className="rg-note">{needsRoleHint('approval_policy.manage')}</span>
            )
          }
          empty={<EmptyState title={TEXT.rulesNone}>{TEXT.rulesNoneBody}</EmptyState>}
        />
      )}
      <p className="rg-note">{TEXT.rulesChange}</p>
    </div>
  );
}

/* ------------------------------------------------------------------ publishing */

function PublishingTab({
  company,
  freezes,
  freezesLoaded,
  error,
  accounts,
  overview,
  wholeFreeze,
  onFreeze,
  onChanged,
}: {
  company: CompanyDto;
  freezes: FreezeWithLiftDto[];
  freezesLoaded: boolean;
  error: Parameters<typeof ErrorBox>[0]['error'];
  accounts: SocialAccountDto[];
  overview: OperationsOverviewDto | null;
  wholeFreeze: FreezeWithLiftDto | null;
  onFreeze: (accountId?: string) => void;
  onChanged: () => void;
}) {
  const { can, open, personName } = useWorkspace();
  const showToast = useToast();
  const [lifting, setLifting] = useState<FreezeWithLiftDto | null>(null);
  const mayFreeze = can('publishing.freeze', company.id);
  const accountFreezes = freezes.filter((item) => item.socialAccountId !== null);
  const accountOf = (id: string | null) => accounts.find((item) => item.id === id);
  const publications = overview?.publications;

  const columns: GridColumn<FreezeWithLiftDto>[] = [
    {
      id: 'account',
      header: TEXT.freezeColAccount,
      sortValue: (row) => accountOf(row.socialAccountId)?.displayName ?? '',
      cell: (row) => {
        const account = accountOf(row.socialAccountId);
        return account ? <AccountLink account={account} /> : <>{row.socialAccountId}</>;
      },
    },
    {
      id: 'reason',
      header: TEXT.freezeColReason,
      cell: (row) => row.reason ?? <span className="rg-muted">{TEXT.noReason}</span>,
    },
    {
      id: 'by',
      header: TEXT.freezeColBy,
      sortValue: (row) => personName(row.frozenBy),
      cell: (row) => <PersonName userId={row.frozenBy} />,
    },
    {
      id: 'when',
      header: TEXT.freezeColWhen,
      sortValue: (row) => row.frozenAt,
      cell: (row) => formatDateTime(row.frozenAt),
    },
    {
      id: 'lift',
      header: '',
      cell: (row) =>
        row.twoPersonLift ? (
          <StatusChip label={TWO_PEOPLE_CHIP} tone="amber" />
        ) : (
          <GatedButton
            allowed={mayFreeze}
            permission="publishing.freeze"
            compact
            className="text-link"
            label={TEXT.liftLabel(accountOf(row.socialAccountId)?.displayName ?? '')}
            onClick={() => setLifting(row)}
          >
            {TEXT.lift}
          </GatedButton>
        ),
    },
  ];

  return (
    <div className="rg-stack">
      <p className="rg-tab-intro">{TEXT.pubIntro}</p>
      {company.status !== 'active' && (
        <Callout tone="warn" title={TEXT.blocked}>
          {TEXT.pubBlocked(COMPANY_STATUS[company.status].label.toLowerCase())}
        </Callout>
      )}
      {!mayFreeze && <ViewOnlyNote permission="publishing.freeze" />}
      <ErrorBox error={error} title={TEXT.freezesError} loading />
      <div className="rg-two">
        <SectionPanel
          title={TEXT.freezeState}
          action={
            <div className="rg-actions">
              <GatedButton
                allowed={mayFreeze && !wholeFreeze}
                permission="publishing.freeze"
                reason={wholeFreeze ? TEXT.alreadyFrozen : undefined}
                compact
                className="btn btn-danger"
                onClick={() => onFreeze()}
              >
                {TEXT.freezeWhole}
              </GatedButton>
              <GatedButton
                allowed={mayFreeze && accounts.length > 0}
                permission="publishing.freeze"
                reason={mayFreeze ? TEXT.noAccountsToFreeze : undefined}
                compact
                onClick={() => onFreeze(undefined)}
              >
                {TEXT.freezeAccount}
              </GatedButton>
            </div>
          }
        >
          {!freezesLoaded ? (
            mayFreeze ? (
              !error && <LoadingBlock lines={2} />
            ) : (
              <NoAccessNote permission="publishing.freeze" what={TEXT.freezeState} />
            )
          ) : wholeFreeze ? (
            <Callout tone="danger" title={TEXT.frozenWhole}>
              <p className="rg-note">{wholeFreeze.reason ?? TEXT.noReason}</p>
              <p className="rg-note">
                {TEXT.frozenBy(
                  personName(wholeFreeze.frozenBy),
                  formatDateTime(wholeFreeze.frozenAt),
                )}
              </p>
              {wholeFreeze.twoPersonLift ? (
                <FreezeLiftPanel freeze={wholeFreeze} onChanged={onChanged} />
              ) : (
                <GatedButton
                  allowed={mayFreeze}
                  permission="publishing.freeze"
                  className="btn btn-outline"
                  label={TEXT.liftLabel(TEXT.wholeCompany)}
                  onClick={() => setLifting(wholeFreeze)}
                >
                  {TEXT.lift}
                </GatedButton>
              )}
            </Callout>
          ) : (
            <Callout tone="ok" title={TEXT.notFrozen}>
              {TEXT.notFrozenBody}
            </Callout>
          )}
        </SectionPanel>
        <SectionPanel title={TEXT.pubPublications}>
          {publications ? (
            publications.total === 0 ? (
              <p className="rg-note">{TEXT.opsNone}</p>
            ) : (
              <BarList rows={countRows(publications.byStatus, PUBLICATION_STATUS)} />
            )
          ) : (
            <NoAccessNote permission="report.read" what={TEXT.pubPublications} />
          )}
          <p className="rg-note rg-gap">
            <button type="button" className="text-link" onClick={() => open('publishing')}>
              {TEXT.openPublishing}
            </button>
          </p>
        </SectionPanel>
      </div>
      {freezesLoaded && (
        <SectionPanel title={TEXT.accountFreezes}>
          <DataGrid
            caption={TEXT.freezeCaption}
            columns={columns}
            rows={accountFreezes}
            rowKey={(row) => row.id}
            defaultSort={{ id: 'when', direction: 'desc' }}
            empty={<EmptyState title={TEXT.accountFreezesNone} />}
          />
        </SectionPanel>
      )}
      {freezesLoaded && accountFreezes.some((item) => item.twoPersonLift) && (
        <SectionPanel title={TEXT.twoPersonTitle}>
          <div className="gov-stack">
            {accountFreezes
              .filter((item) => item.twoPersonLift)
              .map((item) => (
                <div key={item.id}>
                  <strong>
                    {accountOf(item.socialAccountId)?.displayName ?? item.socialAccountId}
                  </strong>
                  <FreezeLiftPanel freeze={item} onChanged={onChanged} />
                </div>
              ))}
          </div>
        </SectionPanel>
      )}
      {lifting && (
        <ConfirmDialog
          title={TEXT.liftTitle}
          confirmLabel={TEXT.lift}
          onClose={() => setLifting(null)}
          onConfirm={async () => {
            await apiSend('DELETE', `/publishing-freezes/${lifting.id}`);
            showToast(TEXT.lifted);
            onChanged();
          }}
        >
          <p>
            {TEXT.liftBody(
              lifting.socialAccountId
                ? (accountOf(lifting.socialAccountId)?.displayName ?? TEXT.wholeCompany)
                : TEXT.wholeCompany,
            )}
          </p>
          <p className="rg-note">{TEXT.liftReauth}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ inbox */

function InboxTab({ company }: { company: CompanyDto }) {
  const { can, personName: _ignored } = useWorkspace();
  void _ignored;
  const mayRead = can('inbox.read', company.id);
  const settings = useApiData<InboxSettingsDto[]>(mayRead ? '/inbox/settings' : null);
  const engine = useApiData<EngineStatusDto>(
    can('account.read', company.id) ? '/engine/status' : null,
  );
  const messages = useApiData<InboxMessageDto[]>(
    mayRead ? `/inbox${queryString({ companyId: company.id })}` : null,
  );
  if (!mayRead) return <NoAccessNote permission="inbox.read" what={TEXT.inboxNoPermission} />;
  const setting = settings.data?.find((item) => item.companyId === company.id) ?? null;
  const list = messages.data ?? [];
  const mayTarget = can('approval_policy.manage', company.id);
  const limits = (engine.data?.notes ?? []).filter((note) => /inbox/i.test(note));
  return (
    <div className="rg-stack">
      <p className="rg-tab-intro">{TEXT.inboxIntro}</p>
      <ErrorBox error={settings.error} loading />
      <div className="rg-two">
        <SectionPanel title={TEXT.inboxTargetTitle}>
          {settings.data ? (
            mayTarget ? (
              <TargetForm company={company} setting={setting} onSaved={settings.reload} />
            ) : (
              <>
                <p>{TEXT.inboxTargetReadOnly(setting?.responseTargetMinutes ?? null)}</p>
                <ViewOnlyNote permission="approval_policy.manage">
                  {TEXT.inboxTargetGated}
                </ViewOnlyNote>
              </>
            )
          ) : (
            !settings.error && <LoadingBlock lines={2} />
          )}
        </SectionPanel>
        <SectionPanel title={TEXT.inboxMessages} subtitle={TEXT.inboxMessagesSubtitle}>
          <ErrorBox error={messages.error} title={TEXT.inboxError} loading />
          {messages.data ? (
            <FactStrip>
              <Fact label={TEXT.inboxTotal} value={list.length} />
              <Fact label={TEXT.inboxWaiting} value={list.filter((m) => !m.replied).length} />
              <Fact label={TEXT.inboxUnassigned} value={list.filter((m) => !m.assignedTo).length} />
              <Fact
                label={TEXT.inboxOverdue}
                value={
                  list.filter((m) => m.overdue === true && !(m.replied && !m.firstResponseAt))
                    .length
                }
              />
            </FactStrip>
          ) : (
            !messages.error && <LoadingBlock lines={2} />
          )}
          <p className="rg-note rg-gap">
            <RecordLink
              screen="inbox"
              params={{ companyId: company.id }}
              keepCompany={false}
              className="text-link rg-link"
            >
              {TEXT.openInbox}
            </RecordLink>
          </p>
        </SectionPanel>
      </div>
      {limits.length > 0 && (
        <Callout tone="info" title={TEXT.engineLimits}>
          {limits.join(' ')}
        </Callout>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ incidents */

function IncidentsTab({
  company,
  incidents,
  loaded,
  error,
  accounts,
}: {
  company: CompanyDto;
  incidents: IncidentDto[];
  loaded: boolean;
  error: Parameters<typeof ErrorBox>[0]['error'];
  accounts: SocialAccountDto[];
}) {
  const { can, personName } = useWorkspace();
  if (!can('incident.read', company.id))
    return <NoAccessNote permission="incident.read" what={TEXT.incidentsHidden} />;
  const accountOf = (id: string | null) => accounts.find((item) => item.id === id);
  const columns: GridColumn<IncidentDto>[] = [
    {
      id: 'title',
      header: TEXT.incidentTitle,
      sortValue: (row) => row.title,
      cell: (row) => (
        <span className="post-title">
          <RecordLink screen="incidents" id={row.id} keepCompany={false}>
            {row.title}
          </RecordLink>
        </span>
      ),
    },
    {
      id: 'severity',
      header: TEXT.incidentSeverity,
      sortValue: (row) => INCIDENT_SEVERITIES.indexOf(row.severity),
      exportValue: (row) => INCIDENT_SEVERITY[row.severity].label,
      cell: (row) => <StatusChip status={INCIDENT_SEVERITY[row.severity]} />,
    },
    {
      id: 'status',
      header: TEXT.incidentStatus,
      sortValue: (row) => INCIDENT_STATUSES.indexOf(row.status),
      exportValue: (row) => INCIDENT_STATUS[row.status].label,
      cell: (row) => <StatusChip status={INCIDENT_STATUS[row.status]} />,
    },
    {
      id: 'account',
      header: TEXT.incidentAccount,
      sortValue: (row) => accountOf(row.socialAccountId)?.displayName ?? '',
      exportValue: (row) => accountOf(row.socialAccountId)?.displayName ?? '',
      cell: (row) => {
        const account = accountOf(row.socialAccountId);
        return account ? (
          <AccountLink account={account} />
        ) : (
          <span className="rg-muted">{TEXT.incidentNoAccount}</span>
        );
      },
    },
    {
      id: 'opened',
      header: TEXT.incidentOpened,
      sortValue: (row) => row.openedAt,
      exportValue: (row) => `${row.openedAt} ${personName(row.openedBy)}`,
      cell: (row) => (
        <>
          {formatDateTime(row.openedAt)}
          <span className="subline">
            <PersonName userId={row.openedBy} />
          </span>
        </>
      ),
    },
    {
      id: 'resolved',
      header: TEXT.incidentResolved,
      sortValue: (row) => row.resolvedAt,
      exportValue: (row) => row.resolvedAt ?? '',
      cell: (row) => formatDateTime(row.resolvedAt),
    },
  ];
  const filters: GridFilter<IncidentDto>[] = [
    {
      id: 'status',
      label: TEXT.incidentStatus,
      options: INCIDENT_STATUSES.map((value) => ({ value, label: INCIDENT_STATUS[value].label })),
      test: (row, value) => row.status === value,
    },
    {
      id: 'severity',
      label: TEXT.incidentSeverity,
      options: INCIDENT_SEVERITIES.map((value) => ({
        value,
        label: INCIDENT_SEVERITY[value].label,
      })),
      test: (row, value) => row.severity === value,
    },
  ];
  return (
    <div className="rg-stack">
      <p className="rg-tab-intro">{TEXT.incidentsIntro}</p>
      <ErrorBox error={error} title={TEXT.incidentsError} loading />
      {!loaded ? (
        !error && <LoadingBlock lines={4} />
      ) : (
        <DataGrid
          caption={TEXT.incidentsCaption}
          columns={columns}
          rows={incidents}
          rowKey={(row) => row.id}
          searchText={(row) => `${row.title} ${row.description ?? ''}`}
          filters={filters}
          defaultSort={{ id: 'opened', direction: 'desc' }}
          exportName={`incidents-${company.slug}`}
          toolbar={
            <RecordLink screen="incidents" className="btn btn-outline">
              {TEXT.incidentsOpenScreen}
            </RecordLink>
          }
          empty={<EmptyState title={TEXT.incidentsEmpty}>{TEXT.incidentsEmptyBody}</EmptyState>}
        />
      )}
    </div>
  );
}
