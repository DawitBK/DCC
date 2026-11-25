'use client';

import { useId, useMemo, useState } from 'react';
import {
  INCIDENT_SEVERITIES,
  type AuditEventDto,
  type IncidentContactDto,
  type IncidentDto,
  type IncidentSeverity,
  type IncidentStatus,
  type SocialAccountDto,
} from '@dcc/contracts';
import { AuditFeed, humanize } from '@/components/audit-event';
import {
  BypassCheckButton,
  BypassCheckResult,
  type BypassCheckState,
} from '@/components/bypass-check';
import { ErrorBox } from '@/components/error-box';
import {
  FactStrip,
  GatedButton,
  PanelSkeleton,
  ageSince,
  secondsBetween,
} from '@/components/gov-parts';
import { ContactValue } from '@/components/incident-detail';
import { EditIncidentDialog, StatusDialog } from '@/components/incident-forms';
import { PageHeader } from '@/components/kit/page-header';
import { Callout, CopyId, DescriptionList, Fact, Timeline } from '@/components/kit/parts';
import { TabPanel, Tabs, useTabParam } from '@/components/kit/tabs';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { useToast } from '@/components/toast';
import { apiSend, queryString } from '@/lib/browser-api';
import { formatDateTime, formatDuration } from '@/lib/format';
import { CONTACT_CHANNEL, INCIDENT_SEVERITY, INCIDENT_STATUS, PLATFORM_LABELS } from '@/lib/labels';
import { needsRoleHint, whoCanText } from '@/lib/permissions-ui';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import '@/app/screens/governance.css';
import '@/app/screens/incidents-screen.css';

/** The title the check for posts DCC did not send gives its incidents (`publications.service.ts`). */
export const BYPASS_TITLE_PREFIX = 'Suspected bypass post ';

const TEXT = {
  incidents: 'Incidents',
  eyebrow: 'Incident',
  notFoundTitle: 'This incident could not be opened',
  back: 'Back to the incidents',
  edit: 'Edit details',
  tabsLabel: 'Incident sections',
  tabOverview: 'Overview',
  tabResponse: 'Playbook and contacts',
  tabHistory: 'History',
  factSeverity: 'Severity',
  factStatus: 'Status',
  factOpenFor: 'Open for',
  factResolvedAfter: 'Resolved after',
  factOpened: 'Opened',
  factCompany: 'Company',
  factCategory: 'Category',
  noCategory: 'None',
  bypassChip: 'Found by the bypass check',
  descriptionTitle: 'What happened',
  noDescription: 'Nobody wrote a description for this incident.',
  bypassTitle: 'Why this incident exists',
  bypassBody:
    'DCC compared the posts the publishing engine holds with the posts DCC itself sent. This one was not sent by DCC, so it was registered here as a suspected bypass. The check only reads: it sends and deletes nothing, and it never changes an incident that a person resolved or closed.',
  bypassEvidence: 'Evidence the engine gave',
  bypassCoverage:
    'It sees posts the engine knows about. A post made directly on a network is not covered.',
  statusTitle: 'Move this incident on',
  statusSubtitle: 'Each change is recorded. You are asked to confirm first.',
  readOnly: 'Your role can read this incident but not change it.',
  severityLabel: 'Severity',
  severitySave: 'Save severity',
  severitySaved: 'The severity was changed.',
  severityNow: 'Already set',
  factsTitle: 'About this incident',
  rowCompany: 'Company',
  rowAccount: 'Social account',
  noAccount: 'Not tied to one account',
  rowCategory: 'Category',
  rowSeverity: 'Severity',
  rowStatus: 'Status',
  rowOpenedBy: 'Opened by',
  rowOpenedAt: 'Opened',
  rowResolved: 'Resolved',
  notResolved: 'Not resolved',
  rowId: 'Incident id',
  // response
  playbookTitle: 'Playbook',
  noCategoryTitle: 'This incident has no category, so there is no playbook',
  noCategoryBody: 'Choose a category in “Edit details” to see its playbook here.',
  noPlaybookTitle: 'This category has no playbook yet',
  noPlaybookBody: 'The Group writes playbooks in the incident setup.',
  archivedNote: 'This category is archived. It stays on incidents that already have it.',
  openSetup: 'Open the incident setup',
  stepsTicked: (done: number, total: number) => `${done} of ${total} steps ticked`,
  localNote:
    'The ticks are only on this page, in your browser. They are not saved, not shared with anyone and not on the record, and they are gone when you leave the page.',
  resetTicks: 'Clear the ticks',
  contactsTitle: 'Who to call',
  contactsSubtitle: 'The company’s recovery contacts, in order. They need no DCC account.',
  noContactsTitle: 'No recovery contact has been entered for this company yet',
  noContactsBody: 'Someone who manages incidents adds them in the incident setup.',
  copy: 'Copy',
  copied: 'Copied',
  copyLabel: (name: string) => `Copy the contact detail of ${name}`,
  // history
  historyTitle: 'History',
  historySubtitle: 'Newest first. Every change to this incident is on the record.',
  historyFromAudit: 'Read from the audit trail.',
  noAuditTitle: 'The full history is not shown to your role',
  noAuditBody: (roles: string) =>
    `Reading the audit trail needs one of these roles: ${roles}. Below is what the incident itself records.`,
  openAudit: 'Open these events in the activity audit',
  selfRecord: 'What the incident itself records',
  openedEvent: (who: string) => `Opened by ${who}`,
  resolvedEvent: (status: string) => `Marked ${status.toLowerCase()}`,
  noEvents: 'No events were found for this incident.',
  auditError: 'The history could not be loaded',
  accountsHint: 'Account names need the right to see social accounts.',
};

const FLOW: Record<IncidentStatus, { to: IncidentStatus; label: string; primary?: boolean }[]> = {
  open: [
    { to: 'investigating', label: 'Start investigating', primary: true },
    { to: 'resolved', label: 'Mark resolved' },
    { to: 'closed', label: 'Close' },
  ],
  investigating: [
    { to: 'resolved', label: 'Mark resolved', primary: true },
    { to: 'open', label: 'Back to open' },
    { to: 'closed', label: 'Close' },
  ],
  resolved: [
    { to: 'closed', label: 'Close', primary: true },
    { to: 'investigating', label: 'Reopen and investigate' },
    { to: 'open', label: 'Reopen' },
  ],
  closed: [
    { to: 'open', label: 'Reopen', primary: true },
    { to: 'investigating', label: 'Reopen and investigate' },
  ],
};

/** The evidence of a bypass incident is kept as a JSON text in its description. */
function readEvidence(description: string | null): Record<string, unknown> | null {
  if (!description?.startsWith('{')) return null;
  try {
    const value = JSON.parse(description) as unknown;
    return value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function evidenceValue(key: string, value: unknown) {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string' && /date|at$/i.test(key) && !Number.isNaN(Date.parse(value)))
    return formatDateTime(value);
  if (typeof value === 'string' && /^https?:\/\//.test(value))
    return (
      <a className="text-link" href={value} target="_blank" rel="noopener noreferrer">
        {value}
      </a>
    );
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

function ContactCard({ contact }: { contact: IncidentContactDto }) {
  const [copied, setCopied] = useState(false);
  return (
    <li className="inc-contact">
      <span className="inc-contact-name">
        <strong>{contact.name}</strong>
        <span>{contact.roleLabel}</span>
      </span>
      <StatusChip label={CONTACT_CHANNEL[contact.channel]} tone="gray" />
      <span className="inc-contact-way">
        <ContactValue contact={contact} />
        <button
          type="button"
          className="inc-copy"
          aria-label={TEXT.copyLabel(contact.name)}
          onClick={() => {
            void navigator.clipboard?.writeText(contact.value).then(() => {
              setCopied(true);
              window.setTimeout(() => setCopied(false), 1500);
            });
          }}
        >
          <span aria-live="polite">{copied ? TEXT.copied : TEXT.copy}</span>
        </button>
      </span>
    </li>
  );
}

/** The playbook as a numbered checklist. The ticks live in this component only: nothing is stored. */
function PlaybookChecklist({ incident }: { incident: IncidentDto }) {
  const uid = useId();
  const [done, setDone] = useState<Set<number>>(new Set());
  const category = incident.category;
  const playbook = category?.playbook;
  if (!playbook) return null;
  const total = playbook.steps.length;
  return (
    <>
      <div className="inc-check-head">
        <strong>{playbook.title}</strong>
        <span className="gov-muted" role="status">
          {TEXT.stepsTicked(done.size, total)}
        </span>
      </div>
      <div
        className="inc-progress"
        role="progressbar"
        aria-label={TEXT.stepsTicked(done.size, total)}
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={done.size}
      >
        <span style={{ width: `${Math.round((done.size / total) * 100)}%` }} />
      </div>
      <ol className="inc-steps">
        {playbook.steps.map((step, index) => (
          <li key={`${index}:${step}`} className="inc-step" data-done={done.has(index)}>
            <input
              id={`${uid}-${index}`}
              type="checkbox"
              checked={done.has(index)}
              onChange={() =>
                setDone((now) => {
                  const next = new Set(now);
                  if (next.has(index)) next.delete(index);
                  else next.add(index);
                  return next;
                })
              }
            />
            <label htmlFor={`${uid}-${index}`} className="inc-step-text">
              {step}
            </label>
          </li>
        ))}
      </ol>
      <p className="hint inc-local-note">{TEXT.localNote}</p>
      {done.size > 0 && (
        <button type="button" className="text-link" onClick={() => setDone(new Set())}>
          {TEXT.resetTicks}
        </button>
      )}
    </>
  );
}

/** `GET /api/incidents/:id`, `PATCH /api/incidents/:id`, and the incident's own events from `GET /api/audit`. */
export function IncidentPage({ id }: { id: string }) {
  const { can, companyName, personName, open, screenAllowed, refreshNotifications } =
    useWorkspace();
  const showToast = useToast();
  const severityAction = useAction();
  const [tab, setTab] = useTabParam(['overview', 'response', 'history'], 'overview');
  const incident = useApiData<IncidentDto>(`/incidents/${id}`);
  const accounts = useApiData<SocialAccountDto[]>(can('account.read') ? '/social-accounts' : null);
  const data = incident.data;
  const mayManage = data ? can('incident.manage', data.companyId) : false;
  const mayAudit = data ? can('audit.read', data.companyId) : false;
  const audit = useApiData<AuditEventDto[]>(
    mayAudit ? `/audit${queryString({ targetType: 'incident', targetId: id, limit: 200 })}` : null,
  );
  const [editing, setEditing] = useState(false);
  const [moving, setMoving] = useState<IncidentStatus | null>(null);
  const [severity, setSeverity] = useState<IncidentSeverity | ''>('');
  const [bypass, setBypass] = useState<BypassCheckState | null>(null);

  const account = data?.socialAccountId
    ? accounts.data?.find((item) => item.id === data.socialAccountId)
    : undefined;
  const accountLabel = data?.socialAccountId
    ? account
      ? `${account.displayName} (${PLATFORM_LABELS[account.platform]})`
      : data.socialAccountId.slice(0, 8)
    : TEXT.noAccount;
  const evidence = useMemo(() => (data ? readEvidence(data.description) : null), [data]);
  const isBypass = Boolean(data?.title.startsWith(BYPASS_TITLE_PREFIX));

  const reload = () => {
    incident.reload();
    audit.reload();
    refreshNotifications();
  };

  const backCrumb = { label: TEXT.incidents, onClick: () => open('incidents') };

  if (incident.error) {
    return (
      <div className="gov">
        <PageHeader
          eyebrow={TEXT.eyebrow}
          title={TEXT.notFoundTitle}
          crumbs={[backCrumb, { label: TEXT.notFoundTitle }]}
        />
        <ErrorBox error={incident.error} title={TEXT.notFoundTitle} loading />
        <div>
          <button type="button" className="btn btn-outline" onClick={() => open('incidents')}>
            {TEXT.back}
          </button>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="gov">
        <PageHeader eyebrow={TEXT.eyebrow} title="Incident" crumbs={[backCrumb, { label: '…' }]} />
        <section className="panel">
          <PanelSkeleton lines={5} label="Opening the incident…" />
        </section>
      </div>
    );
  }

  const resolvedSeconds = secondsBetween(data.openedAt, data.resolvedAt);
  const openFor = ageSince(data.openedAt);
  const isOpen = data.status === 'open' || data.status === 'investigating';

  const selfRecord = [
    ...(data.resolvedAt
      ? [
          {
            id: 'resolved',
            when: formatDateTime(data.resolvedAt),
            title: TEXT.resolvedEvent(INCIDENT_STATUS[data.status].label),
            tone: 'green' as const,
          },
        ]
      : []),
    {
      id: 'opened',
      when: formatDateTime(data.openedAt),
      title: TEXT.openedEvent(personName(data.openedBy)),
      tone: 'red' as const,
    },
  ];

  return (
    <div className="gov">
      <PageHeader
        eyebrow={TEXT.eyebrow}
        title={data.title}
        crumbs={[backCrumb, { label: data.title }]}
        meta={
          <>
            <StatusChip status={INCIDENT_SEVERITY[data.severity]} />
            <StatusChip status={INCIDENT_STATUS[data.status]} />
            {isBypass && <StatusChip label={TEXT.bypassChip} tone="blue" />}
            <span className="gov-muted">{companyName(data.companyId)}</span>
            <CopyId value={data.id} label="Copy incident id" />
          </>
        }
        actions={
          <GatedButton
            allowed={mayManage}
            permission="incident.manage"
            className="btn btn-primary"
            onClick={() => setEditing(true)}
          >
            {TEXT.edit}
          </GatedButton>
        }
        tabs={
          <Tabs
            label={TEXT.tabsLabel}
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'overview', label: TEXT.tabOverview },
              { id: 'response', label: TEXT.tabResponse },
              {
                id: 'history',
                label: TEXT.tabHistory,
                count: mayAudit && audit.data ? audit.data.length : null,
              },
            ]}
          />
        }
      />

      <FactStrip label="The incident at a glance">
        <Fact
          label={TEXT.factSeverity}
          value={<StatusChip status={INCIDENT_SEVERITY[data.severity]} />}
        />
        <Fact
          label={TEXT.factStatus}
          value={<StatusChip status={INCIDENT_STATUS[data.status]} />}
        />
        <Fact
          label={isOpen ? TEXT.factOpenFor : TEXT.factResolvedAfter}
          value={isOpen ? openFor : formatDuration(resolvedSeconds)}
          note={
            isOpen
              ? `Since ${formatDateTime(data.openedAt)}`
              : `At ${formatDateTime(data.resolvedAt)}`
          }
        />
        <Fact
          label={TEXT.factOpened}
          value={new Date(data.openedAt).toLocaleDateString()}
          note={`By ${personName(data.openedBy)}`}
        />
        <Fact
          label={TEXT.factCategory}
          value={data.category?.name ?? TEXT.noCategory}
          note={data.category?.playbook ? 'Has a playbook' : 'No playbook'}
        />
      </FactStrip>

      {tab === 'overview' && (
        <TabPanel id="overview">
          <div className="gov-main-side">
            <div className="gov-stack">
              <SectionPanel title={TEXT.descriptionTitle}>
                {isBypass && evidence ? (
                  <Callout tone="info" title={TEXT.bypassTitle}>
                    {TEXT.bypassBody}
                  </Callout>
                ) : data.description ? (
                  <p className="inc-desc">{data.description}</p>
                ) : (
                  <p className="gov-muted" style={{ margin: 0 }}>
                    {TEXT.noDescription}
                  </p>
                )}
                {isBypass && evidence && (
                  <div className="inc-evidence">
                    <strong>{TEXT.bypassEvidence}</strong>
                    <DescriptionList
                      columns={1}
                      items={Object.entries(evidence).map(([key, value]) => ({
                        label: humanize(key),
                        value: evidenceValue(key, value),
                      }))}
                    />
                    <p className="hint">{TEXT.bypassCoverage}</p>
                  </div>
                )}
                {isBypass && (
                  <div className="gov-cluster" style={{ marginTop: 12 }}>
                    {can('incident.manage', data.companyId) ? (
                      <BypassCheckButton onChange={setBypass} onDone={reload} />
                    ) : (
                      <small className="hint">{needsRoleHint('incident.manage')}</small>
                    )}
                    <button type="button" className="text-link" onClick={() => open('incidents')}>
                      {TEXT.incidents}
                    </button>
                  </div>
                )}
                {isBypass && <BypassCheckResult state={bypass} />}
              </SectionPanel>

              <SectionPanel title={TEXT.statusTitle} subtitle={TEXT.statusSubtitle}>
                {!mayManage && (
                  <Callout tone="info">
                    {TEXT.readOnly} {needsRoleHint('incident.manage')}
                  </Callout>
                )}
                <div className="inc-status-actions">
                  {FLOW[data.status].map((step) => (
                    <button
                      key={step.to}
                      type="button"
                      className={step.primary ? 'btn btn-primary' : 'btn btn-outline'}
                      disabled={!mayManage}
                      onClick={() => setMoving(step.to)}
                    >
                      {step.label}
                    </button>
                  ))}
                </div>
                <div className="inc-severity-row">
                  <div className="field-group">
                    <label className="label" htmlFor="inc-severity">
                      {TEXT.severityLabel}
                    </label>
                    <select
                      id="inc-severity"
                      className="select-field"
                      disabled={!mayManage}
                      value={severity || data.severity}
                      onChange={(event) => setSeverity(event.target.value as IncidentSeverity)}
                    >
                      {INCIDENT_SEVERITIES.map((value) => (
                        <option key={value} value={value}>
                          {INCIDENT_SEVERITY[value].label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <button
                    type="button"
                    className="btn btn-outline"
                    disabled={
                      !mayManage || severityAction.busy || !severity || severity === data.severity
                    }
                    onClick={async () => {
                      const failure = await severityAction.run(() =>
                        apiSend('PATCH', `/incidents/${id}`, { severity }),
                      );
                      if (failure) return;
                      showToast(TEXT.severitySaved);
                      setSeverity('');
                      reload();
                    }}
                  >
                    {TEXT.severitySave}
                  </button>
                </div>
                <ErrorBox error={severityAction.error} />
              </SectionPanel>
            </div>

            <SectionPanel title={TEXT.factsTitle}>
              <DescriptionList
                columns={1}
                items={[
                  {
                    label: TEXT.rowCompany,
                    value: screenAllowed('companies') ? (
                      <button
                        type="button"
                        className="text-link"
                        onClick={() => open('companies', data.companyId)}
                      >
                        {companyName(data.companyId)}
                      </button>
                    ) : (
                      companyName(data.companyId)
                    ),
                  },
                  {
                    label: TEXT.rowAccount,
                    value:
                      data.socialAccountId && screenAllowed('accounts') ? (
                        <button
                          type="button"
                          className="text-link"
                          onClick={() => open('accounts', data.socialAccountId)}
                        >
                          {accountLabel}
                        </button>
                      ) : (
                        accountLabel
                      ),
                    hint:
                      data.socialAccountId && !can('account.read') ? TEXT.accountsHint : undefined,
                  },
                  { label: TEXT.rowCategory, value: data.category?.name ?? TEXT.noCategory },
                  {
                    label: TEXT.rowSeverity,
                    value: <StatusChip status={INCIDENT_SEVERITY[data.severity]} />,
                  },
                  {
                    label: TEXT.rowStatus,
                    value: <StatusChip status={INCIDENT_STATUS[data.status]} />,
                  },
                  { label: TEXT.rowOpenedBy, value: personName(data.openedBy) },
                  { label: TEXT.rowOpenedAt, value: formatDateTime(data.openedAt) },
                  {
                    label: TEXT.rowResolved,
                    value: data.resolvedAt ? formatDateTime(data.resolvedAt) : TEXT.notResolved,
                  },
                  { label: TEXT.rowId, value: <CopyId value={data.id} label="Copy incident id" /> },
                ]}
              />
            </SectionPanel>
          </div>
        </TabPanel>
      )}

      {tab === 'response' && (
        <TabPanel id="response">
          <div className="gov-two">
            <SectionPanel title={TEXT.playbookTitle}>
              {!data.category ? (
                <Callout tone="info" title={TEXT.noCategoryTitle}>
                  {TEXT.noCategoryBody}
                </Callout>
              ) : !data.category.playbook ? (
                <div className="gov-stack-tight">
                  <Callout tone="info" title={TEXT.noPlaybookTitle}>
                    {TEXT.noPlaybookBody}
                  </Callout>
                  {screenAllowed('incidents') && (
                    <div>
                      <button
                        type="button"
                        className="btn btn-outline"
                        onClick={() => open('incidents', null, { tab: 'setup' })}
                      >
                        {TEXT.openSetup}
                      </button>
                    </div>
                  )}
                </div>
              ) : (
                <>
                  {data.category.status === 'archived' && (
                    <p className="hint">{TEXT.archivedNote}</p>
                  )}
                  <PlaybookChecklist key={`${data.id}:${data.categoryId}`} incident={data} />
                </>
              )}
            </SectionPanel>

            <SectionPanel title={TEXT.contactsTitle} subtitle={TEXT.contactsSubtitle}>
              {data.recoveryContacts.length === 0 ? (
                <div className="gov-stack-tight">
                  <Callout tone="warn" title={TEXT.noContactsTitle}>
                    {TEXT.noContactsBody}
                  </Callout>
                  <div>
                    <button
                      type="button"
                      className="btn btn-outline"
                      onClick={() => open('incidents', null, { tab: 'setup' })}
                    >
                      {TEXT.openSetup}
                    </button>
                  </div>
                </div>
              ) : (
                <ul className="inc-contacts">
                  {data.recoveryContacts.map((contact) => (
                    <ContactCard key={contact.id} contact={contact} />
                  ))}
                </ul>
              )}
            </SectionPanel>
          </div>
        </TabPanel>
      )}

      {tab === 'history' && (
        <TabPanel id="history">
          <SectionPanel
            title={TEXT.historyTitle}
            subtitle={TEXT.historySubtitle}
            action={
              mayAudit ? (
                <button
                  type="button"
                  className="text-link"
                  onClick={() => open('audit', null, { targetType: 'incident', targetId: data.id })}
                >
                  {TEXT.openAudit}
                </button>
              ) : undefined
            }
          >
            {mayAudit ? (
              <>
                <ErrorBox error={audit.error} title={TEXT.auditError} loading />
                {!audit.data && audit.loading && <PanelSkeleton lines={4} />}
                {audit.data && (
                  <>
                    <AuditFeed
                      events={audit.data}
                      empty={<p className="gov-muted">{TEXT.noEvents}</p>}
                    />
                    <p className="hint">{TEXT.historyFromAudit}</p>
                  </>
                )}
              </>
            ) : (
              <>
                <Callout tone="info" title={TEXT.noAuditTitle}>
                  {TEXT.noAuditBody(whoCanText('audit.read'))}
                </Callout>
                <h3 style={{ margin: '18px 0 10px', fontSize: 16 }}>{TEXT.selfRecord}</h3>
                <Timeline items={selfRecord} />
              </>
            )}
          </SectionPanel>
        </TabPanel>
      )}

      {editing && (
        <EditIncidentDialog
          incident={data}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            reload();
          }}
        />
      )}
      {moving && (
        <StatusDialog
          incident={data}
          to={moving}
          onClose={() => setMoving(null)}
          onSaved={() => {
            setMoving(null);
            reload();
          }}
        />
      )}
    </div>
  );
}
