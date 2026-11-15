'use client';

import { useState } from 'react';
import { DataTable } from '@/components/data-table';
import { EmptyState, LoadingState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { useToast } from '@/components/toast';
import { apiFetch, apiRequest, queryString } from '@/lib/browser-api';
import { formatDateTime, shortId } from '@/lib/format';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

/** One row of `GET /api/audit`. The API sends the stored row as it is (no DTO in the contracts yet). */
type AuditEvent = {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  company_id: string | null;
};
type AuditVerifyResult = { ok: boolean; checked: number; firstBrokenId: string | null };

const LIMIT = 200;

const TEXT = {
  title: 'Activity audit',
  description: 'Search the record of who did what, export it, and check that it was not altered.',
  verify: '✓ Check the record',
  verifying: 'Checking…',
  export: 'Export CSV',
  exporting: 'Exporting…',
  exportNote: 'The export uses the filters below and may ask you to sign in again first.',
  exported: 'The CSV file was downloaded. The export itself is on record.',
  passed: 'The audit chain is intact',
  broken: 'The audit chain is broken',
  checked: (count: number) => `${count} entries checked.`,
  firstBroken: (id: string) => ` First altered or missing entry: ${id}.`,
  action: 'Action (exact)',
  actionPlaceholder: 'e.g. content.approved',
  targetType: 'Kind of record (exact)',
  targetPlaceholder: 'e.g. content_item',
  from: 'From',
  to: 'To',
  search: 'Search',
  clear: 'Clear',
  log: 'Activity log',
  subtitle: (count: number) =>
    count >= LIMIT
      ? `The newest ${LIMIT} matching entries (the most one search returns)`
      : `${count} matching entries, newest first`,
  caption: 'Audit events',
  event: 'Event',
  actor: 'Who',
  system: 'System',
  company: 'Company',
  time: 'Time',
  target: 'Record',
  emptyTitle: 'No matching audit events',
  emptyBody: 'Try changing or clearing a filter.',
  note: 'Audit records are read-only. The check detects edited or removed entries; it does not make the record tamper-proof.',
};

const EMPTY = { action: '', targetType: '', from: '', to: '' };

/** `GET /api/audit` (filters), `GET /api/audit/export` (CSV), `GET /api/audit/verify`. */
export function AuditScreen() {
  const { companyId, companyName, personName } = useWorkspace();
  const showToast = useToast();
  const verifyAction = useAction();
  const exportAction = useAction();
  const [draft, setDraft] = useState(EMPTY);
  const [filters, setFilters] = useState(EMPTY);
  const [verification, setVerification] = useState<AuditVerifyResult | null>(null);

  const iso = (value: string, endOfDay = false) => {
    if (!value) return undefined;
    const date = new Date(`${value}T${endOfDay ? '23:59:59.999' : '00:00:00'}`);
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
  };
  const query = {
    action: filters.action.trim(),
    targetType: filters.targetType.trim(),
    companyId,
    from: iso(filters.from),
    to: iso(filters.to, true),
  };
  const events = useApiData<AuditEvent[]>(`/audit${queryString({ ...query, limit: LIMIT })}`);

  const download = () =>
    exportAction.run(async () => {
      const response = await apiRequest(`/audit/export${queryString(query)}`, {
        headers: { Accept: 'text/csv' },
      });
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = url;
      link.download = 'audit-export.csv';
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      showToast(TEXT.exported);
      events.reload();
    });

  return (
    <>
      <PageTitle
        title={TEXT.title}
        description={TEXT.description}
        action={
          <>
            <button
              className="btn btn-outline"
              disabled={exportAction.busy}
              onClick={() => void download()}
            >
              {exportAction.busy ? TEXT.exporting : TEXT.export}
            </button>
            <button
              className="btn btn-outline"
              disabled={verifyAction.busy}
              onClick={() =>
                void verifyAction.run(async () => {
                  setVerification(null);
                  setVerification(await apiFetch<AuditVerifyResult>('/audit/verify'));
                })
              }
            >
              {verifyAction.busy ? TEXT.verifying : TEXT.verify}
            </button>
          </>
        }
      />
      <ErrorBox error={verifyAction.error ?? exportAction.error} />
      {verification && (
        <div className={`demo-banner ${verification.ok ? '' : 'error-box'}`} role="status">
          <span aria-hidden="true">{verification.ok ? '✓' : '!'}</span>
          <div>
            <strong>{verification.ok ? TEXT.passed : TEXT.broken}</strong>
            {TEXT.checked(verification.checked)}
            {verification.firstBrokenId && TEXT.firstBroken(verification.firstBrokenId)}
          </div>
        </div>
      )}
      <form
        className="filter-row"
        onSubmit={(event) => {
          event.preventDefault();
          setFilters(draft);
        }}
      >
        <input
          className="field"
          aria-label={TEXT.action}
          placeholder={TEXT.actionPlaceholder}
          maxLength={100}
          value={draft.action}
          onChange={(event) => setDraft({ ...draft, action: event.target.value })}
        />
        <input
          className="field"
          aria-label={TEXT.targetType}
          placeholder={TEXT.targetPlaceholder}
          maxLength={100}
          value={draft.targetType}
          onChange={(event) => setDraft({ ...draft, targetType: event.target.value })}
        />
        <label className="hint" style={{ margin: 0 }}>
          {TEXT.from}{' '}
          <input
            className="field"
            type="date"
            value={draft.from}
            onChange={(event) => setDraft({ ...draft, from: event.target.value })}
          />
        </label>
        <label className="hint" style={{ margin: 0 }}>
          {TEXT.to}{' '}
          <input
            className="field"
            type="date"
            value={draft.to}
            onChange={(event) => setDraft({ ...draft, to: event.target.value })}
          />
        </label>
        <button type="submit" className="btn btn-primary">
          {TEXT.search}
        </button>
        <button
          type="button"
          className="btn btn-outline"
          onClick={() => {
            setDraft(EMPTY);
            setFilters(EMPTY);
          }}
        >
          {TEXT.clear}
        </button>
      </form>
      <ErrorBox error={events.error} loading />
      <SectionPanel title={TEXT.log} subtitle={TEXT.subtitle(events.data?.length ?? 0)}>
        {!events.data && events.loading ? (
          <LoadingState />
        ) : (
          <DataTable
            caption={TEXT.caption}
            rows={events.data ?? []}
            rowKey={(row) => String(row.id)}
            empty={<EmptyState title={TEXT.emptyTitle}>{TEXT.emptyBody}</EmptyState>}
            columns={[
              {
                header: TEXT.event,
                cell: (row) => (
                  <>
                    <span className="post-title">{row.action}</span>
                    <span className="subline">#{row.id}</span>
                  </>
                ),
              },
              {
                header: TEXT.actor,
                cell: (row) => (row.actor_user_id ? personName(row.actor_user_id) : TEXT.system),
              },
              { header: TEXT.company, cell: (row) => companyName(row.company_id) },
              { header: TEXT.time, cell: (row) => formatDateTime(row.occurred_at) },
              {
                header: TEXT.target,
                cell: (row) =>
                  `${row.target_type ?? '—'}${row.target_id ? ` · ${shortId(row.target_id)}` : ''}`,
              },
            ]}
          />
        )}
      </SectionPanel>
      <small className="hint">
        {TEXT.exportNote} {TEXT.note}
      </small>
    </>
  );
}
