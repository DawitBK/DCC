'use client';

import { useMemo, useState } from 'react';
import {
  ALERT_DELIVERY_STATUSES,
  ALERT_MAX_ATTEMPTS,
  ALERT_MIN_SEVERITIES,
  SetAlertContactRequest,
  roleHasPermission,
  type AlertChannel,
  type AlertChannelStatusDto,
  type AlertContactDto,
  type AlertContactsDto,
  type AlertDeliveryDto,
  type AlertDeliveryStatus,
  type AlertSettingsDto,
  type AlertStatusDto,
  type AlertTestResultDto,
} from '@dcc/contracts';
import { canIn } from '@/lib/access';
import { apiSend, queryString } from '@/lib/browser-api';
import { fieldErrorsFromApi, validate } from '@/lib/forms';
import { formatDateTime } from '@/lib/format';
import type { Tone } from '@/lib/labels';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { Dialog, DialogActions } from './dialog';
import { EmptyState } from './empty-state';
import { ErrorBox } from './error-box';
import { FormField } from './form-field';
import { PanelSkeleton } from './gov-parts';
import { DataGrid, type GridColumn } from './kit/data-grid';
import { Callout } from './kit/parts';
import { SectionPanel } from './section-panel';
import { StatusChip } from './status-chip';
import { useToast } from './toast';
import '@/app/screens/governance.css';
import '@/app/screens/incidents-screen.css';
import '@/app/screens/alerts-panel.css';

const CHANNELS: AlertChannel[] = ['sms', 'teams', 'email'];

const TEXT = {
  intro:
    'When an incident is reported as SEV1 (critical) or SEV2 (high), or raised to one of them, DCC tells the right people by SMS, Microsoft Teams and e-mail. Nothing is sent for SEV3 or SEV4.',
  who: 'SEV1: the person who reported it, security, Group marketing and the company executives. SEV2: security, the Digital Marketing Manager and the company executives.',
  group: 'Group',
  groupOption: (index: number) => `Group ${index + 1}`,
  channels: 'Channels on this server',
  channelsSubtitle:
    'Addresses and passwords are kept on the server, never in DCC. A channel that is not set up sends nothing, and says so here.',
  channelName: { sms: 'SMS', teams: 'Teams', email: 'E-mail' } as Record<AlertChannel, string>,
  channelOn: 'Ready',
  channelOff: 'Not set up',
  reasons: {
    not_set: 'Not set up on this server, so nothing is sent by this channel. Ask IT to set it up.',
    incomplete:
      'Set up only in part (something is missing or not valid), so nothing is sent by this channel. Ask IT to finish it.',
    insecure:
      'Refused: this server only accepts a secure address (https, or e-mail with encryption) for this channel. Ask IT to correct it.',
    ok: 'Ready to send.',
  } as Record<AlertChannelStatusDto['reason'], string>,
  statusFailed: 'The state of the channels could not be read',
  settings: 'Settings for the group',
  settingsSubtitle:
    'Switch a channel off for the whole group, or send alerts for SEV1 only. A channel that is off creates no message.',
  settingsReadOnly:
    'Only a group-level security, Group CTO or Group administrator role changes these settings.',
  sendBySms: 'Send alerts by SMS',
  sendByTeams: 'Post alerts in Teams',
  sendByEmail: 'Send alerts by e-mail',
  minSeverity: 'Alert for',
  minHigh: 'SEV1 and SEV2 (critical and high)',
  minCritical: 'SEV1 only (critical)',
  save: 'Save',
  saving: 'Working…',
  saved: 'The alert settings were saved.',
  settingsFailed: 'The settings could not be read',
  mine: 'My mobile number',
  mineSubtitle:
    'Used only to send you SMS alerts. Write it in international form: a plus sign, the country code and the number, for example +251911234567. Other people see it hidden.',
  mobile: 'Mobile number',
  mineSaved: 'Your mobile number was saved.',
  mineRemoved: 'Your mobile number was removed.',
  noneYet: 'You have not saved a number yet, so you get e-mail alerts but no SMS.',
  remove: 'Remove my number',
  contacts: 'Who has a number',
  contactsSubtitleManager:
    'Everyone with a mobile number in the group. You may set or remove anyone’s.',
  contactsSubtitleOther: 'Numbers of other people are hidden here, except the last two digits.',
  contactsCaption: 'Mobile numbers for SMS alerts',
  colPerson: 'Person',
  colMobile: 'Mobile',
  colUpdated: 'Saved',
  colActions: 'Actions',
  you: 'You',
  hidden: 'Hidden',
  addFor: 'Set a number for someone',
  editFor: 'Edit',
  editLabel: (name: string) => `Edit the number of ${name}`,
  removeFor: 'Remove',
  removeLabel: (name: string) => `Remove the number of ${name}`,
  person: 'Person',
  choose: 'Choose a person',
  contactSaved: 'The number was saved.',
  contactRemoved: 'The number was removed.',
  noContacts: 'No numbers yet',
  noContactsBody: 'Nobody has saved a mobile number, so SMS alerts reach no one.',
  contactsFailed: 'The numbers could not be read',
  cancel: 'Cancel',
  test: 'Send myself a test',
  testSubtitle:
    'Sends one clearly marked test message to you, to check that alerts arrive. Teams posts to the shared channel, so only an alert manager may use it.',
  testSms: 'Test SMS',
  testTeams: 'Test Teams message',
  testEmail: 'Test e-mail',
  testing: 'Sending…',
  testNeedsManager: 'Only an alert manager can post a test message to the Teams channel.',
  deliveries: 'Recent alerts sent',
  deliveriesSubtitle:
    'Each message that DCC prepared, and what became of it. A failed message is tried again up to five times, a little later each time.',
  deliveriesCaption: 'Alert deliveries',
  statusFilter: 'Show',
  allStatuses: 'All',
  colWhen: 'Prepared',
  colIncident: 'Incident',
  colChannel: 'Channel',
  colTo: 'To',
  colStatus: 'Status',
  colTries: 'Tries',
  colDetail: 'Detail',
  teamsChannel: 'The Teams channel',
  openIncident: (title: string) => `Open incident: ${title}`,
  nextTry: (when: string) => `Next try ${when}`,
  sentAt: (when: string) => `Sent ${when}`,
  tries: (n: number) => `${n} of ${ALERT_MAX_ATTEMPTS}`,
  noDeliveries: 'No alerts yet',
  noDeliveriesBody:
    'Nothing has been prepared. A message appears here when a SEV1 or SEV2 incident is reported and a channel is set up.',
  deliveriesFailed: 'The alert deliveries could not be read',
  deliveryStatus: {
    pending: { label: 'Waiting to send', tone: 'amber' },
    sent: { label: 'Sent', tone: 'green' },
    failed: { label: 'Failed', tone: 'red' },
  } as Record<AlertDeliveryStatus, { label: string; tone: Tone }>,
};

const STATUS_FILTERS: Record<AlertDeliveryStatus, string> = {
  pending: 'Waiting to send',
  sent: 'Sent',
  failed: 'Failed',
};

/**
 * The Alerts tab of the Incidents screen (RQ-029): which channels work on this server, the group's switches, the
 * caller's own mobile number, who else has one (masked unless the caller manages alerts), a test button, and the
 * recent deliveries. `GET/PUT /api/alerts/settings`, `GET/PUT /api/alerts/contacts`, `GET /api/alerts/deliveries`,
 * `POST /api/alerts/test`, `GET /api/alerts/status`. The API decides who may do what; this screen only shows it.
 */
export function AlertsPanel() {
  const { me } = useWorkspace();
  const groupIds = useMemo(() => [...new Set(me.memberships.map((m) => m.groupId))], [me]);
  const [picked, setPicked] = useState<string | null>(null);
  const groupId = groupIds.find((id) => id === picked) ?? groupIds[0] ?? null;

  if (!groupId) {
    return (
      <SectionPanel title="Alerts">
        <EmptyState title="Alerts are for people with a role in a group" />
      </SectionPanel>
    );
  }
  return (
    <div className="gov-stack">
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Alerts</h2>
            <p>{TEXT.intro}</p>
            <p>{TEXT.who}</p>
          </div>
          {groupIds.length > 1 && (
            <FormField label={TEXT.group}>
              {(control) => (
                <select
                  className="select-field"
                  {...control}
                  value={groupId}
                  onChange={(event) => setPicked(event.target.value)}
                >
                  {groupIds.map((id, index) => (
                    <option key={id} value={id}>
                      {TEXT.groupOption(index)}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
          )}
        </div>
      </section>
      <GroupAlerts key={groupId} groupId={groupId} />
    </div>
  );
}

function GroupAlerts({ groupId }: { groupId: string }) {
  const { me } = useWorkspace();
  const status = useApiData<AlertStatusDto>('/alerts/status');
  const mayManageGroup = me.memberships.some(
    (m) =>
      m.groupId === groupId && m.companyId === null && roleHasPermission(m.role, 'alert.manage'),
  );
  const mayManageAnywhere = canIn(me, 'alert.manage');

  return (
    <>
      <ChannelStatus status={status.data} error={status.error} loading={status.loading} />
      <SettingsForm groupId={groupId} mayManage={mayManageGroup} />
      <Contacts groupId={groupId} />
      <TestAlerts groupId={groupId} mayManage={mayManageGroup} status={status.data} />
      {mayManageAnywhere && <Deliveries />}
    </>
  );
}

// ---------------------------------------------------------------------------------------------------

function ChannelStatus({
  status,
  error,
  loading,
}: {
  status: AlertStatusDto | null;
  error: Parameters<typeof ErrorBox>[0]['error'];
  loading: boolean;
}) {
  return (
    <SectionPanel title={TEXT.channels} subtitle={TEXT.channelsSubtitle}>
      <ErrorBox error={error} title={TEXT.statusFailed} loading />
      {!status && loading ? (
        <PanelSkeleton lines={3} />
      ) : (
        status && (
          <ul className="alerts-channels" aria-label={TEXT.channels}>
            {CHANNELS.map((channel) => {
              const item = status[channel];
              return (
                <li key={channel} className="alerts-channel">
                  <strong>{TEXT.channelName[channel]}</strong>{' '}
                  <StatusChip
                    label={item.configured ? TEXT.channelOn : TEXT.channelOff}
                    tone={item.configured ? 'green' : 'amber'}
                  />
                  <span className="subline">{TEXT.reasons[item.reason]}</span>
                </li>
              );
            })}
          </ul>
        )
      )}
    </SectionPanel>
  );
}

// ---------------------------------------------------------------------------------------------------

function SettingsForm({ groupId, mayManage }: { groupId: string; mayManage: boolean }) {
  const showToast = useToast();
  const action = useAction();
  const settings = useApiData<AlertSettingsDto>(
    mayManage ? `/alerts/settings${queryString({ groupId })}` : null,
  );
  return (
    <SectionPanel title={TEXT.settings} subtitle={TEXT.settingsSubtitle}>
      {!mayManage && (
        <Callout tone="info" title={TEXT.settingsReadOnly}>
          You can still set your own mobile number below.
        </Callout>
      )}
      <ErrorBox error={settings.error} title={TEXT.settingsFailed} loading />
      {mayManage && !settings.data && settings.loading && <PanelSkeleton lines={4} />}
      {mayManage && settings.data && (
        <SettingsFields
          key={settings.data.updatedAt ?? 'defaults'}
          initial={settings.data}
          busy={action.busy}
          error={action.error}
          onSave={async (values) => {
            const failure = await action.run(() =>
              apiSend('PUT', `/alerts/settings${queryString({ groupId })}`, values),
            );
            if (!failure) {
              showToast(TEXT.saved);
              settings.reload();
            }
          }}
        />
      )}
    </SectionPanel>
  );
}

function SettingsFields({
  initial,
  busy,
  error,
  onSave,
}: {
  initial: AlertSettingsDto;
  busy: boolean;
  error: Parameters<typeof ErrorBox>[0]['error'];
  onSave: (values: Omit<AlertSettingsDto, 'groupId' | 'updatedAt'>) => void;
}) {
  const [form, setForm] = useState({
    smsEnabled: initial.smsEnabled,
    teamsEnabled: initial.teamsEnabled,
    emailEnabled: initial.emailEnabled,
    minSeverity: initial.minSeverity,
  });
  const box = (key: 'smsEnabled' | 'teamsEnabled' | 'emailEnabled', label: string) => (
    <label className="platform-option">
      <input
        type="checkbox"
        checked={form[key]}
        onChange={(event) => setForm({ ...form, [key]: event.target.checked })}
      />{' '}
      {label}
    </label>
  );
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        onSave(form);
      }}
    >
      <ErrorBox error={error} />
      <fieldset className="alerts-fieldset">
        <legend className="label">Channels</legend>
        {box('smsEnabled', TEXT.sendBySms)}
        {box('teamsEnabled', TEXT.sendByTeams)}
        {box('emailEnabled', TEXT.sendByEmail)}
      </fieldset>
      <FormField label={TEXT.minSeverity}>
        {(control) => (
          <select
            className="select-field"
            {...control}
            value={form.minSeverity}
            onChange={(event) =>
              setForm({ ...form, minSeverity: event.target.value as typeof form.minSeverity })
            }
          >
            {ALERT_MIN_SEVERITIES.map((value) => (
              <option key={value} value={value}>
                {value === 'high' ? TEXT.minHigh : TEXT.minCritical}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <DialogActions>
        <button type="submit" className="btn btn-primary" disabled={busy}>
          {busy ? TEXT.saving : TEXT.save}
        </button>
      </DialogActions>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------

function Contacts({ groupId }: { groupId: string }) {
  const { me, people, personName } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const contacts = useApiData<AlertContactsDto>(`/alerts/contacts${queryString({ groupId })}`);
  const [editing, setEditing] = useState<{ userId: string | null; mobile: string } | null>(null);
  const mine = contacts.data?.contacts.find((c) => c.own) ?? null;
  const canManage = contacts.data?.canManage === true;

  const remove = async (userId: string | null, own: boolean) => {
    const failure = await action.run(() =>
      apiSend('PUT', '/alerts/contacts', { groupId, mobile: null, ...(userId ? { userId } : {}) }),
    );
    if (!failure) {
      showToast(own ? TEXT.mineRemoved : TEXT.contactRemoved);
      contacts.reload();
    }
  };

  const nameOf = (c: AlertContactDto) =>
    c.own ? TEXT.you : (c.displayName ?? personName(c.userId));
  const columns: GridColumn<AlertContactDto>[] = [
    { id: 'person', header: TEXT.colPerson, sortValue: nameOf, cell: nameOf },
    {
      id: 'mobile',
      header: TEXT.colMobile,
      sortValue: (c) => c.mobile,
      exportValue: (c) => c.mobile,
      cell: (c) => (
        <>
          <span className="gov-mono">{c.mobile}</span>
          {c.masked && <span className="subline">{TEXT.hidden}</span>}
        </>
      ),
    },
    {
      id: 'updated',
      header: TEXT.colUpdated,
      sortValue: (c) => new Date(c.updatedAt).getTime(),
      cell: (c) => formatDateTime(c.updatedAt),
    },
    ...(canManage
      ? [
          {
            id: 'actions',
            header: TEXT.colActions,
            cell: (c: AlertContactDto) => (
              <>
                <button
                  type="button"
                  className="text-link"
                  aria-label={TEXT.editLabel(nameOf(c))}
                  onClick={() => setEditing({ userId: c.userId, mobile: c.mobile })}
                >
                  {TEXT.editFor}
                </button>{' '}
                <button
                  type="button"
                  className="text-link"
                  aria-label={TEXT.removeLabel(nameOf(c))}
                  disabled={action.busy}
                  onClick={() => void remove(c.userId, c.own)}
                >
                  {TEXT.removeFor}
                </button>
              </>
            ),
          } satisfies GridColumn<AlertContactDto>,
        ]
      : []),
  ];

  return (
    <>
      <SectionPanel title={TEXT.mine} subtitle={TEXT.mineSubtitle}>
        <ErrorBox error={contacts.error} title={TEXT.contactsFailed} loading />
        {contacts.data && (
          <MobileForm
            key={mine?.updatedAt ?? 'none'}
            groupId={groupId}
            userId={null}
            initial={mine?.mobile ?? ''}
            hint={mine ? undefined : TEXT.noneYet}
            onSaved={() => {
              showToast(TEXT.mineSaved);
              contacts.reload();
            }}
            onRemove={mine ? () => void remove(null, true) : undefined}
            removing={action.busy}
          />
        )}
        {action.error && <ErrorBox error={action.error} />}
      </SectionPanel>

      <SectionPanel
        title={TEXT.contacts}
        subtitle={canManage ? TEXT.contactsSubtitleManager : TEXT.contactsSubtitleOther}
        action={
          canManage && people ? (
            <button
              type="button"
              className="btn btn-outline"
              onClick={() => setEditing({ userId: '', mobile: '' })}
            >
              {TEXT.addFor}
            </button>
          ) : undefined
        }
      >
        {!contacts.data && contacts.loading ? (
          <PanelSkeleton lines={4} />
        ) : (
          contacts.data && (
            <DataGrid
              caption={TEXT.contactsCaption}
              columns={columns}
              rows={contacts.data.contacts}
              rowKey={(c) => c.userId}
              searchText={(c) => nameOf(c)}
              defaultSort={{ id: 'person', direction: 'asc' }}
              empty={<EmptyState title={TEXT.noContacts}>{TEXT.noContactsBody}</EmptyState>}
            />
          )
        )}
      </SectionPanel>

      {editing && (
        <Dialog title={TEXT.addFor} onClose={() => setEditing(null)}>
          <ManagerContactForm
            groupId={groupId}
            initial={editing}
            candidates={(people ?? []).filter((p) => p.id !== me.user.id)}
            onClose={() => setEditing(null)}
            onSaved={() => {
              setEditing(null);
              showToast(TEXT.contactSaved);
              contacts.reload();
            }}
          />
        </Dialog>
      )}
    </>
  );
}

function MobileForm({
  groupId,
  userId,
  initial,
  hint,
  onSaved,
  onRemove,
  removing,
}: {
  groupId: string;
  userId: string | null;
  initial: string;
  hint?: string;
  onSaved: () => void;
  onRemove?: () => void;
  removing: boolean;
}) {
  const action = useAction();
  const [mobile, setMobile] = useState(initial);
  const [error, setError] = useState<string | undefined>();
  const submit = async () => {
    const checked = validate(SetAlertContactRequest, {
      groupId,
      mobile,
      ...(userId ? { userId } : {}),
    });
    if (!checked.ok) return setError(checked.errors.mobile ?? checked.errors._form);
    setError(undefined);
    const failure = await action.run(() => apiSend('PUT', '/alerts/contacts', checked.data));
    if (failure) return setError(fieldErrorsFromApi(failure).mobile ?? failure.message);
    onSaved();
  };
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <FormField label={TEXT.mobile} hint={hint} error={error}>
        {(control) => (
          <input
            className="field"
            {...control}
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            placeholder="+251911234567"
            value={mobile}
            onChange={(event) => setMobile(event.target.value)}
          />
        )}
      </FormField>
      <div className="inc-status-actions">
        <button type="submit" className="btn btn-primary" disabled={action.busy}>
          {action.busy ? TEXT.saving : TEXT.save}
        </button>
        {onRemove && (
          <button type="button" className="btn btn-outline" disabled={removing} onClick={onRemove}>
            {TEXT.remove}
          </button>
        )}
      </div>
    </form>
  );
}

function ManagerContactForm({
  groupId,
  initial,
  candidates,
  onClose,
  onSaved,
}: {
  groupId: string;
  initial: { userId: string | null; mobile: string };
  candidates: { id: string; displayName: string }[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const action = useAction();
  const [userId, setUserId] = useState(initial.userId ?? '');
  const [mobile, setMobile] = useState(initial.mobile);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const fixed = initial.userId !== '' && initial.userId !== null;
  const submit = async () => {
    if (!userId) return setErrors({ userId: 'Choose a person.' });
    const checked = validate(SetAlertContactRequest, { groupId, userId, mobile });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() => apiSend('PUT', '/alerts/contacts', checked.data));
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    onSaved();
  };
  return (
    <form
      noValidate
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <ErrorBox error={action.error} />
      {!fixed && (
        <FormField label={TEXT.person} error={errors.userId} required>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={userId}
              onChange={(event) => setUserId(event.target.value)}
            >
              <option value="">{TEXT.choose}</option>
              {candidates.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.displayName}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}
      <FormField label={TEXT.mobile} error={errors.mobile} required>
        {(control) => (
          <input
            className="field"
            {...control}
            type="tel"
            inputMode="tel"
            autoComplete="off"
            placeholder="+251911234567"
            value={mobile}
            onChange={(event) => setMobile(event.target.value)}
          />
        )}
      </FormField>
      <DialogActions>
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {TEXT.cancel}
        </button>
        <button type="submit" className="btn btn-primary" disabled={action.busy}>
          {action.busy ? TEXT.saving : TEXT.save}
        </button>
      </DialogActions>
    </form>
  );
}

// ---------------------------------------------------------------------------------------------------

function TestAlerts({
  groupId,
  mayManage,
  status,
}: {
  groupId: string;
  mayManage: boolean;
  status: AlertStatusDto | null;
}) {
  const [busy, setBusy] = useState<AlertChannel | null>(null);
  const [result, setResult] = useState<AlertTestResultDto | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const run = async (channel: AlertChannel) => {
    setBusy(channel);
    setResult(null);
    setProblem(null);
    try {
      setResult(await apiSend<AlertTestResultDto>('POST', '/alerts/test', { channel, groupId }));
    } catch (error) {
      setProblem(error instanceof Error ? error.message : 'The test could not be sent.');
    } finally {
      setBusy(null);
    }
  };
  const labels: Record<AlertChannel, string> = {
    sms: TEXT.testSms,
    teams: TEXT.testTeams,
    email: TEXT.testEmail,
  };
  const tone = (outcome: AlertTestResultDto['outcome']): 'ok' | 'warn' | 'danger' =>
    outcome === 'sent' ? 'ok' : outcome === 'failed' ? 'danger' : 'warn';
  return (
    <SectionPanel title={TEXT.test} subtitle={TEXT.testSubtitle}>
      <div className="inc-status-actions">
        {CHANNELS.map((channel) => {
          const blocked = channel === 'teams' && !mayManage;
          return (
            <span key={channel} className="gov-gated">
              <button
                type="button"
                className="btn btn-outline"
                aria-disabled={blocked || busy !== null || undefined}
                aria-describedby={blocked ? 'alerts-test-teams-note' : undefined}
                onClick={() => {
                  if (!blocked && busy === null) void run(channel);
                }}
              >
                {busy === channel ? TEXT.testing : labels[channel]}
              </button>
              {blocked && (
                <small className="hint gov-gated-reason" id="alerts-test-teams-note">
                  {TEXT.testNeedsManager}
                </small>
              )}
              {status && !status[channel].configured && !blocked && (
                <small className="hint">{TEXT.channelOff}</small>
              )}
            </span>
          );
        })}
      </div>
      <div role="status" aria-live="polite">
        {result && (
          <Callout tone={tone(result.outcome)} title={labels[result.channel]}>
            {result.message}
          </Callout>
        )}
        {problem && (
          <Callout tone="danger" title="The test could not be sent">
            {problem}
          </Callout>
        )}
      </div>
    </SectionPanel>
  );
}

// ---------------------------------------------------------------------------------------------------

function Deliveries() {
  const { open, personName } = useWorkspace();
  const [status, setStatus] = useState<AlertDeliveryStatus | ''>('');
  const deliveries = useApiData<AlertDeliveryDto[]>(
    `/alerts/deliveries${queryString({ status, limit: 100 })}`,
  );
  const columns: GridColumn<AlertDeliveryDto>[] = [
    {
      id: 'when',
      header: TEXT.colWhen,
      sortValue: (d) => new Date(d.createdAt).getTime(),
      exportValue: (d) => d.createdAt,
      cell: (d) => formatDateTime(d.createdAt),
    },
    {
      id: 'incident',
      header: TEXT.colIncident,
      sortValue: (d) => d.incidentTitle ?? '',
      exportValue: (d) => d.incidentTitle ?? d.incidentId,
      cell: (d) => (
        <button
          type="button"
          className="inc-open-link"
          aria-label={TEXT.openIncident(d.incidentTitle ?? d.incidentId)}
          onClick={() => open('incidents', d.incidentId)}
        >
          {d.incidentTitle ?? d.incidentId.slice(0, 8)}
        </button>
      ),
    },
    {
      id: 'channel',
      header: TEXT.colChannel,
      sortValue: (d) => d.channel,
      exportValue: (d) => TEXT.channelName[d.channel],
      cell: (d) => TEXT.channelName[d.channel],
    },
    {
      id: 'to',
      header: TEXT.colTo,
      sortValue: (d) => d.recipientName ?? '',
      exportValue: (d) => d.recipientName ?? TEXT.teamsChannel,
      cell: (d) =>
        d.channel === 'teams'
          ? TEXT.teamsChannel
          : (d.recipientName ?? (d.recipientUserId ? personName(d.recipientUserId) : '')),
    },
    {
      id: 'status',
      header: TEXT.colStatus,
      sortValue: (d) => d.status,
      exportValue: (d) => TEXT.deliveryStatus[d.status].label,
      cell: (d) => <StatusChip {...TEXT.deliveryStatus[d.status]} />,
    },
    {
      id: 'tries',
      header: TEXT.colTries,
      sortValue: (d) => d.attempts,
      cell: (d) => TEXT.tries(d.attempts),
    },
    {
      id: 'detail',
      header: TEXT.colDetail,
      exportValue: (d) => d.lastError ?? '',
      cell: (d) => (
        <>
          {d.lastError && <span>{d.lastError}</span>}
          {d.status === 'pending' && d.nextAttemptAt && (
            <span className="subline">{TEXT.nextTry(formatDateTime(d.nextAttemptAt))}</span>
          )}
          {d.status === 'sent' && d.sentAt && (
            <span className="subline">{TEXT.sentAt(formatDateTime(d.sentAt))}</span>
          )}
        </>
      ),
    },
  ];
  return (
    <SectionPanel
      title={TEXT.deliveries}
      subtitle={TEXT.deliveriesSubtitle}
      action={
        <button type="button" className="btn btn-outline" onClick={deliveries.reload}>
          Refresh
        </button>
      }
    >
      <div className="inc-filters" role="group" aria-label="Filter the alerts">
        <div className="inc-filter-group">
          <label htmlFor="alert-status-filter">{TEXT.statusFilter}</label>
          <select
            id="alert-status-filter"
            className="select-field"
            style={{ width: 'auto' }}
            value={status}
            onChange={(event) => setStatus(event.target.value as AlertDeliveryStatus | '')}
          >
            <option value="">{TEXT.allStatuses}</option>
            {ALERT_DELIVERY_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_FILTERS[value]}
              </option>
            ))}
          </select>
        </div>
      </div>
      <ErrorBox error={deliveries.error} title={TEXT.deliveriesFailed} loading />
      <div style={{ marginTop: 14 }}>
        {!deliveries.data && deliveries.loading ? (
          <PanelSkeleton lines={5} />
        ) : (
          deliveries.data && (
            <div className="inc-grid">
              <DataGrid
                caption={TEXT.deliveriesCaption}
                columns={columns}
                rows={deliveries.data}
                rowKey={(d) => d.id}
                defaultSort={{ id: 'when', direction: 'desc' }}
                searchText={(d) => `${d.incidentTitle ?? ''} ${d.recipientName ?? ''} ${d.channel}`}
                exportName="alert-deliveries"
                empty={<EmptyState title={TEXT.noDeliveries}>{TEXT.noDeliveriesBody}</EmptyState>}
              />
            </div>
          )
        )}
      </div>
    </SectionPanel>
  );
}
