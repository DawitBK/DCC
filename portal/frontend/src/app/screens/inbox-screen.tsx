'use client';

import { useState } from 'react';
import {
  ReplyInboxRequest,
  type EngineStatusDto,
  type InboxMessageDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { EmptyState, LoadingState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { useToast } from '@/components/toast';
import { apiSend, queryString } from '@/lib/browser-api';
import { fieldErrorsFromApi, maxLengthOf, validate, type FieldErrors } from '@/lib/forms';
import { formatDateTime, shortId } from '@/lib/format';
import { PLATFORM_LABELS } from '@/lib/labels';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

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
  kind: { comment: 'Comment', direct_message: 'Direct message' } satisfies Record<
    InboxMessageDto['kind'],
    string
  >,
  replied: 'Replied',
  waiting: 'Not replied',
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
};

/** `GET /api/engine/status`, `GET /api/inbox?companyId=`, `POST /api/inbox/reply`. */
export function InboxScreen() {
  const { companyId, companyName, can } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const engine = useApiData<EngineStatusDto>(can('account.read') ? '/engine/status' : null);
  const inbox = useApiData<InboxMessageDto[]>(`/inbox${queryString({ companyId })}`);
  const accounts = useApiData<SocialAccountDto[]>(can('account.read') ? '/social-accounts' : null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [text, setText] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const messages = inbox.data ?? [];
  const selected = messages.find((item) => item.engineMessageId === activeId) ?? null;
  const accountName = (id: string) => {
    const account = accounts.data?.find((entry) => entry.id === id);
    return account
      ? `${account.displayName} (${PLATFORM_LABELS[account.platform]})`
      : `Account ${shortId(id)}`;
  };
  const max = maxLengthOf(ReplyInboxRequest.shape.text);
  const engineHasNoInbox = engine.data !== null && !engine.data.inbox;

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
      <div className="grid grid-2">
        <SectionPanel title={TEXT.panel} subtitle={TEXT.subtitle(messages.length)}>
          {!inbox.data && inbox.loading && <LoadingState />}
          {inbox.data && messages.length === 0 && (
            <EmptyState title={TEXT.emptyTitle}>{TEXT.emptyBody}</EmptyState>
          )}
          <div className="activity-list">
            {messages.map((item) => (
              <button
                key={item.engineMessageId}
                className="activity-row queue-row"
                aria-pressed={selected?.engineMessageId === item.engineMessageId}
                onClick={() => {
                  setActiveId(item.engineMessageId);
                  setText('');
                  setErrors({});
                  action.clear();
                }}
              >
                <span className="activity-dot" aria-hidden="true" />
                <span className="activity-copy" style={{ flex: 1 }}>
                  <strong>{item.authorName}</strong> · {TEXT.kind[item.kind]}
                  <small>
                    {accountName(item.socialAccountId)} · {companyName(item.companyId)} ·{' '}
                    {formatDateTime(item.receivedAt)}
                  </small>
                </span>
                <StatusChip
                  label={item.replied ? TEXT.replied : TEXT.waiting}
                  tone={item.replied ? 'green' : 'amber'}
                />
              </button>
            ))}
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
              <ErrorBox error={action.error} />
              {can('inbox.reply', selected.companyId) ? (
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
    </>
  );
}
