'use client';

import { useState } from 'react';
import { CreateFreezeRequest, type FreezeDto, type SocialAccountDto } from '@dcc/contracts';
import { Dialog, DialogActions } from '@/components/dialog';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { useToast } from '@/components/toast';
import { Callout } from '@/components/kit/parts';
import { apiSend } from '@/lib/browser-api';
import {
  blankToUndefined,
  fieldErrorsFromApi,
  maxLengthOf,
  validate,
  type FieldErrors,
} from '@/lib/forms';
import { formatDateTime } from '@/lib/format';
import { PLATFORM_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import '@/app/screens/work-shared.css';

const TEXT = {
  freezeTitle: 'Freeze publishing',
  freezeBody:
    'A freeze stops every publish and schedule through DCC for the company or the one account you choose, straight away. It cannot stop someone who posts directly on the network. Freezing never asks you to sign in again; lifting it does.',
  company: 'Company',
  scope: 'What to freeze',
  wholeCompany: 'The whole company',
  reason: 'Reason',
  reasonHint: 'Optional. It is recorded in the audit trail and shown on the freeze.',
  cancel: 'Cancel',
  confirm: 'Freeze publishing',
  working: 'Working…',
  frozen: 'Publishing frozen.',
  liftTitle: 'Lift this freeze?',
  liftBody: (scope: string) =>
    `Publishing through DCC starts again for ${scope}. Posts that are approved can then be published or scheduled.`,
  liftSignIn:
    'Lifting a freeze is a sensitive action. If you signed in a while ago, DCC sends you to sign in again and brings you back to this page. Freezing never asks for this.',
  liftConfirm: 'Lift the freeze',
  keep: 'Keep it frozen',
  lifted: 'Freeze lifted.',
  frozenBy: 'Frozen by',
  since: 'since',
  noReason: 'No reason was recorded',
  noAccounts: 'This company has no registered accounts: the freeze covers the whole company.',
};

/** `POST /api/publishing-freezes`: freeze a whole company, or one of its accounts. Needs `publishing.freeze`. */
export function FreezeDialog({
  accounts,
  initialCompanyId,
  onClose,
  onDone,
}: {
  accounts: readonly SocialAccountDto[];
  initialCompanyId?: string | null;
  onClose: () => void;
  onDone: (freeze: FreezeDto) => void;
}) {
  const { companiesWhere } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const companies = companiesWhere('publishing.freeze');
  const [form, setForm] = useState({
    companyId:
      companies.find((entry) => entry.id === initialCompanyId)?.id ?? companies[0]?.id ?? '',
    socialAccountId: '',
    reason: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const ofCompany = accounts.filter((account) => account.companyId === form.companyId);

  const submit = async () => {
    const checked = validate(CreateFreezeRequest, blankToUndefined(form));
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    let created: FreezeDto | undefined;
    const failure = await action.run(async () => {
      created = await apiSend<FreezeDto>('POST', '/publishing-freezes', checked.data);
    });
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.frozen);
    if (created) onDone(created);
  };

  return (
    <Dialog title={TEXT.freezeTitle} description={TEXT.freezeBody} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
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
              {companies.map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {entry.name}
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField
          label={TEXT.scope}
          error={errors.socialAccountId}
          hint={ofCompany.length === 0 ? TEXT.noAccounts : undefined}
        >
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={form.socialAccountId}
              onChange={(event) => setForm({ ...form, socialAccountId: event.target.value })}
            >
              <option value="">{TEXT.wholeCompany}</option>
              {ofCompany.map((account) => (
                <option key={account.id} value={account.id}>
                  {account.displayName} ({PLATFORM_LABELS[account.platform]})
                </option>
              ))}
            </select>
          )}
        </FormField>
        <FormField label={TEXT.reason} hint={TEXT.reasonHint} error={errors.reason}>
          {(control) => (
            <input
              className="field"
              {...control}
              value={form.reason}
              maxLength={maxLengthOf(CreateFreezeRequest.shape.reason)}
              onChange={(event) => setForm({ ...form, reason: event.target.value })}
            />
          )}
        </FormField>
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {TEXT.cancel}
          </button>
          <button
            type="submit"
            className="btn btn-danger"
            disabled={action.busy || !form.companyId}
          >
            {action.busy ? TEXT.working : TEXT.confirm}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** `DELETE /api/publishing-freezes/:id`: lift a freeze after a plain confirmation. Needs a recent sign-in. */
export function LiftFreezeDialog({
  freeze,
  scope,
  onClose,
  onDone,
}: {
  freeze: FreezeDto;
  /** "Kerchanshe Coffee · Facebook · Kerchanshe Coffee": what the freeze covers, in words. */
  scope: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const { personName } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  return (
    <Dialog title={TEXT.liftTitle} description={TEXT.liftBody(scope)} onClose={onClose}>
      <ErrorBox error={action.error} />
      <p className="wk-modal-text">
        <strong>{scope}</strong>
        <br />
        {freeze.reason ?? TEXT.noReason}
        <br />
        <span className="wk-muted">
          {TEXT.frozenBy} {personName(freeze.frozenBy)} {TEXT.since}{' '}
          {formatDateTime(freeze.frozenAt)}
        </span>
      </p>
      <Callout tone="info">{TEXT.liftSignIn}</Callout>
      <DialogActions>
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {TEXT.keep}
        </button>
        <button
          type="button"
          className="btn btn-danger"
          disabled={action.busy}
          onClick={async () => {
            const failure = await action.run(() =>
              apiSend('DELETE', `/publishing-freezes/${freeze.id}`),
            );
            if (failure) return;
            showToast(TEXT.lifted);
            onDone();
          }}
        >
          {action.busy ? TEXT.working : TEXT.liftConfirm}
        </button>
      </DialogActions>
    </Dialog>
  );
}
