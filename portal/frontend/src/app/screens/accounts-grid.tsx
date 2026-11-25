'use client';

import { useMemo, type ReactNode } from 'react';
import {
  SOCIAL_ACCOUNT_STATUSES,
  SOCIAL_PLATFORMS,
  type BrandDto,
  type EngineChannelDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { StatusChip } from '@/components/status-chip';
import { DataGrid, type GridColumn, type GridFilter } from '@/components/kit/data-grid';
import { ACCOUNT_STATUS, PLATFORM_LABELS } from '@/lib/labels';
import { useWorkspace } from '@/lib/workspace';
import {
  RecordLink,
  PersonName,
  CompanyLink,
  PlatformBadge,
  isPracticeChannel,
} from './registry-shared';

export type AccountGap = 'owner' | 'backup_admin' | 'engine_channel' | 'status';

const TEXT = {
  caption: 'Registered social accounts',
  account: 'Account',
  company: 'Company',
  brand: 'Brand',
  noBrand: 'No brand',
  owner: 'Owner',
  backup: 'Backup administrator',
  assigned: 'Assigned',
  assignedCount: (count: number) => (count === 1 ? '1 person' : `${count} people`),
  nobodyAssigned: 'Nobody',
  engine: 'Publishing engine',
  linked: 'Connected',
  unlinked: 'Not connected',
  practice: 'Practice channel',
  status: 'Status',
  gaps: 'Registry gaps',
  complete: 'Complete',
  missing: 'Missing',
  publicLink: 'Public page',
  publicLinkFor: (name: string) => `Open the public page of ${name}`,
  newTab: '(opens in a new tab)',
  filterPlatform: 'Network',
  filterCompany: 'Company',
  filterStatus: 'Status',
  filterEngine: 'Engine',
  filterOwner: 'Owner',
  filterBackup: 'Backup administrator',
  filterGaps: 'Registry',
  optLinked: 'Connected to the engine',
  optUnlinked: 'Not connected',
  optPractice: 'Practice channel',
  optReal: 'Real channel',
  optHas: 'Has one',
  optMissing: 'Missing',
  optComplete: 'Complete',
  optGaps: 'Has gaps',
  gapLabels: {
    owner: 'No owner',
    backup_admin: 'No backup administrator',
    engine_channel: 'Not connected to the engine',
    status: 'Not active',
  } satisfies Record<AccountGap, string>,
};

/** What is missing from an account, by the same rule as `GET /api/reports/registry-gaps` (archived accounts have no gaps). */
export function accountGaps(account: SocialAccountDto): AccountGap[] {
  if (account.status === 'archived') return [];
  const gaps: AccountGap[] = [];
  if (!account.ownerUserId) gaps.push('owner');
  if (!account.backupAdminUserId) gaps.push('backup_admin');
  if (!account.engineChannelId) gaps.push('engine_channel');
  if (account.status !== 'active') gaps.push('status');
  return gaps;
}

export const GAP_LABELS = TEXT.gapLabels;

/**
 * The list of accounts, as one grid on every screen that shows accounts: search, filters on everything the
 * register records, sortable columns, a column chooser and a CSV of what is on screen. A click on a row opens it.
 */
export function AccountsGrid({
  accounts,
  showCompany = true,
  exportName,
  brandsByCompany,
  assignmentCounts,
  channels,
  onOpen,
  empty,
  toolbar,
  pageSize,
}: {
  accounts: SocialAccountDto[];
  showCompany?: boolean;
  exportName: string;
  brandsByCompany?: Record<string, BrandDto[]>;
  /** account id -> number of people assigned. undefined = this viewer cannot read assignments (no column); null = still loading. */
  assignmentCounts?: Record<string, number> | null;
  channels?: EngineChannelDto[] | null;
  onOpen: (account: SocialAccountDto) => void;
  empty?: ReactNode;
  toolbar?: ReactNode;
  pageSize?: number;
}) {
  const { companyName, personName, companies } = useWorkspace();

  const brandName = (account: SocialAccountDto) =>
    account.brandId
      ? (brandsByCompany?.[account.companyId]?.find((brand) => brand.id === account.brandId)
          ?.name ?? null)
      : null;
  const channelName = (account: SocialAccountDto) =>
    account.engineChannelId
      ? (channels?.find((channel) => channel.engineChannelId === account.engineChannelId)?.name ??
        null)
      : null;

  const columns: GridColumn<SocialAccountDto>[] = [
    {
      id: 'account',
      header: TEXT.account,
      sortValue: (row) => row.displayName,
      exportValue: (row) => `${row.displayName} (${PLATFORM_LABELS[row.platform]}) ${row.handle}`,
      cell: (row) => (
        <div className="rg-cell-account">
          <PlatformBadge platform={row.platform} />
          <span className="post-title rg-account-name">
            <RecordLink screen="accounts" id={row.id} keepCompany={false}>
              {row.displayName}
            </RecordLink>
          </span>
          <span className="subline">
            {row.handle}
            {row.publicUrl && (
              <>
                {' · '}
                <a
                  className="rg-link"
                  href={row.publicUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`${TEXT.publicLinkFor(row.displayName)} ${TEXT.newTab}`}
                >
                  {TEXT.publicLink} ↗
                </a>
              </>
            )}
          </span>
        </div>
      ),
    },
    ...(showCompany
      ? [
          {
            id: 'company',
            header: TEXT.company,
            sortValue: (row: SocialAccountDto) => companyName(row.companyId),
            exportValue: (row: SocialAccountDto) => companyName(row.companyId),
            cell: (row: SocialAccountDto) => <CompanyLink companyId={row.companyId} />,
          },
        ]
      : []),
    {
      id: 'brand',
      header: TEXT.brand,
      hiddenByDefault: true,
      sortValue: (row) => brandName(row),
      exportValue: (row) => brandName(row) ?? '',
      cell: (row) =>
        brandName(row) ?? <span className="rg-muted">{row.brandId ? '…' : TEXT.noBrand}</span>,
    },
    {
      id: 'owner',
      header: TEXT.owner,
      sortValue: (row) => (row.ownerUserId ? personName(row.ownerUserId) : null),
      exportValue: (row) => (row.ownerUserId ? personName(row.ownerUserId) : ''),
      cell: (row) =>
        row.ownerUserId ? (
          <PersonName userId={row.ownerUserId} />
        ) : (
          <StatusChip label={TEXT.missing} tone="red" />
        ),
    },
    {
      id: 'backup',
      header: TEXT.backup,
      sortValue: (row) => (row.backupAdminUserId ? personName(row.backupAdminUserId) : null),
      exportValue: (row) => (row.backupAdminUserId ? personName(row.backupAdminUserId) : ''),
      cell: (row) =>
        row.backupAdminUserId ? (
          <PersonName userId={row.backupAdminUserId} />
        ) : (
          <StatusChip label={TEXT.missing} tone="amber" />
        ),
    },
    ...(assignmentCounts !== undefined
      ? [
          {
            id: 'assigned',
            header: TEXT.assigned,
            hiddenByDefault: true,
            sortValue: (row: SocialAccountDto) =>
              assignmentCounts ? (assignmentCounts[row.id] ?? 0) : null,
            exportValue: (row: SocialAccountDto) =>
              assignmentCounts ? String(assignmentCounts[row.id] ?? 0) : '',
            cell: (row: SocialAccountDto) =>
              !assignmentCounts ? (
                <span className="rg-muted">…</span>
              ) : assignmentCounts[row.id] ? (
                TEXT.assignedCount(assignmentCounts[row.id]!)
              ) : (
                <span className="rg-muted">{TEXT.nobodyAssigned}</span>
              ),
          },
        ]
      : []),
    {
      id: 'engine',
      header: TEXT.engine,
      sortValue: (row) => (row.engineChannelId ? 1 : 0),
      exportValue: (row) =>
        row.engineChannelId
          ? `${TEXT.linked}${isPracticeChannel(row.engineChannelId) ? ` (${TEXT.practice})` : ''}`
          : TEXT.unlinked,
      cell: (row) => (
        <>
          <StatusChip
            label={row.engineChannelId ? TEXT.linked : TEXT.unlinked}
            tone={row.engineChannelId ? 'green' : 'amber'}
          />
          {row.engineChannelId && (
            <span className="subline">
              {channelName(row) ?? row.engineChannelId}
              {isPracticeChannel(row.engineChannelId) ? ` · ${TEXT.practice}` : ''}
            </span>
          )}
        </>
      ),
    },
    {
      id: 'status',
      header: TEXT.status,
      sortValue: (row) => ACCOUNT_STATUS[row.status].label,
      exportValue: (row) => ACCOUNT_STATUS[row.status].label,
      cell: (row) => <StatusChip status={ACCOUNT_STATUS[row.status]} />,
    },
    {
      id: 'gaps',
      header: TEXT.gaps,
      hiddenByDefault: true,
      sortValue: (row) => accountGaps(row).length,
      exportValue: (row) =>
        accountGaps(row)
          .map((gap) => TEXT.gapLabels[gap])
          .join('; '),
      cell: (row) => {
        const gaps = accountGaps(row);
        return gaps.length === 0 ? (
          <StatusChip label={TEXT.complete} tone="green" />
        ) : (
          <span className="rg-chips">
            {gaps.map((gap) => (
              <StatusChip key={gap} label={TEXT.gapLabels[gap]} tone="amber" />
            ))}
          </span>
        );
      },
    },
  ];

  const filters = useMemo<GridFilter<SocialAccountDto>[]>(
    () => [
      {
        id: 'platform',
        label: TEXT.filterPlatform,
        options: SOCIAL_PLATFORMS.map((value) => ({ value, label: PLATFORM_LABELS[value] })),
        test: (row, value) => row.platform === value,
      },
      ...(showCompany
        ? [
            {
              id: 'company',
              label: TEXT.filterCompany,
              options: companies.map((item) => ({ value: item.id, label: item.name })),
              test: (row: SocialAccountDto, value: string) => row.companyId === value,
            },
          ]
        : []),
      {
        id: 'status',
        label: TEXT.filterStatus,
        options: SOCIAL_ACCOUNT_STATUSES.map((value) => ({
          value,
          label: ACCOUNT_STATUS[value].label,
        })),
        test: (row, value) => row.status === value,
      },
      {
        id: 'engine',
        label: TEXT.filterEngine,
        options: [
          { value: 'linked', label: TEXT.optLinked },
          { value: 'unlinked', label: TEXT.optUnlinked },
          { value: 'practice', label: TEXT.optPractice },
          { value: 'real', label: TEXT.optReal },
        ],
        test: (row, value) =>
          value === 'linked'
            ? Boolean(row.engineChannelId)
            : value === 'unlinked'
              ? !row.engineChannelId
              : value === 'practice'
                ? isPracticeChannel(row.engineChannelId)
                : Boolean(row.engineChannelId) && !isPracticeChannel(row.engineChannelId),
      },
      {
        id: 'owner',
        label: TEXT.filterOwner,
        options: [
          { value: 'has', label: TEXT.optHas },
          { value: 'missing', label: TEXT.optMissing },
        ],
        test: (row, value) => (value === 'missing' ? !row.ownerUserId : Boolean(row.ownerUserId)),
      },
      {
        id: 'backup',
        label: TEXT.filterBackup,
        options: [
          { value: 'has', label: TEXT.optHas },
          { value: 'missing', label: TEXT.optMissing },
        ],
        test: (row, value) =>
          value === 'missing' ? !row.backupAdminUserId : Boolean(row.backupAdminUserId),
      },
      {
        id: 'gaps',
        label: TEXT.filterGaps,
        options: [
          { value: 'gaps', label: TEXT.optGaps },
          { value: 'complete', label: TEXT.optComplete },
        ],
        test: (row, value) =>
          value === 'gaps' ? accountGaps(row).length > 0 : accountGaps(row).length === 0,
      },
    ],
    [showCompany, companies],
  );

  return (
    <DataGrid
      caption={TEXT.caption}
      columns={columns}
      rows={accounts}
      rowKey={(row) => row.id}
      searchText={(row) =>
        [
          row.displayName,
          row.handle,
          PLATFORM_LABELS[row.platform],
          companyName(row.companyId),
          brandName(row) ?? '',
          row.ownerUserId ? personName(row.ownerUserId) : '',
          row.backupAdminUserId ? personName(row.backupAdminUserId) : '',
          ACCOUNT_STATUS[row.status].label,
        ].join(' ')
      }
      filters={filters}
      onOpen={onOpen}
      defaultSort={{ id: 'account', direction: 'asc' }}
      exportName={exportName}
      empty={empty}
      toolbar={toolbar}
      pageSize={pageSize}
    />
  );
}
