'use client';

import { INCIDENT_SEVERITIES, ROLE_LABELS, isRole, type SecurityPostureDto } from '@dcc/contracts';
import { DataTable } from '@/components/data-table';
import { EmptyState, LoadingState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatCard } from '@/components/stat-card';
import { StatusChip } from '@/components/status-chip';
import { formatDateTime } from '@/lib/format';
import { INCIDENT_SEVERITY } from '@/lib/labels';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const TEXT = {
  title: 'Security center',
  description: 'What DCC itself knows about its security state, and what it does not watch.',
  refresh: 'Read again',
  generated: (when: string) => `As of ${when}`,
  audit: 'Audit trail',
  auditOk: 'Chain intact',
  auditBroken: 'Chain broken',
  auditFoot: (events: number) => `${events} events checked`,
  firstBroken: (id: string) => `First broken entry: ${id}`,
  twoFactor: 'Two-step sign-in',
  enforced: 'Enforced',
  notEnforced: 'Not enforced',
  freezes: 'Publishing freezes',
  freezesFoot: 'Active now',
  reauth: 'Sign in again for sensitive actions',
  reauthValue: (minutes: number) => `after ${minutes} min`,
  reauthFoot: 'Roles, lifting a freeze, audit export, approval rules',
  accounts: 'Account register',
  accountsSubtitle: 'Gaps in the register of official accounts',
  total: 'Accounts',
  withoutOwner: 'Without an owner',
  withoutBackup: 'Without a backup administrator',
  notConnected: 'Not connected to the engine',
  needsAttention: 'Need attention',
  disconnected: 'Disconnected',
  incidents: 'Open incidents by severity',
  admins: 'New administrators',
  adminsSubtitle: (days: number) => `Administrator roles given in the last ${days} days`,
  adminsCaption: 'Recently granted administrator roles',
  person: 'Person',
  role: 'Role',
  where: 'Where',
  wholeGroup: 'Whole group',
  granted: 'Given',
  noAdmins: 'No new administrators in this period',
  notMonitored: 'Not monitored by DCC',
  notMonitoredSubtitle: 'DCC has no signal for these. Nothing on this screen says they are fine.',
  nothingListed: 'The API lists nothing here.',
};

/** `GET /api/security/posture`: only what DCC really knows; `notMonitored` is shown as it is. */
export function SecurityScreen() {
  const { companyName, personName } = useWorkspace();
  const posture = useApiData<SecurityPostureDto>('/security/posture');
  const data = posture.data;

  return (
    <>
      <PageTitle
        title={TEXT.title}
        description={data ? TEXT.generated(formatDateTime(data.generatedAt)) : TEXT.description}
        action={
          <button className="btn btn-outline" onClick={posture.reload}>
            {TEXT.refresh}
          </button>
        }
      />
      <ErrorBox error={posture.error} loading />
      {!data && posture.loading && <LoadingState />}
      {data && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 18 }}>
            <StatCard
              label={TEXT.audit}
              value={data.auditTrail.chainOk ? TEXT.auditOk : TEXT.auditBroken}
              foot={
                data.auditTrail.firstBrokenId
                  ? TEXT.firstBroken(data.auditTrail.firstBrokenId)
                  : TEXT.auditFoot(data.auditTrail.events)
              }
              icon={data.auditTrail.chainOk ? '✓' : '!'}
            />
            <StatCard
              label={TEXT.twoFactor}
              value={data.twoFactorSignIn.enforced ? TEXT.enforced : TEXT.notEnforced}
              foot={data.twoFactorSignIn.note}
              icon="⬡"
            />
            <StatCard
              label={TEXT.reauth}
              value={TEXT.reauthValue(data.sensitiveActions.signInAgainAfterMinutes)}
              foot={TEXT.reauthFoot}
              icon="↻"
            />
            <StatCard
              label={TEXT.freezes}
              value={String(data.publishingFreezes)}
              foot={TEXT.freezesFoot}
              icon="◷"
            />
          </div>
          <div className="grid grid-2" style={{ marginBottom: 18 }}>
            <SectionPanel title={TEXT.accounts} subtitle={TEXT.accountsSubtitle}>
              <dl className="definition-grid">
                {(
                  [
                    [TEXT.total, data.accounts.total],
                    [TEXT.withoutOwner, data.accounts.withoutOwner],
                    [TEXT.withoutBackup, data.accounts.withoutBackupAdmin],
                    [TEXT.notConnected, data.accounts.notConnectedToEngine],
                    [TEXT.needsAttention, data.accounts.needsAttention],
                    [TEXT.disconnected, data.accounts.disconnected],
                  ] as const
                ).map(([label, value]) => (
                  <div key={label}>
                    <dt>{label}</dt>
                    <dd>{value}</dd>
                  </div>
                ))}
              </dl>
            </SectionPanel>
            <SectionPanel title={TEXT.incidents}>
              <dl className="definition-grid">
                {INCIDENT_SEVERITIES.map((severity) => (
                  <div key={severity}>
                    <dt>{INCIDENT_SEVERITY[severity].label}</dt>
                    <dd>{data.openIncidents[severity]}</dd>
                  </div>
                ))}
              </dl>
            </SectionPanel>
          </div>
          <div style={{ marginBottom: 18 }}>
            <SectionPanel
              title={TEXT.admins}
              subtitle={TEXT.adminsSubtitle(data.newAdministrators.days)}
            >
              <DataTable
                caption={TEXT.adminsCaption}
                rows={data.newAdministrators.items.map((item, index) => ({ ...item, index }))}
                rowKey={(row) => String(row.index)}
                empty={<EmptyState title={TEXT.noAdmins} />}
                columns={[
                  { header: TEXT.person, cell: (row) => personName(row.userId) },
                  {
                    header: TEXT.role,
                    cell: (row) => (isRole(row.role) ? ROLE_LABELS[row.role] : row.role),
                  },
                  {
                    header: TEXT.where,
                    cell: (row) => (row.companyId ? companyName(row.companyId) : TEXT.wholeGroup),
                  },
                  { header: TEXT.granted, cell: (row) => formatDateTime(row.grantedAt) },
                ]}
              />
            </SectionPanel>
          </div>
          <SectionPanel title={TEXT.notMonitored} subtitle={TEXT.notMonitoredSubtitle}>
            {data.notMonitored.length === 0 ? (
              <small className="hint">{TEXT.nothingListed}</small>
            ) : (
              <ul className="plain-list">
                {data.notMonitored.map((item) => (
                  <li key={item}>
                    <StatusChip label={TEXT.notMonitored} tone="gray" /> {item}
                  </li>
                ))}
              </ul>
            )}
          </SectionPanel>
        </>
      )}
    </>
  );
}
