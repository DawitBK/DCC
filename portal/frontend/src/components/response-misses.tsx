'use client';

import { useState } from 'react';
import type { ApprovalMissesDto, InboxMissReportDto } from '@dcc/contracts';
import { queryString } from '@/lib/browser-api';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { DataTable } from './data-table';
import { EmptyState, LoadingState } from './empty-state';
import { ErrorBox } from './error-box';
import { FormField } from './form-field';
import { SectionPanel } from './section-panel';
import '../app/screens/inbox-routing.css';

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

const TEXT = {
  title: 'Response and approval misses',
  subtitle:
    'What reached the last step of the ladder in the month, per company: an inbox message still unanswered at twice its response time, an approval still waiting at twice its limit, and an emergency post still without its second approval after 48 hours. These are the figures for the monthly report. A zero means nothing was missed.',
  month: 'Month',
  monthHint: 'Pick a month. The month is counted in each company’s own time.',
  monthInvalid: 'Choose a month, for example 2026-11.',
  retry: 'Try again',
  caption: (month: string) => `Misses per company in ${month}`,
  company: 'Company',
  inbox: 'Inbox messages unanswered at twice their time',
  approvals: 'Approvals waiting at twice their limit',
  emergency: 'Emergency posts without a second approval after 48 hours',
  noCompaniesTitle: 'No companies to report on',
  noCompaniesBody: 'You can read reports for none of the companies in view.',
  loading: 'Reading the figures…',
  total: (n: number, month: string) =>
    n === 0 ? `No misses in ${month}.` : `${n} ${n === 1 ? 'miss' : 'misses'} in ${month}.`,
  partial:
    'One of the two figures could not be read. The column shows a dash where the figure is missing, not a zero.',
};

/** This month, as the browser's local `YYYY-MM`. */
const currentMonth = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
};

type Row = { companyId: string; name: string };

/**
 * Round 3 (H-19, B-37): the monthly misses of the inbox clock and the approval ladder, side by side, one row per company.
 * `GET /api/reports/inbox-misses?month=` and `GET /api/reports/approval-misses?month=` (both need `report.read`).
 * The two reads are independent: if one fails the other is still shown and the missing figure is a dash, never a zero.
 */
export function ResponseMisses() {
  const { companiesWhere, companyId } = useWorkspace();
  const [month, setMonth] = useState(currentMonth);
  const valid = MONTH.test(month);
  const inbox = useApiData<InboxMissReportDto[]>(
    valid ? `/reports/inbox-misses${queryString({ month })}` : null,
  );
  const approvals = useApiData<ApprovalMissesDto[]>(
    valid ? `/reports/approval-misses${queryString({ month })}` : null,
  );
  const rows: Row[] = companiesWhere('report.read')
    .filter((company) => !companyId || company.id === companyId)
    .map((company) => ({ companyId: company.id, name: company.name }));
  const busy = valid && (inbox.loading || approvals.loading);
  const inboxFor = (id: string) =>
    inbox.data ? (inbox.data.find((r) => r.companyId === id)?.misses ?? 0) : null;
  const approvalsFor = (id: string) =>
    approvals.data ? (approvals.data.find((r) => r.companyId === id)?.approvalMisses ?? 0) : null;
  const emergencyFor = (id: string) =>
    approvals.data
      ? (approvals.data.find((r) => r.companyId === id)?.emergencyFollowupMisses ?? 0)
      : null;
  const show = (n: number | null) => (n === null ? '–' : String(n));
  const total = rows.reduce(
    (sum, r) =>
      sum +
      (inboxFor(r.companyId) ?? 0) +
      (approvalsFor(r.companyId) ?? 0) +
      (emergencyFor(r.companyId) ?? 0),
    0,
  );
  const failed = valid && !busy && (inbox.error !== null || approvals.error !== null);
  const reloadAll = () => {
    inbox.reload();
    approvals.reload();
  };

  return (
    <SectionPanel title={TEXT.title} subtitle={TEXT.subtitle}>
      <div className="misses-controls">
        <FormField
          label={TEXT.month}
          hint={TEXT.monthHint}
          error={valid ? undefined : TEXT.monthInvalid}
        >
          {(control) => (
            <input
              className="field"
              type="month"
              {...control}
              value={month}
              max="9999-12"
              onChange={(event) => setMonth(event.target.value)}
            />
          )}
        </FormField>
      </div>
      <ErrorBox error={inbox.error} loading />
      <ErrorBox error={approvals.error} loading />
      {failed && (
        <p>
          <button type="button" className="btn btn-outline" onClick={reloadAll}>
            {TEXT.retry}
          </button>
        </p>
      )}
      <div aria-live="polite" aria-busy={busy}>
        {busy && <LoadingState />}
        {valid && !busy && !failed && rows.length > 0 && (
          <p className="visually-hidden">{TEXT.total(total, month)}</p>
        )}
      </div>
      {valid && !busy && rows.length === 0 && (
        <EmptyState title={TEXT.noCompaniesTitle}>{TEXT.noCompaniesBody}</EmptyState>
      )}
      {valid && !busy && rows.length > 0 && (
        <>
          <DataTable
            caption={TEXT.caption(month)}
            rows={rows}
            rowKey={(row) => row.companyId}
            columns={[
              {
                header: TEXT.company,
                cell: (row) => <span className="post-title">{row.name}</span>,
              },
              { header: TEXT.inbox, cell: (row) => show(inboxFor(row.companyId)) },
              { header: TEXT.approvals, cell: (row) => show(approvalsFor(row.companyId)) },
              { header: TEXT.emergency, cell: (row) => show(emergencyFor(row.companyId)) },
            ]}
          />
          {failed && <small className="hint">{TEXT.partial}</small>}
        </>
      )}
    </SectionPanel>
  );
}
