'use client';

import { useMemo, useState } from 'react';
import {
  ROLE_LABELS,
  ROLES,
  type AccountAssignmentDto,
  type MembershipRecordDto,
  type SocialAccountDto,
  type UserDto,
} from '@dcc/contracts';
import { EmptyState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { SectionPanel } from '@/components/section-panel';
import { StatusChip } from '@/components/status-chip';
import { DataGrid, type GridColumn, type GridFilter } from '@/components/kit/data-grid';
import { PageHeader } from '@/components/kit/page-header';
import { Callout, CopyId, DescriptionList, Fact } from '@/components/kit/parts';
import { canAtGroup } from '@/lib/access';
import { initials } from '@/lib/format';
import { USER_STATUS } from '@/lib/labels';
import { needsRoleHint } from '@/lib/permissions-ui';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import {
  EndSessionsDialog,
  GrantDialog,
  PermissionChips,
  RemoveRoleDialog,
  permissionsOfRoles,
} from './access-dialogs';
import {
  AccountLink,
  CompanyLink,
  FactStrip,
  GatedButton,
  LoadingBlock,
  MembershipLine,
  NoAccessNote,
  RecordLink,
  ViewOnlyNote,
} from './registry-shared';
import './access-screen.css';

const TEXT = {
  title: 'Access governance',
  description:
    'Who holds which DCC role, and where. DCC decides access; this screen shows it and lets the right administrators change it. Open a person to see everything about their access.',
  give: '＋ Give a role',
  giveReason: 'Giving a role needs the right to give and remove roles.',
  caption: 'People and their DCC roles',
  person: 'Person',
  roles: 'Roles',
  status: 'Status',
  setBy: 'Set by',
  companies: 'Companies',
  wholeGroup: 'Whole Group',
  sso: 'The SSO',
  dcc: 'DCC',
  noRoles: 'No role you can see',
  people: 'People you may see',
  active: 'Active',
  activeNote: 'Can sign in',
  groupLevel: 'With a group-level role',
  groupLevelNote: 'Reach every company',
  fromSso: 'Roles set by the SSO',
  fromSsoNote: 'Renewed at each sign-in',
  filterRole: 'Role',
  filterCompany: 'Company',
  filterStatus: 'Status',
  filterSource: 'Set by',
  optGroup: 'Whole Group',
  emptyTitle: 'Nobody to show',
  emptyBody:
    'People appear here once they hold a role in a company you manage. Give a role by email to someone who has signed in to DCC once.',
  reauth:
    'Giving or removing a role may ask you to sign in again first. You then come back here and repeat it.',
  open: 'Open',
  openLabel: (name: string) => `Open ${name}`,
  hiddenTitle: 'People and roles',
  // detail
  people_: 'Access governance',
  notFoundTitle: 'This person is not available',
  notFoundBody:
    'They do not exist, or they hold no role in a company or group you manage. People you cannot see are never listed.',
  back: 'Back to all people',
  detailDescription: (email: string) =>
    `${email}. Every role this person holds, and what it lets them do.`,
  factStatus: 'Status',
  factRoles: 'Roles held',
  factGroup: 'Group-level roles',
  factOwned: 'Accounts owned',
  factBackup: 'Accounts backed up',
  factAssigned: 'Accounts assigned',
  hidden: '—',
  membershipsTitle: 'Roles held',
  membershipsSubtitle:
    'Each role applies at one place: the whole Group, or one company. A group-level role reaches every company.',
  membershipsCaption: 'Roles held by this person',
  roleCol: 'Role',
  whereCol: 'Where',
  sourceCol: 'Set by',
  actionCol: '',
  removeBtn: 'Remove',
  removeLabel: (role: string, who: string) => `Remove the role ${role} from ${who}`,
  removeNoRight: 'Needs the right to give and remove roles here.',
  removeSelf:
    'Roles you hold yourself are not removed from this screen, so you cannot lock yourself out by accident. Another administrator can remove them.',
  removeSso:
    'This role comes from the Group’s SSO and is renewed every time the person signs in. A removal here would come back: change it in the SSO instead.',
  noMemberships: 'This person holds no role you can see.',
  giveHere: '＋ Give another role',
  canTitle: 'What their roles let them do',
  canSubtitle: 'Everything their roles allow, in plain words, grouped by area of the product.',
  canNone: 'Nothing: they hold no role you can see.',
  rolesPage: 'See every role and permission',
  accountsTitle: 'Accounts',
  accountsSubtitle: 'Social accounts this person owns, backs up or is assigned to.',
  accountsHidden: 'Accounts of this person',
  owns: 'Owner of',
  backsUp: 'Backup administrator of',
  assignedTo: 'Assigned to',
  nothing: 'None',
  loadingAccounts: 'Loading accounts',
  auditTitle: 'Their activity',
  auditBody: 'See what this person did in DCC, from the audit trail.',
  auditOpen: 'Open their activity in the audit trail',
  signOutTitle: 'Sessions',
  signOutBody:
    'Signing a person out ends every DCC session they have, on every device. They keep their roles and can sign in again through the SSO. To remove their access for good, remove their roles or disable the person in the SSO.',
  signOut: 'Sign this person out everywhere',
  signOutSelf: 'To end your own session use “Sign out” in the top bar.',
  signOutResult: (ended: number) =>
    ended === 0
      ? 'No sessions were open.'
      : ended === 1
        ? '1 session ended.'
        : `${ended} sessions ended.`,
  signInNote: 'This asks you to sign in again if your last sign-in is old.',
  dlEmail: 'Email',
  dlName: 'Name',
  dlStatus: 'Status',
  dlId: 'Person id',
  dlStatusHint: 'A disabled person cannot sign in. Disabling is done in the SSO, not here.',
};

type Row = { user: UserDto; companyIds: string[]; groupLevel: boolean; viaSso: boolean };

/** `GET /api/users`, `POST /api/memberships`, `DELETE /api/memberships/:id`. Detail: `/governance/<userId>`. */
export function AccessScreen() {
  const { detailId } = useWorkspace();
  return (
    <div className="rg-page">{detailId ? <PersonDetail userId={detailId} /> : <PeopleList />}</div>
  );
}

function PeopleList() {
  const {
    me,
    people,
    peopleError,
    companyId,
    companies,
    companyName,
    can,
    companiesWhere,
    open,
    reloadPeople,
  } = useWorkspace();
  const [granting, setGranting] = useState(false);
  const mayGrant = canAtGroup(me, 'user.manage') || companiesWhere('user.manage').length > 0;

  const rows = useMemo<Row[]>(
    () =>
      (people ?? [])
        .filter(
          (person) =>
            !companyId ||
            person.memberships.some((m) => m.companyId === companyId || m.companyId === null),
        )
        .map((user) => ({
          user,
          companyIds: [
            ...new Set(user.memberships.flatMap((m) => (m.companyId ? [m.companyId] : []))),
          ],
          groupLevel: user.memberships.some((m) => m.companyId === null),
          viaSso: user.memberships.some((m) => m.source === 'idp'),
        })),
    [people, companyId],
  );

  const columns: GridColumn<Row>[] = [
    {
      id: 'person',
      header: TEXT.person,
      sortValue: (row) => row.user.displayName || row.user.email,
      exportValue: (row) => `${row.user.displayName} <${row.user.email}>`,
      cell: (row) => (
        <div className="rg-person-cell">
          <span className="user-avatar rg-avatar" aria-hidden="true">
            {initials(row.user.displayName || row.user.email)}
          </span>
          <span>
            <span className="post-title">
              <RecordLink screen="access" id={row.user.id} keepCompany={false}>
                {row.user.displayName || row.user.email}
              </RecordLink>
            </span>
            <span className="subline">{row.user.email}</span>
          </span>
        </div>
      ),
    },
    {
      id: 'roles',
      header: TEXT.roles,
      sortValue: (row) => row.user.memberships.length,
      exportValue: (row) =>
        row.user.memberships
          .map(
            (m) =>
              `${ROLE_LABELS[m.role]} (${m.companyId ? companyName(m.companyId) : TEXT.wholeGroup})`,
          )
          .join('; '),
      cell: (row) =>
        row.user.memberships.length === 0 ? (
          <span className="rg-muted">{TEXT.noRoles}</span>
        ) : (
          <ul className="rg-plain-list rg-flat">
            {row.user.memberships.map((m) => (
              <li key={m.id}>
                <MembershipLine
                  membership={m}
                  companyLabel={m.companyId ? companyName(m.companyId) : null}
                />
              </li>
            ))}
          </ul>
        ),
    },
    {
      id: 'status',
      header: TEXT.status,
      sortValue: (row) => row.user.status,
      exportValue: (row) => USER_STATUS[row.user.status].label,
      cell: (row) => <StatusChip status={USER_STATUS[row.user.status]} />,
    },
    {
      id: 'source',
      header: TEXT.setBy,
      sortValue: (row) => (row.viaSso ? 1 : 0),
      exportValue: (row) => (row.viaSso ? TEXT.sso : TEXT.dcc),
      cell: (row) => (row.viaSso ? <StatusChip label={TEXT.sso} tone="blue" /> : TEXT.dcc),
    },
    {
      id: 'open',
      header: '',
      cell: (row) => (
        <RecordLink
          screen="access"
          id={row.user.id}
          keepCompany={false}
          className="text-link rg-link rg-nowrap"
          label={TEXT.openLabel(row.user.displayName || row.user.email)}
        >
          {TEXT.open}
        </RecordLink>
      ),
    },
  ];
  const filters: GridFilter<Row>[] = [
    {
      id: 'role',
      label: TEXT.filterRole,
      options: ROLES.map((role) => ({ value: role, label: ROLE_LABELS[role] })),
      test: (row, value) => row.user.memberships.some((m) => m.role === value),
    },
    {
      id: 'company',
      label: TEXT.filterCompany,
      options: [
        { value: 'group', label: TEXT.optGroup },
        ...companies.map((item) => ({ value: item.id, label: item.name })),
      ],
      test: (row, value) =>
        value === 'group' ? row.groupLevel : row.companyIds.includes(value) || row.groupLevel,
    },
    {
      id: 'status',
      label: TEXT.filterStatus,
      options: [
        { value: 'active', label: USER_STATUS.active.label },
        { value: 'disabled', label: USER_STATUS.disabled.label },
      ],
      test: (row, value) => row.user.status === value,
    },
    {
      id: 'source',
      label: TEXT.filterSource,
      options: [
        { value: 'dcc', label: TEXT.dcc },
        { value: 'idp', label: TEXT.sso },
      ],
      test: (row, value) => row.user.memberships.some((m) => m.source === value),
    },
  ];

  if (!can('user.read')) return <NoAccessNote permission="user.read" what={TEXT.hiddenTitle} />;
  return (
    <>
      <PageHeader
        title={TEXT.title}
        description={TEXT.description}
        actions={
          <GatedButton
            allowed={mayGrant}
            permission="user.manage"
            reason={TEXT.giveReason}
            compact
            className="btn btn-primary"
            onClick={() => setGranting(true)}
          >
            {TEXT.give}
          </GatedButton>
        }
      />
      <ErrorBox error={peopleError} loading />
      <FactStrip>
        <Fact label={TEXT.people} value={people ? rows.length : TEXT.hidden} />
        <Fact
          label={TEXT.active}
          value={people ? rows.filter((r) => r.user.status === 'active').length : TEXT.hidden}
          note={TEXT.activeNote}
        />
        <Fact
          label={TEXT.groupLevel}
          value={people ? rows.filter((r) => r.groupLevel).length : TEXT.hidden}
          note={TEXT.groupLevelNote}
        />
        <Fact
          label={TEXT.fromSso}
          value={people ? rows.filter((r) => r.viaSso).length : TEXT.hidden}
          note={TEXT.fromSsoNote}
        />
      </FactStrip>
      <div className="rg-stack">
        {!mayGrant && <ViewOnlyNote permission="user.manage" />}
        {!people ? (
          !peopleError && <LoadingBlock lines={6} />
        ) : (
          <DataGrid
            caption={TEXT.caption}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.user.id}
            searchText={(row) =>
              `${row.user.displayName} ${row.user.email} ${row.user.memberships
                .map((m) => `${ROLE_LABELS[m.role]} ${m.companyId ? companyName(m.companyId) : ''}`)
                .join(' ')}`
            }
            filters={filters}
            defaultSort={{ id: 'person', direction: 'asc' }}
            exportName="people-and-roles"
            onOpen={(row) => open('access', row.user.id)}
            empty={<EmptyState title={TEXT.emptyTitle}>{TEXT.emptyBody}</EmptyState>}
          />
        )}
        {mayGrant && <p className="rg-note">{TEXT.reauth}</p>}
      </div>
      {granting && (
        <GrantDialog
          onClose={() => setGranting(false)}
          onSaved={() => {
            setGranting(false);
            reloadPeople();
          }}
        />
      )}
    </>
  );
}

function PersonDetail({ userId }: { userId: string }) {
  const { me, people, peopleError, companyName, can, open, reloadPeople, screenAllowed } =
    useWorkspace();
  const [granting, setGranting] = useState(false);
  const [removing, setRemoving] = useState<MembershipRecordDto | null>(null);
  const [signingOut, setSigningOut] = useState(false);
  const [endedResult, setEndedResult] = useState<number | null>(null);
  const user = people?.find((item) => item.id === userId) ?? null;
  const accounts = useApiData<SocialAccountDto[]>(can('account.read') ? '/social-accounts' : null);
  const assigned = useApiData<AccountAssignmentDto[]>(
    can('account.manage') ? `/social-accounts/assignments?userId=${userId}` : null,
  );
  const isSelf = userId === me.user.id;

  if (!people) {
    return (
      <>
        <ErrorBox error={peopleError} loading />
        {!peopleError && <LoadingBlock lines={6} />}
      </>
    );
  }
  if (!user)
    return (
      <>
        <PageHeader
          title={TEXT.notFoundTitle}
          crumbs={[{ label: TEXT.people_, onClick: () => open('access') }, { label: '…' }]}
        />
        <EmptyState title={TEXT.notFoundTitle}>{TEXT.notFoundBody}</EmptyState>
        <div className="rg-empty-action">
          <button type="button" className="btn btn-outline" onClick={() => open('access')}>
            {TEXT.back}
          </button>
        </div>
      </>
    );

  const name = user.displayName || user.email;
  const owned = (accounts.data ?? []).filter((a) => a.ownerUserId === userId);
  const backed = (accounts.data ?? []).filter((a) => a.backupAdminUserId === userId);
  const assignedAccounts = (accounts.data ?? []).filter((a) =>
    (assigned.data ?? []).some((row) => row.socialAccountId === a.id),
  );
  const groupAdmins = people.filter((p) =>
    p.memberships.some((m) => m.role === 'group_admin' && m.companyId === null),
  ).length;
  const permissions = permissionsOfRoles(user.memberships.map((m) => m.role));
  const mayManageHere = (m: MembershipRecordDto) =>
    m.companyId === null ? canAtGroup(me, 'user.manage') : can('user.manage', m.companyId);

  const columns: GridColumn<MembershipRecordDto>[] = [
    {
      id: 'role',
      header: TEXT.roleCol,
      sortValue: (row) => ROLE_LABELS[row.role],
      exportValue: (row) => ROLE_LABELS[row.role],
      cell: (row) => <strong>{ROLE_LABELS[row.role]}</strong>,
    },
    {
      id: 'where',
      header: TEXT.whereCol,
      sortValue: (row) => (row.companyId ? companyName(row.companyId) : ''),
      exportValue: (row) => (row.companyId ? companyName(row.companyId) : TEXT.wholeGroup),
      cell: (row) =>
        row.companyId ? <CompanyLink companyId={row.companyId} /> : <span>{TEXT.wholeGroup}</span>,
    },
    {
      id: 'source',
      header: TEXT.sourceCol,
      sortValue: (row) => row.source,
      exportValue: (row) => (row.source === 'idp' ? TEXT.sso : TEXT.dcc),
      cell: (row) =>
        row.source === 'idp' ? (
          <StatusChip label={TEXT.sso} tone="blue" />
        ) : (
          <span>{TEXT.dcc}</span>
        ),
    },
    {
      id: 'actions',
      header: TEXT.actionCol,
      cell: (row) => {
        if (isSelf) return <span className="rg-muted">{TEXT.removeSelf}</span>;
        if (row.source === 'idp') return <span className="rg-muted">{TEXT.removeSso}</span>;
        return (
          <GatedButton
            allowed={mayManageHere(row)}
            permission="user.manage"
            reason={TEXT.removeNoRight}
            compact
            className="text-link"
            label={TEXT.removeLabel(ROLE_LABELS[row.role], name)}
            onClick={() => setRemoving(row)}
          >
            {TEXT.removeBtn}
          </GatedButton>
        );
      },
    },
  ];

  const accountList = (list: SocialAccountDto[]) =>
    list.length === 0 ? (
      <span className="rg-muted">{TEXT.nothing}</span>
    ) : (
      <ul className="rg-plain-list rg-flat">
        {list.map((a) => (
          <li key={a.id}>
            <AccountLink account={a} />
          </li>
        ))}
      </ul>
    );

  return (
    <>
      <PageHeader
        eyebrow="Person"
        title={name}
        description={TEXT.detailDescription(user.email)}
        crumbs={[{ label: TEXT.people_, onClick: () => open('access') }, { label: name }]}
        meta={
          <>
            <StatusChip status={USER_STATUS[user.status]} />
            <CopyId value={user.id} label="Copy person id" />
          </>
        }
        actions={
          <>
            <GatedButton
              allowed={can('user.manage') || canAtGroup(me, 'user.manage')}
              permission="user.manage"
              reason={isSelf ? 'You cannot give a role to yourself.' : TEXT.giveReason}
              compact
              className="btn btn-primary"
              onClick={() => (isSelf ? undefined : setGranting(true))}
            >
              {TEXT.giveHere}
            </GatedButton>
            <GatedButton
              allowed={can('security.manage') && !isSelf}
              permission="security.manage"
              reason={isSelf ? TEXT.signOutSelf : needsRoleHint('security.manage')}
              compact
              className="btn btn-danger"
              onClick={() => setSigningOut(true)}
            >
              {TEXT.signOut}
            </GatedButton>
          </>
        }
      />
      <FactStrip>
        <Fact label={TEXT.factStatus} value={USER_STATUS[user.status].label} />
        <Fact label={TEXT.factRoles} value={user.memberships.length} />
        <Fact
          label={TEXT.factGroup}
          value={user.memberships.filter((m) => m.companyId === null).length}
        />
        <Fact label={TEXT.factOwned} value={accounts.data ? owned.length : TEXT.hidden} />
        <Fact label={TEXT.factBackup} value={accounts.data ? backed.length : TEXT.hidden} />
        <Fact
          label={TEXT.factAssigned}
          value={assigned.data ? assignedAccounts.length : TEXT.hidden}
        />
      </FactStrip>
      {endedResult !== null && (
        <div className="rg-gap-below">
          <Callout tone="ok" title={TEXT.signOutTitle}>
            {TEXT.signOutResult(endedResult)}
          </Callout>
        </div>
      )}
      <div className="kit-split">
        <div className="rg-stack">
          <SectionPanel title={TEXT.membershipsTitle} subtitle={TEXT.membershipsSubtitle}>
            <DataGrid
              caption={TEXT.membershipsCaption}
              columns={columns}
              rows={user.memberships}
              rowKey={(row) => row.id}
              defaultSort={{ id: 'role', direction: 'asc' }}
              empty={<EmptyState title={TEXT.noMemberships} />}
            />
            <p className="rg-note rg-gap">{TEXT.reauth}</p>
          </SectionPanel>
          <SectionPanel title={TEXT.canTitle} subtitle={TEXT.canSubtitle}>
            {permissions.size === 0 ? (
              <p className="rg-note">{TEXT.canNone}</p>
            ) : (
              <PermissionChips permissions={permissions} />
            )}
            {screenAllowed('roles') && (
              <p className="rg-note rg-gap">
                <RecordLink screen="roles">{TEXT.rolesPage}</RecordLink>
              </p>
            )}
          </SectionPanel>
        </div>
        <div className="rg-stack">
          <SectionPanel title={TEXT.accountsTitle} subtitle={TEXT.accountsSubtitle}>
            {!can('account.read') ? (
              <NoAccessNote permission="account.read" what={TEXT.accountsHidden} />
            ) : !accounts.data ? (
              <LoadingBlock lines={3} label={TEXT.loadingAccounts} />
            ) : (
              <DescriptionList
                columns={1}
                items={[
                  { label: TEXT.owns, value: accountList(owned) },
                  { label: TEXT.backsUp, value: accountList(backed) },
                  {
                    label: TEXT.assignedTo,
                    value: can('account.manage') ? (
                      assigned.data ? (
                        accountList(assignedAccounts)
                      ) : (
                        <LoadingBlock lines={1} />
                      )
                    ) : (
                      <span className="rg-muted">{needsRoleHint('account.manage')}</span>
                    ),
                  },
                ]}
              />
            )}
          </SectionPanel>
          <SectionPanel title={TEXT.dlName}>
            <DescriptionList
              columns={1}
              items={[
                { label: TEXT.dlName, value: user.displayName },
                { label: TEXT.dlEmail, value: user.email },
                {
                  label: TEXT.dlStatus,
                  value: <StatusChip status={USER_STATUS[user.status]} />,
                  hint: TEXT.dlStatusHint,
                },
                { label: TEXT.dlId, value: <CopyId value={user.id} label="Copy person id" /> },
              ]}
            />
          </SectionPanel>
          {can('audit.read') && (
            <SectionPanel title={TEXT.auditTitle}>
              <p className="rg-note">{TEXT.auditBody}</p>
              <p className="rg-gap">
                <RecordLink
                  screen="audit"
                  params={{ actorUserId: user.id }}
                  className="btn btn-outline"
                >
                  {TEXT.auditOpen}
                </RecordLink>
              </p>
            </SectionPanel>
          )}
          <SectionPanel title={TEXT.signOutTitle}>
            <p className="rg-note">{TEXT.signOutBody}</p>
            <p className="rg-note">{TEXT.signInNote}</p>
          </SectionPanel>
        </div>
      </div>
      {granting && (
        <GrantDialog
          presetUserId={user.id}
          onClose={() => setGranting(false)}
          onSaved={() => {
            setGranting(false);
            reloadPeople();
          }}
        />
      )}
      {removing && (
        <RemoveRoleDialog
          user={user}
          membership={removing}
          onlyGroupAdmin={
            removing.role === 'group_admin' && removing.companyId === null && groupAdmins <= 1
          }
          onClose={() => setRemoving(null)}
          onDone={reloadPeople}
        />
      )}
      {signingOut && (
        <EndSessionsDialog
          user={user}
          isSelf={isSelf}
          onClose={() => setSigningOut(false)}
          onDone={setEndedResult}
        />
      )}
    </>
  );
}
