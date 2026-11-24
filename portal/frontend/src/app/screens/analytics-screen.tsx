'use client';

import { useState, type ReactNode } from 'react';
import type {
  AnalyticsPointDto,
  AnalyticsReportDto,
  AnalyticsSeriesDto,
  SocialAccountDto,
} from '@dcc/contracts';
import { DataTable } from '@/components/data-table';
import { EmptyState, LoadingState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { Sparkline } from '@/components/sparkline';
import { StatusChip } from '@/components/status-chip';
import { queryString } from '@/lib/browser-api';
import { formatDay, formatReading } from '@/lib/format';
import { PLATFORM_LABELS } from '@/lib/labels';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

/** The windows the screen offers. The API takes 1 to 90 days. */
const WINDOWS = [7, 30, 90] as const;
const DEFAULT_WINDOW = 30;

const TEXT = {
  title: 'Analytics & reports',
  description: 'Figures read from each social network, account by account.',
  rules:
    'Each account is shown on its own, with the network’s own names for its figures. DCC never adds figures across accounts or networks, and it stores none of them: they are read from the network through the engine when this page opens.',
  windowLabel: 'Time window',
  windowOption: (days: number) => `Last ${days} days`,
  accountLabel: 'Account',
  allAccounts: 'All accounts',
  retry: 'Try again',
  summary: (count: number, days: number) =>
    count === 1
      ? `Showing 1 account for the last ${days} days.`
      : `Showing ${count} accounts for the last ${days} days.`,
  noAccountsTitle: 'No accounts to report on',
  noAccountsBody:
    'No account connected to the engine is available here. Accounts must be connected to the engine before their figures can be read.',
  panelSubtitle: (platform: string, company: string, days: number) =>
    `${platform} · ${company} · last ${days} days`,
  caption: (account: string) => `Figures for ${account}, as the network names them`,
  metric: 'Figure',
  first: 'First reading',
  latest: 'Latest reading',
  noReading: 'No reading',
  noReadingsInSeries: 'The network sent no readings for this figure.',
  trendNote: 'Each trend is drawn on its own scale. It shows shape, not size.',
  detailsSummary: 'All readings by day',
  detailsCaption: (account: string) => `Every reading for ${account}, by day`,
  date: 'Date',
  emptyTitle: 'No data for this period',
  emptyBody:
    'The network sent nothing for this account in this window. That is not a count of zero.',
  missingTitle: 'No figures for this post',
  missingFallback: 'The engine marked the published post as gone.',
  unavailableTitle: 'Figures could not be read for this account',
  unavailableFallback: 'The engine could not answer for this account.',
  unavailableChip: 'Unavailable',
  missingChip: 'Missing',
  okChip: 'Figures read',
  emptyChip: 'No data',
};

type Reading = { date: string; value: number };

/** The first and the latest point that has a reading. A point without one is skipped, never counted as 0. */
function firstAndLatest(points: AnalyticsPointDto[]): { first?: Reading; latest?: Reading } {
  const read = points.flatMap((point): Reading[] =>
    point.value === null ? [] : [{ date: point.date, value: point.value }],
  );
  return { first: read[0], latest: read.at(-1) };
}

function reading(point: Reading | undefined): ReactNode {
  return point ? (
    <>
      {formatReading(point.value)}
      <span className="subline">{formatDay(point.date)}</span>
    </>
  ) : (
    TEXT.noReading
  );
}

/** `GET /api/reports/analytics?days=&socialAccountId=` (needs `report.read`). Rules: decision D-24. */
export function AnalyticsScreen() {
  const { companyId, can } = useWorkspace();
  const [days, setDays] = useState<number>(DEFAULT_WINDOW);
  const [accountId, setAccountId] = useState('');
  const accounts = useApiData<SocialAccountDto[]>(can('account.read') ? '/social-accounts' : null);
  const reports = useApiData<AnalyticsReportDto[]>(
    `/reports/analytics${queryString({ days, socialAccountId: accountId })}`,
  );

  const visible = (reports.data ?? []).filter(
    (report) => !companyId || report.companyId === companyId,
  );
  const accountChoices = (accounts.data ?? []).filter(
    (account) => !companyId || account.companyId === companyId,
  );
  const busy = reports.loading;

  return (
    <>
      <PageTitle title={TEXT.title} description={TEXT.description} />
      <p className="hint" style={{ marginTop: 0, marginBottom: 15, fontSize: 13 }}>
        {TEXT.rules}
      </p>
      <div className="filter-row">
        <select
          className="select-field"
          aria-label={TEXT.windowLabel}
          value={days}
          onChange={(event) => setDays(Number(event.target.value))}
        >
          {WINDOWS.map((value) => (
            <option key={value} value={value}>
              {TEXT.windowOption(value)}
            </option>
          ))}
        </select>
        {accountChoices.length > 0 && (
          <select
            className="select-field"
            aria-label={TEXT.accountLabel}
            value={accountId}
            onChange={(event) => setAccountId(event.target.value)}
          >
            <option value="">{TEXT.allAccounts}</option>
            {accountChoices.map((account) => (
              <option key={account.id} value={account.id}>
                {account.displayName} ({PLATFORM_LABELS[account.platform]})
              </option>
            ))}
          </select>
        )}
      </div>
      <ErrorBox error={reports.error} loading />
      {reports.error && (
        <p>
          <button type="button" className="btn btn-outline" onClick={reports.reload}>
            {TEXT.retry}
          </button>
        </p>
      )}
      <div aria-live="polite" aria-busy={busy}>
        {!reports.data && busy && <LoadingState />}
        {reports.data && !busy && (
          <p className="visually-hidden">{TEXT.summary(visible.length, days)}</p>
        )}
      </div>
      {reports.data && visible.length === 0 && !busy && (
        <SectionPanel title={TEXT.noAccountsTitle}>
          <EmptyState title={TEXT.noAccountsTitle}>{TEXT.noAccountsBody}</EmptyState>
        </SectionPanel>
      )}
      {reports.data &&
        visible.map((report) => (
          <AccountReport key={report.socialAccountId} report={report} days={days} />
        ))}
    </>
  );
}

function AccountReport({ report, days }: { report: AnalyticsReportDto; days: number }) {
  const { companyName } = useWorkspace();
  const platform = PLATFORM_LABELS[report.platform];
  const { status } = report.result;
  const chip =
    status === 'ok'
      ? { label: TEXT.okChip, tone: 'green' as const }
      : status === 'empty'
        ? { label: TEXT.emptyChip, tone: 'gray' as const }
        : status === 'missing'
          ? { label: TEXT.missingChip, tone: 'amber' as const }
          : { label: TEXT.unavailableChip, tone: 'red' as const };
  return (
    <div style={{ marginBottom: 18 }}>
      <SectionPanel
        title={report.displayName}
        subtitle={TEXT.panelSubtitle(
          platform,
          companyName(report.companyId),
          report.result.windowDays || days,
        )}
        action={<StatusChip label={chip.label} tone={chip.tone} />}
      >
        <ResultBody report={report} platform={platform} />
      </SectionPanel>
    </div>
  );
}

function ResultBody({ report, platform }: { report: AnalyticsReportDto; platform: string }) {
  const { result } = report;
  if (result.status === 'empty') {
    return <EmptyState title={TEXT.emptyTitle}>{TEXT.emptyBody}</EmptyState>;
  }
  if (result.status === 'missing') {
    return (
      <EmptyState title={TEXT.missingTitle}>{result.reason || TEXT.missingFallback}</EmptyState>
    );
  }
  if (result.status === 'unavailable') {
    return (
      <EmptyState title={TEXT.unavailableTitle}>
        {result.reason || TEXT.unavailableFallback}
      </EmptyState>
    );
  }
  if (result.series.length === 0) {
    return <EmptyState title={TEXT.emptyTitle}>{TEXT.emptyBody}</EmptyState>;
  }
  return (
    <>
      <div className="compact-table">
        <DataTable
          caption={TEXT.caption(report.displayName)}
          rows={result.series}
          rowKey={(row) => row.label}
          columns={[
            {
              header: TEXT.metric,
              cell: (row) => (
                <>
                  <span className="post-title">{row.label}</span>
                  <span className="subline">{platform}</span>
                  {row.points.length === 0 ? (
                    <span className="subline">{TEXT.noReadingsInSeries}</span>
                  ) : (
                    <Sparkline points={row.points} />
                  )}
                </>
              ),
            },
            { header: TEXT.first, cell: (row) => reading(firstAndLatest(row.points).first) },
            { header: TEXT.latest, cell: (row) => reading(firstAndLatest(row.points).latest) },
          ]}
        />
      </div>
      <small className="hint">{TEXT.trendNote}</small>
      <DailyReadings account={report.displayName} series={result.series} />
    </>
  );
}

/** Every reading, a row per day and a column per figure, kept behind a disclosure so the page stays short. */
function DailyReadings({ account, series }: { account: string; series: AnalyticsSeriesDto[] }) {
  const days = [
    ...new Set(series.flatMap((item) => item.points.map((point) => point.date))),
  ].sort();
  if (days.length === 0) return null;
  const lookups = series.map(
    (item) => new Map(item.points.map((point) => [point.date, point.value])),
  );
  return (
    <details className="readings-details">
      <summary>{TEXT.detailsSummary}</summary>
      <div className="table-wrap">
        <table>
          <caption className="visually-hidden">{TEXT.detailsCaption(account)}</caption>
          <thead>
            <tr>
              <th scope="col">{TEXT.date}</th>
              {series.map((item) => (
                <th key={item.label} scope="col">
                  {item.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((day) => (
              <tr key={day}>
                <th scope="row">{formatDay(day)}</th>
                {series.map((item, index) => {
                  const value = lookups[index]!.get(day);
                  return (
                    <td key={item.label}>
                      {value === null || value === undefined
                        ? TEXT.noReading
                        : formatReading(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}
