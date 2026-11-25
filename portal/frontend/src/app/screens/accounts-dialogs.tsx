'use client';

import { useState } from 'react';
import {
  CreateSocialAccountRequest,
  SOCIAL_PLATFORMS,
  type BrandDto,
  type SocialAccountDto,
  type UserDto,
} from '@dcc/contracts';
import { Dialog, DialogActions } from '@/components/dialog';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { Callout } from '@/components/kit/parts';
import { useToast } from '@/components/toast';
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

const TEXT = {
  dialogRegister: 'Register a social account',
  dialogBody:
    'Add an official page or profile to the register. DCC records who owns it and who backs them up; it never stores a network password or token. The next step, after saving, is to connect the account to the engine so it can be published to.',
  company: 'Company',
  platform: 'Network',
  displayName: 'Display name',
  displayNameHint: 'The name of the page as people see it on the network.',
  handle: 'Handle',
  handleHint:
    'The page’s @name or address on the network. Together with the network it must be unique.',
  publicUrl: 'Public link',
  publicUrlHint: 'Optional. The full address of the page, starting with https://',
  brand: 'Brand',
  noBrand: 'No brand',
  owner: 'Owner',
  ownerHint: 'The person accountable for this account. Every account has one.',
  backup: 'Backup administrator',
  backupHint:
    'Optional now, but the register shows a gap until one is set. Must be a different person from the owner.',
  noBackup: 'No backup administrator yet',
  choose: 'Choose a person…',
  noPeople:
    'You cannot see the list of people, so you cannot choose an owner here. Ask someone who can see people and roles.',
  hasRoleHere: 'Hold a role in this company',
  others: 'Other people you can see',
  cancel: 'Cancel',
  save: 'Register account',
  saving: 'Saving…',
  saved: 'Account registered. Connect it to the engine so it can be published to.',
};

/** Does this person hold a role that reaches the company (a company role there, or a group-level role)? */
export function reachesCompany(person: UserDto, companyId: string | null | undefined): boolean {
  if (!companyId) return true;
  return person.memberships.some(
    (membership) => membership.companyId === null || membership.companyId === companyId,
  );
}

/**
 * A person chooser. People who hold a role in the company are listed first, so the likely choices are on top;
 * everyone else the viewer may see follows. `exclude` removes people already chosen elsewhere in the form.
 */
export function PersonSelect({
  value,
  onChange,
  control,
  companyId,
  exclude = [],
  emptyLabel = TEXT.choose,
}: {
  value: string;
  onChange: (value: string) => void;
  control: object;
  companyId?: string | null;
  exclude?: string[];
  emptyLabel?: string;
}) {
  const { people, me } = useWorkspace();
  const list = (people ?? []).filter(
    (person) => person.status === 'active' && !exclude.includes(person.id),
  );
  const here = list.filter((person) => reachesCompany(person, companyId));
  const rest = list.filter((person) => !reachesCompany(person, companyId));
  const label = (person: UserDto) =>
    `${person.displayName || person.email}${person.id === me.user.id ? ' (you)' : ''} · ${person.email}`;
  return (
    <select
      className="select-field"
      {...control}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      <option value="">{emptyLabel}</option>
      {companyId && here.length > 0 ? (
        <>
          <optgroup label={TEXT.hasRoleHere}>
            {here.map((person) => (
              <option key={person.id} value={person.id}>
                {label(person)}
              </option>
            ))}
          </optgroup>
          {rest.length > 0 && (
            <optgroup label={TEXT.others}>
              {rest.map((person) => (
                <option key={person.id} value={person.id}>
                  {label(person)}
                </option>
              ))}
            </optgroup>
          )}
        </>
      ) : (
        list.map((person) => (
          <option key={person.id} value={person.id}>
            {label(person)}
          </option>
        ))
      )}
    </select>
  );
}

/** `POST /api/social-accounts` with every field of `CreateSocialAccountRequest`. */
export function RegisterDialog({
  onClose,
  onSaved,
  presetCompanyId,
}: {
  onClose: () => void;
  onSaved: (account: SocialAccountDto) => void;
  presetCompanyId?: string;
}) {
  const { companiesWhere, people, me } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const companies = companiesWhere('account.manage');
  const [form, setForm] = useState({
    companyId: presetCompanyId ?? companies[0]?.id ?? '',
    platform: SOCIAL_PLATFORMS[0] as string,
    displayName: '',
    handle: '',
    publicUrl: '',
    brandId: '',
    ownerUserId: '',
    backupAdminUserId: '',
  });
  const [errors, setErrors] = useState<FieldErrors>({});
  const brands = useApiData<BrandDto[]>(
    form.companyId ? `/companies/${form.companyId}/brands` : null,
  );
  const set = (key: keyof typeof form) => (value: string) =>
    setForm((current) => ({ ...current, [key]: value }));
  const shape = CreateSocialAccountRequest.shape;

  const submit = async () => {
    const checked = validate(CreateSocialAccountRequest, blankToUndefined(form));
    if (!checked.ok) return setErrors(checked.errors);
    setErrors({});
    let saved: SocialAccountDto | undefined;
    const failure = await action.run(async () => {
      saved = await apiSend<SocialAccountDto>('POST', '/social-accounts', checked.data);
    });
    if (failure || !saved) return setErrors(failure ? fieldErrorsFromApi(failure) : {});
    showToast(TEXT.saved);
    onSaved(saved);
  };

  return (
    <Dialog title={TEXT.dialogRegister} description={TEXT.dialogBody} onClose={onClose} wide>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        {!people && <Callout tone="warn">{TEXT.noPeople}</Callout>}
        <div className="grid grid-2">
          <FormField label={TEXT.company} error={errors.companyId} required>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={form.companyId}
                disabled={Boolean(presetCompanyId)}
                onChange={(event) => {
                  set('companyId')(event.target.value);
                  set('brandId')('');
                }}
              >
                {companies.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={TEXT.platform} error={errors.platform} required>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={form.platform}
                onChange={(event) => set('platform')(event.target.value)}
              >
                {SOCIAL_PLATFORMS.map((value) => (
                  <option key={value} value={value}>
                    {PLATFORM_LABELS[value]}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField
            label={TEXT.displayName}
            hint={TEXT.displayNameHint}
            error={errors.displayName}
            required
          >
            {(control) => (
              <input
                className="field"
                {...control}
                value={form.displayName}
                maxLength={maxLengthOf(shape.displayName)}
                onChange={(event) => set('displayName')(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={TEXT.handle} hint={TEXT.handleHint} error={errors.handle} required>
            {(control) => (
              <input
                className="field"
                {...control}
                value={form.handle}
                maxLength={maxLengthOf(shape.handle)}
                onChange={(event) => set('handle')(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={TEXT.publicUrl} hint={TEXT.publicUrlHint} error={errors.publicUrl}>
            {(control) => (
              <input
                className="field"
                type="url"
                {...control}
                value={form.publicUrl}
                onChange={(event) => set('publicUrl')(event.target.value)}
              />
            )}
          </FormField>
          <FormField label={TEXT.brand} error={errors.brandId}>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={form.brandId}
                onChange={(event) => set('brandId')(event.target.value)}
              >
                <option value="">{TEXT.noBrand}</option>
                {(brands.data ?? []).map((brand) => (
                  <option key={brand.id} value={brand.id}>
                    {brand.name}
                  </option>
                ))}
              </select>
            )}
          </FormField>
          <FormField label={TEXT.owner} hint={TEXT.ownerHint} error={errors.ownerUserId} required>
            {(control) => (
              <PersonSelect
                control={control}
                companyId={form.companyId}
                value={form.ownerUserId}
                onChange={set('ownerUserId')}
                exclude={form.backupAdminUserId ? [form.backupAdminUserId] : []}
              />
            )}
          </FormField>
          <FormField label={TEXT.backup} hint={TEXT.backupHint} error={errors.backupAdminUserId}>
            {(control) => (
              <PersonSelect
                control={control}
                companyId={form.companyId}
                emptyLabel={TEXT.noBackup}
                value={form.backupAdminUserId}
                onChange={set('backupAdminUserId')}
                exclude={form.ownerUserId ? [form.ownerUserId] : []}
              />
            )}
          </FormField>
        </div>
        {form.ownerUserId === me.user.id && (
          <p className="rg-note">You are registering yourself as the owner of this account.</p>
        )}
        <DialogActions>
          <button type="button" className="btn btn-outline" onClick={onClose}>
            {TEXT.cancel}
          </button>
          <button type="submit" className="btn btn-primary" disabled={action.busy}>
            {action.busy ? TEXT.saving : TEXT.save}
          </button>
        </DialogActions>
      </form>
    </Dialog>
  );
}
