'use client';

import { useState } from 'react';
import {
  AssignInboxMessageRequest,
  ReplyInboxRequest,
  type EngineStatusDto,
  type InboxAssignmentDto,
  type InboxAssigneeDto,
  type InboxMessageDto,
  type InboxSettingsDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { EmptyState, LoadingState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { ResponseTargets } from '@/components/inbox-response-targets';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { useToast } from '@/components/toast';
import { apiSend, queryString } from '@/lib/browser-api';
import { fieldErrorsFromApi, maxLengthOf, validate, type FieldErrors } from '@/lib/forms';
import { formatDateTime, formatDuration, shortId } from '@/lib/format';
import { PLATFORM_LABELS } from '@/lib/labels';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

type AssignmentFilter = '' | 'me' | 'unassigned';

const TEXT = {
  title: 'Unified inbox',
  description: 'Comments and direct messages on the connected accounts, in one queue.',
  refresh: 'Read again',
  panel: 'Messages',
  subtitle: (count: number) =>
    `${count} messages read from the publishing engine. DCC does not store them.`,
  engineOff: 'The inbox is not available yet',
  engineOffBody:
    'The publishing engine that is connected does not provide comments and messages. The inbox appears here when the customised Postiz with the unified inbox is connected.',
  emptyTitle: 'No messages',
  emptyBody: 'New comments and direct messages on connected accounts appear here.',
  emptyFiltered: 'No messages match these filters',
  emptyFilteredBody: 'Change or clear a filter to see more.',
  kind: { comment: 'Comment', direct_message: 'Direct message' } satisfies Record<
    InboxMessageDto['kind'],
    string
  >,
  replied: 'Replied',
  waiting: 'Not replied',
  overdue: 'Overdue',
  select: 'Select a message',
  selectBody: 'Choose a message to read it and reply.',
  from: (name: string) => `From ${name}`,
  reply: 'Your reply',
  replyHint: (used: number, max: number | undefined) =>
    max ? `${used} / ${max} characters. It is posted from the official account.` : '',
  send: 'Send reply',
  sending: 'Sending…',
  sent: 'Reply sent. The inbox was read again.',
  noReply: 'Your role can read the inbox but not reply.',
  filterAssignment: 'Show messages',
  filterAll: 'All messages',
  filterMe: 'Assigned to me',
  filterUnassigned: 'Not assigned',
  filterOverdue: 'Overdue only',
  noTargetAnywhere:
    'No company here has a response target, so nothing is marked overdue. A target is set under "Response targets" by someone who manages approval rules.',
  assignedTo: (name: string) => `Assigned to ${name}`,
  notAssigned: 'Not assigned',
  you: 'you',
  due: (when: string) => `Due ${when}`,
  repliedInEngine: 'Replied in the engine, time not tracked',
  firstReply: (duration: string) => `First reply after ${duration}`,
  responseTitle: 'Response',
  received: 'Received',
  dueLabel: 'Due',
  noTarget: 'No response target for this company',
  firstReplyLabel: 'First reply',
  noReplyYet: 'Not replied through DCC yet',
  assignee: 'Assigned to',
  assignedSince: (when: string) => `since ${when}`,
  assignLabel: 'Assign this message to',
  assignHint: 'Anyone who may reply for this company. Choose nobody to clear the assignment.',
  nobody: 'Nobody',
  loadingPeople: 'Loading people…',
  assign: 'Save assignment',
  assigning: 'Saving…',
  assignToMe: 'Assign to me',
  assigned: (name: string) => `Assigned to ${name}.`,
  unassigned: 'Assignment cleared.',
  noLongerAssignable: (name: string) => `${name} (can no longer be assigned)`,
};

/** A message the engine reports as replied with no reply of ours: DCC cannot know when, and never calls it overdue. */
const repliedInEngine = (item: InboxMessageDto) => item.replied && !item.firstResponseAt;

/** Overdue as the API says, except that a message answered directly in the engine is never overdue. */
const isOverdue = (item: InboxMessageDto) => item.overdue === true && !repliedInEngine(item);

/** The one line a row shows about timing, or null when there is nothing to say (no target, not answered). */
function timingNote(item: InboxMessageDto): string | null {
  if (repliedInEngine(item)) return TEXT.repliedInEngine;
  if (item.firstResponseAt) return TEXT.firstReply(formatDuration(item.responseSeconds));
  return item.dueAt ? TEXT.due(formatDateTime(item.dueAt)) : null;
}

/**
 * `GET /api/engine/status`, `GET /api/inbox?companyId=&assignedTo=&unassigned=&overdue=`, `POST /api/inbox/reply`,
 * `GET /api/inbox/assignees`, `PUT /api/inbox/assignment`, `GET/PUT /api/inbox/settings`.
 */
export function InboxScreen() {
  const { me, companyId, companyName, can, companiesWhere } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const assignAction = useAction();
  const engine = useApiData<EngineStatusDto>(can('account.read') ? '/engine/status' : null);
  const [assignment, setAssignment] = useState<AssignmentFilter>('');
  const [overdueOnly, setOverdueOnly] = useState(false);
  const filtered = assignment !== '' || overdueOnly;
  const inbox = useApiData<InboxMessageDto[]>(
    `/inbox${queryString({
      companyId,
      assignedTo: assignment === 'me' ? me.user.id : undefined,
      unassigned: assignment === 'unassigned' ? 'true' : undefined,
      overdue: overdueOnly ? 'true' : undefined,
    })}`,
  );
  const accounts = useApiData<SocialAccountDto[]>(can('account.read') ? '/social-accounts' : null);
  const settings = useApiData<InboxSettingsDto[]>(can('inbox.read') ? '/inbox/settings' : null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  // null = nothing chosen yet in the picker: it shows who is assigned now.
  const [pickedAssignee, setPickedAssignee] = useState<string | null>(null);

  const messages = inbox.data ?? [];
  const selected = messages.find((item) => item.engineMessageId === activeId) ?? null;
  const mayReply = selected ? can('inbox.reply', selected.companyId) : false;
  const assignees = useApiData<InboxAssigneeDto[]>(
    selected && mayReply
      ? `/inbox/assignees${queryString({ companyId: selected.companyId })}`
      : null,
  );
  const accountName = (id: string) => {
    const account = accounts.data?.find((entry) => entry.id === id);
    return account
      ? `${account.displayName} (${PLATFORM_LABELS[account.platform]})`
      : `Account ${shortId(id)}`;
  };
  const personLabel = (userId: string, name: string | null | undefined) =>
    userId === me.user.id ? TEXT.you : name || `Person ${shortId(userId)}`;
  const assigneeLabel = (item: InboxMessageDto) =>
    item.assignedTo
      ? TEXT.assignedTo(personLabel(item.assignedTo, item.assignedToName))
      : TEXT.notAssigned;
  const max = maxLengthOf(ReplyInboxRequest.shape.text);
  const engineHasNoInbox = engine.data !== null && !engine.data.inbox;
  const targetCompanies = companiesWhere('approval_policy.manage');
  const anyTarget = (settings.data ?? []).some((entry) => entry.responseTargetMinutes !== null);

  const send = async () => {
    if (!selected) return;
    const checked = validate(ReplyInboxRequest, {
      socialAccountId: selected.socialAccountId,
      engineMessageId: selected.engineMessageId,
      text,
    });
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() => apiSend('POST', '/inbox/reply', checked.data));
    inbox.reload();
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    setText('');
    showToast(TEXT.sent);
  };

  /** `PUT /api/inbox/assignment`; null clears. Success is said only after the API answered. */
  const saveAssignment = async (assigneeUserId: string | null) => {
    if (!selected) return;
    const checked = validate(AssignInboxMessageRequest, {
      socialAccountId: selected.socialAccountId,
      engineMessageId: selected.engineMessageId,
      assigneeUserId,
    });
    if (!checked.ok) return;
    let answer: InboxAssignmentDto | undefined;
    const failure = await assignAction.run(async () => {
      answer = await apiSend<InboxAssignmentDto>('PUT', '/inbox/assignment', checked.data);
    });
    if (failure || !answer) return;
    showToast(
      answer.assignedTo
        ? TEXT.assigned(personLabel(answer.assignedTo, answer.assignedToName))
        : TEXT.unassigned,
    );
    setPickedAssignee(null);
    inbox.reload();
  };

  const currentAssignee = selected?.assignedTo ?? '';
  const pickerValue = pickedAssignee ?? currentAssignee;
  const people = assignees.data ?? [];
  const peopleLoading = assignees.loading && !assignees.data;
  const missingAssignee =
    selected?.assignedTo && assignees.data && !people.some((p) => p.userId === selected.assignedTo)
      ? selected.assignedTo
      : null;

  return (
    <>
      <PageTitle
        title={TEXT.title}
        description={TEXT.description}
        action={
          <button className="btn btn-outline" onClick={inbox.reload}>
            {TEXT.refresh}
          </button>
        }
      />
      {engineHasNoInbox && (
        <div className="demo-banner" role="note">
          <span aria-hidden="true">ⓘ</span>
          <div>
            <strong>{TEXT.engineOff}</strong>
            {TEXT.engineOffBody} {engine.data?.notes.join(' ')}
          </div>
        </div>
      )}
      <ErrorBox error={inbox.error} loading />
      <div className="filter-row">
        <select
          className="select-field"
          aria-label={TEXT.filterAssignment}
          value={assignment}
          onChange={(event) => {
            setAssignment(event.target.value as AssignmentFilter);
            setActiveId(null);
          }}
        >
          <option value="">{TEXT.filterAll}</option>
          <option value="me">{TEXT.filterMe}</option>
          <option value="unassigned">{TEXT.filterUnassigned}</option>
        </select>
        <label className="platform-option filter-check">
          <input
            type="checkbox"
            checked={overdueOnly}
            onChange={(event) => {
              setOverdueOnly(event.target.checked);
              setActiveId(null);
            }}
          />
          {TEXT.filterOverdue}
        </label>
      </div>
      {settings.data && !anyTarget && (
        <p className="hint filter-note" role="note">
          {TEXT.noTargetAnywhere}
        </p>
      )}
      <div className="grid grid-2">
        <SectionPanel title={TEXT.panel} subtitle={TEXT.subtitle(messages.length)}>
          {!inbox.data && inbox.loading && <LoadingState />}
          {inbox.data && messages.length === 0 && (
            <EmptyState title={filtered ? TEXT.emptyFiltered : TEXT.emptyTitle}>
              {filtered ? TEXT.emptyFilteredBody : TEXT.emptyBody}
            </EmptyState>
          )}
          <div className="activity-list">
            {messages.map((item) => {
              const note = timingNote(item);
              return (
                <button
                  key={item.engineMessageId}
                  className="activity-row queue-row"
                  aria-pressed={selected?.engineMessageId === item.engineMessageId}
                  onClick={() => {
                    setActiveId(item.engineMessageId);
                    setText('');
                    setErrors({});
                    setPickedAssignee(null);
                    action.clear();
                    assignAction.clear();
                  }}
                >
                  <span className="activity-dot" aria-hidden="true" />
                  <span className="activity-copy" style={{ flex: 1 }}>
                    <strong>{item.authorName}</strong> · {TEXT.kind[item.kind]}
                    <small>
                      {accountName(item.socialAccountId)} · {companyName(item.companyId)} ·{' '}
                      {formatDateTime(item.receivedAt)}
                    </small>
                    <small>
                      {assigneeLabel(item)}
                      {note ? ` · ${note}` : ''}
                    </small>
                  </span>
                  <span className="chip-stack">
                    <StatusChip
                      label={item.replied ? TEXT.replied : TEXT.waiting}
                      tone={item.replied ? 'green' : 'amber'}
                    />
                    {isOverdue(item) && <StatusChip label={TEXT.overdue} tone="red" />}
                  </span>
                </button>
              );
            })}
          </div>
        </SectionPanel>
        <SectionPanel
          title={selected ? TEXT.from(selected.authorName) : TEXT.select}
          subtitle={selected ? accountName(selected.socialAccountId) : undefined}
        >
          {!selected ? (
            <EmptyState title={TEXT.select}>{TEXT.selectBody}</EmptyState>
          ) : (
            <>
              <div className="preview-card" style={{ marginBottom: 14 }}>
                <div className="preview-body" style={{ whiteSpace: 'pre-wrap' }}>
                  {selected.text}
                </div>
              </div>
              <dl className="definition-grid" aria-label={TEXT.responseTitle}>
                <div>
                  <dt>{TEXT.received}</dt>
                  <dd>{formatDateTime(selected.receivedAt)}</dd>
                </div>
                <div>
                  <dt>{TEXT.dueLabel}</dt>
                  <dd>
                    {selected.dueAt ? formatDateTime(selected.dueAt) : TEXT.noTarget}
                    {isOverdue(selected) && <StatusChip label={TEXT.overdue} tone="red" />}
                  </dd>
                </div>
                <div>
                  <dt>{TEXT.firstReplyLabel}</dt>
                  <dd>
                    {repliedInEngine(selected)
                      ? TEXT.repliedInEngine
                      : selected.firstResponseAt
                        ? `${formatDateTime(selected.firstResponseAt)}. ${TEXT.firstReply(formatDuration(selected.responseSeconds))}.`
                        : TEXT.noReplyYet}
                  </dd>
                </div>
                <div>
                  <dt>{TEXT.assignee}</dt>
                  <dd>
                    {selected.assignedTo
                      ? personLabel(selected.assignedTo, selected.assignedToName)
                      : TEXT.notAssigned}
                    {selected.assignedAt && (
                      <span className="subline">
                        {TEXT.assignedSince(formatDateTime(selected.assignedAt))}
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
              {mayReply && (
                <form
                  noValidate
                  className="assign-form"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void saveAssignment(pickerValue === '' ? null : pickerValue);
                  }}
                >
                  <ErrorBox error={assignAction.error} />
                  <ErrorBox error={assignees.error} loading />
                  <FormField label={TEXT.assignLabel} hint={TEXT.assignHint}>
                    {(control) => (
                      <select
                        className="select-field"
                        {...control}
                        value={pickerValue}
                        disabled={peopleLoading}
                        onChange={(event) => setPickedAssignee(event.target.value)}
                      >
                        <option value="">{peopleLoading ? TEXT.loadingPeople : TEXT.nobody}</option>
                        {missingAssignee && (
                          <option value={missingAssignee}>
                            {TEXT.noLongerAssignable(
                              personLabel(missingAssignee, selected.assignedToName),
                            )}
                          </option>
                        )}
                        {people.map((person) => (
                          <option key={person.userId} value={person.userId}>
                            {person.userId === me.user.id
                              ? `${person.displayName} (${TEXT.you})`
                              : person.displayName}
                          </option>
                        ))}
                      </select>
                    )}
                  </FormField>
                  <div className="assign-actions">
                    <button
                      type="submit"
                      className="btn btn-outline"
                      disabled={assignAction.busy || pickerValue === currentAssignee}
                    >
                      {assignAction.busy ? TEXT.assigning : TEXT.assign}
                    </button>
                    {currentAssignee !== me.user.id &&
                      people.some((person) => person.userId === me.user.id) && (
                        <button
                          type="button"
                          className="btn btn-outline"
                          disabled={assignAction.busy}
                          onClick={() => void saveAssignment(me.user.id)}
                        >
                          {TEXT.assignToMe}
                        </button>
                      )}
                  </div>
                </form>
              )}
              <ErrorBox error={action.error} />
              {mayReply ? (
                <form
                  noValidate
                  onSubmit={(event) => {
                    event.preventDefault();
                    void send();
                  }}
                >
                  <FormField
                    label={TEXT.reply}
                    hint={TEXT.replyHint(text.length, max)}
                    error={errors.text}
                    required
                  >
                    {(control) => (
                      <textarea
                        className="textarea-field"
                        style={{ minHeight: 90 }}
                        {...control}
                        value={text}
                        maxLength={max}
                        onChange={(event) => setText(event.target.value)}
                      />
                    )}
                  </FormField>
                  <button type="submit" className="btn btn-primary" disabled={action.busy}>
                    {action.busy ? TEXT.sending : TEXT.send}
                  </button>
                </form>
              ) : (
                <small className="hint">{TEXT.noReply}</small>
              )}
            </>
          )}
        </SectionPanel>
      </div>
      {settings.data && targetCompanies.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <ResponseTargets
            companies={targetCompanies}
            settings={settings.data}
            onSaved={() => {
              settings.reload();
              inbox.reload();
            }}
          />
        </div>
      )}
    </>
  );
}
