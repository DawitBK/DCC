'use client';

import { useState } from 'react';
import {
  GrantMembershipRequest,
  ROLE_LABELS,
  ROLES,
  roleAllowedAtScope,
  type MembershipRecordDto,
  type Role,
  type UserDto,
} from '@dcc/contracts';
import { DataTable } from '@/components/data-table';
import { Dialog, DialogActions } from '@/components/dialog';
import { EmptyState, LoadingState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { FormField } from '@/components/form-field';
import { PageTitle } from '@/components/page-title';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { useToast } from '@/components/toast';
import { canAtGroup } from '@/lib/access';
import { apiSend } from '@/lib/browser-api';
import { fieldErrorsFromApi, validate, type FieldErrors } from '@/lib/forms';
import { initials } from '@/lib/format';
import { USER_STATUS } from '@/lib/labels';
import { useAction } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const GROUP = '';

const TEXT = {
  title: 'Access governance',
  description: 'Who holds which DCC role, and where. DCC decides access; this screen shows it.',
  give: '＋ Give a role',
  team: 'People and roles',
  subtitle: (count: number) => `${count} people you may see`,
  caption: 'People and their DCC roles',
  person: 'Person',
  roles: 'Roles',
  status: 'Status',
  wholeGroup: 'Whole group',
  remove: 'Remove',
  removeLabel: (role: string, person: string) => `Remove the role ${role} from ${person}`,
  fromSso: 'set by the SSO',
  noRoles: 'No role you can see',
  emptyTitle: 'Nobody to show',
  emptyBody: 'People appear here once they hold a role in a company you manage.',
  dialog: 'Give a role',
  dialogBody:
    'The person must have signed in to DCC once. Type their complete work email: there is no search.',
  email: 'Work email',
  scope: 'Where',
  role: 'Role',
  roleHint: 'Only the roles that can be held at the chosen place are listed.',
  cancel: 'Cancel',
  save: 'Give role',
  saving: 'Saving…',
  granted: 'Role given. The list was read again from DCC.',
  removeTitle: 'Remove this role?',
  removeBody: (role: string, person: string, where: string) =>
    `${person} will lose the role ${role} (${where}).`,
  confirmRemove: 'Remove role',
  removed: 'Role removed. The list was read again from DCC.',
  reauthNote:
    'Giving or removing a role may ask you to sign in again first. You then come back here and repeat it.',
};

/** `GET /api/users`, `POST /api/memberships` (by email), `DELETE /api/memberships/:id`. */
export function AccessScreen() {
  const { me, people, peopleError, companyId, companyName, can, companiesWhere, reloadPeople } =
    useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const [granting, setGranting] = useState(false);
  const [removing, setRemoving] = useState<{
    user: UserDto;
    membership: MembershipRecordDto;
  } | null>(null);
  const mayGrantGroup = canAtGroup(me, 'user.manage');
  const manageCompanies = companiesWhere('user.manage');
  const mayGrant = mayGrantGroup || manageCompanies.length > 0;

  const rows = (people ?? []).filter(
    (person) =>
      !companyId ||
      person.memberships.some((m) => m.companyId === companyId || m.companyId === null),
  );
  const where = (membership: MembershipRecordDto) =>
    membership.companyId ? companyName(membership.companyId) : TEXT.wholeGroup;
  const mayRemove = (membership: MembershipRecordDto) =>
    membership.companyId ? can('user.manage', membership.companyId) : mayGrantGroup;

  return (
    <>
      <PageTitle
        title={TEXT.title}
        description={TEXT.description}
        action={
          mayGrant && (
            <button className="btn btn-primary" onClick={() => setGranting(true)}>
              {TEXT.give}
            </button>
          )
        }
      />
      <SectionPanel title={TEXT.team} subtitle={TEXT.subtitle(rows.length)}>
        <ErrorBox error={peopleError} loading />
        {!people ? (
          !peopleError && <LoadingState />
        ) : (
          <DataTable
            caption={TEXT.caption}
            rows={rows}
            rowKey={(row) => row.id}
            empty={<EmptyState title={TEXT.emptyTitle}>{TEXT.emptyBody}</EmptyState>}
            columns={[
              {
                header: TEXT.person,
                cell: (row) => (
                  <>
                    <span
                      className="user-avatar"
                      aria-hidden="true"
                      style={{
                        display: 'inline-grid',
                        width: 29,
                        height: 29,
                        marginRight: 8,
                        verticalAlign: 'middle',
                        fontSize: 10,
                      }}
                    >
                      {initials(row.displayName || row.email)}
                    </span>
                    {row.displayName || row.email}
                    <span className="subline">{row.email}</span>
                  </>
                ),
              },
              {
                header: TEXT.roles,
                cell: (row) =>
                  row.memberships.length === 0 ? (
                    TEXT.noRoles
                  ) : (
                    <ul className="plain-list" style={{ listStyle: 'none', paddingLeft: 0 }}>
                      {row.memberships.map((membership) => (
                        <li key={membership.id}>
                          <strong>{ROLE_LABELS[membership.role]}</strong> · {where(membership)}
                          {membership.source === 'idp' && ` · ${TEXT.fromSso}`}{' '}
                          {mayRemove(membership) && row.id !== me.user.id && (
                            <button
                              className="text-link"
                              aria-label={TEXT.removeLabel(
                                ROLE_LABELS[membership.role],
                                row.displayName || row.email,
                              )}
                              onClick={() => {
                                action.clear();
                                setRemoving({ user: row, membership });
                              }}
                            >
                              {TEXT.remove}
                            </button>
                          )}
                        </li>
                      ))}
                    </ul>
                  ),
              },
              {
                header: TEXT.status,
                cell: (row) => <StatusChip status={USER_STATUS[row.status]} />,
              },
            ]}
          />
        )}
      </SectionPanel>
      {mayGrant && <small className="hint">{TEXT.reauthNote}</small>}
      {granting && (
        <GrantDialog
          onClose={() => setGranting(false)}
          onSaved={() => {
            setGranting(false);
            reloadPeople();
          }}
        />
      )}
      {removing && (
        <Dialog
          title={TEXT.removeTitle}
          description={TEXT.removeBody(
            ROLE_LABELS[removing.membership.role],
            removing.user.displayName || removing.user.email,
            where(removing.membership),
          )}
          onClose={() => setRemoving(null)}
        >
          <ErrorBox error={action.error} />
          <DialogActions>
            <button className="btn btn-outline" onClick={() => setRemoving(null)}>
              {TEXT.cancel}
            </button>
            <button
              className="btn btn-danger"
              disabled={action.busy}
              onClick={async () => {
                const failure = await action.run(() =>
                  apiSend('DELETE', `/memberships/${removing.membership.id}`),
                );
                reloadPeople();
                if (failure) return;
                setRemoving(null);
                showToast(TEXT.removed);
              }}
            >
              {TEXT.confirmRemove}
            </button>
          </DialogActions>
        </Dialog>
      )}
    </>
  );
}

function GrantDialog({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { me, companiesWhere } = useWorkspace();
  const showToast = useToast();
  const action = useAction();
  const companies = companiesWhere('user.manage');
  const mayGrantGroup = canAtGroup(me, 'user.manage');
  const [email, setEmail] = useState('');
  const [scope, setScope] = useState(companies[0]?.id ?? GROUP);
  const rolesFor = (value: string): Role[] =>
    ROLES.filter((role) => roleAllowedAtScope(role, value === GROUP ? 'group' : 'company'));
  const [role, setRole] = useState<string>(rolesFor(companies[0]?.id ?? GROUP)[0] ?? '');
  const [errors, setErrors] = useState<FieldErrors>({});
  const roles = rolesFor(scope);

  const submit = async () => {
    const checked = validate(GrantMembershipRequest, {
      email: email.trim() || undefined,
      role,
      companyId: scope === GROUP ? undefined : scope,
    });
    if (!checked.ok) {
      // The schema reports "give a person" under userId; on this form the person is the email box.
      const { userId, ...rest } = checked.errors;
      return setErrors({ ...rest, ...(userId ? { email: rest.email ?? userId } : {}) });
    }
    setErrors({});
    const failure = await action.run(() => apiSend('POST', '/memberships', checked.data));
    if (failure) return setErrors(fieldErrorsFromApi(failure));
    showToast(TEXT.granted);
    onSaved();
  };

  return (
    <Dialog title={TEXT.dialog} description={TEXT.dialogBody} onClose={onClose}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault();
          void submit();
        }}
      >
        <ErrorBox error={action.error} />
        <FormField label={TEXT.email} error={errors.email} required>
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
        <FormField label={TEXT.scope} error={errors.companyId} required>
          {(control) => (
            <select
              className="select-field"
              {...control}
              value={scope}
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
              {mayGrantGroup && <option value={GROUP}>{TEXT.wholeGroup}</option>}
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
