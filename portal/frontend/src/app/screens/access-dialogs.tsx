'use client';

import { useMemo, useState } from 'react';
import {
  GrantMembershipRequest,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  ROLES,
  roleAllowedAtScope,
  type EndSessionsResultDto,
  type MembershipRecordDto,
  type Permission,
  type Role,
  type UserDto,
} from '@dcc/contracts';
import { Dialog, DialogActions } from '@/components/dialog';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { Callout } from '@/components/kit/parts';
import { useToast } from '@/components/toast';
import { canAtGroup } from '@/lib/access';
import { apiSend } from '@/lib/browser-api';
import { fieldErrorsFromApi, validate, type FieldErrors } from '@/lib/forms';
import { ROLE_SUMMARY } from '@/lib/labels';
import { PERMISSION_TEXT } from '@/lib/permissions-ui';
import { useAction } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { ConfirmDialog, PERMISSION_AREAS } from './registry-shared';

const GROUP = '';

const TEXT = {
  grantTitle: 'Give a role',
  grantTitleFor: (name: string) => `Give ${name} a role`,
  grantBody:
    'A role says what a person may do and where. Choose the place first: some roles belong to the whole Group, others to one company.',
  who: 'Who',
  whoList: 'A person in the list',
  whoEmail: 'A new person, by email',
  person: 'Person',
  personHint: 'Only people you may see are listed. For anyone else use their email.',
  choose: 'Choose a person…',
  email: 'Work email',
  emailHint:
    'The complete address, exactly as they sign in. There is no search. The person must have signed in to DCC once.',
  scope: 'Where',
  scopeHint:
    'A group-level role reaches every company of the Group; a company role reaches only that company.',
  wholeGroup: 'Whole Group',
  role: 'Role',
  roleHint: 'Only the roles that can be held at the chosen place are listed.',
  canDo: 'What this role lets the person do',
  noPermissions: 'This role carries no permission in DCC.',
  save: 'Give role',
  saving: 'Saving…',
  cancel: 'Cancel',
  granted: 'Role given. The list was read again from DCC.',
  selfNote: 'You cannot give a role to yourself. Another administrator has to do it.',
  reauth:
    'Giving a role asks you to sign in again if your last sign-in is old. You come back to this page and repeat it.',
  alreadyHolds: 'Roles this person already holds',
  removeTitle: 'Remove this role?',
  removeIntro: (person: string, role: string, where: string) =>
    `${person} will lose the role ${role} (${where}).`,
  loseHead: 'They will no longer be able to:',
  keepAll: 'They keep everything this role allows through the roles they still hold.',
  lastAdmin:
    'This is the only Group administrator you can see. DCC refuses to remove the last one: give the role to someone else first.',
  signInNote:
    'This asks you to sign in again if your last sign-in is old. You come back to this page and repeat the change.',
  confirmRemove: 'Remove role',
  removed: 'Role removed. The list was read again from DCC.',
  loseAlways: 'The person keeps their account and any other role.',
  idpReason:
    'This role comes from the Group’s SSO and is renewed every time the person signs in. A removal here would come back at their next sign-in: change it in the SSO instead.',
  endTitle: 'Sign this person out everywhere?',
  endBody: (person: string) =>
    `This signs ${person} out of DCC on every device they are signed in on. They keep their roles and can sign in again through the SSO.`,
  endPermanent:
    'To remove their access for good, remove their roles in DCC or disable the person in the SSO.',
  endButton: 'Sign out everywhere',
  endResult: (ended: number) =>
    ended === 0
      ? 'No sessions were open.'
      : ended === 1
        ? '1 session ended.'
        : `${ended} sessions ended.`,
  endSelf: 'You are signing yourself out. You will be sent to the sign-in page.',
};

/** The permissions of a set of roles, as one list without repeats. */
export function permissionsOfRoles(roles: readonly Role[]): Set<Permission> {
  return new Set(roles.flatMap((role) => [...ROLE_PERMISSIONS[role]]));
}

/** A role's permissions as plain words, grouped by area of the product. */
export function PermissionChips({ permissions }: { permissions: Iterable<Permission> }) {
  const set = new Set(permissions);
  const groups = PERMISSION_AREAS.map((area) => ({
    area,
    items: area.permissions.filter((permission) => set.has(permission)),
  })).filter((group) => group.items.length > 0);
  if (groups.length === 0) return <p className="rg-note">{TEXT.noPermissions}</p>;
  return (
    <ul className="rg-perm-groups">
      {groups.map(({ area, items }) => (
        <li key={area.id}>
          <strong>{area.label}</strong>
          <span className="rg-chips">
            {items.map((permission) => (
              <span
                className="rg-perm-chip"
                key={permission}
                title={PERMISSION_TEXT[permission].description}
              >
                {PERMISSION_TEXT[permission].label}
              </span>
            ))}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * `POST /api/memberships`: a person from the list (`userId`) or a new person by email, in a company or for the
 * whole Group. `presetCompanyId` fixes the place (the company page); `presetUserId` fixes the person (the person page).
 */
export function GrantDialog({
  onClose,
  onSaved,
  presetCompanyId,
  presetUserId,
}: {
  onClose: () => void;
  onSaved: () => void;
  presetCompanyId?: string;
  presetUserId?: string;
}) {
  const { me, companiesWhere, people, personName, companyName } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const companies = companiesWhere('user.manage');
  const mayGrantGroup = canAtGroup(me, 'user.manage');
  const firstScope = presetCompanyId ?? companies[0]?.id ?? GROUP;
  const rolesFor = (value: string): Role[] =>
    ROLES.filter((role) => roleAllowedAtScope(role, value === GROUP ? 'group' : 'company'));
  const [mode, setMode] = useState<'list' | 'email'>(
    presetUserId || (people && people.length > 0) ? 'list' : 'email',
  );
  const [userId, setUserId] = useState(presetUserId ?? '');
  const [email, setEmail] = useState('');
  const [scope, setScope] = useState(firstScope);
  const [role, setRole] = useState<string>(rolesFor(firstScope)[0] ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const roles = rolesFor(scope);
  const chosen = people?.find((person) => person.id === userId) ?? null;
  const asSelf = mode === 'list' && userId === me.user.id;
  const permissions = useMemo(() => (role ? [...ROLE_PERMISSIONS[role as Role]] : []), [role]);

  const submit = async () => {
    if (asSelf) return setErrors({ userId: TEXT.selfNote });
    const checked = validate(GrantMembershipRequest, {
      ...(mode === 'list' ? { userId: userId || undefined } : { email: email.trim() || undefined }),
      role,
      companyId: scope === GROUP ? undefined : scope,
    });
    if (!checked.ok) {
      // The schema reports "give a person" under userId; the form shows it under whichever person box is in use.
      const { userId: personError, ...rest } = checked.errors;
      return setErrors({
        ...rest,
        ...(personError
          ? { [mode === 'list' ? 'userId' : 'email']: rest.email ?? personError }
          : {}),
      });
    }
    setErrors({});
    const failure = await action.run(() => apiSend('POST', '/memberships', checked.data));
    if (failure) {
      const fromApi = fieldErrorsFromApi(failure);
      const { userId: personError, ...rest } = fromApi;
      return setErrors({
        ...rest,
        ...(personError ? { [mode === 'list' ? 'userId' : 'email']: personError } : {}),
      });
    }
    showToast(TEXT.granted);
    onSaved();
  };

  return (
    <Dialog
      title={presetUserId ? TEXT.grantTitleFor(personName(presetUserId)) : TEXT.grantTitle}
      description={TEXT.grantBody}
      onClose={onClose}
      wide
    >
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        {!presetUserId && (
          <fieldset className="rg-fieldset">
            <legend className="label">{TEXT.who}</legend>
            <label className="rg-radio">
              <input
                type="radio"
                name="who"
                checked={mode === 'list'}
                onChange={() => setMode('list')}
                disabled={!people || people.length === 0}
              />
              {TEXT.whoList}
            </label>
            <label className="rg-radio">
              <input
                type="radio"
                name="who"
                checked={mode === 'email'}
                onChange={() => setMode('email')}
              />
              {TEXT.whoEmail}
            </label>
          </fieldset>
        )}
        {!presetUserId && mode === 'list' && (
          <FormField label={TEXT.person} hint={TEXT.personHint} error={errors.userId} required>
            {(control) => (
              <select
                className="select-field"
                {...control}
                value={userId}
                onChange={(event) => setUserId(event.target.value)}
              >
                <option value="">{TEXT.choose}</option>
                {(people ?? [])
                  .filter((person) => person.status === 'active')
                  .map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.displayName || person.email} ({person.email})
                    </option>
                  ))}
              </select>
            )}
          </FormField>
        )}
        {!presetUserId && mode === 'email' && (
          <FormField label={TEXT.email} hint={TEXT.emailHint} error={errors.email} required>
            {(control) => (
              <input
                className="field"
                type="email"
                autoComplete="off"
                {...control}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            )}
          </FormField>
        )}
        {presetUserId && errors.userId && (
          <small className="field-error" role="alert">
            {errors.userId}
          </small>
        )}
        {asSelf && <Callout tone="warn">{TEXT.selfNote}</Callout>}
        {chosen && chosen.memberships.length > 0 && (
          <p className="rg-note rg-gap">
            {TEXT.alreadyHolds}:{' '}
            {chosen.memberships
              .map(
                (m) =>
                  `${ROLE_LABELS[m.role]} (${m.companyId ? companyName(m.companyId) : TEXT.wholeGroup})`,
              )
              .join(', ')}
          </p>
        )}
        <FormField label={TEXT.scope} hint={TEXT.scopeHint} error={errors.companyId} required>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={scope}
              disabled={Boolean(presetCompanyId)}
              onChange={(event) => {
                const next = event.target.value;
                setScope(next);
                if (!rolesFor(next).includes(role as Role)) setRole(rolesFor(next)[0] ?? '');
              }}
            >
              {companies.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
              {mayGrantGroup && !presetCompanyId && (
                <option value={GROUP}>{TEXT.wholeGroup}</option>
              )}
            </select>
          )}
        </FormField>
        <FormField label={TEXT.role} hint={TEXT.roleHint} error={errors.role} required>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={role}
              onChange={(event) => setRole(event.target.value)}
            >
              {roles.map((value) => (
                <option key={value} value={value}>
                  {ROLE_LABELS[value]}
                </option>
              ))}
            </select>
          )}
        </FormField>
        {role && (
          <details className="rg-disclosure" open>
            <summary>
              {TEXT.canDo}: {ROLE_SUMMARY[role as Role]}
            </summary>
            <PermissionChips permissions={permissions} />
          </details>
        )}
        <p className="rg-note rg-gap">{TEXT.reauth}</p>
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

/**
 * `DELETE /api/memberships/:id`, after saying who loses what: the permissions of this role that the person's other
 * roles at the same place do not also give. A role set by the SSO cannot be removed here (it would come back).
 */
export function RemoveRoleDialog({
  user,
  membership,
  onlyGroupAdmin,
  onClose,
  onDone,
}: {
  user: UserDto;
  membership: MembershipRecordDto;
  /** True when this is the one Group administrator the viewer can see. */
  onlyGroupAdmin: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { companyName } = useWorkspace();
  const showToast = useToast();
  const where = membership.companyId ? companyName(membership.companyId) : TEXT.wholeGroup;
  const person = user.displayName || user.email;
  const losing = useMemo(() => {
    // Other roles that apply at the same place: a group role reaches every company, a company role only its own.
    const others = user.memberships.filter(
      (other) =>
        other.id !== membership.id &&
        (other.companyId === null || other.companyId === membership.companyId),
    );
    const kept = permissionsOfRoles(others.map((other) => other.role));
    return ROLE_PERMISSIONS[membership.role].filter((permission) => !kept.has(permission));
  }, [user, membership]);

  return (
    <ConfirmDialog
      title={TEXT.removeTitle}
      confirmLabel={TEXT.confirmRemove}
      danger
      onClose={onClose}
      onConfirm={async () => {
        await apiSend('DELETE', `/memberships/${membership.id}`);
        showToast(TEXT.removed);
        onDone();
      }}
    >
      <p>{TEXT.removeIntro(person, ROLE_LABELS[membership.role], where)}</p>
      {onlyGroupAdmin && <Callout tone="danger">{TEXT.lastAdmin}</Callout>}
      {losing.length === 0 ? (
        <p>{TEXT.keepAll}</p>
      ) : (
        <>
          <p>{TEXT.loseHead}</p>
          <PermissionChips permissions={losing} />
        </>
      )}
      <p className="rg-note">{TEXT.loseAlways}</p>
      <p className="rg-note">{TEXT.signInNote}</p>
    </ConfirmDialog>
  );
}

/** `POST /api/users/:id/end-sessions` (needs `security.manage`): signs the person out of DCC everywhere. */
export function EndSessionsDialog({
  user,
  isSelf,
  onClose,
  onDone,
}: {
  user: UserDto;
  isSelf: boolean;
  onClose: () => void;
  /** Called with how many sessions the API ended (0 = none were open). */
  onDone: (ended: number) => void;
}) {
  const showToast = useToast();
  const person = user.displayName || user.email;
  return (
    <ConfirmDialog
      title={TEXT.endTitle}
      confirmLabel={TEXT.endButton}
      danger
      onClose={onClose}
      onConfirm={async () => {
        const result = await apiSend<EndSessionsResultDto>(
          'POST',
          `/users/${user.id}/end-sessions`,
        );
        showToast(TEXT.endResult(result?.ended ?? 0));
        onDone(result?.ended ?? 0);
      }}
    >
      <p>{TEXT.endBody(person)}</p>
      <p>{TEXT.endPermanent}</p>
      {isSelf && <Callout tone="warn">{TEXT.endSelf}</Callout>}
      <p className="rg-note">{TEXT.signInNote}</p>
    </ConfirmDialog>
  );
}
