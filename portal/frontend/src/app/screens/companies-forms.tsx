'use client';

import { useState } from 'react';
import {
  COMPANY_STATUSES,
  CreateBrandRequest,
  CreateCompanyRequest,
  CreateFreezeRequest,
  UpdateBrandRequest,
  UpdateCompanyRequest,
  type BrandDto,
  type CompanyDto,
  type SocialAccountDto,
} from '@dcc/contracts';
import { Dialog, DialogActions } from '@/components/dialog';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { Callout } from '@/components/kit/parts';
import { useToast } from '@/components/toast';
import { apiSend } from '@/lib/browser-api';
import { fieldErrorsFromApi, maxLengthOf, validate, type FieldErrors } from '@/lib/forms';
import { COMPANY_STATUS, PLATFORM_LABELS } from '@/lib/labels';
import { useAction } from '@/lib/use-api';

const TEXT = {
  name: 'Name',
  slug: 'Short name for links',
  slugHint:
    'Lower-case letters, digits and single dashes. It is filled in from the name and cannot be changed later.',
  status: 'Status',
  statusHint: 'Suspended and archived companies cannot publish. Nothing is ever deleted.',
  cancel: 'Cancel',
  back: 'Back',
  save: 'Save',
  saving: 'Saving…',
  companyDialog: 'Add a company',
  companyDialogBody:
    'A company is one business of the Group with its own accounts, people and rules. People of other companies never see it.',
  editDialog: (name: string) => `Edit ${name}`,
  brandDialog: (company: string) => `Add a brand to ${company}`,
  brandDialogBody:
    'A brand groups accounts and posts inside the company, for example one product line. Brands cannot be removed once added; they can be renamed.',
  renameDialog: (name: string) => `Rename ${name}`,
  companySaved: 'Company saved.',
  brandSaved: 'Brand saved.',
  statusEffects: {
    active:
      'The company works normally: its accounts can be published to and its inbox can be answered.',
    suspended:
      'A pause. Nothing can be published for the company and its inbox cannot be answered until it is made active again.',
    archived:
      'The company is closed. The same limits as suspended apply. It stays in the list for the record and can be made active again.',
  } satisfies Record<CompanyDto['status'], string>,
  confirmSuspend: (name: string) => `Suspend ${name}?`,
  confirmArchive: (name: string) => `Archive ${name}?`,
  confirmIntro: 'This is what changes the moment you confirm:',
  consequences: [
    'Nothing can be published for this company, including posts that were already approved.',
    'Replies and assignments in its inbox are refused.',
    'People can still sign in and read everything. Nothing is deleted.',
    'Posts already scheduled in the engine are not called back by this change: check the Publishing screen.',
    'You can make the company active again at any time.',
  ],
  reviewChange: 'Review the change',
  confirmSuspendButton: 'Suspend company',
  confirmArchiveButton: 'Archive company',
  confirmActivate: (name: string) => `Make ${name} active again`,
  freezeTitle: 'Freeze publishing',
  freezeBody:
    'A freeze stops publishing through DCC at once, for the whole company or for one account. It does not stop someone posting directly on the network. Lifting a freeze asks for a recent sign-in.',
  freezeScope: 'What to freeze',
  freezeWholeCompany: 'The whole company',
  freezeOneAccount: 'One account',
  freezeAccount: 'Account',
  freezeAccountHint: 'Only accounts of this company are listed.',
  freezeReason: 'Reason',
  freezeReasonHint: 'Optional, shown to everyone who can see the freeze. Up to 500 characters.',
  freezeSubmit: 'Freeze now',
  freezeDone: 'Publishing is frozen.',
  chooseAccount: 'Choose an account…',
};

/** "Buna Pen & Plate!" becomes "buna-pen-plate": a short name the contract accepts, offered as the person types. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);
}

export type CompanyEditing =
  | { kind: 'new-company' }
  | { kind: 'company'; company: CompanyDto }
  | { kind: 'new-brand'; company: CompanyDto }
  | { kind: 'brand'; company: CompanyDto; brand: BrandDto };

/**
 * `POST /api/companies`, `PATCH /api/companies/:id`, `POST /api/companies/:id/brands`,
 * `PATCH /api/companies/:id/brands/:brandId`. Changing a company away from active is confirmed in a second
 * step that says what stops working.
 */
export function CompanyForm({
  editing,
  onClose,
  onSaved,
}: {
  editing: CompanyEditing;
  onClose: () => void;
  onSaved: (saved?: { id: string }) => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const isNew = editing.kind === 'new-company' || editing.kind === 'new-brand';
  const isCompany = editing.kind === 'new-company' || editing.kind === 'company';
  const [name, setName] = useState(
    editing.kind === 'company'
      ? editing.company.name
      : editing.kind === 'brand'
        ? editing.brand.name
        : '',
  );
  const [slug, setSlug] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [status, setStatus] = useState<CompanyDto['status'] | null>(
    editing.kind === 'company' ? editing.company.status : null,
  );
  const [errors, setErrors] = useState<FieldErrors>({});
  const [confirming, setConfirming] = useState(false);

  const title =
    editing.kind === 'new-company'
      ? TEXT.companyDialog
      : editing.kind === 'company'
        ? TEXT.editDialog(editing.company.name)
        : editing.kind === 'new-brand'
          ? TEXT.brandDialog(editing.company.name)
          : TEXT.renameDialog(editing.brand.name);
  const description =
    editing.kind === 'new-company'
      ? TEXT.companyDialogBody
      : editing.kind === 'new-brand'
        ? TEXT.brandDialogBody
        : undefined;

  const leavingActive =
    editing.kind === 'company' &&
    status !== null &&
    status !== 'active' &&
    status !== editing.company.status;

  const submit = async (confirmed: boolean) => {
    const changed = {
      ...(editing.kind === 'company' && name.trim() !== editing.company.name ? { name } : {}),
      ...(editing.kind === 'company' && status && status !== editing.company.status
        ? { status }
        : {}),
    };
    const checked =
      editing.kind === 'new-company'
        ? validate(CreateCompanyRequest, { name, slug })
        : editing.kind === 'new-brand'
          ? validate(CreateBrandRequest, { name, slug })
          : editing.kind === 'company'
            ? validate(UpdateCompanyRequest, changed)
            : validate(UpdateBrandRequest, { name });
    if (!checked.ok) {
      setConfirming(false);
      // The schema reports "nothing to change" without a field: say it under the name.
      const { _form, ...rest } = checked.errors;
      return setErrors(
        _form && editing.kind === 'company' ? { ...rest, name: _form } : checked.errors,
      );
    }
    if (leavingActive && !confirmed) return setConfirming(true);
    setErrors({});
    const path =
      editing.kind === 'new-company'
        ? '/companies'
        : editing.kind === 'company'
          ? `/companies/${editing.company.id}`
          : editing.kind === 'new-brand'
            ? `/companies/${editing.company.id}/brands`
            : `/companies/${editing.company.id}/brands/${editing.brand.id}`;
    let saved: { id: string } | undefined;
    const failure = await action.run(async () => {
      saved = await apiSend<{ id: string }>(isNew ? 'POST' : 'PATCH', path, checked.data);
    });
    if (failure) {
      setConfirming(false);
      return setErrors(fieldErrorsFromApi(failure));
    }
    showToast(isCompany ? TEXT.companySaved : TEXT.brandSaved);
    onSaved(saved);
  };

  if (confirming && editing.kind === 'company' && status) {
    return (
      <Dialog
        title={
          status === 'archived'
            ? TEXT.confirmArchive(editing.company.name)
            : TEXT.confirmSuspend(editing.company.name)
        }
        onClose={onClose}
      >
        <div className="rg-confirm-body">
          <p>{TEXT.confirmIntro}</p>
          <ul>
            {TEXT.consequences.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
        <ErrorBox error={action.error} />
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={() => setConfirming(false)}>
            {TEXT.back}
          </button>
          <button
            type="button"
            className="btn btn-danger"
            disabled={action.busy}
            onClick={() => void submit(true)}
          >
            {action.busy
              ? TEXT.saving
              : status === 'archived'
                ? TEXT.confirmArchiveButton
                : TEXT.confirmSuspendButton}
          </button>
        </DialogActions>
      </Dialog>
    );
  }

  return (
    <Dialog title={title} description={description} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit(false);
        }}
      >
        <ErrorBox error={action.error} />
        {errors._form && (
          <small className="field-error" role="alert">
            {errors._form}
          </small>
        )}
        <FormField label={TEXT.name} error={errors.name} required>
          {(control) => (
            <input
              className="field"
              {...control}
              value={name}
              maxLength={maxLengthOf(CreateCompanyRequest.shape.name)}
              onChange={(event) => {
                setName(event.target.value);
                if (isNew && !slugTouched) setSlug(slugify(event.target.value));
              }}
            />
          )}
        </FormField>
        {isNew && (
          <FormField label={TEXT.slug} hint={TEXT.slugHint} error={errors.slug} required>
            {(control) => (
              <input
                className="field"
                {...control}
                value={slug}
                maxLength={maxLengthOf(CreateCompanyRequest.shape.slug)}
                onChange={(event) => {
                  setSlugTouched(true);
                  setSlug(event.target.value);
                }}
              />
            )}
          </FormField>
        )}
        {editing.kind === 'company' && status && (
          <>
            <FormField label={TEXT.status} hint={TEXT.statusHint} error={errors.status}>
              {(control) => (
                <select
                  className="select-field"
                  {...control}
                  value={status}
                  onChange={(event) => setStatus(event.target.value as CompanyDto['status'])}
                >
                  {COMPANY_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {COMPANY_STATUS[value].label}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <Callout
              tone={status === 'active' ? 'ok' : 'warn'}
              title={COMPANY_STATUS[status].label}
            >
              {TEXT.statusEffects[status]}
            </Callout>
          </>
        )}
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {TEXT.cancel}
          </button>
          <button
            type="submit"
            className={leavingActive ? 'btn btn-danger' : 'btn btn-primary'}
            disabled={action.busy}
          >
            {action.busy ? TEXT.saving : leavingActive ? TEXT.reviewChange : TEXT.save}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}

/** `POST /api/publishing-freezes`: the whole company, or one of its accounts. */
export function FreezeDialog({
  company,
  accounts,
  presetAccountId,
  onClose,
  onSaved,
}: {
  company: CompanyDto;
  accounts: SocialAccountDto[];
  presetAccountId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const showToast = useToast();
  const action = useAction();
  const [scope, setScope] = useState<'company' | 'account'>(
    presetAccountId ? 'account' : 'company',
  );
  const [accountId, setAccountId] = useState(presetAccountId ?? '');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});

  const submit = async () => {
    const checked = validate(CreateFreezeRequest, {
      companyId: company.id,
      socialAccountId: scope === 'account' ? accountId || undefined : undefined,
      reason: reason.trim() || undefined,
    });
    if (!checked.ok) return setErrors(checked.errors);
    if (scope === 'account' && !accountId)
      return setErrors({ socialAccountId: 'Choose an account.' });
    setErrors({});
    const failure = await action.run(() => apiSend('POST', '/publishing-freezes', checked.data));
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.freezeDone);
    onSaved();
  };

  return (
    <Dialog
      title={`${TEXT.freezeTitle}: ${company.name}`}
      description={TEXT.freezeBody}
      onClose={onClose}
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        <FormField label={TEXT.freezeScope}>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={scope}
              onChange={(event) => setScope(event.target.value as 'company' | 'account')}
            >
              <option value="company">{TEXT.freezeWholeCompany}</option>
              <option value="account">{TEXT.freezeOneAccount}</option>
            </select>
          )}
        </FormField>
        {scope === 'account' && (
          <FormField
            label={TEXT.freezeAccount}
            hint={TEXT.freezeAccountHint}
            error={errors.socialAccountId}
            required
          >
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={accountId}
                onChange={(event) => setAccountId(event.target.value)}
              >
                <option value="">{TEXT.chooseAccount}</option>
                {accounts.map((account) => (
                  <option key={account.id} value={account.id}>
                    {account.displayName} ({PLATFORM_LABELS[account.platform]}) {account.handle}
                  </option>
                ))}
              </select>
            )}
          </FormField>
        )}
        <FormField label={TEXT.freezeReason} hint={TEXT.freezeReasonHint} error={errors.reason}>
          {(control) => (
            <textarea
              className="textarea-field"
              style={{ minHeight: 90 }}
              {...control}
              value={reason}
              maxLength={maxLengthOf(CreateFreezeRequest.shape.reason)}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </FormField>
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {TEXT.cancel}
          </button>
          <button type="submit" className="btn btn-danger" disabled={action.busy}>
            {action.busy ? TEXT.saving : TEXT.freezeSubmit}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
