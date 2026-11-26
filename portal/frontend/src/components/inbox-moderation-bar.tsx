'use client';

import { useState } from 'react';
import {
  RemoveMessageRequest,
  type InboxMessageDto,
  type ModerationAction,
  type ModerationActionDto,
} from '@dcc/contracts';
import { apiSend } from '@/lib/browser-api';
import { fieldErrorsFromApi, validate, type FieldErrors } from '@/lib/forms';
import { useAction } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { Dialog } from './dialog';
import { ErrorBox } from './error-box';
import { FormField } from './form-field';

const TEXT = {
  group: 'Moderation',
  hide: 'Hide comment',
  delete: 'Delete comment',
  block: 'Block this person',
  hideBusy: 'Hiding…',
  reasonLabel: 'Why (a few words, kept in the record)',
  reasonHint: 'A reason is required: deleting a comment or blocking a person cannot be undone.',
  reasonShort: 'Write a reason of at least 5 characters.',
  confirm: { delete: 'Delete the comment', block: 'Block the person' } satisfies Record<
    'delete' | 'block',
    string
  >,
  title: { delete: 'Delete this comment', block: 'Block this person' } satisfies Record<
    'delete' | 'block',
    string
  >,
  description: {
    delete: 'The comment is removed from the network and the action is recorded with your name.',
    block:
      'The person can no longer comment on or message this account. The action is recorded with your name.',
  } satisfies Record<'delete' | 'block', string>,
  cancel: 'Cancel',
  working: 'Working…',
  note: 'Hiding is for rude or unwanted comments. Deleting and blocking are for the Digital Marketing Manager.',
};

/**
 * Round 2, E-14: moderation buttons of one message. Hide needs `inbox.moderate`; delete and block need `inbox.remove` and a
 * written reason (UI visibility only: the API decides). The answer says plainly when only a record was made.
 * `POST /api/inbox/moderation/hide | delete | block`.
 */
export function ModerationBar({
  message,
  onDone,
}: {
  message: InboxMessageDto;
  onDone: () => void;
}) {
  const { can } = useWorkspace();
  const action = useAction();
  const [result, setResult] = useState<ModerationActionDto | null>(null);
  const [asking, setAsking] = useState<'delete' | 'block' | null>(null);
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const mayHide = can('inbox.moderate', message.companyId) && message.kind === 'comment';
  const mayRemove = can('inbox.remove', message.companyId);
  if (!mayHide && !mayRemove) return null;

  const run = async (kind: ModerationAction, body: Record<string, unknown>) => {
    setResult(null);
    let answer: ModerationActionDto | undefined;
    const failure = await action.run(async () => {
      answer = await apiSend<ModerationActionDto>('POST', `/inbox/moderation/${kind}`, body);
    });
    onDone();
    if (failure) return failure;
    if (answer) setResult(answer);
    return null;
  };
  const target = {
    socialAccountId: message.socialAccountId,
    engineMessageId: message.engineMessageId,
  };

  const confirm = async () => {
    if (!asking) return;
    const checked = validate(RemoveMessageRequest, { ...target, reason });
    if (!checked.ok) return setErrors({ reason: TEXT.reasonShort });
    setErrors({});
    const failure = await run(asking, checked.data);
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    setAsking(null);
    setReason('');
  };

  return (
    <div className="moderation-bar" role="group" aria-label={TEXT.group}>
      <ErrorBox error={action.error} />
      <div className="assign-actions">
        {mayHide && (
          <button
            type="button"
            className="btn btn-outline"
            disabled={action.busy}
            onClick={() => void run('hide', target)}
          >
            {action.busy ? TEXT.hideBusy : TEXT.hide}
          </button>
        )}
        {mayRemove && message.kind === 'comment' && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={action.busy}
            onClick={() => {
              setAsking('delete');
              setErrors({});
              action.clear();
            }}
          >
            {TEXT.delete}
          </button>
        )}
        {mayRemove && (
          <button
            type="button"
            className="btn btn-danger"
            disabled={action.busy}
            onClick={() => {
              setAsking('block');
              setErrors({});
              action.clear();
            }}
          >
            {TEXT.block}
          </button>
        )}
      </div>
      {result && (
        <p className="hint" role="status">
          {result.outcomeNote}
        </p>
      )}
      {!result && <small className="hint">{TEXT.note}</small>}
      {asking && (
        <Dialog
          title={TEXT.title[asking]}
          description={TEXT.description[asking]}
          onClose={() => setAsking(null)}
        >
          <form
            noValidate
            onSubmit={(event) => {
              event.preventDefault();
              void confirm();
            }}
          >
            <ErrorBox error={action.error} />
            <FormField
              label={TEXT.reasonLabel}
              hint={TEXT.reasonHint}
              error={errors.reason}
              required
            >
              {(control) => (
                <textarea
                  className="textarea-field"
                  style={{ minHeight: 70 }}
                  {...control}
                  value={reason}
                  maxLength={500}
                  onChange={(event) => setReason(event.target.value)}
                />
              )}
            </FormField>
            <div className="assign-actions">
              <button type="submit" className="btn btn-danger" disabled={action.busy}>
                {action.busy ? TEXT.working : TEXT.confirm[asking]}
              </button>
              <button type="button" className="btn btn-outline" onClick={() => setAsking(null)}>
                {TEXT.cancel}
              </button>
            </div>
          </form>
        </Dialog>
      )}
    </div>
  );
}
