'use client';

import { useState } from 'react';
import { CreateFreezeRequest, type SocialAccountDto } from '@dcc/contracts';
import { apiSend } from '@/lib/browser-api';
import {
  blankToUndefined,
  fieldErrorsFromApi,
  maxLengthOf,
  validate,
  type FieldErrors,
} from '@/lib/forms';
import { PLATFORM_LABELS } from '@/lib/labels';
import { useAction, useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { Dialog, DialogActions } from './dialog';
import { ErrorBox } from './error-box';
import { FormField } from './form-field';
import { useToast } from './toast';

const TEXT = {
  title: 'Freeze publishing',
  description:
    'This stops every publish through DCC for what you choose, at once. Everyone who can publish for the company is told. It cannot stop someone posting on the network directly with the account’s own login. Lifting a freeze later asks you to sign in again.',
  company: 'Company',
  scope: 'What to freeze',
  wholeCompany: 'The whole company: every account',
  oneAccount: (name: string) => name,
  reason: 'Reason',
  reasonHint: 'Optional, but it helps whoever lifts the freeze. It is kept on the record.',
  cancel: 'Cancel',
  confirm: 'Freeze publishing',
  working: 'Freezing…',
  done: 'Publishing is frozen. Everyone who can publish was told.',
  noCompany: 'You do not hold the freeze permission for any company in view.',
};

/**
 * The emergency brake: `POST /api/publishing-freezes` (needs `publishing.freeze`). It never asks for a recent
 * sign-in: stopping must be instant. The list of freezes and lifting one live on the publishing screen.
 */
export function FreezeDialog({
  initialCompanyId,
  onClose,
  onFrozen,
}: {
  initialCompanyId?: string | null;
  onClose: () => void;
  onFrozen: () => void;
}) {
  const { companiesWhere, can, refreshNotifications } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const companies = companiesWhere('publishing.freeze');
  const accounts = useApiData<SocialAccountDto[]>(can('account.read') ? '/social-accounts' : null);
  const [form, setForm] = useState({
    companyId: companies.find((item) => item.id === initialCompanyId)?.id ?? companies[0]?.id ?? '',
    socialAccountId: '',
    reason: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const accountChoices = (accounts.data ?? []).filter(
    (account) => account.companyId === form.companyId && account.status !== 'archived',
  );

  const submit = async () => {
    const checked = validate(CreateFreezeRequest, blankToUndefined(form));
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    const failure = await action.run(() => apiSend('POST', '/publishing-freezes', checked.data));
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.done);
    refreshNotifications();
    onFrozen();
  };

  return (
    <Dialog title={TEXT.title} description={TEXT.description} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        {companies.length === 0 ? (
          <p className="field-error">{TEXT.noCompany}</p>
        ) : (
          <>
            <FormField label={TEXT.company} error={errors.companyId} required>
              {(control) => (
                <select
                  className="select-field"
                  {...control}
                  value={form.companyId}
                  onChange={(event) =>
                    setForm({ ...form, companyId: event.target.value, socialAccountId: '' })
                  }
                >
                  {companies.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label={TEXT.scope} error={errors.socialAccountId}>
              {(control) => (
                <select
                  className="select-field"
                  {...control}
                  value={form.socialAccountId}
                  onChange={(event) => setForm({ ...form, socialAccountId: event.target.value })}
                >
                  <option value="">{TEXT.wholeCompany}</option>
                  {accountChoices.map((account) => (
                    <option key={account.id} value={account.id}>
                      {TEXT.oneAccount(
                        `${account.displayName} (${PLATFORM_LABELS[account.platform]})`,
                      )}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <FormField label={TEXT.reason} hint={TEXT.reasonHint} error={errors.reason}>
              {(control) => (
                <textarea
                  className="textarea-field"
                  style={{ minHeight: 90 }}
                  {...control}
                  maxLength={maxLengthOf(CreateFreezeRequest.shape.reason.unwrap())}
                  value={form.reason}
                  onChange={(event) => setForm({ ...form, reason: event.target.value })}
                />
              )}
            </FormField>
          </>
        )}
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {TEXT.cancel}
          </button>
          <button
            type="submit"
            className="btn btn-danger"
            disabled={action.busy || companies.length === 0}
          >
            {action.busy ? TEXT.working : TEXT.confirm}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
