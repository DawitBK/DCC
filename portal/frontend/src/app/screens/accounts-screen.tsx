'use client';

import { useMemo, useState } from 'react';
import type {
  AccountAssignmentDto,
  EngineChannelDto,
  EngineStatusDto,
  RegistryGapDto,
  SocialAccountDto,
} from '@dcc/contracts';
import { EmptyState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { SectionPanel } from '@/components/section-panel';
import { PageHeader } from '@/components/kit/page-header';
import { Callout, Fact } from '@/components/kit/parts';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { AccountDetail } from './accounts-detail';
import { RegisterDialog } from './accounts-dialogs';
import { AccountsGrid, GAP_LABELS, type AccountGap } from './accounts-grid';
import {
  AccountLink,
  FactStrip,
  GatedButton,
  LoadingBlock,
  NoAccessNote,
  RecordLink,
  ViewOnlyNote,
  useBrands,
} from './registry-shared';
import './accounts-screen.css';

const TEXT = {
  title: 'Social accounts',
  description:
    'The register of the Group’s official accounts: who owns each one, who backs them up, how it is connected for publishing and what state it is in. Open an account to manage it.',
  register: '＋ Register account',
  inView: 'Accounts',
  inViewNote: 'In the chosen company scope',
  active: 'Active',
  activeNote: 'In normal use',
  attention: 'Need attention',
  attentionNote: 'Flagged in the register',
  disconnected: 'Disconnected',
  disconnectedNote: 'Cannot be published to',
  notConnected: 'Not connected to the engine',
  notConnectedNote: 'Cannot be published to yet',
  noOwner: 'Without an owner',
  noBackup: 'Without a backup administrator',
  gapsTitle: 'Registry gaps',
  gapsSubtitle:
    'Accounts that are missing something the register needs. Each line opens the place where it is fixed.',
  gapsClean:
    'No gaps: every account has an owner, a backup administrator and an engine connection, and is active.',
  gapsCaption: 'Registry gaps',
  gapFix: 'Fix it',
  gapFixLabel: (name: string, gap: string) => `${gap}: open ${name}`,
  gapMore: (count: number) => `Show ${count} more`,
  gapExplain: {
    owner: 'An account with no owner has nobody accountable for it.',
    backup_admin: 'Without a backup administrator, one absent person can lock the account.',
    engine_channel: 'Without an engine channel the account cannot be published to.',
    status: 'Accounts that are flagged, disconnected or archived-in-progress need a decision.',
  } satisfies Record<AccountGap, string>,
  gapsError: 'The registry gaps could not be loaded',
  gapsHidden: 'The registry gaps panel',
  engineTitle: 'Publishing engine',
  engineLine: (provider: string, verified: string, publish: string) =>
    `${provider} · ${verified} · ${publish}`,
  verified: 'Checked against a live service',
  unverified: 'Not yet checked against a live service',
  canPublish: 'Can publish',
  cannotPublish: 'Cannot publish',
  engineMore: 'Open the Publishing engine screen',
  connectNetwork: 'Connect a network in the engine',
  connectNewTab: '(opens in a new tab)',
  connectHelp:
    'Channels connected there appear in the list of channels when you link an account to the engine.',
  registryTitle: 'Account register',
  registrySubtitle: (count: number) =>
    `${count} ${count === 1 ? 'account' : 'accounts'} from DCC. Click a row to open it.`,
  emptyTitle: 'No accounts in this scope',
  emptyBody:
    'Register the Group’s official pages and profiles so every post can be approved and published through DCC.',
  loadError: 'The accounts could not be loaded',
  engineError: 'The engine state could not be loaded',
  brandsError: 'Brands could not be loaded',
  assignmentsError: 'Assignments could not be loaded',
  channelsError: 'The engine’s channels could not be loaded',
  newTab: '(opens in a new tab)',
};

const GAP_ORDER: AccountGap[] = ['owner', 'backup_admin', 'engine_channel', 'status'];
const SHOWN = 5;

/** `GET/POST /api/social-accounts` and the registry reads. Detail: `/social-accounts/<id>`. */
export function AccountsScreen() {
  const { detailId } = useWorkspace();
  return (
    <div className="rg-page">
      {detailId ? <AccountDetail accountId={detailId} /> : <AccountsList />}
    </div>
  );
}

function AccountsList() {
  const { companyId, can, companiesWhere, open } = useWorkspace();
  const accounts = useApiData<SocialAccountDto[]>('/social-accounts');
  const engine = useApiData<EngineStatusDto>('/engine/status');
  const manageCompanies = companiesWhere('account.manage');
  const mayManage = manageCompanies.length > 0;
  const assignments = useApiData<AccountAssignmentDto[]>(
    can('account.manage') ? '/social-accounts/assignments' : null,
  );
  const channels = useApiData<EngineChannelDto[]>(
    can('account.manage') ? '/engine/channels' : null,
  );
  const gaps = useApiData<RegistryGapDto[]>(can('report.read') ? '/reports/registry-gaps' : null);
  const [registering, setRegistering] = useState(false);

  const scoped = useMemo(
    () => (accounts.data ?? []).filter((item) => !companyId || item.companyId === companyId),
    [accounts.data, companyId],
  );
  const companyIds = useMemo(() => [...new Set(scoped.map((item) => item.companyId))], [scoped]);
  const brands = useBrands(companyIds, can('brand.read') && companyIds.length > 0);
  const counts = useMemo(() => {
    if (!assignments.data) return null;
    const out: Record<string, number> = {};
    for (const row of assignments.data)
      out[row.socialAccountId] = (out[row.socialAccountId] ?? 0) + 1;
    return out;
  }, [assignments.data]);

  const scopedIds = new Set(scoped.map((item) => item.id));
  const gapRows = (gaps.data ?? []).filter((row) => scopedIds.has(row.socialAccountId));
  const count = (test: (account: SocialAccountDto) => boolean) => scoped.filter(test).length;

  return (
    <>
      <PageHeader
        title={TEXT.title}
        description={TEXT.description}
        actions={
          <GatedButton
            allowed={mayManage}
            permission="account.manage"
            compact
            className="btn btn-primary"
            onClick={() => setRegistering(true)}
          >
            {TEXT.register}
          </GatedButton>
        }
      />
      <ErrorBox error={accounts.error} title={TEXT.loadError} loading />
      <ErrorBox error={brands.error} title={TEXT.brandsError} loading />
      <ErrorBox error={assignments.error} title={TEXT.assignmentsError} loading />
      <ErrorBox error={channels.error} title={TEXT.channelsError} loading />
      <FactStrip columns={6}>
        <Fact label={TEXT.inView} value={scoped.length} note={TEXT.inViewNote} />
        <Fact
          label={TEXT.active}
          value={count((item) => item.status === 'active')}
          note={TEXT.activeNote}
        />
        <Fact
          label={TEXT.attention}
          value={count((item) => item.status === 'needs_attention')}
          note={TEXT.attentionNote}
        />
        <Fact
          label={TEXT.disconnected}
          value={count((item) => item.status === 'disconnected')}
          note={TEXT.disconnectedNote}
        />
        <Fact
          label={TEXT.notConnected}
          value={count((item) => !item.engineChannelId && item.status !== 'archived')}
          note={TEXT.notConnectedNote}
        />
        <Fact
          label={TEXT.noBackup}
          value={count((item) => !item.backupAdminUserId && item.status !== 'archived')}
          note={`${TEXT.noOwner}: ${count((item) => !item.ownerUserId && item.status !== 'archived')}`}
        />
      </FactStrip>
      <div className="rg-stack">
        {engine.data && (
          <Callout
            tone="info"
            title={TEXT.engineLine(
              engine.data.provider,
              engine.data.verification === 'verified' ? TEXT.verified : TEXT.unverified,
              engine.data.canPublish ? TEXT.canPublish : TEXT.cannotPublish,
            )}
          >
            <p className="rg-note">{engine.data.notes.join(' ')}</p>
            <div className="rg-actions rg-gap">
              {can('account.read') && (
                <RecordLink screen="engine" className="btn btn-outline">
                  {TEXT.engineMore}
                </RecordLink>
              )}
              {engine.data.consoleUrl && mayManage && (
                <a
                  className="btn btn-outline"
                  href={engine.data.consoleUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  {TEXT.connectNetwork}
                  <span className="visually-hidden"> {TEXT.connectNewTab}</span>
                  <span aria-hidden="true">↗</span>
                </a>
              )}
            </div>
            {engine.data.consoleUrl && mayManage && <p className="rg-note">{TEXT.connectHelp}</p>}
          </Callout>
        )}
        <ErrorBox error={engine.error} title={TEXT.engineError} loading />
        {!mayManage && <ViewOnlyNote permission="account.manage" />}
        <SectionPanel title={TEXT.gapsTitle} subtitle={TEXT.gapsSubtitle}>
          {!can('report.read') ? (
            <NoAccessNote permission="report.read" what={TEXT.gapsHidden} />
          ) : gaps.error ? (
            <ErrorBox error={gaps.error} title={TEXT.gapsError} loading />
          ) : !gaps.data ? (
            <LoadingBlock lines={3} />
          ) : gapRows.length === 0 ? (
            <Callout tone="ok">{TEXT.gapsClean}</Callout>
          ) : (
            <div className="rg-gap-groups">
              {GAP_ORDER.map((gap) => {
                const rows = gapRows.filter((row) =>
                  gap === 'status' ? row.status !== 'active' : row.missing.includes(gap),
                );
                if (rows.length === 0) return null;
                const first = rows.slice(0, SHOWN);
                const rest = rows.slice(SHOWN);
                const renderRow = (row: RegistryGapDto) => (
                  <li key={row.socialAccountId}>
                    <AccountLink
                      account={{
                        id: row.socialAccountId,
                        displayName: row.displayName,
                        platform: row.platform,
                      }}
                    />
                    <RecordLink
                      screen="accounts"
                      id={row.socialAccountId}
                      params={{ tab: gap === 'engine_channel' ? 'engine' : 'profile' }}
                      keepCompany={false}
                      className="rg-link rg-gap-fix"
                      label={TEXT.gapFixLabel(row.displayName, GAP_LABELS[gap])}
                    >
                      {TEXT.gapFix}
                    </RecordLink>
                  </li>
                );
                return (
                  <div className="rg-gap-card" key={gap}>
                    <h3>
                      <span>{GAP_LABELS[gap]}</span>
                      <span className="rg-gap-count">{rows.length}</span>
                    </h3>
                    <p className="rg-note">{TEXT.gapExplain[gap]}</p>
                    <ul>{first.map(renderRow)}</ul>
                    {rest.length > 0 && (
                      <details>
                        <summary className="rg-gap-more">{TEXT.gapMore(rest.length)}</summary>
                        <ul>{rest.map(renderRow)}</ul>
                      </details>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </SectionPanel>
        <SectionPanel title={TEXT.registryTitle} subtitle={TEXT.registrySubtitle(scoped.length)}>
          {!accounts.data ? (
            !accounts.error && <LoadingBlock lines={6} />
          ) : (
            <AccountsGrid
              accounts={scoped}
              exportName="social-accounts"
              brandsByCompany={brands.byCompany}
              assignmentCounts={can('account.manage') ? counts : undefined}
              channels={channels.data}
              onOpen={(account) => open('accounts', account.id)}
              empty={
                <EmptyState title={TEXT.emptyTitle}>
                  {TEXT.emptyBody}
                  {mayManage && (
                    <div className="rg-empty-action">
                      <button
                        type="button"
                        className="btn btn-primary"
                        onClick={() => setRegistering(true)}
                      >
                        {TEXT.register}
                      </button>
                    </div>
                  )}
                </EmptyState>
              }
            />
          )}
        </SectionPanel>
      </div>
      {registering && (
        <RegisterDialog
          presetCompanyId={
            companyId && manageCompanies.some((c) => c.id === companyId) ? companyId : undefined
          }
          onClose={() => setRegistering(false)}
          onSaved={(account) => {
            setRegistering(false);
            accounts.reload();
            gaps.reload();
            open('accounts', account.id, { tab: 'engine' });
          }}
        />
      )}
    </>
  );
}
