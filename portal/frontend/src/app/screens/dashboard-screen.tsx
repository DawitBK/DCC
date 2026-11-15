'use client';

import type { ContentItemDto, DashboardDto, OperationsOverviewDto } from '@dcc/contracts';
import { DataTable } from '@/components/data-table';
import { EmptyState, LoadingState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatCard } from '@/components/stat-card';
import { StatusChip } from '@/components/status-chip';
import { byNewest, currentVersionOf, useContentVersions } from '@/lib/content';
import { excerpt, formatDateTime } from '@/lib/format';
import { CONTENT_STATUS } from '@/lib/labels';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const TEXT = {
  title: (name: string) => `Good day, ${name}`,
  description: 'What needs attention across the companies you can see.',
  createContent: '＋ Create content',
  accounts: 'Social accounts',
  accountsFoot: (active: number, attention: number) =>
    `${active} active · ${attention} need attention`,
  pending: 'Waiting for approval',
  pendingFoot: 'Requests you may review',
  published: 'Published, last 7 days',
  publishedFoot: 'Posts sent through DCC',
  incidents: 'Open incidents',
  incidentsFoot: 'Open or being investigated',
  unread: 'Unread notifications',
  unreadFoot: 'Open the bell to read them',
  scopeNote:
    'These five numbers cover every company you can see; the company switcher does not narrow them.',
  overviewTitle: 'Operations overview',
  overviewSubtitle: 'Counts DCC holds per company. These are not audience analytics.',
  overviewCaption: 'Accounts, content items and publications per company',
  company: 'Company',
  accountsCol: 'Accounts',
  contentCol: 'Content items',
  publicationsCol: 'Publications',
  noOverview: 'No companies to report on',
  recentTitle: 'Recent content',
  recentSubtitle: 'The latest items in the chosen company scope',
  recentCaption: 'Recent content items',
  content: 'Content',
  status: 'Status',
  updated: 'Updated',
  noContent: 'No content yet',
  noContentBody: 'Drafts appear here once someone writes one.',
  viewAll: 'Open →',
  noText: '(text not loaded)',
};

function byStatus(counts: { total: number; byStatus: Record<string, number> }): string {
  const parts = Object.entries(counts.byStatus)
    .filter(([, count]) => count > 0)
    .map(([status, count]) => `${count} ${status.replaceAll('_', ' ')}`);
  return parts.length ? parts.join(' · ') : '';
}

/** Home: `GET /api/dashboard`, `GET /api/reports/overview` (report.read), `GET /api/content-items` (content.read). */
export function DashboardScreen() {
  const { me, can, companyId, companyName, go } = useWorkspace();
  const dashboard = useApiData<DashboardDto>('/dashboard');
  const overview = useApiData<OperationsOverviewDto[]>(
    can('report.read') ? '/reports/overview' : null,
  );
  const content = useApiData<ContentItemDto[]>(can('content.read') ? '/content-items' : null);
  const recent = byNewest(
    (content.data ?? []).filter((item) => !companyId || item.companyId === companyId),
  ).slice(0, 5);
  const { versionsByItem } = useContentVersions(recent);
  const overviewRows = (overview.data ?? []).filter(
    (row) => !companyId || row.companyId === companyId,
  );
  const numbers = dashboard.data;
  const firstName = (me.user.displayName || me.user.email).split(/[\s@]/)[0] ?? '';

  return (
    <>
      <PageTitle
        title={TEXT.title(firstName)}
        description={TEXT.description}
        action={
          can('content.create') && (
            <button className="btn btn-primary" onClick={() => go('composer')}>
              {TEXT.createContent}
            </button>
          )
        }
      />
      <ErrorBox error={dashboard.error} loading />
      {!numbers && dashboard.loading && <LoadingState />}
      {numbers && (
        <>
          <div className="grid grid-4" style={{ marginBottom: 8 }}>
            {numbers.accounts && (
              <StatCard
                label={TEXT.accounts}
                value={String(numbers.accounts.total)}
                foot={TEXT.accountsFoot(numbers.accounts.active, numbers.accounts.needsAttention)}
                icon="◎"
              />
            )}
            {numbers.pendingApprovals !== null && (
              <StatCard
                label={TEXT.pending}
                value={String(numbers.pendingApprovals)}
                foot={TEXT.pendingFoot}
                icon="✓"
              />
            )}
            {numbers.publishedLast7Days !== null && (
              <StatCard
                label={TEXT.published}
                value={String(numbers.publishedLast7Days)}
                foot={TEXT.publishedFoot}
                icon="↗"
              />
            )}
            {numbers.openIncidents !== null && (
              <StatCard
                label={TEXT.incidents}
                value={String(numbers.openIncidents)}
                foot={TEXT.incidentsFoot}
                icon="⚑"
              />
            )}
            <StatCard
              label={TEXT.unread}
              value={String(numbers.unreadNotifications)}
              foot={TEXT.unreadFoot}
              icon="♧"
            />
          </div>
          <small className="hint" style={{ marginBottom: 18 }}>
            {TEXT.scopeNote}
          </small>
        </>
      )}
      {can('report.read') && (
        <div style={{ marginBottom: 18 }}>
          <SectionPanel title={TEXT.overviewTitle} subtitle={TEXT.overviewSubtitle}>
            <ErrorBox error={overview.error} loading />
            {overview.data && (
              <DataTable
                caption={TEXT.overviewCaption}
                rows={overviewRows}
                rowKey={(row) => row.companyId}
                empty={<EmptyState title={TEXT.noOverview} />}
                columns={[
                  { header: TEXT.company, cell: (row) => row.companyName },
                  {
                    header: TEXT.accountsCol,
                    cell: (row) => (
                      <>
                        {row.socialAccounts.total}
                        <span className="subline">{byStatus(row.socialAccounts)}</span>
                      </>
                    ),
                  },
                  {
                    header: TEXT.contentCol,
                    cell: (row) => (
                      <>
                        {row.contentItems.total}
                        <span className="subline">{byStatus(row.contentItems)}</span>
                      </>
                    ),
                  },
                  {
                    header: TEXT.publicationsCol,
                    cell: (row) => (
                      <>
                        {row.publications.total}
                        <span className="subline">{byStatus(row.publications)}</span>
                      </>
                    ),
                  },
                ]}
              />
            )}
          </SectionPanel>
        </div>
      )}
      {can('content.read') && (
        <SectionPanel
          title={TEXT.recentTitle}
          subtitle={TEXT.recentSubtitle}
          action={
            <button
              className="text-link"
              onClick={() => go(can('content.create') ? 'composer' : 'publishing')}
            >
              {TEXT.viewAll}
            </button>
          }
        >
          <ErrorBox error={content.error} loading />
          {content.data && (
            <DataTable
              caption={TEXT.recentCaption}
              rows={recent}
              rowKey={(row) => row.id}
              empty={<EmptyState title={TEXT.noContent}>{TEXT.noContentBody}</EmptyState>}
              columns={[
                {
                  header: TEXT.content,
                  cell: (row) => {
                    const version = currentVersionOf(row, versionsByItem[row.id]);
                    return (
                      <>
                        <span className="post-title">
                          {version ? excerpt(version.body) : TEXT.noText}
                        </span>
                        <span className="subline">{companyName(row.companyId)}</span>
                      </>
                    );
                  },
                },
                {
                  header: TEXT.status,
                  cell: (row) => <StatusChip status={CONTENT_STATUS[row.status]} />,
                },
                { header: TEXT.updated, cell: (row) => formatDateTime(row.updatedAt) },
              ]}
            />
          )}
        </SectionPanel>
      )}
    </>
  );
}
