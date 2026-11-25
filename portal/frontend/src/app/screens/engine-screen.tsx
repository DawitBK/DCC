'use client';

import { useMemo } from 'react';
import type { EngineChannelDto, EngineStatusDto, SocialAccountDto } from '@dcc/contracts';
import { ErrorBox } from '@/components/error-box';
import { DataGrid, type GridColumn, type GridFilter } from '@/components/kit/data-grid';
import { PageHeader } from '@/components/kit/page-header';
import { Callout, Fact } from '@/components/kit/parts';
import { StatusChip } from '@/components/status-chip';
import { EmptyBlock, Skeletons } from '@/components/work/parts';
import { PLATFORM_LABELS } from '@/lib/labels';
import { needsRoleHint } from '@/lib/permissions-ui';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import '@/app/screens/work-shared.css';

const TEXT = {
  title: 'Publishing engine',
  description:
    'DCC decides what may be published. The engine only carries out what DCC allowed. This page shows what is behind DCC today, what it can and cannot do, and which accounts are connected to it.',
  loadError: 'The engine state could not be loaded',
  channelsError: 'The engine channels could not be loaded',
  facts: {
    provider: 'Engine',
    verification: 'Checked against a live engine',
    publish: 'Can publish',
    inbox: 'Real inbox',
    channels: 'Channels in the engine',
    unlinked: 'Accounts not connected',
  },
  yes: 'Yes',
  no: 'No',
  verified: 'Verified',
  unverified: 'Not verified yet',
  notesHeading: 'What DCC knows about this engine',
  rule: 'The governance rule',
  ruleBody:
    'Nobody publishes straight to the engine. A post goes out only after DCC approved it, and only if its company is active, no freeze is on, and its account is connected to a channel here. Posts made outside DCC are looked for by the suspected-bypass check on the Publishing screen.',
  console: 'Open the engine to connect a network',
  consoleBody:
    'Only an engine administrator connects networks, there. A connected channel then appears in the list below and can be linked to a registered account.',
  noConsole: 'No engine web address is set for this environment.',
  channelsHeading: 'Channels in the engine',
  channelsBody:
    'Every page or profile the engine holds, and the registered DCC account each one is linked to.',
  needsManage: 'The list of channels is for people who manage social accounts.',
  channelCaption: 'Channels held by the publishing engine',
  columns: {
    name: 'Channel',
    platform: 'Network',
    state: 'State',
    linked: 'Linked DCC account',
    id: 'Engine id',
  },
  filters: { platform: 'Network', state: 'State', linked: 'Linked' },
  practice: 'Practice channel',
  disabled: 'Disabled in the engine',
  enabled: 'Enabled',
  notGoverned: 'A network DCC does not govern',
  linkedYes: 'Linked',
  linkedNo: 'Not linked',
  notLinked: 'Not linked to an account',
  openAccount: (name: string) => `Open the account ${name}`,
  gapsHeading: 'Accounts that cannot be published to yet',
  gapsBody:
    'These registered accounts have no channel in the engine. Open one and link it, or connect the network in the engine first.',
  gapsNone: 'Every registered account is connected to a channel.',
  gapsCaption: 'Registered accounts without an engine channel',
  accountColumns: { account: 'Account', platform: 'Network', company: 'Company', status: 'Status' },
  link: 'Link it',
  channelCount: (n: number) => (n === 1 ? '1 channel' : `${n} channels`),
};

/** What is behind DCC for publishing: `GET /engine/status`, the channels `GET /engine/channels`, and the accounts that have none. */
export function EngineScreen() {
  const { can, companyId, companyName, open } = useWorkspace();
  const status = useApiData<EngineStatusDto>('/engine/status');
  const channels = useApiData<EngineChannelDto[]>(
    can('account.manage') ? '/engine/channels' : null,
  );
  const accounts = useApiData<SocialAccountDto[]>('/social-accounts');

  const accountList = useMemo(
    () => (accounts.data ?? []).filter((row) => !companyId || row.companyId === companyId),
    [accounts.data, companyId],
  );
  const accountById = useMemo(
    () => new Map((accounts.data ?? []).map((row) => [row.id, row])),
    [accounts.data],
  );
  const unlinked = accountList.filter((row) => !row.engineChannelId && row.status !== 'archived');
  const channelRows = channels.data ?? [];
  const engine = status.data;

  const channelColumns: GridColumn<EngineChannelDto>[] = [
    {
      id: 'name',
      header: TEXT.columns.name,
      sortValue: (row) => row.name,
      cell: (row) => <strong>{row.name}</strong>,
    },
    {
      id: 'platform',
      header: TEXT.columns.platform,
      sortValue: (row) => (row.platform ? PLATFORM_LABELS[row.platform] : ''),
      cell: (row) => (row.platform ? PLATFORM_LABELS[row.platform] : TEXT.notGoverned),
    },
    {
      id: 'state',
      header: TEXT.columns.state,
      sortValue: (row) => (row.disabled ? 1 : 0),
      exportValue: (row) => (row.disabled ? TEXT.disabled : TEXT.enabled),
      cell: (row) => (
        <>
          <StatusChip
            label={row.disabled ? TEXT.disabled : TEXT.enabled}
            tone={row.disabled ? 'gray' : 'green'}
          />
          {row.engineChannelId.startsWith('fake-') && (
            <small className="hint" style={{ display: 'block' }}>
              {TEXT.practice}
            </small>
          )}
        </>
      ),
    },
    {
      id: 'linked',
      header: TEXT.columns.linked,
      sortValue: (row) => (row.linkedAccountId ? 1 : 0),
      exportValue: (row) =>
        row.linkedAccountId
          ? (accountById.get(row.linkedAccountId)?.displayName ?? row.linkedAccountId)
          : '',
      cell: (row) => {
        const account = row.linkedAccountId ? accountById.get(row.linkedAccountId) : undefined;
        return account ? (
          <button
            type="button"
            className="text-link"
            aria-label={TEXT.openAccount(account.displayName)}
            onClick={() => open('accounts', account.id)}
          >
            {account.displayName} ({companyName(account.companyId)})
          </button>
        ) : (
          TEXT.notLinked
        );
      },
    },
    {
      id: 'id',
      header: TEXT.columns.id,
      hiddenByDefault: true,
      sortValue: (row) => row.engineChannelId,
      cell: (row) => <code>{row.engineChannelId}</code>,
    },
  ];
  const channelFilters: GridFilter<EngineChannelDto>[] = [
    {
      id: 'platform',
      label: TEXT.filters.platform,
      options: [
        ...new Set(
          channelRows.map((row) => row.platform).filter((p): p is NonNullable<typeof p> => !!p),
        ),
      ].map((p) => ({
        value: p,
        label: PLATFORM_LABELS[p],
      })),
      test: (row, value) => row.platform === value,
    },
    {
      id: 'linked',
      label: TEXT.filters.linked,
      options: [
        { value: 'yes', label: TEXT.linkedYes },
        { value: 'no', label: TEXT.linkedNo },
      ],
      test: (row, value) => (value === 'yes') === !!row.linkedAccountId,
    },
  ];

  const gapColumns: GridColumn<SocialAccountDto>[] = [
    {
      id: 'account',
      header: TEXT.accountColumns.account,
      sortValue: (row) => row.displayName,
      cell: (row) => (
        <button type="button" className="text-link" onClick={() => open('accounts', row.id)}>
          {row.displayName} <small className="hint">{row.handle}</small>
        </button>
      ),
    },
    {
      id: 'platform',
      header: TEXT.accountColumns.platform,
      sortValue: (row) => PLATFORM_LABELS[row.platform],
      cell: (row) => PLATFORM_LABELS[row.platform],
    },
    {
      id: 'company',
      header: TEXT.accountColumns.company,
      sortValue: (row) => companyName(row.companyId),
      cell: (row) => companyName(row.companyId),
    },
    {
      id: 'link',
      header: TEXT.link,
      cell: (row) =>
        can('account.manage', row.companyId) ? (
          <button
            type="button"
            className="btn btn-outline"
            onClick={() => open('accounts', row.id)}
          >
            {TEXT.link}
          </button>
        ) : (
          <small className="hint">{needsRoleHint('account.manage')}</small>
        ),
    },
  ];

  return (
    <div className="kit-stack">
      <PageHeader
        title={TEXT.title}
        description={TEXT.description}
        actions={
          engine?.consoleUrl ? (
            <a
              className="btn btn-outline"
              href={engine.consoleUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {TEXT.console} ↗
            </a>
          ) : undefined
        }
      />
      <ErrorBox error={status.error} title={TEXT.loadError} loading />
      <ErrorBox error={channels.error} title={TEXT.channelsError} loading />
      {status.loading && !engine ? (
        <Skeletons />
      ) : (
        engine && (
          <>
            <div className="kit-facts">
              <Fact label={TEXT.facts.provider} value={engine.provider} />
              <Fact
                label={TEXT.facts.verification}
                value={engine.verification === 'verified' ? TEXT.verified : TEXT.unverified}
              />
              <Fact label={TEXT.facts.publish} value={engine.canPublish ? TEXT.yes : TEXT.no} />
              <Fact label={TEXT.facts.inbox} value={engine.inbox ? TEXT.yes : TEXT.no} />
              {can('account.manage') && (
                <Fact label={TEXT.facts.channels} value={channelRows.length} />
              )}
              <Fact label={TEXT.facts.unlinked} value={unlinked.length} />
            </div>
            <Callout
              tone={engine.verification === 'verified' ? 'ok' : 'warn'}
              title={TEXT.notesHeading}
            >
              <ul className="plain-list">
                {engine.notes.map((note) => (
                  <li key={note}>{note}</li>
                ))}
              </ul>
            </Callout>
            <Callout title={TEXT.rule}>{TEXT.ruleBody}</Callout>
            <Callout title={engine.consoleUrl ? TEXT.console : TEXT.noConsole}>
              {TEXT.consoleBody}
            </Callout>
          </>
        )
      )}

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{TEXT.channelsHeading}</h2>
            <p>{TEXT.channelsBody}</p>
          </div>
        </div>
        {!can('account.manage') ? (
          <p className="hint">
            {TEXT.needsManage} {needsRoleHint('account.manage')}
          </p>
        ) : channels.loading && !channels.data ? (
          <Skeletons />
        ) : (
          <DataGrid
            caption={TEXT.channelCaption}
            columns={channelColumns}
            rows={channelRows}
            rowKey={(row) => row.engineChannelId}
            searchText={(row) => `${row.name} ${row.platform ?? ''} ${row.engineChannelId}`}
            filters={channelFilters}
            exportName="engine-channels"
            defaultSort={{ id: 'name', direction: 'asc' }}
            empty={<EmptyBlock title={TEXT.channelCount(0)}>{TEXT.consoleBody}</EmptyBlock>}
          />
        )}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{TEXT.gapsHeading}</h2>
            <p>{TEXT.gapsBody}</p>
          </div>
        </div>
        <DataGrid
          caption={TEXT.gapsCaption}
          columns={gapColumns}
          rows={unlinked}
          rowKey={(row) => row.id}
          exportName="accounts-without-channel"
          empty={<EmptyBlock title={TEXT.gapsNone} />}
        />
      </section>
    </div>
  );
}
