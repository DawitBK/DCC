'use client';

import { SENSITIVE_REPLY_KINDS, type SensitiveReplyKind } from '@dcc/contracts';
import { FormField } from './form-field';

export const SENSITIVE_KIND_LABELS: Record<SensitiveReplyKind, string> = {
  legal_threat: 'A legal threat',
  media: 'A journalist or the media',
  investor: 'An investor or partner',
  safety: 'A safety claim',
  personal_data: 'Personal data',
  refund_compensation: 'A refund or compensation',
};

const TEXT = {
  check: 'This reply is sensitive and needs approval before it is sent',
  checkHint:
    'Tick this for legal threats, the media, investors, safety, personal data, refunds or compensation. Nothing is posted until another approver agrees.',
  kind: 'What makes it sensitive',
  choose: 'Choose one',
};

/**
 * Round 2, E-08: the "this reply is sensitive" switch of the reply form. Ticked, the reply goes to
 * `POST /api/inbox/reply-approvals` instead of being sent. `value` is the chosen kind, or '' while the box is not ticked.
 */
export function SensitiveReplyField({
  ticked,
  kind,
  error,
  onChange,
}: {
  ticked: boolean;
  kind: SensitiveReplyKind | '';
  error?: string;
  onChange: (ticked: boolean, kind: SensitiveReplyKind | '') => void;
}) {
  return (
    <div className="field-group">
      <label className="platform-option">
        <input
          type="checkbox"
          checked={ticked}
          onChange={(event) => onChange(event.target.checked, event.target.checked ? kind : '')}
        />
        {TEXT.check}
      </label>
      <small className="hint">{TEXT.checkHint}</small>
      {ticked && (
        <FormField label={TEXT.kind} error={error} required>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={kind}
              onChange={(event) => onChange(true, event.target.value as SensitiveReplyKind | '')}
            >
              <option value="">{TEXT.choose}</option>
              {SENSITIVE_REPLY_KINDS.map((value) => (
                <option key={value} value={value}>
                  {SENSITIVE_KIND_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        </FormField>
      )}
    </div>
  );
}
