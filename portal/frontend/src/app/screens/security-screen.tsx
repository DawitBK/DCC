'use client';

import { useState } from 'react';
import {
  INCIDENT_SEVERITIES,
  ROLE_LABELS,
  isRole,
  type EngineStatusDto,
  type FreezeDto,
  type SecurityPostureDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { EmptyState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { FreezeDialog } from '@/components/freeze-dialog';
import {
  FactStrip,
  GatedButton,
  NextSteps,
  PanelSkeleton,
  ageSince,
  type NextStep,
} from '@/components/gov-parts';
import { DataGrid, type GridColumn } from '@/components/kit/data-grid';
import { PageHeader } from '@/components/kit/page-header';
import { Callout, Fact } from '@/components/kit/parts';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { formatDateTime } from '@/lib/format';
import { INCIDENT_SEVERITY, PLATFORM_LABELS } from '@/lib/labels';
import { useApiData, type ApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import './governance.css';
import './security-screen.css';

type NewAdministrator = SecurityPostureDto['newAdministrators']['items'][number];
type HealthBody = { status: string; checks?: Record<string, string> };

const TEXT = {
  title: 'Security center',
  description:
    'What DCC itself knows about its security state, what needs doing, and what it does not watch at all.',
  asOf: (when: string, ago: string) => `As of ${when} (${ago} ago)`,
  refresh: 'Read again',
  freeze: 'Freeze publishing',
  loadFailed: 'The security overview could not be loaded',
  scopeNote:
    'These counts cover every company your role may see for security. The company chosen in the top bar does not narrow them.',
  // next steps
  nextTitle: 'What to do next',
  nextSubtitle: 'Worked out only from the numbers on this page. Nothing here is a guess.',
  nothing: 'Nothing that DCC watches needs action right now.',
  nothingBody:
    'That is not the same as “all is well”: read the list of what DCC does not watch, further down.',
  stepChain: (id: string | null) => `The audit chain is broken${id ? ` at event #${id}` : ''}`,
  stepChainBody:
    'Do not restore or repair anything. Tell the architect and the Group CTO at once: a broken chain is a security incident.',
  stepChainAction: 'Open the integrity check',
  stepIncidentsHigh: (count: number) =>
    `${count} ${count === 1 ? 'incident' : 'incidents'} open at high or critical severity`,
  stepIncidentsHighBody: 'Open the incident, follow its playbook and call the recovery contacts.',
  stepIncidentsLow: (count: number) =>
    `${count} lower-severity ${count === 1 ? 'incident is' : 'incidents are'} still open`,
  stepIncidentsLowBody: 'Move each one on, or resolve it when it is dealt with.',
  stepIncidentsAction: 'Open incidents',
  stepOwner: (count: number) =>
    `${count} ${count === 1 ? 'account has' : 'accounts have'} no owner`,
  stepOwnerBody:
    'Nobody is responsible for these accounts. Give each one an owner on the social accounts screen.',
  stepBackup: (count: number) =>
    `${count} ${count === 1 ? 'account has' : 'accounts have'} no backup administrator`,
  stepBackupBody: 'If the owner is away or leaves, nobody can step in. Name a backup for each.',
  stepDisconnected: (count: number) =>
    `${count} ${count === 1 ? 'account is' : 'accounts are'} disconnected`,
  stepDisconnectedBody: 'Nothing can be published to a disconnected account. Reconnect it.',
  stepAttention: (count: number) =>
    `${count} ${count === 1 ? 'account needs' : 'accounts need'} attention`,
  stepAttentionBody: 'Open each one and see what is flagged.',
  stepNotConnected: (count: number) =>
    `${count} ${count === 1 ? 'account is' : 'accounts are'} not connected to the publishing engine`,
  stepNotConnectedBody:
    'Posts cannot be sent to these accounts until each is linked to a channel of the engine.',
  stepAccountsAction: 'Open the accounts',
  stepFreezes: (count: number) =>
    `Publishing is frozen in ${count} ${count === 1 ? 'place' : 'places'}`,
  stepFreezesBody: 'Nothing is published there. Lift each freeze when the cause is dealt with.',
  stepFreezesAction: 'Open publishing',
  stepMfa: 'Two-step sign-in is switched off in this installation',
  stepMfaBody:
    'This is how development and practice setups run. Production always requires it and refuses to start without it. If you are looking at the live system, this is a serious fault.',
  stepAdmins: (count: number, days: number) =>
    `${count} administrator ${count === 1 ? 'role was' : 'roles were'} given in the last ${days} days`,
  stepAdminsBody: 'Check that each one was expected. A role nobody can explain is a warning sign.',
  stepAdminsAction: 'See the role changes',
  // facts
  factAudit: 'Audit chain',
  factAuditOk: 'Intact',
  factAuditBad: 'Broken',
  factAuditNote: (events: number) => `${events.toLocaleString()} events checked`,
  factAuditBadNote: (id: string | null) =>
    id ? `First broken event: #${id}` : 'See the integrity check',
  factMfa: 'Two-step sign-in',
  factMfaOn: 'Enforced',
  factMfaOff: 'Not enforced',
  factReauth: 'Sign in again after',
  factReauthValue: (minutes: number) => `${minutes} min`,
  factReauthNote: 'For roles, lifting a freeze, exports and approval rules',
  factFreezes: 'Publishing freezes',
  factFreezesNone: 'None',
  factFreezesNote: (count: number) => (count === 0 ? 'Publishing is open' : 'Active now'),
  factAdmins: 'New administrators',
  factAdminsNote: (days: number) => `Last ${days} days`,
  mfaNoteTitle: 'About two-step sign-in',
  mfaMeaning: {
    on: 'DCC refuses a sign-in that did not use a password and an authenticator code.',
    off: 'DCC is not checking for the second step in this installation. The note below is the platform’s statement about how it is meant to work.',
  },
  reauthMeaning:
    'A few actions ask you to sign in again if your last sign-in is older than this: giving or removing a role, lifting a freeze, exporting the audit trail, and changing an approval rule.',
  // accounts
  accountsTitle: 'Account register',
  accountsSubtitle: (total: number) =>
    `${total} ${total === 1 ? 'account' : 'accounts'} in the register (archived ones are not counted)`,
  rowOwner: 'Without an owner',
  rowOwnerHint: 'Nobody is responsible for the account.',
  rowBackup: 'Without a backup administrator',
  rowBackupHint: 'Nobody can step in for the owner.',
  rowEngine: 'Not connected to the engine',
  rowEngineHint: 'Posts cannot be sent to it yet.',
  rowAttention: 'Need attention',
  rowAttentionHint: 'Flagged by a person or by the engine.',
  rowDisconnected: 'Disconnected',
  rowDisconnectedHint: 'The link to the network is down.',
  ofTotal: (total: number) => `of ${total}`,
  openList: 'Open the list',
  allGood: 'None',
  // incidents
  incidentsTitle: 'Open incidents by severity',
  incidentsSubtitle: 'Open or being investigated, in the companies you may see.',
  incidentsNone: 'No open incidents.',
  openThese: 'Open these',
  // admins
  adminsTitle: 'New administrators',
  adminsSubtitle: (days: number) =>
    `Administrator roles (group administrator, company administrator, security administrator, Group CTO) given in the last ${days} days.`,
  adminsCaption: 'Recently given administrator roles',
  noAdmins: 'No new administrators in this period',
  noAdminsBody: 'Nobody was given an administrator role in this window.',
  person: 'Person',
  role: 'Role',
  where: 'Where',
  wholeGroup: 'Whole group',
  granted: 'Given',
  openPerson: 'Open person',
  // freezes
  freezesTitle: 'Publishing freezes',
  freezesSubtitle:
    'A freeze stops publishing through DCC. It cannot stop someone posting directly on the network.',
  freezeAll: 'The whole company',
  freezeBy: (who: string, when: string) => `Frozen by ${who}, ${when}`,
  liftHint: 'Lifting a freeze is done on the publishing screen and asks you to sign in again.',
  noFreezes: 'Publishing is not frozen anywhere you can see.',
  // readiness
  readinessTitle: 'Readiness',
  readinessSubtitle: 'Read from the public health checks and from the publishing engine.',
  checkLive: 'DCC server is running',
  checkLiveBody: 'The process answers. It does not look at anything it depends on.',
  checkReady: 'DCC can serve people',
  checkReadyBody: 'Asked just now: can this instance reach its database?',
  checkDatabase: 'Database',
  checking: 'Checking…',
  up: 'Up',
  down: 'Down',
  unreachable: 'DCC could not be reached',
  healthStatus: (code: number) => `The health check answered ${code}.`,
  engineTitle: 'Publishing engine',
  engineNoAccess: 'Your role does not include seeing the publishing engine.',
  engineProvider: 'Engine',
  engineVerified: 'Verified against a live engine',
  engineUnverified: 'Not verified against a live engine',
  engineVerifiedHint:
    'Verified means a test was run against a real engine. Unverified means the engine is connected and read, but a real post on a real network has not been proven yet.',
  enginePublish: 'Can publish',
  engineInbox: 'Inbox available',
  engineConsole: 'Engine console',
  engineConsoleOpen: 'Open the engine console',
  engineNotes: 'What the engine integration says about itself',
  yes: 'Yes',
  no: 'No',
  // not monitored
  notMonitored: 'What DCC does not watch',
  notMonitoredSubtitle:
    'DCC has no signal for these. An empty panel anywhere on this page never means they are fine.',
  notWatched: 'Not watched',
  nothingListed: 'The API lists nothing here.',
  freezeNeedsRole: 'Freezing publishing needs the freeze permission.',
  noAccountsNote: 'Account names need the right to see social accounts.',
};

function healthOf(api: ApiData<HealthBody>): {
  state: 'checking' | 'up' | 'down' | 'unreachable';
  detail?: string;
} {
  if (api.data) return { state: api.data.status === 'ok' ? 'up' : 'down' };
  if (api.error) {
    if (api.error.status === 0) return { state: 'unreachable' };
    return { state: 'down', detail: TEXT.healthStatus(api.error.status) };
  }
  return { state: 'checking' };
}

function HealthChip({ state }: { state: 'checking' | 'up' | 'down' | 'unreachable' }) {
  if (state === 'up') return <StatusChip label={TEXT.up} tone="green" />;
  if (state === 'checking') return <StatusChip label={TEXT.checking} tone="gray" />;
  return <StatusChip label={state === 'down' ? TEXT.down : TEXT.unreachable} tone="red" />;
}

/**
 * `GET /api/security/posture` (security.read), `GET /api/health/live` and `/health/ready` (public),
 * `GET /api/engine/status` (account.read), `GET /api/publishing-freezes` and `POST` (publishing.freeze).
 */
export function SecurityScreen() {
  const {
    can,
    open,
    companyName,
    personName,
    screenAllowed,
    companiesWhere,
    refreshNotifications,
  } = useWorkspace();
  const posture = useApiData<SecurityPostureDto>('/security/posture');
  const live = useApiData<HealthBody>('/health/live');
  const ready = useApiData<HealthBody>('/health/ready');
  const engine = useApiData<EngineStatusDto>(can('account.read') ? '/engine/status' : null);
  const freezes = useApiData<FreezeDto[]>(can('publishing.freeze') ? '/publishing-freezes' : null);
  const accounts = useApiData<SocialAccountDto[]>(can('account.read') ? '/social-accounts' : null);
  const [freezing, setFreezing] = useState(false);
  const data = posture.data;
  const mayFreeze = companiesWhere('publishing.freeze').length > 0 || can('publishing.freeze');

  const reload = () => {
    posture.reload();
    live.reload();
    ready.reload();
    engine.reload();
    freezes.reload();
  };

  const accountName = (id: string | null) => {
    if (!id) return TEXT.freezeAll;
    const account = accounts.data?.find((item) => item.id === id);
    return account
      ? `${account.displayName} (${PLATFORM_LABELS[account.platform]})`
      : id.slice(0, 8);
  };

  const steps: NextStep[] = [];
  if (data) {
    const { accounts: reg, openIncidents: inc } = data;
    if (!data.auditTrail.chainOk)
      steps.push({
        id: 'chain',
        urgency: 'now',
        title: TEXT.stepChain(data.auditTrail.firstBrokenId),
        detail: TEXT.stepChainBody,
        action: {
          label: TEXT.stepChainAction,
          run: () => open('audit', null, { tab: 'integrity' }),
        },
      });
    const urgent = inc.high + inc.critical;
    if (urgent > 0)
      steps.push({
        id: 'inc-high',
        urgency: 'now',
        title: TEXT.stepIncidentsHigh(urgent),
        detail: TEXT.stepIncidentsHighBody,
        action: {
          label: TEXT.stepIncidentsAction,
          run: () => open('incidents', null, { status: 'active' }),
        },
      });
    const minor = inc.low + inc.medium;
    if (minor > 0)
      steps.push({
        id: 'inc-low',
        urgency: 'soon',
        title: TEXT.stepIncidentsLow(minor),
        detail: TEXT.stepIncidentsLowBody,
        action: {
          label: TEXT.stepIncidentsAction,
          run: () => open('incidents', null, { status: 'active' }),
        },
      });
    const accountsAction = (label: string, params: Record<string, string>) => ({
      label: label,
      run: () => open('accounts', null, params),
    });
    if (reg.withoutOwner > 0)
      steps.push({
        id: 'owner',
        urgency: 'now',
        title: TEXT.stepOwner(reg.withoutOwner),
        detail: TEXT.stepOwnerBody,
        action: accountsAction(TEXT.stepAccountsAction, { gap: 'owner' }),
      });
    if (reg.disconnected > 0)
      steps.push({
        id: 'disconnected',
        urgency: 'now',
        title: TEXT.stepDisconnected(reg.disconnected),
        detail: TEXT.stepDisconnectedBody,
        action: accountsAction(TEXT.stepAccountsAction, { status: 'disconnected' }),
      });
    if (reg.needsAttention > 0)
      steps.push({
        id: 'attention',
        urgency: 'soon',
        title: TEXT.stepAttention(reg.needsAttention),
        detail: TEXT.stepAttentionBody,
        action: accountsAction(TEXT.stepAccountsAction, { status: 'needs_attention' }),
      });
    if (reg.withoutBackupAdmin > 0)
      steps.push({
        id: 'backup',
        urgency: 'soon',
        title: TEXT.stepBackup(reg.withoutBackupAdmin),
        detail: TEXT.stepBackupBody,
        action: accountsAction(TEXT.stepAccountsAction, { gap: 'backup_admin' }),
      });
    if (reg.notConnectedToEngine > 0)
      steps.push({
        id: 'engine',
        urgency: 'soon',
        title: TEXT.stepNotConnected(reg.notConnectedToEngine),
        detail: TEXT.stepNotConnectedBody,
        action: accountsAction(TEXT.stepAccountsAction, { gap: 'engine_channel' }),
      });
    if (data.publishingFreezes > 0)
      steps.push({
        id: 'freezes',
        urgency: 'info',
        title: TEXT.stepFreezes(data.publishingFreezes),
        detail: TEXT.stepFreezesBody,
        action: { label: TEXT.stepFreezesAction, run: () => open('publishing') },
      });
    if (!data.twoFactorSignIn.enforced)
      steps.push({ id: 'mfa', urgency: 'soon', title: TEXT.stepMfa, detail: TEXT.stepMfaBody });
    if (data.newAdministrators.items.length > 0)
      steps.push({
        id: 'admins',
        urgency: 'info',
        title: TEXT.stepAdmins(data.newAdministrators.items.length, data.newAdministrators.days),
        detail: TEXT.stepAdminsBody,
        action: {
          label: TEXT.stepAdminsAction,
          run: () => open('audit', null, { quick: 'roles' }),
        },
      });
  }

  const adminColumns: GridColumn<NewAdministrator>[] = [
    {
      id: 'person',
      header: TEXT.person,
      sortValue: (row) => personName(row.userId),
      cell: (row) => <span className="post-title">{personName(row.userId)}</span>,
    },
    {
      id: 'role',
      header: TEXT.role,
      sortValue: (row) => (isRole(row.role) ? ROLE_LABELS[row.role] : row.role),
      cell: (row) => (isRole(row.role) ? ROLE_LABELS[row.role] : row.role),
    },
    {
      id: 'where',
      header: TEXT.where,
      sortValue: (row) => (row.companyId ? companyName(row.companyId) : TEXT.wholeGroup),
      cell: (row) => (row.companyId ? companyName(row.companyId) : TEXT.wholeGroup),
    },
    {
      id: 'granted',
      header: TEXT.granted,
      sortValue: (row) => new Date(row.grantedAt).getTime(),
      exportValue: (row) => row.grantedAt,
      cell: (row) => (
        <>
          {formatDateTime(row.grantedAt)}
          <span className="subline">{ageSince(row.grantedAt)} ago</span>
        </>
      ),
    },
    {
      id: 'open',
      header: '',
      cell: (row) =>
        row.userId && screenAllowed('access') ? (
          <button
            type="button"
            className="text-link"
            aria-label={`${TEXT.openPerson}: ${personName(row.userId)}`}
            onClick={() => open('access', row.userId)}
          >
            {TEXT.openPerson}
          </button>
        ) : null,
    },
  ];

  type RegistryRow = {
    id: string;
    label: string;
    hint: string;
    count: number;
    params: Record<string, string>;
    bad: 'red' | 'amber';
  };
  const registryRows: RegistryRow[] = data
    ? [
        {
          id: 'owner',
          label: TEXT.rowOwner,
          hint: TEXT.rowOwnerHint,
          count: data.accounts.withoutOwner,
          params: { gap: 'owner' },
          bad: 'red' as const,
        },
        {
          id: 'backup',
          label: TEXT.rowBackup,
          hint: TEXT.rowBackupHint,
          count: data.accounts.withoutBackupAdmin,
          params: { gap: 'backup_admin' },
          bad: 'amber' as const,
        },
        {
          id: 'engine',
          label: TEXT.rowEngine,
          hint: TEXT.rowEngineHint,
          count: data.accounts.notConnectedToEngine,
          params: { gap: 'engine_channel' },
          bad: 'amber' as const,
        },
        {
          id: 'attention',
          label: TEXT.rowAttention,
          hint: TEXT.rowAttentionHint,
          count: data.accounts.needsAttention,
          params: { status: 'needs_attention' },
          bad: 'amber' as const,
        },
        {
          id: 'disconnected',
          label: TEXT.rowDisconnected,
          hint: TEXT.rowDisconnectedHint,
          count: data.accounts.disconnected,
          params: { status: 'disconnected' },
          bad: 'red' as const,
        },
      ]
    : [];

  const liveHealth = healthOf(live);
  const readyHealth = healthOf(ready);

  return (
    <div className="gov">
      <PageHeader
        title={TEXT.title}
        description={
          data
            ? `${TEXT.description} ${TEXT.asOf(formatDateTime(data.generatedAt), ageSince(data.generatedAt))}.`
            : TEXT.description
        }
        actions={
          <>
            <button type="button" className="btn btn-outline" onClick={reload}>
              {TEXT.refresh}
            </button>
            <GatedButton
              allowed={mayFreeze}
              permission="publishing.freeze"
              className="btn btn-danger"
              onClick={() => setFreezing(true)}
            >
              {TEXT.freeze}
            </GatedButton>
          </>
        }
      />
      <ErrorBox error={posture.error} title={TEXT.loadFailed} loading />
      {!data && posture.loading && (
        <section className="panel">
          <PanelSkeleton lines={5} label="Reading the security overview…" />
        </section>
      )}

      {data && (
        <>
          <p className="gov-section-note" style={{ margin: 0 }}>
            {TEXT.scopeNote}
          </p>

          <SectionPanel title={TEXT.nextTitle} subtitle={TEXT.nextSubtitle}>
            <NextSteps
              steps={steps}
              empty={
                <Callout tone="ok" title={TEXT.nothing}>
                  {TEXT.nothingBody}
                </Callout>
              }
            />
          </SectionPanel>

          <FactStrip label="Security at a glance">
            <Fact
              label={TEXT.factAudit}
              value={data.auditTrail.chainOk ? TEXT.factAuditOk : TEXT.factAuditBad}
              note={
                data.auditTrail.chainOk
                  ? TEXT.factAuditNote(data.auditTrail.events)
                  : TEXT.factAuditBadNote(data.auditTrail.firstBrokenId)
              }
            />
            <Fact
              label={TEXT.factMfa}
              value={data.twoFactorSignIn.enforced ? TEXT.factMfaOn : TEXT.factMfaOff}
              note={data.twoFactorSignIn.enforced ? TEXT.mfaMeaning.on : 'See the note below'}
            />
            <Fact
              label={TEXT.factReauth}
              value={TEXT.factReauthValue(data.sensitiveActions.signInAgainAfterMinutes)}
              note={TEXT.factReauthNote}
            />
            <Fact
              label={TEXT.factFreezes}
              value={data.publishingFreezes === 0 ? TEXT.factFreezesNone : data.publishingFreezes}
              note={TEXT.factFreezesNote(data.publishingFreezes)}
            />
            <Fact
              label={TEXT.factAdmins}
              value={data.newAdministrators.items.length}
              note={TEXT.factAdminsNote(data.newAdministrators.days)}
            />
          </FactStrip>

          <div className="gov-two">
            <Callout tone={data.twoFactorSignIn.enforced ? 'ok' : 'warn'} title={TEXT.mfaNoteTitle}>
              {data.twoFactorSignIn.enforced ? TEXT.mfaMeaning.on : TEXT.mfaMeaning.off}
              <br />
              <em>{data.twoFactorSignIn.note}</em>
            </Callout>
            <Callout tone="info" title={TEXT.factReauth}>
              {TEXT.reauthMeaning}
            </Callout>
          </div>

          <div className="gov-two">
            <SectionPanel
              title={TEXT.accountsTitle}
              subtitle={TEXT.accountsSubtitle(data.accounts.total)}
            >
              <ul className="sec-rows">
                {registryRows.map((row) => (
                  <li key={row.id} className="sec-row">
                    <span className="sec-row-label">
                      <strong>{row.label}</strong>
                      <small>{row.hint}</small>
                    </span>
                    <span className="kit-bar-track" aria-hidden="true">
                      <span
                        className={`kit-bar-fill kit-tone-${row.count === 0 ? 'green' : row.bad}`}
                        style={{
                          width: `${data.accounts.total ? Math.round((row.count / data.accounts.total) * 100) : 0}%`,
                        }}
                      />
                    </span>
                    <span className="sec-row-count">
                      {row.count === 0 ? TEXT.allGood : row.count}
                      <small>{row.count === 0 ? '' : TEXT.ofTotal(data.accounts.total)}</small>
                    </span>
                    <span className="sec-link">
                      {screenAllowed('accounts') && (
                        <button
                          type="button"
                          className="text-link"
                          aria-label={`${TEXT.openList}: ${row.label}`}
                          onClick={() => open('accounts', null, row.params)}
                        >
                          {TEXT.openList}
                        </button>
                      )}
                    </span>
                  </li>
                ))}
              </ul>
            </SectionPanel>

            <SectionPanel title={TEXT.incidentsTitle} subtitle={TEXT.incidentsSubtitle}>
              {INCIDENT_SEVERITIES.every((severity) => data.openIncidents[severity] === 0) ? (
                <Callout tone="ok" title={TEXT.incidentsNone} />
              ) : null}
              <ul className="sec-rows">
                {[...INCIDENT_SEVERITIES].reverse().map((severity) => {
                  const count = data.openIncidents[severity];
                  const total = INCIDENT_SEVERITIES.reduce(
                    (sum, item) => sum + data.openIncidents[item],
                    0,
                  );
                  return (
                    <li key={severity} className="sec-row">
                      <span className="sec-row-label">
                        <strong>
                          <StatusChip status={INCIDENT_SEVERITY[severity]} />
                        </strong>
                      </span>
                      <span className="kit-bar-track" aria-hidden="true">
                        <span
                          className={`kit-bar-fill kit-tone-${count === 0 ? 'green' : INCIDENT_SEVERITY[severity].tone === 'blue' ? 'blue' : INCIDENT_SEVERITY[severity].tone}`}
                          style={{ width: `${total ? Math.round((count / total) * 100) : 0}%` }}
                        />
                      </span>
                      <span className="sec-row-count">{count}</span>
                      <span className="sec-link">
                        {count > 0 && screenAllowed('incidents') && (
                          <button
                            type="button"
                            className="text-link"
                            aria-label={`${TEXT.openThese}: ${INCIDENT_SEVERITY[severity].label}`}
                            onClick={() => open('incidents', null, { status: 'active', severity })}
                          >
                            {TEXT.openThese}
                          </button>
                        )}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </SectionPanel>
          </div>

          <SectionPanel
            title={TEXT.adminsTitle}
            subtitle={TEXT.adminsSubtitle(data.newAdministrators.days)}
            action={
              can('audit.read') ? (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => open('audit', null, { quick: 'roles' })}
                >
                  {TEXT.stepAdminsAction}
                </button>
              ) : undefined
            }
          >
            <DataGrid
              caption={TEXT.adminsCaption}
              columns={adminColumns}
              rows={data.newAdministrators.items.map((item, index) => ({ ...item, index }))}
              rowKey={(row) => String((row as NewAdministrator & { index: number }).index)}
              defaultSort={{ id: 'granted', direction: 'desc' }}
              exportName="new-administrators"
              onOpen={(row) => {
                if (row.userId && screenAllowed('access')) open('access', row.userId);
              }}
              empty={<EmptyState title={TEXT.noAdmins}>{TEXT.noAdminsBody}</EmptyState>}
            />
          </SectionPanel>

          {can('publishing.freeze') && (
            <SectionPanel
              title={TEXT.freezesTitle}
              subtitle={TEXT.freezesSubtitle}
              action={
                <button type="button" className="text-link" onClick={() => open('publishing')}>
                  {TEXT.stepFreezesAction}
                </button>
              }
            >
              <ErrorBox error={freezes.error} loading />
              {freezes.data && freezes.data.length === 0 && (
                <Callout tone="ok" title={TEXT.noFreezes} />
              )}
              {freezes.data && freezes.data.length > 0 && (
                <>
                  <ul className="sec-freeze-list">
                    {freezes.data.map((freeze) => (
                      <li key={freeze.id}>
                        <span>
                          <strong>{companyName(freeze.companyId)}</strong> ·{' '}
                          {accountName(freeze.socialAccountId)}
                          {freeze.reason && (
                            <span className="subline">Reason: {freeze.reason}</span>
                          )}
                          <span className="subline">
                            {TEXT.freezeBy(
                              personName(freeze.frozenBy),
                              formatDateTime(freeze.frozenAt),
                            )}
                          </span>
                        </span>
                        <StatusChip label="Frozen" tone="amber" />
                      </li>
                    ))}
                  </ul>
                  <p className="hint">{TEXT.liftHint}</p>
                </>
              )}
            </SectionPanel>
          )}

          <div className="gov-two">
            <SectionPanel title={TEXT.readinessTitle} subtitle={TEXT.readinessSubtitle}>
              <ul className="sec-checks">
                <li className="sec-check">
                  <span className="sec-check-body">
                    <strong>{TEXT.checkLive}</strong>
                    <span>{liveHealth.detail ?? TEXT.checkLiveBody}</span>
                  </span>
                  <HealthChip state={liveHealth.state} />
                </li>
                <li className="sec-check">
                  <span className="sec-check-body">
                    <strong>{TEXT.checkReady}</strong>
                    <span>{readyHealth.detail ?? TEXT.checkReadyBody}</span>
                  </span>
                  <HealthChip state={readyHealth.state} />
                </li>
                {ready.data?.checks &&
                  Object.entries(ready.data.checks).map(([name, result]) => (
                    <li key={name} className="sec-check">
                      <span className="sec-check-body">
                        <strong>{name === 'database' ? TEXT.checkDatabase : name}</strong>
                        <span>Reported by the readiness check.</span>
                      </span>
                      <StatusChip
                        label={result === 'up' ? TEXT.up : result === 'down' ? TEXT.down : result}
                        tone={result === 'up' ? 'green' : 'red'}
                      />
                    </li>
                  ))}
              </ul>
            </SectionPanel>

            <SectionPanel title={TEXT.engineTitle}>
              {!can('account.read') ? (
                <p className="gov-muted">{TEXT.engineNoAccess}</p>
              ) : (
                <>
                  <ErrorBox error={engine.error} loading />
                  {!engine.data && engine.loading && <PanelSkeleton lines={3} />}
                  {engine.data && (
                    <>
                      <ul className="sec-checks">
                        <li className="sec-check">
                          <span className="sec-check-body">
                            <strong>{TEXT.engineProvider}</strong>
                            <span>{engine.data.provider}</span>
                          </span>
                          <StatusChip
                            label={
                              engine.data.verification === 'verified'
                                ? TEXT.engineVerified
                                : TEXT.engineUnverified
                            }
                            tone={engine.data.verification === 'verified' ? 'green' : 'amber'}
                          />
                        </li>
                        <li className="sec-check">
                          <span className="sec-check-body">
                            <strong>{TEXT.enginePublish}</strong>
                          </span>
                          <StatusChip
                            label={engine.data.canPublish ? TEXT.yes : TEXT.no}
                            tone={engine.data.canPublish ? 'green' : 'red'}
                          />
                        </li>
                        <li className="sec-check">
                          <span className="sec-check-body">
                            <strong>{TEXT.engineInbox}</strong>
                          </span>
                          <StatusChip
                            label={engine.data.inbox ? TEXT.yes : TEXT.no}
                            tone={engine.data.inbox ? 'green' : 'gray'}
                          />
                        </li>
                        {engine.data.consoleUrl && (
                          <li className="sec-check">
                            <span className="sec-check-body">
                              <strong>{TEXT.engineConsole}</strong>
                              <span>Where an engine administrator connects networks.</span>
                            </span>
                            <a
                              className="text-link"
                              href={engine.data.consoleUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              {TEXT.engineConsoleOpen}
                            </a>
                          </li>
                        )}
                      </ul>
                      <p className="hint">{TEXT.engineVerifiedHint}</p>
                      {engine.data.notes.length > 0 && (
                        <>
                          <strong>{TEXT.engineNotes}</strong>
                          <ul className="sec-notes">
                            {engine.data.notes.map((note) => (
                              <li key={note}>{note}</li>
                            ))}
                          </ul>
                        </>
                      )}
                    </>
                  )}
                </>
              )}
            </SectionPanel>
          </div>

          <SectionPanel title={TEXT.notMonitored} subtitle={TEXT.notMonitoredSubtitle}>
            {data.notMonitored.length === 0 ? (
              <p className="gov-muted">{TEXT.nothingListed}</p>
            ) : (
              <ul className="sec-unmonitored">
                {data.notMonitored.map((item) => (
                  <li key={item}>
                    <StatusChip label={TEXT.notWatched} tone="gray" />
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </SectionPanel>
        </>
      )}

      {freezing && (
        <FreezeDialog
          onClose={() => setFreezing(false)}
          onFrozen={() => {
            setFreezing(false);
            posture.reload();
            freezes.reload();
            refreshNotifications();
          }}
        />
      )}
    </div>
  );
}
