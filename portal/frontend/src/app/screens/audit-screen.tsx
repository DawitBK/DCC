'use client';

import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { z } from 'zod';
import {
  ROLE_LABELS,
  roleHasPermission,
  type AuditEventDto,
  type AuditVerifyResultDto,
} from '@dcc/contracts';
import {
  AUDIT_ACTIONS,
  AUDIT_AREA_LABEL,
  AuditDetails,
  QUICK_FILTERS,
  TARGET_KINDS,
  actionInfo,
  eventSummary,
  isUuid,
  targetKindLabel,
  targetLink,
  type AuditArea,
} from '@/components/audit-event';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { FactStrip, PanelSkeleton, localInputValue } from '@/components/gov-parts';
import { DataGrid, type GridColumn } from '@/components/kit/data-grid';
import { Drawer } from '@/components/kit/drawer';
import { PageHeader } from '@/components/kit/page-header';
import { Callout, CopyId, DescriptionList, Fact } from '@/components/kit/parts';
import { TabPanel, Tabs, useTabParam } from '@/components/kit/tabs';
import { EmptyState } from '@/components/empty-state';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { useToast } from '@/components/toast';
import { apiFetch, apiRequest, queryString } from '@/lib/browser-api';
import { validate, type FieldErrors } from '@/lib/forms';
import { formatDateTime, shortId } from '@/lib/format';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import type { WorkspaceScreen } from '@/lib/workspace-routes';
import './governance.css';
import './audit-screen.css';

/** The most one search returns (the API's limit for `GET /api/audit`) and the most one export holds. */
const SEARCH_LIMITS = [25, 50, 100, 200] as const;
const EXPORT_LIMITS = [1000, 2500, 5000] as const;
const DEFAULT_LIMIT = 50;

const TEXT = {
  title: 'Activity audit',
  description:
    'The record of who did what, and when. Search it, open any event, export it, and check that nobody altered it.',
  tabEvents: 'Events',
  tabIntegrity: 'Is the record intact?',
  tabsLabel: 'Audit sections',
  export: 'Export CSV',
  exporting: 'Exporting…',
  exported: 'The CSV file was downloaded. The export itself is now on the record.',
  verify: 'Check the record',
  verifying: 'Checking…',
  exportLimit: 'Rows in the export file',
  exportLimitHint:
    'The export uses the filters above. It needs a recent sign-in, and it is itself recorded as “Audit trail exported”.',
  quickTitle: 'Quick filters',
  find: 'Find events',
  findHint: 'Every box narrows the search. Leave a box empty to ignore it.',
  company: 'Company',
  allCompanies: 'All companies you may read',
  companyHint: 'Same as the company in the top bar.',
  person: 'Who did it',
  anyone: 'Anyone',
  personHint: 'Names of people seen in these events, and everyone you may see.',
  action: 'Action (exact)',
  actionPlaceholder: 'for example content.approved',
  actionHint: 'The platform’s own name of the action. Pick from the list or type it.',
  kind: 'Kind of record',
  kindPlaceholder: 'for example content_item',
  recordId: 'Record id',
  recordIdPlaceholder: 'the full id of a post, account, incident…',
  recordIdHint: 'Everything that happened to one record.',
  from: 'From',
  to: 'Until',
  limit: 'Events per search',
  limitHint: 'The API returns at most 200 at a time; load older ones below.',
  search: 'Search',
  clear: 'Clear all filters',
  today: 'Today',
  last7: 'Last 7 days',
  last30: 'Last 30 days',
  anyTime: 'Any time',
  appliedTitle: 'Filters in force',
  remove: (what: string) => `Remove the filter: ${what}`,
  notUuid: 'This must be a full id (letters, digits and dashes, 36 characters).',
  badRange: 'The start must be before the end.',
  loadFailed: 'The events could not be loaded',
  readAgain: 'Read again',
  tryAgain: 'Try again',
  factEvents: 'Events shown',
  factEventsNote: (more: boolean) =>
    more ? 'The newest matches. Older ones can be loaded.' : 'Every event that matches.',
  factSpan: 'Time span shown',
  factPeople: 'People involved',
  factPeopleNote: (system: number) =>
    system > 0 ? `and ${system} by the system` : 'No system events here',
  factSensitive: 'Sensitive actions',
  factSensitiveNote: 'Roles, rules, freezes, exports…',
  factRefused: 'Refused requests',
  factRefusedNote: 'Someone tried something they may not do',
  factFailedSignIns: 'Failed sign-ins',
  factFailedSignInsNote: 'In the events shown',
  noneShown: 'Nothing yet',
  shownCaption: 'Audit events',
  colWhen: 'When',
  colEvent: 'What happened',
  colWho: 'Who',
  colCompany: 'Company',
  colRecord: 'Record',
  colDetail: 'In short',
  colRequest: 'Request id',
  system: 'The system',
  sensitive: 'Sensitive',
  openRecord: 'Open',
  area: 'Area',
  sensitivity: 'Sensitivity',
  sensitiveOnly: 'Sensitive actions only',
  emptyTitle: 'No events match these filters',
  emptyBody:
    'Widen the dates, clear a filter, or check the company in the top bar. You only ever see the events of the companies your role may audit.',
  emptyFirst: 'There are no events to show yet',
  loaded: (count: number) => `${count} events loaded.`,
  loadOlder: 'Load older events',
  loadingOlder: 'Loading…',
  noOlder: 'That is every matching event you may read.',
  moreMayExist: 'Older matching events exist.',
  olderError: 'Older events could not be loaded',
  drawerSubtitle: (id: string, when: string) => `Event #${id} · ${when}`,
  secWho: 'Who, when and where',
  secAbout: 'What it was about',
  secRecorded: 'What was recorded',
  rowNumber: 'Event number',
  rowWhen: 'When',
  rowAction: 'Action name',
  rowWho: 'Who did it',
  rowCompany: 'Company',
  rowKind: 'Kind of record',
  rowRecord: 'Record id',
  rowRequest: 'Request id',
  requestHint:
    'The id of the request that caused this event. An error box shows the same id, so support can match the two.',
  noRecord: 'This event is not about a single record.',
  systemHint: 'No person: the system did this, or the person was not known yet.',
  pivotRecord: 'All events about this record',
  pivotPerson: 'All events by this person',
  pivotAction: 'All events with this action',
  integrityIntro:
    'Every event is stored with a fingerprint that covers the fingerprint of the event before it. This check walks the whole chain and says whether any event was edited or removed in place.',
  verifyFirst: 'Run the check to see the result.',
  verdictOk: 'The record is intact',
  verdictBad: 'The chain is broken',
  verdictOkBody: (count: number) =>
    `${count} events were checked from the first to the newest, in order. None was edited or removed in place.`,
  verdictBadBody: (count: number, id: string | null) =>
    `${count} events were checked and the chain does not hold${id ? `: the first event that does not follow from the one before it is #${id}` : ''}.`,
  checkedAt: (when: string) => `Checked ${when}, by this browser’s clock.`,
  badWhatNow: 'What to do now',
  badSteps: [
    'Do not restore a backup and do not try to repair anything.',
    'Keep everything exactly as it is.',
    'Tell the architect and the Group CTO at once. A broken chain is a security incident.',
  ],
  provesTitle: 'What a pass proves',
  proves: [
    'No event was edited or removed in place since it was written: each fingerprint covers the one before it, so changing any event breaks the chain from that point on.',
    'Through DCC nothing can be changed or deleted: the database refuses updates, deletes and truncation of the record, even by accident.',
  ],
  notProvesTitle: 'What a pass does not prove',
  notProves: [
    'It does not catch a complete, consistent rewrite by someone with full control of the database: they can recompute every fingerprint, and the chain still passes. Checkpoints exist for that.',
    'It cannot show an action that never wrote an event because of a defect.',
    'It does not cover changes made on the server outside DCC.',
    'So the honest word is “tamper-evident”, never “tamper-proof”.',
  ],
  checkpointTitle: 'Checkpoints: catching a full rewrite',
  checkpoint: [
    'A checkpoint is one line kept outside the database: “at this time the record had N events, and event X had this fingerprint”. Comparing it later reveals a shortened or rewritten record.',
    'Checkpoints are taken and compared by a job on the server (the commands are “audit:checkpoint write” and “audit:checkpoint verify”), by the people who run the system. DCC cannot read them, so this screen cannot tell you whether checkpoints are being taken on this installation. Ask the Group CTO.',
    'A failed checkpoint comparison is a security incident, handled the same way as a broken chain.',
  ],
  scopeTitle: 'What you can read here',
  scopeGroup: (role: string) =>
    `As ${role} at group level you read every company’s events in your group, and the group-wide events that belong to no company.`,
  scopeCompany: (role: string, names: string) =>
    `As ${role} you read the events of ${names}. Group-wide events are not shown to you.`,
  scopeNone: 'Your current role does not include reading the audit trail.',
  relatedTitle: 'Related',
  relatedSecurity: 'Security center',
  relatedIncidents: 'Incidents',
};

type Filters = {
  quick: string;
  action: string;
  actorUserId: string;
  targetType: string;
  targetId: string;
  from: string;
  to: string;
  limit: number;
};

const FILTER_KEYS = [
  'quick',
  'action',
  'actorUserId',
  'targetType',
  'targetId',
  'from',
  'to',
  'limit',
] as const;

function readFilters(params: URLSearchParams): Filters {
  const limit = Number(params.get('limit'));
  return {
    quick: params.get('quick') ?? '',
    action: params.get('action') ?? '',
    actorUserId: params.get('actorUserId') ?? '',
    targetType: params.get('targetType') ?? '',
    targetId: params.get('targetId') ?? '',
    from: params.get('from') ?? '',
    to: params.get('to') ?? '',
    limit: (SEARCH_LIMITS as readonly number[]).includes(limit) ? limit : DEFAULT_LIMIT,
  };
}

/** A date or date-time the person typed, as the ISO time the API wants. A bare date means its whole day. */
function toIso(value: string, endOfDay = false): string | undefined {
  if (!value) return undefined;
  const text = value.length === 10 ? `${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}` : value;
  const date = new Date(text);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

const FilterForm = z.object({
  targetId: z.string().refine((v) => v === '' || isUuid(v), TEXT.notUuid),
  actorUserId: z.string().refine((v) => v === '' || isUuid(v), TEXT.notUuid),
});

function agoText(iso: string): string {
  const seconds = (Date.now() - new Date(iso).getTime()) / 1000;
  if (!Number.isFinite(seconds) || seconds < 0) return '';
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ago`;
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)} h ago`;
  return `${Math.floor(seconds / 86_400)} d ago`;
}

/** `GET /api/audit` (all filters), `GET /api/audit/export` (CSV), `GET /api/audit/verify`. */
export function AuditScreen() {
  const workspace = useWorkspace();
  const { me, can, companyId, companyName, personName, companies } = workspace;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const showToast = useToast();
  const [tab, setTab] = useTabParam(['events', 'integrity'], 'events');
  const verifyAction = useAction();
  const exportAction = useAction();
  const moreAction = useAction();
  const [verification, setVerification] = useState<{
    result: AuditVerifyResultDto;
    at: string;
  } | null>(null);
  const [exportLimit, setExportLimit] = useState<number>(EXPORT_LIMITS[0]);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const search = params.toString();
  const applied = useMemo(() => readFilters(new URLSearchParams(search)), [search]);
  const [draft, setDraft] = useState<Filters>(applied);
  const [errors, setErrors] = useState<FieldErrors>({});
  useEffect(() => setDraft(applied), [applied]);

  const quick = QUICK_FILTERS.find((item) => item.id === applied.quick);
  const query = {
    action: applied.action.trim(),
    actions: quick?.actions?.join(','),
    companyId,
    actorUserId: applied.actorUserId,
    targetType: applied.targetType.trim(),
    targetId: applied.targetId,
    from: toIso(applied.from),
    to: toIso(applied.to, true),
  };
  const path = `/audit${queryString({ ...query, limit: applied.limit })}`;
  const first = useApiData<AuditEventDto[]>(can('audit.read') ? path : null);

  // Older pages are kept next to the first one, and dropped the moment the search changes.
  const [older, setOlder] = useState<{ path: string; rows: AuditEventDto[]; done: boolean }>({
    path: '',
    rows: [],
    done: false,
  });
  const olderRows = useMemo(() => (older.path === path ? older.rows : []), [older, path]);
  const rows = useMemo(() => [...(first.data ?? []), ...olderRows], [first.data, olderRows]);
  const lastPageFull =
    olderRows.length > 0 ? !older.done : (first.data?.length ?? 0) >= applied.limit;

  // ---- the address holds the filters, so a refresh, a shared link and a sign-in again keep them ----
  const writeParams = (changes: Record<string, string | null | undefined>) => {
    const next = new URLSearchParams(search);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    const text = next.toString();
    router.replace(`${pathname}${text ? `?${text}` : ''}`, { scroll: false });
  };
  const applyFilters = (next: Partial<Filters>) => {
    const changes: Record<string, string | null> = {};
    for (const key of FILTER_KEYS) {
      const value = next[key];
      if (value === undefined) continue;
      changes[key] =
        key === 'limit' ? (value === DEFAULT_LIMIT ? null : String(value)) : String(value);
    }
    writeParams(changes);
  };
  const clearFilters = () => {
    const keep = new URLSearchParams(search);
    for (const key of FILTER_KEYS) keep.delete(key);
    const text = keep.toString();
    router.replace(`${pathname}${text ? `?${text}` : ''}`, { scroll: false });
  };

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const checked = validate(FilterForm, draft);
    const nextErrors: FieldErrors = checked.ok ? {} : { ...checked.errors };
    const from = toIso(draft.from);
    const to = toIso(draft.to, true);
    if (from && to && from > to) nextErrors.from = TEXT.badRange;
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;
    applyFilters({ ...draft, targetType: draft.targetType.trim(), action: draft.action.trim() });
  };

  const setCompany = (value: string) => {
    const next = new URLSearchParams(search);
    if (value) next.set('companyId', value);
    else next.delete('companyId');
    const text = next.toString();
    router.replace(`${pathname}${text ? `?${text}` : ''}`, { scroll: false });
  };

  const toggleQuick = (id: string) => {
    const item = QUICK_FILTERS.find((entry) => entry.id === id);
    if (!item) return;
    if (item.mine) {
      const on = applied.actorUserId === me.user.id;
      applyFilters({ actorUserId: on ? '' : me.user.id });
    } else {
      applyFilters({ quick: applied.quick === id ? '' : id });
    }
  };
  const quickActive = (id: string) =>
    id === 'mine' ? applied.actorUserId === me.user.id : applied.quick === id;

  const setRange = (days: number | null) => {
    if (days === null) return applyFilters({ from: '', to: '' });
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - (days - 1));
    applyFilters({ from: localInputValue(start), to: '' });
  };

  const loadOlder = () =>
    moreAction.run(async () => {
      const last = rows.at(-1);
      if (!last) return;
      const page = await apiFetch<AuditEventDto[]>(`${path}&beforeId=${last.id}`);
      const seen = new Set(rows.map((row) => row.id));
      setOlder({
        path,
        rows: [...olderRows, ...page.filter((row) => !seen.has(row.id))],
        done: page.length < applied.limit,
      });
    });

  const download = () =>
    exportAction.run(async () => {
      const response = await apiRequest(
        `/audit/export${queryString({ ...query, limit: exportLimit })}`,
        { headers: { Accept: 'text/csv' } },
      );
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'audit-export.csv';
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(TEXT.exported);
      first.reload();
    });

  const runVerify = () =>
    verifyAction.run(async () => {
      setVerification(null);
      const result = await apiFetch<AuditVerifyResultDto>('/audit/verify');
      setVerification({ result, at: new Date().toISOString() });
    });

  // ---- the people and numbers the screen offers ----
  const actorIds = useMemo(() => {
    const ids = new Set<string>();
    for (const person of workspace.people ?? []) ids.add(person.id);
    for (const row of rows) if (row.actor_user_id) ids.add(row.actor_user_id);
    if (applied.actorUserId) ids.add(applied.actorUserId);
    return [...ids].sort((a, b) => personName(a).localeCompare(personName(b)));
    // personName reads the workspace's people list, which is part of `workspace`.
  }, [rows, workspace.people, applied.actorUserId]);

  const stats = useMemo(() => {
    const actors = new Set<string>();
    let system = 0;
    let sensitive = 0;
    let refused = 0;
    let failedSignIns = 0;
    for (const row of rows) {
      if (row.actor_user_id) actors.add(row.actor_user_id);
      else system += 1;
      if (actionInfo(row.action).sensitive) sensitive += 1;
      if (row.action === 'security.access_denied') refused += 1;
      if (row.action === 'auth.login_failed') failedSignIns += 1;
    }
    const times = rows.map((row) => new Date(row.occurred_at).getTime()).filter(Number.isFinite);
    return {
      actors: actors.size,
      system,
      sensitive,
      refused,
      failedSignIns,
      oldest: times.length ? Math.min(...times) : null,
      newest: times.length ? Math.max(...times) : null,
    };
  }, [rows]);

  const selected = rows.find((row) => row.id === selectedId) ?? null;

  const appliedChips: { key: string; text: string; clear: () => void }[] = [];
  if (companyId)
    appliedChips.push({
      key: 'company',
      text: `${TEXT.company}: ${companyName(companyId)}`,
      clear: () => setCompany(''),
    });
  if (quick)
    appliedChips.push({
      key: 'quick',
      text: quick.label,
      clear: () => applyFilters({ quick: '' }),
    });
  if (applied.action)
    appliedChips.push({
      key: 'action',
      text: `${TEXT.action.replace(' (exact)', '')}: ${applied.action}`,
      clear: () => applyFilters({ action: '' }),
    });
  if (applied.actorUserId)
    appliedChips.push({
      key: 'actor',
      text: `${TEXT.person}: ${personName(applied.actorUserId)}`,
      clear: () => applyFilters({ actorUserId: '' }),
    });
  if (applied.targetType)
    appliedChips.push({
      key: 'kind',
      text: `${TEXT.kind}: ${targetKindLabel(applied.targetType)}`,
      clear: () => applyFilters({ targetType: '' }),
    });
  if (applied.targetId)
    appliedChips.push({
      key: 'record',
      text: `${TEXT.recordId}: ${shortId(applied.targetId)}`,
      clear: () => applyFilters({ targetId: '' }),
    });
  if (applied.from)
    appliedChips.push({
      key: 'from',
      text: `${TEXT.from}: ${formatDateTime(toIso(applied.from))}`,
      clear: () => applyFilters({ from: '' }),
    });
  if (applied.to)
    appliedChips.push({
      key: 'to',
      text: `${TEXT.to}: ${formatDateTime(toIso(applied.to, true))}`,
      clear: () => applyFilters({ to: '' }),
    });

  const columns: GridColumn<AuditEventDto>[] = [
    {
      id: 'when',
      header: TEXT.colWhen,
      sortValue: (row) => Number(row.id),
      exportValue: (row) => row.occurred_at,
      cell: (row) => (
        <>
          <span className="post-title">{formatDateTime(row.occurred_at)}</span>
          <span className="subline">
            #{row.id} · {agoText(row.occurred_at)}
          </span>
        </>
      ),
    },
    {
      id: 'event',
      header: TEXT.colEvent,
      sortValue: (row) => actionInfo(row.action).label,
      cell: (row) => {
        const info = actionInfo(row.action);
        return (
          <span className="audit-event-label">
            <span className="post-title">{info.label}</span>
            <span className="subline gov-mono">{row.action}</span>
            {info.sensitive && (
              <span>
                <StatusChip label={TEXT.sensitive} tone={info.tone === 'red' ? 'red' : 'amber'} />
              </span>
            )}
          </span>
        );
      },
    },
    {
      id: 'who',
      header: TEXT.colWho,
      sortValue: (row) => (row.actor_user_id ? personName(row.actor_user_id) : TEXT.system),
      cell: (row) =>
        row.actor_user_id ? (
          personName(row.actor_user_id)
        ) : (
          <span className="gov-muted">{TEXT.system}</span>
        ),
    },
    {
      id: 'company',
      header: TEXT.colCompany,
      sortValue: (row) => companyName(row.company_id),
      cell: (row) => companyName(row.company_id),
    },
    {
      id: 'record',
      header: TEXT.colRecord,
      sortValue: (row) => targetKindLabel(row.target_type),
      cell: (row) => {
        const link = targetLink(row);
        const allowed = link && workspace.screenAllowed(link.screen);
        return (
          <>
            {targetKindLabel(row.target_type)}
            {row.target_id && <span className="subline gov-mono">{shortId(row.target_id)}</span>}
            {link && allowed && (
              <button
                type="button"
                className="text-link"
                aria-label={`${link.label}: ${targetKindLabel(row.target_type)} ${shortId(row.target_id)}`}
                onClick={() => workspace.open(link.screen, link.id, link.params)}
              >
                {TEXT.openRecord}
              </button>
            )}
          </>
        );
      },
    },
    {
      id: 'detail',
      header: TEXT.colDetail,
      cell: (row) =>
        eventSummary(row, { personName, companyName }) || <span className="gov-muted">—</span>,
      exportValue: (row) => eventSummary(row, { personName, companyName }),
    },
    {
      id: 'request',
      header: TEXT.colRequest,
      hiddenByDefault: true,
      cell: (row) => (row.correlation_id ? <CopyId value={row.correlation_id} /> : '—'),
      exportValue: (row) => row.correlation_id ?? '',
    },
  ];

  const pivot = (changes: Partial<Filters>) => {
    setSelectedId(null);
    const next: Partial<Filters> = {
      quick: '',
      action: '',
      actorUserId: '',
      targetType: '',
      targetId: '',
      ...changes,
    };
    applyFilters(next);
  };

  return (
    <div className="gov">
      <PageHeader
        title={TEXT.title}
        description={TEXT.description}
        actions={
          <>
            <button
              type="button"
              className="btn btn-outline"
              disabled={exportAction.busy}
              onClick={() => void download()}
            >
              {exportAction.busy ? TEXT.exporting : TEXT.export}
            </button>
            <button
              type="button"
              className="btn btn-primary"
              disabled={verifyAction.busy}
              onClick={() => {
                setTab('integrity');
                void runVerify();
              }}
            >
              {verifyAction.busy ? TEXT.verifying : TEXT.verify}
            </button>
          </>
        }
        tabs={
          <Tabs
            label={TEXT.tabsLabel}
            active={tab}
            onChange={setTab}
            tabs={[
              { id: 'events', label: TEXT.tabEvents },
              { id: 'integrity', label: TEXT.tabIntegrity },
            ]}
          />
        }
      />
      <ErrorBox error={exportAction.error} />

      {tab === 'events' && (
        <TabPanel id="events">
          <div className="gov-stack">
            <form className="panel" onSubmit={submit} noValidate>
              <div className="panel-header">
                <div>
                  <h2>{TEXT.find}</h2>
                  <p>{TEXT.findHint}</p>
                </div>
              </div>
              <div className="gov-pill-row" role="group" aria-label={TEXT.quickTitle}>
                {QUICK_FILTERS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className="gov-chip-button"
                    aria-pressed={quickActive(item.id)}
                    title={item.hint}
                    onClick={() => toggleQuick(item.id)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              {quick && <p className="hint">{quick.hint}</p>}
              <div className="audit-filter-grid">
                <FormField label={TEXT.company} hint={TEXT.companyHint}>
                  {(control) => (
                    <select
                      className="select-field"
                      {...control}
                      value={companyId ?? ''}
                      onChange={(event) => setCompany(event.target.value)}
                    >
                      <option value="">{TEXT.allCompanies}</option>
                      {companies.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
                <FormField label={TEXT.person} hint={TEXT.personHint} error={errors.actorUserId}>
                  {(control) => (
                    <select
                      className="select-field"
                      {...control}
                      value={draft.actorUserId}
                      onChange={(event) => setDraft({ ...draft, actorUserId: event.target.value })}
                    >
                      <option value="">{TEXT.anyone}</option>
                      {actorIds.map((id) => (
                        <option key={id} value={id}>
                          {personName(id)}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
                <FormField label={TEXT.action} hint={TEXT.actionHint}>
                  {(control) => (
                    <>
                      <input
                        className="field"
                        {...control}
                        list="audit-actions"
                        maxLength={100}
                        placeholder={TEXT.actionPlaceholder}
                        autoComplete="off"
                        value={draft.action}
                        onChange={(event) => setDraft({ ...draft, action: event.target.value })}
                      />
                      <datalist id="audit-actions">
                        {[...new Set([...Object.keys(AUDIT_ACTIONS), ...rows.map((r) => r.action)])]
                          .sort()
                          .map((name) => (
                            <option key={name} value={name}>
                              {actionInfo(name).label}
                            </option>
                          ))}
                      </datalist>
                    </>
                  )}
                </FormField>
                <FormField label={TEXT.kind}>
                  {(control) => (
                    <>
                      <input
                        className="field"
                        {...control}
                        list="audit-kinds"
                        maxLength={100}
                        placeholder={TEXT.kindPlaceholder}
                        autoComplete="off"
                        value={draft.targetType}
                        onChange={(event) => setDraft({ ...draft, targetType: event.target.value })}
                      />
                      <datalist id="audit-kinds">
                        {TARGET_KINDS.map((kind) => (
                          <option key={kind.value} value={kind.value}>
                            {kind.label}
                          </option>
                        ))}
                      </datalist>
                    </>
                  )}
                </FormField>
                <FormField label={TEXT.recordId} hint={TEXT.recordIdHint} error={errors.targetId}>
                  {(control) => (
                    <input
                      className="field"
                      {...control}
                      maxLength={36}
                      placeholder={TEXT.recordIdPlaceholder}
                      autoComplete="off"
                      value={draft.targetId}
                      onChange={(event) =>
                        setDraft({ ...draft, targetId: event.target.value.trim() })
                      }
                    />
                  )}
                </FormField>
                <FormField label={TEXT.from} error={errors.from}>
                  {(control) => (
                    <input
                      className="field"
                      type="datetime-local"
                      {...control}
                      value={draft.from}
                      onChange={(event) => setDraft({ ...draft, from: event.target.value })}
                    />
                  )}
                </FormField>
                <FormField label={TEXT.to}>
                  {(control) => (
                    <input
                      className="field"
                      type="datetime-local"
                      {...control}
                      value={draft.to}
                      onChange={(event) => setDraft({ ...draft, to: event.target.value })}
                    />
                  )}
                </FormField>
                <FormField label={TEXT.limit} hint={TEXT.limitHint}>
                  {(control) => (
                    <select
                      className="select-field"
                      {...control}
                      value={draft.limit}
                      onChange={(event) =>
                        setDraft({ ...draft, limit: Number(event.target.value) })
                      }
                    >
                      {SEARCH_LIMITS.map((value) => (
                        <option key={value} value={value}>
                          {value}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
                <FormField label={TEXT.exportLimit} hint={TEXT.exportLimitHint}>
                  {(control) => (
                    <select
                      className="select-field"
                      {...control}
                      value={exportLimit}
                      onChange={(event) => setExportLimit(Number(event.target.value))}
                    >
                      {EXPORT_LIMITS.map((value) => (
                        <option key={value} value={value}>
                          {value.toLocaleString()}
                        </option>
                      ))}
                    </select>
                  )}
                </FormField>
              </div>
              <div className="audit-filter-actions">
                <button type="submit" className="btn btn-primary">
                  {TEXT.search}
                </button>
                <button type="button" className="btn btn-outline" onClick={clearFilters}>
                  {TEXT.clear}
                </button>
                <div className="audit-presets" role="group" aria-label="Date ranges">
                  <button type="button" className="text-link" onClick={() => setRange(1)}>
                    {TEXT.today}
                  </button>
                  <button type="button" className="text-link" onClick={() => setRange(7)}>
                    {TEXT.last7}
                  </button>
                  <button type="button" className="text-link" onClick={() => setRange(30)}>
                    {TEXT.last30}
                  </button>
                  <button type="button" className="text-link" onClick={() => setRange(null)}>
                    {TEXT.anyTime}
                  </button>
                </div>
              </div>
              {appliedChips.length > 0 && (
                <div className="audit-applied">
                  <strong>{TEXT.appliedTitle}</strong>
                  {appliedChips.map((chip) => (
                    <span key={chip.key} className="gov-applied">
                      {chip.text}
                      <button
                        type="button"
                        aria-label={TEXT.remove(chip.text)}
                        onClick={chip.clear}
                      >
                        <span aria-hidden="true">✕</span>
                      </button>
                    </span>
                  ))}
                </div>
              )}
            </form>

            <ErrorBox error={first.error} title={TEXT.loadFailed} loading />
            {first.error && (
              <div>
                <button type="button" className="btn btn-outline" onClick={first.reload}>
                  {TEXT.tryAgain}
                </button>
              </div>
            )}

            {first.data && (
              <FactStrip label={TEXT.factEvents}>
                <Fact
                  label={TEXT.factEvents}
                  value={rows.length.toLocaleString()}
                  note={TEXT.factEventsNote(lastPageFull)}
                />
                <Fact
                  label={TEXT.factSpan}
                  value={
                    stats.oldest === null
                      ? TEXT.noneShown
                      : `${new Date(stats.oldest).toLocaleDateString()} – ${new Date(stats.newest ?? stats.oldest).toLocaleDateString()}`
                  }
                  note="Oldest to newest event shown"
                />
                <Fact
                  label={TEXT.factPeople}
                  value={stats.actors}
                  note={TEXT.factPeopleNote(stats.system)}
                />
                <Fact
                  label={TEXT.factSensitive}
                  value={stats.sensitive}
                  note={TEXT.factSensitiveNote}
                />
                <Fact label={TEXT.factRefused} value={stats.refused} note={TEXT.factRefusedNote} />
                <Fact
                  label={TEXT.factFailedSignIns}
                  value={stats.failedSignIns}
                  note={TEXT.factFailedSignInsNote}
                />
              </FactStrip>
            )}

            <SectionPanel
              title="Events"
              subtitle={
                first.data ? `${TEXT.loaded(rows.length)} Newest first.` : 'Reading the record…'
              }
              action={
                <button type="button" className="btn btn-outline" onClick={first.reload}>
                  {TEXT.readAgain}
                </button>
              }
            >
              {!first.data && first.loading ? (
                <PanelSkeleton lines={6} label="Reading the audit record…" />
              ) : (
                first.data && (
                  <>
                    <div className="audit-grid">
                      <DataGrid
                        caption={TEXT.shownCaption}
                        columns={columns}
                        rows={rows}
                        rowKey={(row) => row.id}
                        defaultSort={{ id: 'when', direction: 'desc' }}
                        pageSize={25}
                        searchText={(row) =>
                          [
                            row.action,
                            actionInfo(row.action).label,
                            row.actor_user_id ? personName(row.actor_user_id) : TEXT.system,
                            companyName(row.company_id),
                            row.target_type ?? '',
                            targetKindLabel(row.target_type),
                            row.target_id ?? '',
                            row.correlation_id ?? '',
                            row.id,
                            JSON.stringify(row.details ?? {}),
                          ].join(' ')
                        }
                        filters={[
                          {
                            id: 'area',
                            label: TEXT.area,
                            options: (Object.keys(AUDIT_AREA_LABEL) as AuditArea[]).map((area) => ({
                              value: area,
                              label: AUDIT_AREA_LABEL[area],
                            })),
                            test: (row, value) => actionInfo(row.action).area === value,
                          },
                          {
                            id: 'sensitive',
                            label: TEXT.sensitivity,
                            options: [{ value: 'yes', label: TEXT.sensitiveOnly }],
                            test: (row) => Boolean(actionInfo(row.action).sensitive),
                          },
                        ]}
                        onOpen={(row) => setSelectedId(row.id)}
                        empty={
                          <EmptyState
                            title={appliedChips.length ? TEXT.emptyTitle : TEXT.emptyFirst}
                          >
                            {TEXT.emptyBody}
                          </EmptyState>
                        }
                      />
                    </div>
                    <ErrorBox error={moreAction.error} title={TEXT.olderError} loading />
                    {rows.length > 0 && (
                      <div className="audit-load-more">
                        {lastPageFull ? (
                          <>
                            <button
                              type="button"
                              className="btn btn-outline"
                              disabled={moreAction.busy}
                              onClick={() => void loadOlder()}
                            >
                              {moreAction.busy ? TEXT.loadingOlder : TEXT.loadOlder}
                            </button>
                            <span>{TEXT.moreMayExist}</span>
                          </>
                        ) : (
                          <span>{TEXT.noOlder}</span>
                        )}
                      </div>
                    )}
                  </>
                )
              )}
            </SectionPanel>
          </div>
        </TabPanel>
      )}

      {tab === 'integrity' && (
        <TabPanel id="integrity">
          <IntegrityTab
            busy={verifyAction.busy}
            error={verifyAction.error}
            verification={verification}
            onRun={() => void runVerify()}
          />
        </TabPanel>
      )}

      {selected && (
        <EventDrawer
          event={selected}
          onClose={() => setSelectedId(null)}
          onPivot={pivot}
          canOpen={(screen) => workspace.screenAllowed(screen)}
          onOpen={(screen, id, p) => {
            setSelectedId(null);
            workspace.open(screen, id, p);
          }}
        />
      )}
    </div>
  );
}

function EventDrawer({
  event,
  onClose,
  onPivot,
  canOpen,
  onOpen,
}: {
  event: AuditEventDto;
  onClose: () => void;
  onPivot: (changes: Partial<Filters>) => void;
  canOpen: (screen: WorkspaceScreen) => boolean;
  onOpen: (screen: WorkspaceScreen, id: string | null, params?: Record<string, string>) => void;
}) {
  const { personName, companyName } = useWorkspace();
  const info = actionInfo(event.action);
  const link = targetLink(event);
  const summary = eventSummary(event, { personName, companyName });
  return (
    <Drawer
      title={info.label}
      subtitle={TEXT.drawerSubtitle(event.id, formatDateTime(event.occurred_at))}
      onClose={onClose}
      footer={
        <div className="audit-drawer-foot">
          {link && canOpen(link.screen) && (
            <button
              type="button"
              className="btn btn-primary"
              onClick={() => onOpen(link.screen, link.id, link.params)}
            >
              {link.label}
            </button>
          )}
          {event.target_id && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => onPivot({ targetId: event.target_id ?? '' })}
            >
              {TEXT.pivotRecord}
            </button>
          )}
          {event.actor_user_id && (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => onPivot({ actorUserId: event.actor_user_id ?? '' })}
            >
              {TEXT.pivotPerson}
            </button>
          )}
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => onPivot({ action: event.action })}
          >
            {TEXT.pivotAction}
          </button>
        </div>
      }
    >
      <div className="gov">
        <div className="gov-cluster">
          <StatusChip label={AUDIT_AREA_LABEL[info.area]} tone="gray" />
          {info.sensitive && (
            <StatusChip label={TEXT.sensitive} tone={info.tone === 'red' ? 'red' : 'amber'} />
          )}
        </div>
        {summary && <Callout title="In short">{summary}</Callout>}
        <section className="audit-drawer-section">
          <h3>{TEXT.secWho}</h3>
          <DescriptionList
            columns={1}
            items={[
              { label: TEXT.rowNumber, value: `#${event.id}` },
              {
                label: TEXT.rowWhen,
                value: `${formatDateTime(event.occurred_at)} (${agoText(event.occurred_at)})`,
              },
              {
                label: TEXT.rowAction,
                value: <code className="gov-mono">{event.action}</code>,
              },
              {
                label: TEXT.rowWho,
                value: event.actor_user_id ? (
                  <span className="gov-cluster">
                    {personName(event.actor_user_id)}
                    <CopyId value={event.actor_user_id} label="Copy person id" />
                  </span>
                ) : (
                  TEXT.system
                ),
                hint: event.actor_user_id ? undefined : TEXT.systemHint,
              },
              { label: TEXT.rowCompany, value: companyName(event.company_id) },
              {
                label: TEXT.rowRequest,
                value: event.correlation_id ? (
                  <CopyId value={event.correlation_id} label="Copy request id" />
                ) : (
                  '—'
                ),
                hint: TEXT.requestHint,
              },
            ]}
          />
        </section>
        <section className="audit-drawer-section">
          <h3>{TEXT.secAbout}</h3>
          {event.target_type || event.target_id ? (
            <DescriptionList
              columns={1}
              items={[
                { label: TEXT.rowKind, value: targetKindLabel(event.target_type) },
                {
                  label: TEXT.rowRecord,
                  value: event.target_id ? (
                    <CopyId value={event.target_id} label="Copy record id" />
                  ) : (
                    '—'
                  ),
                },
              ]}
            />
          ) : (
            <p className="gov-muted" style={{ margin: 0 }}>
              {TEXT.noRecord}
            </p>
          )}
        </section>
        <section className="audit-drawer-section">
          <h3>{TEXT.secRecorded}</h3>
          <AuditDetails event={event} />
        </section>
      </div>
    </Drawer>
  );
}

function IntegrityTab({
  busy,
  error,
  verification,
  onRun,
}: {
  busy: boolean;
  error: ReturnType<typeof useAction>['error'];
  verification: { result: AuditVerifyResultDto; at: string } | null;
  onRun: () => void;
}) {
  const { me, companyName, open } = useWorkspace();
  const readers = me.memberships.filter((membership) =>
    roleHasPermission(membership.role, 'audit.read'),
  );
  const group = readers.find((membership) => membership.companyId === null);
  const companyNames = readers
    .filter((membership) => membership.companyId !== null)
    .map((membership) => companyName(membership.companyId));
  return (
    <div className="gov-stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{TEXT.tabIntegrity}</h2>
            <p>{TEXT.integrityIntro}</p>
          </div>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={onRun}>
            {busy ? TEXT.verifying : TEXT.verify}
          </button>
        </div>
        <ErrorBox error={error} />
        <div role="status" aria-live="polite">
          {busy && !verification && <PanelSkeleton lines={2} label="Walking the chain…" />}
          {!verification && !busy && !error && <p className="gov-muted">{TEXT.verifyFirst}</p>}
          {verification && (
            <div
              className={`audit-verdict ${verification.result.ok ? 'audit-verdict-ok' : 'audit-verdict-bad'}`}
            >
              <span className="audit-verdict-mark" aria-hidden="true">
                {verification.result.ok ? '✓' : '!'}
              </span>
              <div>
                <h3>{verification.result.ok ? TEXT.verdictOk : TEXT.verdictBad}</h3>
                <p>
                  {verification.result.ok
                    ? TEXT.verdictOkBody(verification.result.checked)
                    : TEXT.verdictBadBody(
                        verification.result.checked,
                        verification.result.firstBrokenId,
                      )}
                </p>
                <small className="hint">{TEXT.checkedAt(formatDateTime(verification.at))}</small>
                {!verification.result.ok && (
                  <>
                    <strong>{TEXT.badWhatNow}</strong>
                    <ol className="audit-steps">
                      {TEXT.badSteps.map((step) => (
                        <li key={step}>{step}</li>
                      ))}
                    </ol>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <div className="gov-three">
        <section className="panel audit-explain">
          <h3>{TEXT.provesTitle}</h3>
          <ul>
            {TEXT.proves.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
        <section className="panel audit-explain">
          <h3>{TEXT.notProvesTitle}</h3>
          <ul>
            {TEXT.notProves.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
        <section className="panel audit-explain">
          <h3>{TEXT.checkpointTitle}</h3>
          <ul>
            {TEXT.checkpoint.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>
      </div>

      <div className="gov-two">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{TEXT.scopeTitle}</h2>
            </div>
          </div>
          {readers.length === 0 ? (
            <p>{TEXT.scopeNone}</p>
          ) : group ? (
            <p>{TEXT.scopeGroup(ROLE_LABELS[group.role])}</p>
          ) : (
            <p>
              {TEXT.scopeCompany(
                ROLE_LABELS[readers[0]!.role],
                companyNames.length ? companyNames.join(', ') : 'your companies',
              )}
            </p>
          )}
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{TEXT.relatedTitle}</h2>
            </div>
          </div>
          <div className="gov-cluster">
            <button type="button" className="btn btn-outline" onClick={() => open('security')}>
              {TEXT.relatedSecurity}
            </button>
            <button type="button" className="btn btn-outline" onClick={() => open('incidents')}>
              {TEXT.relatedIncidents}
            </button>
          </div>
        </section>
      </div>
    </div>
  );
}
