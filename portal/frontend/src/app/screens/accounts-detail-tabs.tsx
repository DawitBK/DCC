'use client';

import { useMemo, useState } from 'react';
import {
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  LinkEngineChannelRequest,
  PUBLICATION_STATUSES,
  type AnalyticsPointDto,
  type AnalyticsReportDto,
  type EngineChannelDto,
  type EngineStatusDto,
  type IncidentDto,
  type PublicationDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { EmptyState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { SectionPanel } from '@/components/section-panel';
import { Sparkline } from '@/components/sparkline';
import { StatusChip } from '@/components/status-chip';
import { DataGrid, type GridColumn, type GridFilter } from '@/components/kit/data-grid';
import { Callout, DescriptionList } from '@/components/kit/parts';
import { useToast } from '@/components/toast';
import { apiSend, queryString } from '@/lib/browser-api';
import { fieldErrorsFromApi, validate } from '@/lib/forms';
import { formatDateTime, formatDay, formatReading } from '@/lib/format';
import {
  INCIDENT_SEVERITY,
  INCIDENT_STATUS,
  PLATFORM_LABELS,
  PUBLICATION_STATUS,
} from '@/lib/labels';
import { useAction, useApiData, type ApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import {
  ConfirmDialog,
  GatedButton,
  LoadingBlock,
  NoAccessNote,
  PersonName,
  PlatformBadge,
  RecordLink,
  ViewOnlyNote,
  isPracticeChannel,
} from './registry-shared';

const TEXT = {
  // engine
  engineIntro:
    'An account can be published to only after it is linked to a channel of the publishing engine. The channel is the page or profile the engine connected on the network. DCC stores only the channel’s id, never a password or a token.',
  currentTitle: 'Current link',
  linked: 'Connected to the engine',
  unlinked: 'Not connected to the engine',
  unlinkedBody:
    'This account cannot be published to. Posts approved for it are refused until a channel is linked. Pick a channel below.',
  linkedBody:
    'Approved posts for this account go out through this channel. Unlinking stops that: the account stays in the register but cannot be published to.',
  channelId: 'Engine channel id',
  channelName: 'Channel in the engine',
  channelUnknown: 'The engine did not list this channel (it may have been removed there).',
  channelNotShown: 'Your role cannot list the engine’s channels, so only the id is shown.',
  practiceNote:
    'A practice channel: nothing sent to it leaves this computer and nothing reaches a real network.',
  disabledNote: 'This channel is disabled in the engine.',
  unlink: 'Unlink',
  unlinkTitle: 'Unlink this account from the engine?',
  unlinkBody: (name: string) =>
    `${name} will no longer be connected to a channel. It stays in the register, but nothing can be published to it until a channel is linked again.`,
  unlinkDone: 'The account was unlinked.',
  linkDone: 'The account was linked to the channel.',
  channelsTitle: 'Channels in the engine',
  channelsSubtitle: (platform: string) =>
    `Channels the engine holds. Only ${platform} channels that are free can be linked to this account.`,
  channelsCaption: 'Channels held by the publishing engine',
  channel: 'Channel',
  network: 'Network',
  state: 'State',
  showAll: 'Also show channels that cannot be linked',
  stateCurrent: 'Linked to this account',
  stateAvailable: 'Available',
  stateTaken: 'Linked to another account',
  stateTakenBy: (name: string) => `Linked to ${name}`,
  stateTakenHidden: 'Linked to an account you cannot see',
  stateDisabled: 'Disabled in the engine',
  stateOther: 'Another network',
  stateUngoverned: 'A network DCC does not govern',
  practice: 'Practice channel',
  link: 'Link this channel',
  switchTo: 'Switch to this channel',
  linkLabel: (name: string) => `Link the channel ${name} to this account`,
  cannotLink: 'This channel cannot be linked to this account.',
  channelsEmpty: 'The engine has no channels yet',
  channelsEmptyBody:
    'Connect a network in the engine first; its channels then appear here and can be linked.',
  channelsError: 'The engine’s channels could not be loaded',
  channelsHidden: 'The engine’s channels',
  connectNetwork: 'Connect a network in the engine',
  connectNew: '(opens in a new tab)',
  connectHelp: 'Channels connected there appear in this list. Reload it afterwards.',
  engineVerified: 'Checked against a live service',
  engineUnverified: 'Not yet checked against a live service',
  rule: 'DCC approves, the engine only executes: a post reaches the engine only after DCC has checked that it is approved, that nobody froze publishing and that the account is allowed.',
  // publications
  pubIntro:
    'Everything DCC sent, or scheduled to send, to this account through the engine, newest first.',
  pubCaption: 'Publications to this account',
  pubStatus: 'Status',
  pubRequested: 'Requested',
  pubScheduled: 'Scheduled for',
  pubCompleted: 'Completed',
  pubBy: 'Requested by',
  pubApproved: 'Approved by',
  pubContent: 'Post',
  pubOpenContent: 'Open the post',
  pubError: 'Error',
  pubLive: 'On the network',
  pubLiveLink: 'See the post ↗',
  pubOperation: 'Engine reference',
  pubEmpty: 'Nothing has been published to this account',
  pubEmptyBody: 'Publications appear here once an approved post is sent to this account.',
  pubOpenScreen: 'Open the Publishing screen',
  pubLoadError: 'Publications could not be loaded',
  pubHidden: 'Publications',
  newTab: '(opens in a new tab)',
  none: '—',
  // incidents
  incIntro: 'Incidents registered against this account, newest first.',
  incCaption: 'Incidents about this account',
  incTitle: 'Incident',
  incSeverity: 'Severity',
  incStatus: 'Status',
  incOpened: 'Opened',
  incResolved: 'Resolved',
  incEmpty: 'No incidents for this account',
  incEmptyBody: 'Nothing has been registered against it. Report one from the Incidents screen.',
  incOpenScreen: 'Open the Incidents screen',
  incError: 'Incidents could not be loaded',
  incHidden: 'Incidents',
  // analytics
  anIntro:
    'Figures the network reports for this account, read live through the engine. DCC stores none of them and never adds figures across accounts.',
  window: 'Time window',
  windowOption: (days: number) => `Last ${days} days`,
  anLoadError: 'The figures could not be loaded',
  anHidden: 'Figures',
  anNotLinked:
    'This account is not connected to the engine, so there are no figures to read. Link a channel first.',
  anNoReport: 'The report has no entry for this account.',
  anOk: 'Figures read',
  anEmpty: 'No data',
  anMissing: 'Missing',
  anUnavailable: 'Unavailable',
  anEmptyBody:
    'The network sent nothing for this account in this window. That is not a count of zero.',
  anMissingBody: 'The engine marked the published post as gone.',
  anUnavailableBody: 'The engine could not answer for this account.',
  figure: 'Figure',
  trend: 'Trend',
  first: 'First reading',
  latest: 'Latest reading',
  noReading: 'No reading',
  trendNote: 'Each trend is drawn on its own scale. It shows shape, not size.',
  openAnalytics: 'Open Analytics and reports',
};

/* ------------------------------------------------------------------ engine */

type ChannelState = 'current' | 'available' | 'taken' | 'disabled' | 'other';
type ChannelRow = { channel: EngineChannelDto; state: ChannelState };

export function EngineTab({
  account,
  accounts,
  engine,
  channels,
  mayManage,
  onChanged,
}: {
  account: SocialAccountDto;
  accounts: SocialAccountDto[];
  engine: EngineStatusDto | null;
  channels: ApiData<EngineChannelDto[]>;
  mayManage: boolean;
  onChanged: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const [showAll, setShowAll] = useState(false);
  const [unlinking, setUnlinking] = useState(false);
  const current =
    channels.data?.find((item) => item.engineChannelId === account.engineChannelId) ?? null;

  const rows = useMemo<ChannelRow[]>(
    () =>
      (channels.data ?? []).map((channel): ChannelRow => {
        const state: ChannelState =
          channel.engineChannelId === account.engineChannelId
            ? 'current'
            : channel.platform !== account.platform
              ? 'other'
              : channel.disabled
                ? 'disabled'
                : channel.linkedAccountId
                  ? 'taken'
                  : 'available';
        return { channel, state };
      }),
    [channels.data, account.engineChannelId, account.platform],
  );
  const shown = showAll
    ? rows
    : rows.filter((row) => row.state === 'current' || row.state === 'available');

  const link = async (engineChannelId: string | null) => {
    const checked = validate(LinkEngineChannelRequest, { engineChannelId });
    if (!checked.ok) return;
    const failure = await action.run(() =>
      apiSend('PATCH', `/social-accounts/${account.id}/engine-channel`, checked.data),
    );
    channels.reload();
    onChanged();
    if (failure) return void fieldErrorsFromApi(failure);
    showToast(engineChannelId ? TEXT.linkDone : TEXT.unlinkDone);
  };

  const stateText = (row: ChannelRow): string => {
    if (row.state === 'current') return TEXT.stateCurrent;
    if (row.state === 'available') return TEXT.stateAvailable;
    if (row.state === 'disabled') return TEXT.stateDisabled;
    if (row.state === 'other') return row.channel.platform ? TEXT.stateOther : TEXT.stateUngoverned;
    const owner = accounts.find((item) => item.id === row.channel.linkedAccountId);
    return owner ? TEXT.stateTakenBy(owner.displayName) : TEXT.stateTakenHidden;
  };
  const stateTone = (state: ChannelState) =>
    state === 'current' ? 'green' : state === 'available' ? 'blue' : 'gray';

  const columns: GridColumn<ChannelRow>[] = [
    {
      id: 'channel',
      header: TEXT.channel,
      sortValue: (row) => row.channel.name,
      exportValue: (row) => `${row.channel.name} (${row.channel.engineChannelId})`,
      cell: (row) => (
        <>
          <span className="post-title">{row.channel.name}</span>
          <span className="subline">
            {row.channel.engineChannelId}
            {isPracticeChannel(row.channel.engineChannelId) ? ` · ${TEXT.practice}` : ''}
          </span>
        </>
      ),
    },
    {
      id: 'network',
      header: TEXT.network,
      sortValue: (row) => row.channel.platform ?? '',
      exportValue: (row) => (row.channel.platform ? PLATFORM_LABELS[row.channel.platform] : ''),
      cell: (row) =>
        row.channel.platform ? (
          <PlatformBadge platform={row.channel.platform} />
        ) : (
          <span className="rg-muted">{TEXT.stateUngoverned}</span>
        ),
    },
    {
      id: 'state',
      header: TEXT.state,
      sortValue: (row) => stateText(row),
      exportValue: (row) => stateText(row),
      cell: (row) => <StatusChip label={stateText(row)} tone={stateTone(row.state)} />,
    },
    {
      id: 'action',
      header: '',
      cell: (row) =>
        row.state === 'current' ? null : (
          <GatedButton
            allowed={mayManage && row.state === 'available'}
            permission="account.manage"
            reason={mayManage ? TEXT.cannotLink : undefined}
            compact
            className="btn btn-outline"
            busy={action.busy}
            label={TEXT.linkLabel(row.channel.name)}
            onClick={() => void link(row.channel.engineChannelId)}
          >
            {account.engineChannelId ? TEXT.switchTo : TEXT.link}
          </GatedButton>
        ),
    },
  ];

  const linked = Boolean(account.engineChannelId);
  return (
    <div className="rg-stack">
      <p className="rg-tab-intro">{TEXT.engineIntro}</p>
      {!mayManage && <ViewOnlyNote permission="account.manage" />}
      <ErrorBox error={action.error} />
      <div className="rg-engine-card" data-state={linked ? 'linked' : 'unlinked'}>
        <div className="rg-chips">
          <StatusChip
            label={linked ? TEXT.linked : TEXT.unlinked}
            tone={linked ? 'green' : 'amber'}
          />
          {linked && isPracticeChannel(account.engineChannelId) && (
            <StatusChip label={TEXT.practice} tone="blue" />
          )}
          {current?.disabled && <StatusChip label={TEXT.stateDisabled} tone="red" />}
        </div>
        {linked ? (
          <>
            <h3>{current?.name ?? account.engineChannelId}</h3>
            <DescriptionList
              columns={2}
              items={[
                {
                  label: TEXT.channelName,
                  value: current?.name ?? (mayManage ? TEXT.channelUnknown : TEXT.channelNotShown),
                },
                {
                  label: TEXT.network,
                  value: current?.platform ? PLATFORM_LABELS[current.platform] : null,
                },
                {
                  label: TEXT.channelId,
                  value: <code className="rg-code">{account.engineChannelId}</code>,
                },
              ]}
            />
            <p className="rg-note">{TEXT.linkedBody}</p>
            {isPracticeChannel(account.engineChannelId) && (
              <Callout tone="info">{TEXT.practiceNote}</Callout>
            )}
            {current?.disabled && <Callout tone="warn">{TEXT.disabledNote}</Callout>}
            <div>
              <GatedButton
                allowed={mayManage}
                permission="account.manage"
                className="btn btn-danger"
                onClick={() => setUnlinking(true)}
              >
                {TEXT.unlink}
              </GatedButton>
            </div>
          </>
        ) : (
          <>
            <h3>{TEXT.unlinked}</h3>
            <p className="rg-note">{TEXT.unlinkedBody}</p>
          </>
        )}
      </div>
      <Callout tone="info">{TEXT.rule}</Callout>
      <SectionPanel
        title={TEXT.channelsTitle}
        subtitle={TEXT.channelsSubtitle(PLATFORM_LABELS[account.platform])}
        action={
          engine?.consoleUrl && mayManage ? (
            <a
              className="btn btn-outline"
              href={engine.consoleUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              {TEXT.connectNetwork}
              <span className="visually-hidden"> {TEXT.connectNew}</span>
              <span aria-hidden="true">↗</span>
            </a>
          ) : undefined
        }
      >
        {!mayManage ? (
          <NoAccessNote permission="account.manage" what={TEXT.channelsHidden} />
        ) : (
          <>
            <ErrorBox error={channels.error} title={TEXT.channelsError} loading />
            {!channels.data ? (
              !channels.error && <LoadingBlock lines={4} />
            ) : (
              <DataGrid
                caption={TEXT.channelsCaption}
                columns={columns}
                rows={shown}
                rowKey={(row) => row.channel.engineChannelId}
                searchText={(row) => `${row.channel.name} ${row.channel.engineChannelId}`}
                defaultSort={{ id: 'channel', direction: 'asc' }}
                toolbar={
                  <label className="platform-option filter-check">
                    <input
                      type="checkbox"
                      checked={showAll}
                      onChange={(event) => setShowAll(event.target.checked)}
                    />
                    {TEXT.showAll}
                  </label>
                }
                empty={
                  rows.length === 0 ? (
                    <EmptyState title={TEXT.channelsEmpty}>{TEXT.channelsEmptyBody}</EmptyState>
                  ) : undefined
                }
              />
            )}
            {engine?.consoleUrl && <p className="rg-note rg-gap">{TEXT.connectHelp}</p>}
          </>
        )}
      </SectionPanel>
      {engine && (
        <p className="rg-note">
          {engine.provider} ·{' '}
          {engine.verification === 'verified' ? TEXT.engineVerified : TEXT.engineUnverified}
        </p>
      )}
      {unlinking && (
        <ConfirmDialog
          title={TEXT.unlinkTitle}
          confirmLabel={TEXT.unlink}
          danger
          onClose={() => setUnlinking(false)}
          onConfirm={async () => {
            await apiSend('PATCH', `/social-accounts/${account.id}/engine-channel`, {
              engineChannelId: null,
            });
            channels.reload();
            onChanged();
            showToast(TEXT.unlinkDone);
          }}
        >
          <p>{TEXT.unlinkBody(account.displayName)}</p>
        </ConfirmDialog>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ publications */

export function PublicationsTab({ account }: { account: SocialAccountDto }) {
  const { can, open } = useWorkspace();
  const allowed = can('content.read', account.companyId);
  const api = useApiData<PublicationDto[]>(allowed ? '/publications' : null);
  const rows = (api.data ?? []).filter((item) => item.socialAccountId === account.id);
  if (!allowed) return <NoAccessNote permission="content.read" what={TEXT.pubHidden} />;

  const columns: GridColumn<PublicationDto>[] = [
    {
      id: 'status',
      header: TEXT.pubStatus,
      sortValue: (row) => PUBLICATION_STATUS[row.status].label,
      exportValue: (row) => PUBLICATION_STATUS[row.status].label,
      cell: (row) => <StatusChip status={PUBLICATION_STATUS[row.status]} />,
    },
    {
      id: 'requested',
      header: TEXT.pubRequested,
      sortValue: (row) => row.requestedAt,
      exportValue: (row) => row.requestedAt,
      cell: (row) => formatDateTime(row.requestedAt),
    },
    {
      id: 'scheduled',
      header: TEXT.pubScheduled,
      sortValue: (row) => row.scheduledAt,
      exportValue: (row) => row.scheduledAt ?? '',
      cell: (row) => formatDateTime(row.scheduledAt),
    },
    {
      id: 'completed',
      header: TEXT.pubCompleted,
      sortValue: (row) => row.completedAt,
      exportValue: (row) => row.completedAt ?? '',
      cell: (row) => formatDateTime(row.completedAt),
    },
    {
      id: 'content',
      header: TEXT.pubContent,
      cell: (row) => (
        <RecordLink screen="content" id={row.contentItemId} keepCompany={false}>
          {TEXT.pubOpenContent}
        </RecordLink>
      ),
    },
    {
      id: 'by',
      header: TEXT.pubBy,
      sortValue: (row) => row.requestedBy,
      cell: (row) => <PersonName userId={row.requestedBy} />,
    },
    {
      id: 'approved',
      header: TEXT.pubApproved,
      sortValue: (row) => row.approvedBy,
      cell: (row) => <PersonName userId={row.approvedBy} />,
    },
    {
      id: 'live',
      header: TEXT.pubLive,
      cell: (row) =>
        row.externalPostUrl ? (
          <a
            className="rg-link"
            href={row.externalPostUrl}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`${TEXT.pubLiveLink} ${TEXT.newTab}`}
          >
            {TEXT.pubLiveLink}
          </a>
        ) : (
          <span className="rg-muted">{TEXT.none}</span>
        ),
    },
    {
      id: 'error',
      header: TEXT.pubError,
      cell: (row) => row.error ?? <span className="rg-muted">{TEXT.none}</span>,
    },
    {
      id: 'operation',
      header: TEXT.pubOperation,
      hiddenByDefault: true,
      exportValue: (row) => row.engineOperationId ?? '',
      cell: (row) => row.engineOperationId ?? <span className="rg-muted">{TEXT.none}</span>,
    },
  ];
  const filters: GridFilter<PublicationDto>[] = [
    {
      id: 'status',
      label: TEXT.pubStatus,
      options: PUBLICATION_STATUSES.map((value) => ({
        value,
        label: PUBLICATION_STATUS[value].label,
      })),
      test: (row, value) => row.status === value,
    },
  ];
  return (
    <div className="rg-stack">
      <p className="rg-tab-intro">{TEXT.pubIntro}</p>
      <ErrorBox error={api.error} title={TEXT.pubLoadError} loading />
      {!api.data ? (
        !api.error && <LoadingBlock lines={4} />
      ) : (
        <DataGrid
          caption={TEXT.pubCaption}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          filters={filters}
          defaultSort={{ id: 'requested', direction: 'desc' }}
          exportName={`publications-${account.handle.replace(/[^a-z0-9]+/gi, '-')}`}
          toolbar={
            <button type="button" className="btn btn-outline" onClick={() => open('publishing')}>
              {TEXT.pubOpenScreen}
            </button>
          }
          empty={<EmptyState title={TEXT.pubEmpty}>{TEXT.pubEmptyBody}</EmptyState>}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ incidents */

export function AccountIncidentsTab({ account }: { account: SocialAccountDto }) {
  const { can, open } = useWorkspace();
  const allowed = can('incident.read', account.companyId);
  const api = useApiData<IncidentDto[]>(allowed ? '/incidents' : null);
  const rows = (api.data ?? []).filter((item) => item.socialAccountId === account.id);
  if (!allowed) return <NoAccessNote permission="incident.read" what={TEXT.incHidden} />;
  const columns: GridColumn<IncidentDto>[] = [
    {
      id: 'title',
      header: TEXT.incTitle,
      sortValue: (row) => row.title,
      cell: (row) => (
        <span className="post-title">
          <RecordLink screen="incidents" id={row.id} keepCompany={false}>
            {row.title}
          </RecordLink>
        </span>
      ),
    },
    {
      id: 'severity',
      header: TEXT.incSeverity,
      sortValue: (row) => INCIDENT_SEVERITIES.indexOf(row.severity),
      exportValue: (row) => INCIDENT_SEVERITY[row.severity].label,
      cell: (row) => <StatusChip status={INCIDENT_SEVERITY[row.severity]} />,
    },
    {
      id: 'status',
      header: TEXT.incStatus,
      sortValue: (row) => INCIDENT_STATUSES.indexOf(row.status),
      exportValue: (row) => INCIDENT_STATUS[row.status].label,
      cell: (row) => <StatusChip status={INCIDENT_STATUS[row.status]} />,
    },
    {
      id: 'opened',
      header: TEXT.incOpened,
      sortValue: (row) => row.openedAt,
      exportValue: (row) => row.openedAt,
      cell: (row) => formatDateTime(row.openedAt),
    },
    {
      id: 'resolved',
      header: TEXT.incResolved,
      sortValue: (row) => row.resolvedAt,
      exportValue: (row) => row.resolvedAt ?? '',
      cell: (row) => formatDateTime(row.resolvedAt),
    },
  ];
  const filters: GridFilter<IncidentDto>[] = [
    {
      id: 'status',
      label: TEXT.incStatus,
      options: INCIDENT_STATUSES.map((value) => ({ value, label: INCIDENT_STATUS[value].label })),
      test: (row, value) => row.status === value,
    },
    {
      id: 'severity',
      label: TEXT.incSeverity,
      options: INCIDENT_SEVERITIES.map((value) => ({
        value,
        label: INCIDENT_SEVERITY[value].label,
      })),
      test: (row, value) => row.severity === value,
    },
  ];
  return (
    <div className="rg-stack">
      <p className="rg-tab-intro">{TEXT.incIntro}</p>
      <ErrorBox error={api.error} title={TEXT.incError} loading />
      {!api.data ? (
        !api.error && <LoadingBlock lines={3} />
      ) : (
        <DataGrid
          caption={TEXT.incCaption}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          filters={filters}
          defaultSort={{ id: 'opened', direction: 'desc' }}
          toolbar={
            <button type="button" className="btn btn-outline" onClick={() => open('incidents')}>
              {TEXT.incOpenScreen}
            </button>
          }
          empty={<EmptyState title={TEXT.incEmpty}>{TEXT.incEmptyBody}</EmptyState>}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ analytics */

const WINDOWS = [7, 30, 90] as const;

function firstAndLatest(points: AnalyticsPointDto[]) {
  const read = points.flatMap((point) =>
    point.value === null ? [] : [{ date: point.date, value: point.value }],
  );
  return { first: read[0], latest: read.at(-1) };
}

export function AnalyticsTab({ account }: { account: SocialAccountDto }) {
  const { can, open } = useWorkspace();
  const [days, setDays] = useState<number>(30);
  const allowed = can('report.read', account.companyId);
  const linked = Boolean(account.engineChannelId);
  const api = useApiData<AnalyticsReportDto[]>(
    allowed && linked
      ? `/reports/analytics${queryString({ days, socialAccountId: account.id })}`
      : null,
  );
  if (!allowed) return <NoAccessNote permission="report.read" what={TEXT.anHidden} />;
  const report = api.data?.find((item) => item.socialAccountId === account.id) ?? null;
  const result = report?.result;
  return (
    <div className="rg-stack">
      <p className="rg-tab-intro">{TEXT.anIntro}</p>
      {!linked ? (
        <Callout tone="warn">{TEXT.anNotLinked}</Callout>
      ) : (
        <>
          <div className="rg-toolbar">
            <label className="rg-window">
              <span className="label">{TEXT.window}</span>
              <select
                className="select-field"
                style={{ width: 'auto' }}
                value={days}
                onChange={(event) => setDays(Number(event.target.value))}
              >
                {WINDOWS.map((value) => (
                  <option key={value} value={value}>
                    {TEXT.windowOption(value)}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" className="btn btn-outline" onClick={() => open('analytics')}>
              {TEXT.openAnalytics}
            </button>
          </div>
          <ErrorBox error={api.error} title={TEXT.anLoadError} loading />
          {api.loading && !api.data ? (
            <LoadingBlock lines={4} />
          ) : !api.error && !result ? (
            <EmptyState title={TEXT.anNoReport} />
          ) : result ? (
            <SectionPanel
              title={`${PLATFORM_LABELS[account.platform]} · ${account.displayName}`}
              subtitle={`${result.windowDays} days`}
              action={
                <StatusChip
                  label={
                    result.status === 'ok'
                      ? TEXT.anOk
                      : result.status === 'empty'
                        ? TEXT.anEmpty
                        : result.status === 'missing'
                          ? TEXT.anMissing
                          : TEXT.anUnavailable
                  }
                  tone={
                    result.status === 'ok'
                      ? 'green'
                      : result.status === 'unavailable'
                        ? 'red'
                        : 'amber'
                  }
                />
              }
            >
              {result.status === 'ok' ? (
                <>
                  <div className="rg-series rg-series-head" aria-hidden="true">
                    <span>{TEXT.figure}</span>
                    <span>{TEXT.trend}</span>
                    <span>{TEXT.first}</span>
                    <span>{TEXT.latest}</span>
                  </div>
                  {result.series.map((series) => {
                    const { first, latest } = firstAndLatest(series.points);
                    return (
                      <div className="rg-series" key={series.label}>
                        <strong>{series.label}</strong>
                        <Sparkline points={series.points} />
                        <span>
                          {first ? formatReading(first.value) : TEXT.noReading}
                          {first && <span className="subline">{formatDay(first.date)}</span>}
                        </span>
                        <span>
                          {latest ? formatReading(latest.value) : TEXT.noReading}
                          {latest && <span className="subline">{formatDay(latest.date)}</span>}
                        </span>
                      </div>
                    );
                  })}
                  <p className="rg-note rg-gap">{TEXT.trendNote}</p>
                </>
              ) : (
                <p>
                  {result.status === 'empty'
                    ? TEXT.anEmptyBody
                    : result.status === 'missing'
                      ? (result.reason ?? TEXT.anMissingBody)
                      : (result.reason ?? TEXT.anUnavailableBody)}
                </p>
              )}
            </SectionPanel>
          ) : null}
        </>
      )}
    </div>
  );
}
