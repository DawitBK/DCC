'use client';

import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  type IncidentDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import {
  BypassCheckButton,
  BypassCheckHint,
  BypassCheckResult,
  type BypassCheckState,
} from '@/components/bypass-check';
import { EmptyState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import {
  FactStrip,
  GatedButton,
  PanelSkeleton,
  ageSince,
  secondsBetween,
} from '@/components/gov-parts';
import { IncidentPage, BYPASS_TITLE_PREFIX } from '@/components/incident-page';
import { CreateIncidentDialog } from '@/components/incident-forms';
import { IncidentSetup } from '@/components/incident-setup';
import { DataGrid, type GridColumn } from '@/components/kit/data-grid';
import { PageHeader } from '@/components/kit/page-header';
import { Fact } from '@/components/kit/parts';
import { TabPanel, Tabs, useTabParam } from '@/components/kit/tabs';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { formatDateTime, formatDuration, shortId } from '@/lib/format';
import { INCIDENT_SEVERITY, INCIDENT_STATUS, PLATFORM_LABELS } from '@/lib/labels';
import { whoCanText } from '@/lib/permissions-ui';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import './governance.css';
import './incidents-screen.css';

const DAY_MS = 86_400_000;
const ACTIVE = 'active';

const TEXT = {
  title: 'Incidents',
  description:
    'Register an incident, follow it through its playbook, call the right people and record when it is resolved.',
  tabsLabel: 'Incident sections',
  tabRegister: 'Register',
  tabSetup: 'Setup: categories, playbooks and contacts',
  report: 'Report an incident',
  checkBypass: 'Check for posts DCC did not send',
  status: 'Status',
  severity: 'Severity',
  allStatuses: 'All statuses',
  activeStatuses: 'Open or investigating',
  allSeverities: 'All severities',
  filtersLabel: 'Filter the register',
  factOpen: 'Open now',
  factOpenNote: (open: number, investigating: number) =>
    `${open} open · ${investigating} being investigated`,
  factUrgent: 'High or critical, open',
  factUrgentNote: 'These need a person now',
  factOldest: 'Oldest open',
  factOldestNone: 'None',
  factOldestNote: (title: string) => title,
  factResolved: 'Resolved, last 30 days',
  factResolvedNote: 'Resolved or closed',
  factMedian: 'Median time to resolve',
  factMedianNote: 'Of those resolved in the last 30 days',
  factNone: '—',
  register: 'Incident register',
  subtitle: (shown: number, total: number) =>
    shown === total
      ? `${total} ${total === 1 ? 'incident' : 'incidents'} you may read`
      : `${shown} of ${total} incidents (the status and severity filters above are on)`,
  caption: 'Incidents',
  colIncident: 'Incident',
  colSeverity: 'Severity',
  colStatus: 'Status',
  colCompany: 'Company',
  colAccount: 'Account',
  colCategory: 'Category',
  colOpenedBy: 'Opened by',
  colOpened: 'Opened',
  colResolved: 'Resolved',
  colAge: 'Age',
  noAccount: '—',
  noCategory: '—',
  stillOpen: 'Not yet',
  ageOpen: (age: string) => `${age} open`,
  ageResolved: (age: string) => `${age} to resolve`,
  bypassChip: 'Found by the bypass check',
  source: 'Source',
  sourceBypass: 'Found by the bypass check',
  sourcePeople: 'Reported by a person',
  category: 'Category',
  noCategoryOption: 'No category',
  account: 'Account',
  emptyTitle: 'No incidents are registered',
  emptyBodyManage:
    'Nothing has gone wrong that anyone wrote down. When something does, report it here so the right people are told and the playbook is at hand.',
  emptyBodyRead: (roles: string) =>
    `Incidents are reported by people who manage them. Roles that can: ${roles}.`,
  loadFailed: 'The incidents could not be loaded',
  openLabel: (title: string) => `Open incident: ${title}`,
};

type StatusFilter = '' | typeof ACTIVE | (typeof INCIDENT_STATUSES)[number];

function isActive(row: IncidentDto): boolean {
  return row.status === 'open' || row.status === 'investigating';
}

/** `GET /api/incidents`, `GET /api/incidents/:id`, `POST /api/incidents`, `PATCH /api/incidents/:id`. */
export function IncidentsScreen() {
  const { detailId } = useWorkspace();
  return detailId ? <IncidentPage key={detailId} id={detailId} /> : <IncidentRegister />;
}

function IncidentRegister() {
  const { companyId, companyName, can, companiesWhere, personName, open, refreshNotifications } =
    useWorkspace();
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const [tab, setTab] = useTabParam(['register', 'setup'], 'register');
  const incidents = useApiData<IncidentDto[]>('/incidents');
  const accounts = useApiData<SocialAccountDto[]>(can('account.read') ? '/social-accounts' : null);
  const [creating, setCreating] = useState(false);
  const [bypass, setBypass] = useState<BypassCheckState | null>(null);
  const mayManage = companiesWhere('incident.manage').length > 0;

  const statusParam = params.get('status') ?? '';
  const status: StatusFilter =
    statusParam === ACTIVE || (INCIDENT_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as StatusFilter)
      : '';
  const severityParam = params.get('severity') ?? '';
  const severity = (INCIDENT_SEVERITIES as readonly string[]).includes(severityParam)
    ? severityParam
    : '';
  const setFilter = (key: 'status' | 'severity', value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const text = next.toString();
    router.replace(`${pathname}${text ? `?${text}` : ''}`, { scroll: false });
  };

  const scoped = useMemo(
    () => (incidents.data ?? []).filter((row) => !companyId || row.companyId === companyId),
    [incidents.data, companyId],
  );
  const visible = scoped.filter(
    (row) =>
      (status === '' || (status === ACTIVE ? isActive(row) : row.status === status)) &&
      (!severity || row.severity === severity),
  );

  const stats = useMemo(() => {
    const now = Date.now();
    const active = scoped.filter(isActive);
    const urgent = active.filter((row) => row.severity === 'high' || row.severity === 'critical');
    const oldest = [...active].sort(
      (a, b) => new Date(a.openedAt).getTime() - new Date(b.openedAt).getTime(),
    )[0];
    const recent = scoped.filter(
      (row) => row.resolvedAt && now - new Date(row.resolvedAt).getTime() <= 30 * DAY_MS,
    );
    const durations = recent
      .map((row) => secondsBetween(row.openedAt, row.resolvedAt))
      .filter((value): value is number => value !== null)
      .sort((a, b) => a - b);
    const median =
      durations.length === 0
        ? null
        : durations.length % 2
          ? durations[(durations.length - 1) / 2]!
          : (durations[durations.length / 2 - 1]! + durations[durations.length / 2]!) / 2;
    return {
      open: active.filter((row) => row.status === 'open').length,
      investigating: active.filter((row) => row.status === 'investigating').length,
      urgent: urgent.length,
      oldest,
      resolved: recent.length,
      median,
    };
  }, [scoped]);

  const accountName = (id: string | null) => {
    if (!id) return TEXT.noAccount;
    const account = accounts.data?.find((item) => item.id === id);
    return account ? `${account.displayName} (${PLATFORM_LABELS[account.platform]})` : shortId(id);
  };
  const isBypass = (row: IncidentDto) => row.title.startsWith(BYPASS_TITLE_PREFIX);

  const columns: GridColumn<IncidentDto>[] = [
    {
      id: 'incident',
      header: TEXT.colIncident,
      sortValue: (row) => row.title,
      exportValue: (row) => row.title,
      cell: (row) => (
        <span className="inc-title-cell">
          <button
            type="button"
            className="inc-open-link"
            aria-label={TEXT.openLabel(row.title)}
            onClick={() => open('incidents', row.id)}
          >
            {row.title}
          </button>
          <span className="subline gov-mono">{shortId(row.id)}</span>
          {isBypass(row) && (
            <span>
              <StatusChip label={TEXT.bypassChip} tone="blue" />
            </span>
          )}
        </span>
      ),
    },
    {
      id: 'severity',
      header: TEXT.colSeverity,
      sortValue: (row) => INCIDENT_SEVERITIES.indexOf(row.severity),
      exportValue: (row) => INCIDENT_SEVERITY[row.severity].label,
      cell: (row) => <StatusChip status={INCIDENT_SEVERITY[row.severity]} />,
    },
    {
      id: 'status',
      header: TEXT.colStatus,
      sortValue: (row) => INCIDENT_STATUSES.indexOf(row.status),
      exportValue: (row) => INCIDENT_STATUS[row.status].label,
      cell: (row) => <StatusChip status={INCIDENT_STATUS[row.status]} />,
    },
    {
      id: 'company',
      header: TEXT.colCompany,
      sortValue: (row) => companyName(row.companyId),
      cell: (row) => companyName(row.companyId),
    },
    {
      id: 'account',
      header: TEXT.colAccount,
      sortValue: (row) => (row.socialAccountId ? accountName(row.socialAccountId) : null),
      exportValue: (row) => accountName(row.socialAccountId),
      cell: (row) => accountName(row.socialAccountId),
    },
    {
      id: 'category',
      header: TEXT.colCategory,
      sortValue: (row) => row.category?.name ?? null,
      exportValue: (row) => row.category?.name ?? '',
      cell: (row) => row.category?.name ?? TEXT.noCategory,
    },
    {
      id: 'openedBy',
      header: TEXT.colOpenedBy,
      sortValue: (row) => personName(row.openedBy),
      exportValue: (row) => personName(row.openedBy),
      cell: (row) => personName(row.openedBy),
    },
    {
      id: 'opened',
      header: TEXT.colOpened,
      sortValue: (row) => new Date(row.openedAt).getTime(),
      exportValue: (row) => row.openedAt,
      cell: (row) => (
        <>
          {formatDateTime(row.openedAt)}
          <span className="subline">{ageSince(row.openedAt)} ago</span>
        </>
      ),
    },
    {
      id: 'resolved',
      header: TEXT.colResolved,
      sortValue: (row) => (row.resolvedAt ? new Date(row.resolvedAt).getTime() : null),
      exportValue: (row) => row.resolvedAt ?? '',
      cell: (row) => (row.resolvedAt ? formatDateTime(row.resolvedAt) : TEXT.stillOpen),
    },
    {
      id: 'age',
      header: TEXT.colAge,
      hiddenByDefault: true,
      sortValue: (row) =>
        row.resolvedAt
          ? (secondsBetween(row.openedAt, row.resolvedAt) ?? 0)
          : (Date.now() - new Date(row.openedAt).getTime()) / 1000,
      exportValue: (row) =>
        row.resolvedAt
          ? TEXT.ageResolved(formatDuration(secondsBetween(row.openedAt, row.resolvedAt)))
          : TEXT.ageOpen(ageSince(row.openedAt)),
      cell: (row) =>
        row.resolvedAt
          ? TEXT.ageResolved(formatDuration(secondsBetween(row.openedAt, row.resolvedAt)))
          : TEXT.ageOpen(ageSince(row.openedAt)),
    },
  ];

  const categoryNames = [
    ...new Set(scoped.flatMap((row) => (row.category ? [row.category.name] : []))),
  ].sort();

  return (
    <div className="gov">
      <PageHeader
        title={TEXT.title}
        description={TEXT.description}
        actions={
          <>
            {mayManage ? (
              <BypassCheckButton
                onChange={setBypass}
                onDone={() => {
                  incidents.reload();
                  refreshNotifications();
                }}
              />
            ) : (
              <GatedButton allowed={false} permission="incident.manage" onClick={() => undefined}>
                {TEXT.checkBypass}
              </GatedButton>
            )}
            <GatedButton
              allowed={mayManage}
              permission="incident.manage"
              className="btn btn-primary"
              onClick={() => setCreating(true)}
            >
              {TEXT.report}
            </GatedButton>
          </>
        }
        tabs={
          <Tabs
            label={TEXT.tabsLabel}
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'register', label: TEXT.tabRegister, count: scoped.length },
              { id: 'setup', label: TEXT.tabSetup },
            ]}
          />
        }
      />
      <BypassCheckResult state={bypass} />
      <ErrorBox error={incidents.error} title={TEXT.loadFailed} loading />

      {tab === 'register' && (
        <TabPanel id="register">
          <div className="gov-stack">
            {mayManage && <BypassCheckHint />}
            {incidents.data && (
              <FactStrip label="Incidents at a glance">
                <Fact
                  label={TEXT.factOpen}
                  value={stats.open + stats.investigating}
                  note={TEXT.factOpenNote(stats.open, stats.investigating)}
                />
                <Fact label={TEXT.factUrgent} value={stats.urgent} note={TEXT.factUrgentNote} />
                <Fact
                  label={TEXT.factOldest}
                  value={stats.oldest ? ageSince(stats.oldest.openedAt) : TEXT.factOldestNone}
                  note={stats.oldest ? TEXT.factOldestNote(stats.oldest.title) : undefined}
                />
                <Fact
                  label={TEXT.factResolved}
                  value={stats.resolved}
                  note={TEXT.factResolvedNote}
                />
                <Fact
                  label={TEXT.factMedian}
                  value={stats.median === null ? TEXT.factNone : formatDuration(stats.median)}
                  note={TEXT.factMedianNote}
                />
              </FactStrip>
            )}

            <SectionPanel
              title={TEXT.register}
              subtitle={incidents.data ? TEXT.subtitle(visible.length, scoped.length) : undefined}
            >
              <div className="inc-filters" role="group" aria-label={TEXT.filtersLabel}>
                <div className="inc-filter-group">
                  <label htmlFor="inc-status">{TEXT.status}</label>
                  <select
                    id="inc-status"
                    className="select-field"
                    style={{ width: 'auto' }}
                    value={status}
                    onChange={(event) => setFilter('status', event.target.value)}
                  >
                    <option value="">{TEXT.allStatuses}</option>
                    <option value={ACTIVE}>{TEXT.activeStatuses}</option>
                    {INCIDENT_STATUSES.map((value) => (
                      <option key={value} value={value}>
                        {INCIDENT_STATUS[value].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="inc-filter-group">
                  <label htmlFor="inc-severity-filter">{TEXT.severity}</label>
                  <select
                    id="inc-severity-filter"
                    className="select-field"
                    style={{ width: 'auto' }}
                    value={severity}
                    onChange={(event) => setFilter('severity', event.target.value)}
                  >
                    <option value="">{TEXT.allSeverities}</option>
                    {INCIDENT_SEVERITIES.map((value) => (
                      <option key={value} value={value}>
                        {INCIDENT_SEVERITY[value].label}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <div style={{ marginTop: 14 }}>
                {!incidents.data && incidents.loading ? (
                  <PanelSkeleton lines={6} label="Reading the incidents…" />
                ) : (
                  incidents.data && (
                    <div className="inc-grid">
                      <DataGrid
                        caption={TEXT.caption}
                        columns={columns}
                        rows={visible}
                        rowKey={(row) => row.id}
                        defaultSort={{ id: 'opened', direction: 'desc' }}
                        searchText={(row) =>
                          [
                            row.title,
                            row.description ?? '',
                            row.id,
                            companyName(row.companyId),
                            accountName(row.socialAccountId),
                            row.category?.name ?? '',
                            personName(row.openedBy),
                          ].join(' ')
                        }
                        filters={[
                          {
                            id: 'source',
                            label: TEXT.source,
                            options: [
                              { value: 'bypass', label: TEXT.sourceBypass },
                              { value: 'people', label: TEXT.sourcePeople },
                            ],
                            test: (row, value) => (value === 'bypass') === isBypass(row),
                          },
                          {
                            id: 'category',
                            label: TEXT.category,
                            options: [
                              { value: '__none', label: TEXT.noCategoryOption },
                              ...categoryNames.map((name) => ({ value: name, label: name })),
                            ],
                            test: (row, value) =>
                              value === '__none' ? !row.category : row.category?.name === value,
                          },
                        ]}
                        exportName="incidents"
                        onOpen={(row) => open('incidents', row.id)}
                        rowTone={(row) =>
                          isActive(row) && (row.severity === 'critical' || row.severity === 'high')
                            ? `inc-sev-${row.severity}`
                            : undefined
                        }
                        empty={
                          <EmptyState title={TEXT.emptyTitle}>
                            {mayManage
                              ? TEXT.emptyBodyManage
                              : TEXT.emptyBodyRead(whoCanText('incident.manage'))}
                          </EmptyState>
                        }
                      />
                    </div>
                  )
                )}
              </div>
            </SectionPanel>
          </div>
        </TabPanel>
      )}

      {tab === 'setup' && (
        <TabPanel id="setup">
          <IncidentSetup onChanged={incidents.reload} />
        </TabPanel>
      )}

      {creating && (
        <CreateIncidentDialog
          accounts={accounts.data ?? []}
          initialCompanyId={companyId}
          onClose={() => setCreating(false)}
          onSaved={(created) => {
            setCreating(false);
            incidents.reload();
            refreshNotifications();
            open('incidents', created.id);
          }}
        />
      )}
    </div>
  );
}
