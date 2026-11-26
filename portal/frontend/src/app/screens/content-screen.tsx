'use client';

import { useMemo } from 'react';
import {
  CONTENT_ITEM_STATUSES,
  SOCIAL_PLATFORMS,
  type ContentCategoryDto,
  type ContentItemDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { ErrorBox } from '@/components/error-box';
import { StatusChip } from '@/components/status-chip';
import { DataGrid, type GridColumn, type GridFilter } from '@/components/kit/data-grid';
import { PageHeader } from '@/components/kit/page-header';
import { Fact } from '@/components/kit/parts';
import { EmptyBlock, PlatformChips, Skeletons } from '@/components/work/parts';
import { formatDateTime } from '@/lib/format';
import { CONTENT_STATUS, PLATFORM_LABELS } from '@/lib/labels';
import { needsRoleHint } from '@/lib/permissions-ui';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { useBrands } from '@/lib/work-data';
import { relativeAge } from '@/lib/work';
import { ContentDetail } from './content-detail';
import './content-screen.css';
import './work-shared.css';

const TEXT = {
  title: 'Content library',
  description:
    'Every post of the companies you can see: what it says, who wrote it, where it stands and where it was sent. Open one to read its versions, its approval and its publications.',
  create: '＋ Create content',
  createWhy: 'You can read content but not write it.',
  caption: 'Content library',
  loadError: 'The content library could not be loaded',
  facts: {
    total: 'Posts',
    drafts: 'Drafts',
    review: 'In review',
    approved: 'Approved, ready to publish',
    rejected: 'Rejected',
    published: 'Published',
  },
  notes: {
    total: 'In the companies in view',
    drafts: 'Written, not yet sent',
    review: 'Waiting for reviewers',
    approved: 'Waiting for a publisher',
    rejected: 'Sent back to the author',
    published: 'On at least one network',
  },
  empty: 'There is no content yet',
  emptyBody:
    'Posts appear here as soon as someone saves a first draft. Drafts, posts in review and published posts all stay in the library.',
  columns: {
    text: 'Post',
    status: 'Status',
    company: 'Company',
    category: 'Kind',
    brand: 'Brand',
    targets: 'Networks',
    author: 'Written by',
    version: 'Version',
    media: 'Files',
    updated: 'Changed',
    created: 'Created',
  },
  filters: {
    status: 'Status',
    company: 'Company',
    category: 'Kind of content',
    brand: 'Brand',
    author: 'Author',
    media: 'Files',
    platform: 'Network',
  },
  withMedia: 'With pictures or videos',
  withoutMedia: 'Without pictures or videos',
  noCategory: 'No kind chosen',
  noBrand: 'No brand',
  noText: '(no text)',
  files: (count: number) => (count === 0 ? '—' : count === 1 ? '1 file' : `${count} files`),
  open: 'Open',
  openLabel: (text: string) => `Open the post: ${text}`,
  ago: (text: string) => text,
  searchHint: 'Search the text, company, author, kind and accounts',
};

/** The library at `/content`; one post at `/content/<id>` (tabs: overview, versions, approval, publications, activity). */
export function ContentScreen() {
  const { detailId } = useWorkspace();
  return detailId ? <ContentDetail id={detailId} /> : <ContentLibrary />;
}

function ContentLibrary() {
  const { companyId, companyName, personName, open, can } = useWorkspace();
  const items = useApiData<ContentItemDto[]>('/content-items');
  const accounts = useApiData<SocialAccountDto[]>('/social-accounts');
  const categories = useApiData<ContentCategoryDto[]>('/content-categories');

  const rows = useMemo(
    () => (items.data ?? []).filter((row) => !companyId || row.companyId === companyId),
    [items.data, companyId],
  );
  const accountList = useMemo(() => accounts.data ?? [], [accounts.data]);
  const companyIds = useMemo(() => [...new Set(rows.map((row) => row.companyId))], [rows]);
  const { brands } = useBrands(companyIds);

  const categoryName = (id: string | null) =>
    id ? (categories.data?.find((entry) => entry.id === id)?.name ?? '…') : null;
  const brandName = (id: string | null) =>
    id ? (brands.find((entry) => entry.id === id)?.name ?? '…') : null;
  const targetNames = (row: ContentItemDto) =>
    (row.preview?.targetAccountIds ?? [])
      .map((id) => accountList.find((account) => account.id === id))
      .filter((account): account is SocialAccountDto => Boolean(account));
  const mayCreate = can('content.create');
  const count = (status: ContentItemDto['status']) =>
    rows.filter((row) => row.status === status).length;

  const columns: GridColumn<ContentItemDto>[] = [
    {
      id: 'text',
      header: TEXT.columns.text,
      cell: (row) => {
        const text = row.preview?.excerpt ?? TEXT.noText;
        return (
          <button
            type="button"
            className="wk-link wk-excerpt-link"
            aria-label={TEXT.openLabel(text)}
            onClick={() => open('content', row.id)}
          >
            <span className="wk-excerpt">{text}</span>
          </button>
        );
      },
      sortValue: (row) => row.preview?.excerpt ?? '',
      exportValue: (row) => row.preview?.excerpt ?? '',
    },
    {
      id: 'status',
      header: TEXT.columns.status,
      cell: (row) => <StatusChip status={CONTENT_STATUS[row.status]} />,
      sortValue: (row) => CONTENT_STATUS[row.status].label,
      exportValue: (row) => CONTENT_STATUS[row.status].label,
    },
    {
      id: 'company',
      header: TEXT.columns.company,
      cell: (row) => companyName(row.companyId),
      sortValue: (row) => companyName(row.companyId),
    },
    {
      id: 'category',
      header: TEXT.columns.category,
      cell: (row) =>
        categoryName(row.categoryId) ?? <span className="wk-muted">{TEXT.noCategory}</span>,
      sortValue: (row) => categoryName(row.categoryId) ?? '',
      exportValue: (row) => categoryName(row.categoryId) ?? '',
    },
    {
      id: 'brand',
      header: TEXT.columns.brand,
      cell: (row) => brandName(row.brandId) ?? <span className="wk-muted">{TEXT.noBrand}</span>,
      sortValue: (row) => brandName(row.brandId) ?? '',
      exportValue: (row) => brandName(row.brandId) ?? '',
      hiddenByDefault: true,
    },
    {
      id: 'targets',
      header: TEXT.columns.targets,
      cell: (row) => (
        <PlatformChips ids={row.preview?.targetAccountIds ?? []} accounts={accountList} />
      ),
      sortValue: (row) => row.preview?.targetAccountIds.length ?? 0,
      exportValue: (row) =>
        targetNames(row)
          .map((account) => `${PLATFORM_LABELS[account.platform]} ${account.displayName}`)
          .join('; '),
    },
    {
      id: 'author',
      header: TEXT.columns.author,
      cell: (row) => personName(row.createdBy),
      sortValue: (row) => personName(row.createdBy),
    },
    {
      id: 'version',
      header: TEXT.columns.version,
      cell: (row) => (row.preview ? `v${row.preview.versionNumber}` : '—'),
      sortValue: (row) => row.preview?.versionNumber ?? 0,
      align: 'right',
    },
    {
      id: 'media',
      header: TEXT.columns.media,
      cell: (row) => TEXT.files(row.preview?.mediaCount ?? 0),
      sortValue: (row) => row.preview?.mediaCount ?? 0,
      exportValue: (row) => String(row.preview?.mediaCount ?? 0),
      align: 'right',
    },
    {
      id: 'updated',
      header: TEXT.columns.updated,
      cell: (row) => (
        <>
          {formatDateTime(row.updatedAt)}
          <span className="wk-sub">{relativeAge(row.updatedAt)}</span>
        </>
      ),
      sortValue: (row) => row.updatedAt,
      exportValue: (row) => row.updatedAt,
    },
    {
      id: 'created',
      header: TEXT.columns.created,
      cell: (row) => formatDateTime(row.createdAt),
      sortValue: (row) => row.createdAt,
      exportValue: (row) => row.createdAt,
      hiddenByDefault: true,
    },
  ];

  const filters: GridFilter<ContentItemDto>[] = [
    {
      id: 'status',
      label: TEXT.filters.status,
      // "expired" (an approval that ran out) is not in the contracts' list yet.
      options: [...CONTENT_ITEM_STATUSES, 'expired' as const].map((value) => ({
        value,
        label: CONTENT_STATUS[value].label,
      })),
      test: (row, value) => (row.status as string) === value,
    },
    {
      id: 'company',
      label: TEXT.filters.company,
      options: companyIds
        .map((id) => ({ value: id, label: companyName(id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      test: (row, value) => row.companyId === value,
    },
    {
      id: 'category',
      label: TEXT.filters.category,
      options: [
        { value: 'none', label: TEXT.noCategory },
        ...(categories.data ?? []).map((entry) => ({ value: entry.id, label: entry.name })),
      ],
      test: (row, value) => (value === 'none' ? row.categoryId === null : row.categoryId === value),
    },
    {
      id: 'brand',
      label: TEXT.filters.brand,
      options: [
        { value: 'none', label: TEXT.noBrand },
        ...brands.map((entry) => ({ value: entry.id, label: entry.name })),
      ],
      test: (row, value) => (value === 'none' ? row.brandId === null : row.brandId === value),
    },
    {
      id: 'author',
      label: TEXT.filters.author,
      options: [...new Set(rows.map((row) => row.createdBy))]
        .map((id) => ({ value: id, label: personName(id) }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      test: (row, value) => row.createdBy === value,
    },
    {
      id: 'media',
      label: TEXT.filters.media,
      options: [
        { value: 'yes', label: TEXT.withMedia },
        { value: 'no', label: TEXT.withoutMedia },
      ],
      test: (row, value) => (row.preview?.mediaCount ?? 0) > 0 === (value === 'yes'),
    },
    {
      id: 'platform',
      label: TEXT.filters.platform,
      options: SOCIAL_PLATFORMS.map((value) => ({ value, label: PLATFORM_LABELS[value] })),
      test: (row, value) => targetNames(row).some((account) => account.platform === value),
    },
  ];

  return (
    <div className="wk-grid">
      <PageHeader
        title={TEXT.title}
        description={TEXT.description}
        actions={
          <button
            type="button"
            className="btn btn-primary"
            disabled={!mayCreate}
            title={mayCreate ? undefined : needsRoleHint('content.create')}
            onClick={() => open('composer')}
          >
            {TEXT.create}
          </button>
        }
        meta={
          !mayCreate ? (
            <span className="wk-hint">
              {TEXT.createWhy} {needsRoleHint('content.create')}
            </span>
          ) : undefined
        }
      />
      <ErrorBox error={items.error} title={TEXT.loadError} loading />
      <div className="wk-facts">
        <Fact label={TEXT.facts.total} value={rows.length} note={TEXT.notes.total} />
        <Fact label={TEXT.facts.drafts} value={count('draft')} note={TEXT.notes.drafts} />
        <Fact label={TEXT.facts.review} value={count('in_review')} note={TEXT.notes.review} />
        <Fact label={TEXT.facts.approved} value={count('approved')} note={TEXT.notes.approved} />
        <Fact label={TEXT.facts.rejected} value={count('rejected')} note={TEXT.notes.rejected} />
        <Fact label={TEXT.facts.published} value={count('published')} note={TEXT.notes.published} />
      </div>
      {items.loading && !items.data ? (
        <Skeletons rows={8} />
      ) : (
        <DataGrid
          caption={TEXT.caption}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          filters={filters}
          searchText={(row) =>
            [
              row.preview?.excerpt ?? '',
              companyName(row.companyId),
              personName(row.createdBy),
              categoryName(row.categoryId) ?? '',
              brandName(row.brandId) ?? '',
              CONTENT_STATUS[row.status].label,
              targetNames(row)
                .map((account) => `${PLATFORM_LABELS[account.platform]} ${account.displayName}`)
                .join(' '),
            ].join(' ')
          }
          defaultSort={{ id: 'updated', direction: 'desc' }}
          exportName="content-library"
          onOpen={(row) => open('content', row.id)}
          empty={
            <EmptyBlock
              title={TEXT.empty}
              action={
                mayCreate ? (
                  <button
                    type="button"
                    className="btn btn-primary"
                    onClick={() => open('composer')}
                  >
                    {TEXT.create}
                  </button>
                ) : undefined
              }
            >
              {TEXT.emptyBody}
            </EmptyBlock>
          }
        />
      )}
    </div>
  );
}
