'use client';

import { useRouter } from 'next/navigation';
import { PERMISSIONS, ROLE_LABELS, type Permission, type SecurityPostureDto } from '@dcc/contracts';
import { PageHeader } from '@/components/kit/page-header';
import { Callout, DescriptionList } from '@/components/kit/parts';
import { RoleSwitcher, actingRoleLabel, rolesOf } from '@/components/role-chooser';
import { SignOutButton } from '@/components/sign-out-button';
import { ThemeToggle } from '@/components/theme-toggle';
import { ROLE_SUMMARY } from '@/lib/labels';
import { PERMISSION_TEXT, whoCanText } from '@/lib/permissions-ui';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';

const TEXT = {
  title: 'My profile and access',
  description:
    'Who you are in DCC, the roles you hold, what each lets you do and what it does not, and the rules for your session.',
  who: 'You',
  facts: {
    name: 'Name',
    email: 'Work email',
    acting: 'Working as',
    theme: 'Theme',
    session: 'Session',
  },
  allRoles: 'All of your roles together',
  rolesHeading: 'Your roles',
  rolesBody:
    'A group-level role reaches every company of the Group; a company-level role reaches that one company.',
  group: 'Whole Group',
  switchHeading: 'Choose how you work',
  switchBody:
    'With more than one role you can work as one of them, so you only see and can do what that role allows. Choose all roles together to see everything you hold.',
  oneRole: 'You hold one role, so there is nothing to switch.',
  canHeading: 'What you can do now',
  cannotHeading: 'What you cannot do, and who can',
  none: 'Nothing',
  sessionHeading: 'Your session',
  sessionBody:
    'DCC signs you out after a period with no activity, and some actions ask you to sign in again at the single sign-on first. An open page left alone does not keep your session alive.',
  twoFactor: 'Two-factor sign-in',
  reauth: 'Sign in again for sensitive actions',
  reauthValue: (minutes: number) => `after ${minutes} minutes`,
  enforced: 'Required',
  notEnforced: 'Not required in this environment',
  postureNote: 'Read from the security center, which your role may open.',
  noPosture:
    'The exact times are shown in the Security center, which your role cannot open. Ask a security administrator.',
  signOut: 'Sign out',
  signOutBody: 'Signing out of DCC also signs you out of the single sign-on.',
};

const AREA: Record<string, string> = {
  company: 'Companies',
  brand: 'Brands',
  user: 'People and roles',
  account: 'Social accounts',
  content: 'Content and approvals',
  approval_policy: 'Approval rules',
  publishing: 'Publishing',
  audit: 'Audit',
  security: 'Security',
  incident: 'Incidents',
  report: 'Reports',
  inbox: 'Inbox',
};

function grouped(list: readonly Permission[]) {
  const byArea = new Map<string, Permission[]>();
  for (const permission of list) {
    const key = permission.split('.')[0]!;
    byArea.set(key, [...(byArea.get(key) ?? []), permission]);
  }
  return [...byArea];
}

/** The signed-in person: roles with their reach, what the roles allow and refuse, and the session rules. */
export function ProfileScreen() {
  const router = useRouter();
  const { me, can, companyName } = useWorkspace();
  const posture = useApiData<SecurityPostureDto>(can('security.read') ? '/security/posture' : null);
  const roles = rolesOf(me);
  const allowed = PERMISSIONS.filter((permission) => me.permissions.includes(permission));
  const refused = PERMISSIONS.filter((permission) => !me.permissions.includes(permission));

  return (
    <div className="kit-stack">
      <PageHeader title={TEXT.title} description={TEXT.description} actions={<SignOutButton />} />
      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{TEXT.who}</h2>
          </div>
        </div>
        <DescriptionList
          items={[
            { label: TEXT.facts.name, value: me.user.displayName || me.user.email },
            { label: TEXT.facts.email, value: me.user.email },
            { label: TEXT.facts.acting, value: actingRoleLabel(me) ?? TEXT.allRoles },
            { label: TEXT.facts.theme, value: <ThemeToggle /> },
          ]}
        />
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{TEXT.rolesHeading}</h2>
            <p>{TEXT.rolesBody}</p>
          </div>
        </div>
        <ul className="kit-todo">
          {me.roles.length === 0 && <li>{TEXT.none}</li>}
          {[...new Set(me.roles)].map((role) => (
            <li key={role}>
              <div className="kit-todo-main">
                <strong>{ROLE_LABELS[role]}</strong>
                <small>{ROLE_SUMMARY[role]}</small>
              </div>
              <span className="status status-blue">
                {me.memberships
                  .filter((m) => m.role === role)
                  .map((m) => (m.companyId ? companyName(m.companyId) : TEXT.group))
                  .join(', ') || TEXT.group}
              </span>
            </li>
          ))}
        </ul>
        <h3>{TEXT.switchHeading}</h3>
        <p className="hint">{roles.length > 1 ? TEXT.switchBody : TEXT.oneRole}</p>
        {roles.length > 1 && <RoleSwitcher me={me} onChanged={() => router.refresh()} />}
      </section>

      <div className="grid grid-2">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{TEXT.canHeading}</h2>
            </div>
          </div>
          {allowed.length === 0 && <p>{TEXT.none}</p>}
          {grouped(allowed).map(([area, list]) => (
            <div key={area}>
              <h3>{AREA[area]}</h3>
              <ul className="plain-list">
                {list.map((permission) => (
                  <li key={permission}>
                    <strong>{PERMISSION_TEXT[permission].label}</strong>:{' '}
                    {PERMISSION_TEXT[permission].description}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>{TEXT.cannotHeading}</h2>
            </div>
          </div>
          {refused.length === 0 && <p>{TEXT.none}</p>}
          <ul className="plain-list">
            {refused.map((permission) => (
              <li key={permission}>
                <strong>{PERMISSION_TEXT[permission].label}</strong>: {whoCanText(permission)}
              </li>
            ))}
          </ul>
        </section>
      </div>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>{TEXT.sessionHeading}</h2>
            <p>{TEXT.sessionBody}</p>
          </div>
        </div>
        {posture.data ? (
          <DescriptionList
            items={[
              {
                label: TEXT.twoFactor,
                value: posture.data.twoFactorSignIn.enforced ? TEXT.enforced : TEXT.notEnforced,
                hint: posture.data.twoFactorSignIn.note,
              },
              {
                label: TEXT.reauth,
                value: TEXT.reauthValue(posture.data.sensitiveActions.signInAgainAfterMinutes),
                hint: TEXT.postureNote,
              },
            ]}
          />
        ) : (
          <Callout title={TEXT.sessionHeading}>
            {can('security.read') ? '…' : TEXT.noPosture}
          </Callout>
        )}
        <p className="hint" style={{ marginTop: 12 }}>
          {TEXT.signOutBody}
        </p>
      </section>
    </div>
  );
}
