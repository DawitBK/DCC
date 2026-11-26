'use client';

import {
  MODERATION_ACTIONS,
  type ModerationActionDto,
  type ModerationOutcome,
} from '@dcc/contracts';
import { ErrorBox } from '@/components/error-box';
import { DataGrid, type GridColumn, type GridFilter } from '@/components/kit/data-grid';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { formatDateTime, shortId } from '@/lib/format';
import type { Tone } from '@/lib/labels';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const TEXT = {
  title: 'Moderation record',
  subtitle:
    'Every comment hidden, deleted or blocked through DCC: who did it, why, and what really happened in the network.',
  caption: 'Moderation actions',
  loadError: 'The moderation record could not be loaded',
  empty: 'Nothing has been moderated yet.',
  columns: {
    when: 'When',
    action: 'Action',
    company: 'Company',
    message: 'Message',
    reason: 'Reason',
    outcome: 'What happened',
    by: 'By',
  },
  filters: { action: 'Action', outcome: 'Outcome', company: 'Company' },
  noReason: '—',
};

const ACTION_LABEL: Record<(typeof MODERATION_ACTIONS)[number], string> = {
  hide: 'Hidden',
  delete: 'Deleted',
  block: 'Person blocked',
};

const OUTCOME: Record<ModerationOutcome, { label: string; tone: Tone }> = {
  done: { label: 'Done in the network', tone: 'green' },
  recorded_only: { label: 'Recorded only', tone: 'amber' },
  failed: { label: 'Failed', tone: 'red' },
};

/** `GET /api/inbox/moderation`: the record of what was hidden, deleted or blocked. For holders of `inbox.moderate`. */
export function InboxModerationLog() {
  const { can, companyId, companyName, companies, personName } = useWorkspace();
  const log = useApiData<ModerationActionDto[]>(
    can('inbox.moderate') ? `/inbox/moderation${companyId ? `?companyId=${companyId}` : ''}` : null,
  );
  if (!can('inbox.moderate')) return null;

  const columns: GridColumn<ModerationActionDto>[] = [
    {
      id: 'when',
      header: TEXT.columns.when,
      sortValue: (row) => row.performedAt,
      exportValue: (row) => row.performedAt,
      cell: (row) => formatDateTime(row.performedAt),
    },
    {
      id: 'action',
      header: TEXT.columns.action,
      sortValue: (row) => ACTION_LABEL[row.action],
      cell: (row) => ACTION_LABEL[row.action],
    },
    {
      id: 'company',
      header: TEXT.columns.company,
      sortValue: (row) => companyName(row.companyId),
      cell: (row) => companyName(row.companyId),
    },
    {
      id: 'message',
      header: TEXT.columns.message,
      hiddenByDefault: true,
      sortValue: (row) => row.engineMessageId,
      cell: (row) => <code>{shortId(row.engineMessageId)}</code>,
    },
    {
      id: 'reason',
      header: TEXT.columns.reason,
      sortValue: (row) => row.reason ?? '',
      cell: (row) => row.reason ?? TEXT.noReason,
    },
    {
      id: 'outcome',
      header: TEXT.columns.outcome,
      sortValue: (row) => OUTCOME[row.outcome].label,
      exportValue: (row) => `${OUTCOME[row.outcome].label}: ${row.outcomeNote}`,
      cell: (row) => (
        <>
          <StatusChip label={OUTCOME[row.outcome].label} tone={OUTCOME[row.outcome].tone} />
          <small className="hint" style={{ display: 'block' }}>
            {row.outcomeNote}
          </small>
        </>
      ),
    },
    {
      id: 'by',
      header: TEXT.columns.by,
      sortValue: (row) => row.performedByName ?? personName(row.performedBy),
      cell: (row) => row.performedByName ?? personName(row.performedBy),
    },
  ];

  const filters: GridFilter<ModerationActionDto>[] = [
    {
      id: 'action',
      label: TEXT.filters.action,
      options: MODERATION_ACTIONS.map((value) => ({ value, label: ACTION_LABEL[value] })),
      test: (row, value) => row.action === value,
    },
    {
      id: 'outcome',
      label: TEXT.filters.outcome,
      options: (Object.keys(OUTCOME) as ModerationOutcome[]).map((value) => ({
        value,
        label: OUTCOME[value].label,
      })),
      test: (row, value) => row.outcome === value,
    },
    {
      id: 'company',
      label: TEXT.filters.company,
      options: companies.map((company) => ({ value: company.id, label: company.name })),
      test: (row, value) => row.companyId === value,
    },
  ];

  return (
    <SectionPanel title={TEXT.title} subtitle={TEXT.subtitle}>
      <ErrorBox error={log.error} title={TEXT.loadError} loading />
      <DataGrid
        caption={TEXT.caption}
        columns={columns}
        rows={log.data ?? []}
        rowKey={(row) => row.id}
        searchText={(row) => `${row.reason ?? ''} ${row.outcomeNote} ${ACTION_LABEL[row.action]}`}
        filters={filters}
        defaultSort={{ id: 'when', direction: 'desc' }}
        exportName="moderation-record"
        empty={<p className="hint">{TEXT.empty}</p>}
      />
    </SectionPanel>
  );
}
