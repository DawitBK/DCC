'use client';

import { useMemo, useState } from 'react';
import {
  COMPANY_STATUSES,
  type CompanyDto,
  type FreezeDto,
  type OperationsOverviewDto,
} from '@dcc/contracts';
import { EmptyState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { StatusChip } from '@/components/status-chip';
import { DataGrid, type GridColumn, type GridFilter } from '@/components/kit/data-grid';
import { PageHeader } from '@/components/kit/page-header';
import { Callout, Fact } from '@/components/kit/parts';
import { COMPANY_STATUS } from '@/lib/labels';
import { needsRoleHint } from '@/lib/permissions-ui';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { CompanyDetail } from './companies-detail';
import { CompanyForm, type CompanyEditing } from './companies-forms';
import {
  FactStrip,
  GatedButton,
  LoadingBlock,
  RecordLink,
  ViewOnlyNote,
  useBrands,
} from './registry-shared';
import './companies-screen.css';

const TEXT = {
  title: 'Companies and brands',
  description:
    'The businesses of the Group and the brands each one manages. Open a company to see its accounts, people, rules, publishing state, inbox and incidents in one place.',
  addCompany: '＋ Add company',
  addCompanyReason: 'Only a Group administrator can add a company.',
  caption: 'Companies of the Group',
  companies: 'Companies',
  companiesNote: (active: number) => `${active} active`,
  brands: 'Brands',
  brandsNote: 'Across these companies',
  accounts: 'Social accounts',
  accountsNote: (attention: number) =>
    attention === 0 ? 'None need attention' : `${attention} need attention`,
  incidents: 'Open incidents',
  incidentsNote: 'Open or being investigated',
  frozen: 'Publishing frozen',
  frozenNote: 'Companies with a freeze on them',
  cannotPublish: 'Cannot publish',
  cannotPublishNote: 'Suspended or archived',
  company: 'Company',
  status: 'Status',
  brandsCol: 'Brands',
  accountsCol: 'Accounts',
  contentCol: 'Content',
  publicationsCol: 'Publications',
  incidentsCol: 'Open incidents',
  freezeCol: 'Publishing',
  open: 'Open',
  openLabel: (name: string) => `Open ${name}`,
  hidden: '—',
  noFigure: 'Needs the permission to see reports',
  failedNote: (count: number) => `${count} failed`,
  inReviewNote: (count: number) => `${count} in review`,
  attentionNote: (count: number) => `${count} need attention`,
  notFrozen: 'Open',
  frozenWhole: 'Frozen',
  frozenAccounts: (count: number) =>
    count === 1 ? '1 account frozen' : `${count} accounts frozen`,
  cannotPublishChip: 'Cannot publish',
  filterStatus: 'Status',
  filterFreeze: 'Publishing',
  optFrozen: 'Company frozen',
  optSomeFrozen: 'Some account frozen',
  optNotFrozen: 'Not frozen',
  filterIncidents: 'Incidents',
  optHasIncidents: 'Has open incidents',
  optNoIncidents: 'No open incidents',
  emptyTitle: 'No companies in this scope',
  emptyBody:
    'The API returned no company for your access. A Group administrator adds companies and gives people roles in them.',
  brandsError: 'Brands could not be loaded',
  overviewError: 'The operations figures could not be loaded',
  freezesError: 'The publishing freezes could not be loaded',
  reportsHidden: 'Some figures are hidden',
  reportsHiddenBody:
    'Accounts, content, publications and incidents per company come from the operations overview.',
  freezesHidden:
    'The freeze column needs the right to freeze publishing, because that is the right that lets someone see freezes.',
  noCompanies: 'Loading companies',
};

type Row = {
  company: CompanyDto;
  brands: number | null;
  overview: OperationsOverviewDto | null;
  frozenWhole: boolean | null;
  frozenAccounts: number;
  openIncidents: number | null;
};

const incidentsOpen = (overview: OperationsOverviewDto | null): number | null =>
  overview?.incidents
    ? (overview.incidents.byStatus.open ?? 0) + (overview.incidents.byStatus.investigating ?? 0)
    : null;

/** `GET /api/companies` plus the operations overview, brands and freezes for the figures. Detail: `/companies/<id>`. */
export function CompaniesScreen() {
  const { detailId } = useWorkspace();
  return (
    <div className="rg-page">
      {detailId ? <CompanyDetail companyId={detailId} /> : <CompaniesList />}
    </div>
  );
}

function CompaniesList() {
  const { scopeCompanies, companies, can, open, reloadCompanies } = useWorkspace();
  const [editing, setEditing] = useState<CompanyEditing | null>(null);
  const ids = scopeCompanies.map((item) => item.id);
  const mayReadBrands = can('brand.read');
  const brands = useBrands(ids, mayReadBrands);
  const overview = useApiData<OperationsOverviewDto[]>(
    can('report.read') ? '/reports/overview' : null,
  );
  const freezes = useApiData<FreezeDto[]>(can('publishing.freeze') ? '/publishing-freezes' : null);
  const mayManage = can('company.manage');

  const rows = useMemo<Row[]>(
    () =>
      scopeCompanies.map((company) => {
        const row = overview.data?.find((entry) => entry.companyId === company.id) ?? null;
        const mine = (freezes.data ?? []).filter((freeze) => freeze.companyId === company.id);
        return {
          company,
          brands:
            mayReadBrands && brands.loaded ? (brands.byCompany[company.id]?.length ?? 0) : null,
          overview: row,
          frozenWhole: freezes.data ? mine.some((freeze) => freeze.socialAccountId === null) : null,
          frozenAccounts: mine.filter((freeze) => freeze.socialAccountId !== null).length,
          openIncidents: incidentsOpen(row),
        };
      }),
    [scopeCompanies, overview.data, freezes.data, brands.byCompany, brands.loaded, mayReadBrands],
  );

  const sum = (pick: (row: Row) => number | null) =>
    rows.reduce((total, row) => total + (pick(row) ?? 0), 0);

  const columns = useMemo<GridColumn<Row>[]>(
    () => [
      {
        id: 'company',
        header: TEXT.company,
        sortValue: (row) => row.company.name,
        exportValue: (row) => `${row.company.name} (${row.company.slug})`,
        cell: (row) => (
          <>
            <span className="post-title">
              <RecordLink screen="companies" id={row.company.id} keepCompany={false}>
                {row.company.name}
              </RecordLink>
            </span>
            <span className="subline">{row.company.slug}</span>
          </>
        ),
      },
      {
        id: 'status',
        header: TEXT.status,
        sortValue: (row) => COMPANY_STATUS[row.company.status].label,
        exportValue: (row) => COMPANY_STATUS[row.company.status].label,
        cell: (row) => <StatusChip status={COMPANY_STATUS[row.company.status]} />,
      },
      {
        id: 'brands',
        header: TEXT.brandsCol,
        align: 'right',
        sortValue: (row) => row.brands,
        exportValue: (row) => (row.brands === null ? '' : String(row.brands)),
        cell: (row) =>
          row.brands === null ? <span className="rg-muted">{TEXT.hidden}</span> : row.brands,
      },
      {
        id: 'accounts',
        header: TEXT.accountsCol,
        align: 'right',
        sortValue: (row) => row.overview?.socialAccounts.total ?? null,
        exportValue: (row) => String(row.overview?.socialAccounts.total ?? ''),
        cell: (row) =>
          row.overview ? (
            <>
              {row.overview.socialAccounts.total}
              {(row.overview.socialAccounts.byStatus.needs_attention ?? 0) +
                (row.overview.socialAccounts.byStatus.disconnected ?? 0) >
                0 && (
                <span className="subline">
                  {TEXT.attentionNote(
                    (row.overview.socialAccounts.byStatus.needs_attention ?? 0) +
                      (row.overview.socialAccounts.byStatus.disconnected ?? 0),
                  )}
                </span>
              )}
            </>
          ) : (
            <span className="rg-muted" title={TEXT.noFigure}>
              {TEXT.hidden}
            </span>
          ),
      },
      {
        id: 'content',
        header: TEXT.contentCol,
        align: 'right',
        sortValue: (row) => row.overview?.contentItems.total ?? null,
        exportValue: (row) => String(row.overview?.contentItems.total ?? ''),
        cell: (row) =>
          row.overview ? (
            <>
              {row.overview.contentItems.total}
              {(row.overview.contentItems.byStatus.in_review ?? 0) > 0 && (
                <span className="subline">
                  {TEXT.inReviewNote(row.overview.contentItems.byStatus.in_review ?? 0)}
                </span>
              )}
            </>
          ) : (
            <span className="rg-muted" title={TEXT.noFigure}>
              {TEXT.hidden}
            </span>
          ),
      },
      {
        id: 'publications',
        header: TEXT.publicationsCol,
        align: 'right',
        sortValue: (row) => row.overview?.publications.total ?? null,
        exportValue: (row) => String(row.overview?.publications.total ?? ''),
        cell: (row) =>
          row.overview ? (
            <>
              {row.overview.publications.total}
              {(row.overview.publications.byStatus.failed ?? 0) > 0 && (
                <span className="subline">
                  {TEXT.failedNote(row.overview.publications.byStatus.failed ?? 0)}
                </span>
              )}
            </>
          ) : (
            <span className="rg-muted" title={TEXT.noFigure}>
              {TEXT.hidden}
            </span>
          ),
      },
      {
        id: 'incidents',
        header: TEXT.incidentsCol,
        align: 'right',
        sortValue: (row) => row.openIncidents,
        exportValue: (row) => (row.openIncidents === null ? '' : String(row.openIncidents)),
        cell: (row) =>
          row.openIncidents === null ? (
            <span className="rg-muted">{TEXT.hidden}</span>
          ) : row.openIncidents > 0 ? (
            <StatusChip label={String(row.openIncidents)} tone="red" />
          ) : (
            0
          ),
      },
      {
        id: 'freeze',
        header: TEXT.freezeCol,
        sortValue: (row) => (row.frozenWhole ? 2 : row.frozenAccounts > 0 ? 1 : 0),
        exportValue: (row) =>
          row.frozenWhole === null
            ? ''
            : row.company.status !== 'active'
              ? TEXT.cannotPublishChip
              : row.frozenWhole
                ? TEXT.frozenWhole
                : row.frozenAccounts > 0
                  ? TEXT.frozenAccounts(row.frozenAccounts)
                  : TEXT.notFrozen,
        cell: (row) => (
          <span className="rg-chips">
            {row.company.status !== 'active' && (
              <StatusChip label={TEXT.cannotPublishChip} tone="amber" />
            )}
            {row.frozenWhole === null ? (
              row.company.status === 'active' && <span className="rg-muted">{TEXT.hidden}</span>
            ) : row.frozenWhole ? (
              <StatusChip label={TEXT.frozenWhole} tone="red" />
            ) : row.frozenAccounts > 0 ? (
              <StatusChip label={TEXT.frozenAccounts(row.frozenAccounts)} tone="amber" />
            ) : (
              row.company.status === 'active' && <StatusChip label={TEXT.notFrozen} tone="green" />
            )}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: (row) => (
          <RecordLink
            screen="companies"
            id={row.company.id}
            keepCompany={false}
            label={TEXT.openLabel(row.company.name)}
            className="text-link rg-link rg-nowrap"
          >
            {TEXT.open}
          </RecordLink>
        ),
      },
    ],
    [],
  );

  const filters = useMemo<GridFilter<Row>[]>(
    () => [
      {
        id: 'status',
        label: TEXT.filterStatus,
        options: COMPANY_STATUSES.map((value) => ({ value, label: COMPANY_STATUS[value].label })),
        test: (row, value) => row.company.status === value,
      },
      {
        id: 'freeze',
        label: TEXT.filterFreeze,
        options: [
          { value: 'whole', label: TEXT.optFrozen },
          { value: 'some', label: TEXT.optSomeFrozen },
          { value: 'none', label: TEXT.optNotFrozen },
        ],
        test: (row, value) =>
          value === 'whole'
            ? row.frozenWhole === true
            : value === 'some'
              ? row.frozenAccounts > 0
              : row.frozenWhole === false && row.frozenAccounts === 0,
      },
      {
        id: 'incidents',
        label: TEXT.filterIncidents,
        options: [
          { value: 'has', label: TEXT.optHasIncidents },
          { value: 'none', label: TEXT.optNoIncidents },
        ],
        test: (row, value) =>
          value === 'has' ? (row.openIncidents ?? 0) > 0 : row.openIncidents === 0,
      },
    ],
    [],
  );

  const activeCount = scopeCompanies.filter((item) => item.status === 'active').length;
  const loadingCompanies = companies.length === 0;

  return (
    <>
      <PageHeader
        title={TEXT.title}
        description={TEXT.description}
        actions={
          <GatedButton
            allowed={mayManage}
            permission="company.manage"
            reason={TEXT.addCompanyReason}
            className="btn btn-primary"
            onClick={() => setEditing({ kind: 'new-company' })}
          >
            {TEXT.addCompany}
          </GatedButton>
        }
      />
      <ErrorBox error={brands.error} title={TEXT.brandsError} loading />
      <ErrorBox error={overview.error} title={TEXT.overviewError} loading />
      <ErrorBox error={freezes.error} title={TEXT.freezesError} loading />
      <FactStrip columns={6}>
        <Fact
          label={TEXT.companies}
          value={scopeCompanies.length}
          note={TEXT.companiesNote(activeCount)}
        />
        <Fact
          label={TEXT.brands}
          value={mayReadBrands && brands.loaded ? sum((row) => row.brands) : TEXT.hidden}
          note={TEXT.brandsNote}
        />
        <Fact
          label={TEXT.accounts}
          value={
            overview.data ? sum((row) => row.overview?.socialAccounts.total ?? 0) : TEXT.hidden
          }
          note={
            overview.data
              ? TEXT.accountsNote(
                  sum(
                    (row) =>
                      (row.overview?.socialAccounts.byStatus.needs_attention ?? 0) +
                      (row.overview?.socialAccounts.byStatus.disconnected ?? 0),
                  ),
                )
              : TEXT.noFigure
          }
        />
        <Fact
          label={TEXT.incidents}
          value={
            rows.some((row) => row.openIncidents !== null)
              ? sum((row) => row.openIncidents)
              : TEXT.hidden
          }
          note={TEXT.incidentsNote}
        />
        <Fact
          label={TEXT.frozen}
          value={
            freezes.data
              ? rows.filter((row) => row.frozenWhole || row.frozenAccounts > 0).length
              : TEXT.hidden
          }
          note={freezes.data ? TEXT.frozenNote : TEXT.freezesHidden}
        />
        <Fact
          label={TEXT.cannotPublish}
          value={scopeCompanies.length - activeCount}
          note={TEXT.cannotPublishNote}
        />
      </FactStrip>
      <div className="rg-stack">
        {!mayManage && (
          <ViewOnlyNote permission="company.manage">{needsRoleHint('company.manage')}</ViewOnlyNote>
        )}
        {!can('report.read') && (
          <Callout tone="info" title={TEXT.reportsHidden}>
            {TEXT.reportsHiddenBody} {needsRoleHint('report.read')}
          </Callout>
        )}
        {loadingCompanies ? (
          <LoadingBlock lines={5} label={TEXT.noCompanies} />
        ) : (
          <DataGrid
            caption={TEXT.caption}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.company.id}
            searchText={(row) => `${row.company.name} ${row.company.slug}`}
            filters={filters}
            defaultSort={{ id: 'company', direction: 'asc' }}
            exportName="companies"
            onOpen={(row) => open('companies', row.company.id)}
            empty={
              scopeCompanies.length === 0 ? (
                <EmptyState title={TEXT.emptyTitle}>{TEXT.emptyBody}</EmptyState>
              ) : undefined
            }
          />
        )}
      </div>
      {editing && (
        <CompanyForm
          editing={editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            setEditing(null);
            reloadCompanies();
            brands.reload();
            overview.reload();
            if (editing.kind === 'new-company' && saved?.id) open('companies', saved.id);
          }}
        />
      )}
    </>
  );
}
