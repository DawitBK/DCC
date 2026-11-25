'use client';

import { useMemo, useState } from 'react';
import {
  COMPANY_ONLY_ROLES,
  EITHER_SCOPE_ROLES,
  GROUP_ONLY_ROLES,
  PERMISSIONS,
  ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type Permission,
  type Role,
} from '@dcc/contracts';
import { PageHeader } from '@/components/kit/page-header';
import { Callout } from '@/components/kit/parts';
import { TabPanel, Tabs, useTabParam } from '@/components/kit/tabs';
import { ROLE_SUMMARY } from '@/lib/labels';
import { PERMISSION_TEXT, holdersOf } from '@/lib/permissions-ui';
import { useWorkspace } from '@/lib/workspace';

const TEXT = {
  title: 'Roles and permissions',
  description:
    'What each role may do in DCC, from the one table the system itself uses. Nothing here is a copy: if the table changes, this page changes with it.',
  tabsLabel: 'Roles and permissions views',
  tabs: { matrix: 'Role by permission', byRole: 'What each role can do', rules: 'Fixed rules' },
  yours: 'Your role',
  you: 'You hold this role',
  yes: 'Yes',
  no: 'No',
  filterArea: 'Area',
  allAreas: 'All areas',
  scopeGroup: 'Group level: applies to every company of the Group',
  scopeCompany: 'Company level: applies to one company only',
  scopeEither: 'Either: the whole Group or one company',
  canDo: 'Can do',
  cannotDo: 'Cannot do',
  holders: 'Held by',
  rulesIntro:
    'These rules sit on top of the table. They are checked by the backend on every request and cannot be switched off from any screen.',
  caption: 'Which role holds which permission',
  permissionHeading: 'Permission',
};

const AREAS: Record<string, string> = {
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

const RULES: { title: string; body: string }[] = [
  {
    title: 'Nobody decides on their own words',
    body: 'A person who wrote any version of a post can never review, approve or reject it, whatever role they hold. This is checked on every decision.',
  },
  {
    title: 'A company never reaches another company',
    body: 'Company-level roles apply to one company only. Only a group-level role reaches every company of the Group, and that is always on the record.',
  },
  {
    title: 'Sensitive actions need a recent sign-in',
    body: 'Giving or removing a role, ending a person’s sessions, lifting a publishing freeze, setting or removing an approval rule and exporting the audit trail ask you to sign in again at the single sign-on if your last sign-in is older than the window shown in the Security center.',
  },
  {
    title: 'Nothing is published except through DCC',
    body: 'The publishing engine only carries out what DCC approved. A post goes out only if it is approved, its company is active, no freeze is on and its account is connected to the engine.',
  },
  {
    title: 'Hiding a button is never the protection',
    body: 'The screens show what your role can do, but the backend checks every request again. A control that is greyed out explains who can use it.',
  },
  {
    title: 'You cannot grant yourself a role',
    body: 'Even a company administrator cannot give themselves another role. The last group administrator cannot be removed.',
  },
];

function scopeOf(role: Role): string {
  if ((GROUP_ONLY_ROLES as readonly string[]).includes(role)) return TEXT.scopeGroup;
  if ((COMPANY_ONLY_ROLES as readonly string[]).includes(role)) return TEXT.scopeCompany;
  if ((EITHER_SCOPE_ROLES as readonly string[]).includes(role)) return TEXT.scopeEither;
  return '';
}

const areaOf = (permission: Permission) => permission.split('.')[0]!;

/** Roles by permissions, read from the table the backend uses (`ROLE_PERMISSIONS`). Visible to everybody. */
export function RolesScreen() {
  const { me } = useWorkspace();
  const mine = useMemo(() => new Set(me.roles), [me.roles]);
  const [tab, setTab] = useTabParam(['matrix', 'byRole', 'rules'], 'matrix');
  const [area, setArea] = useState('');
  const permissions = useMemo(
    () => PERMISSIONS.filter((permission) => !area || areaOf(permission) === area),
    [area],
  );

  return (
    <div className="kit-stack">
      <PageHeader title={TEXT.title} description={TEXT.description} />
      <Tabs
        label={TEXT.tabsLabel}
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'matrix', label: TEXT.tabs.matrix, count: ROLES.length },
          { id: 'byRole', label: TEXT.tabs.byRole },
          { id: 'rules', label: TEXT.tabs.rules, count: RULES.length },
        ]}
      />

      {tab === 'matrix' && (
        <TabPanel id="matrix">
          <div className="kit-toolbar" style={{ marginBottom: 12 }}>
            <div className="kit-filter">
              <label className="visually-hidden" htmlFor="roles-area">
                {TEXT.filterArea}
              </label>
              <select
                id="roles-area"
                className="select-field"
                value={area}
                onChange={(e) => setArea(e.target.value)}
              >
                <option value="">{`${TEXT.filterArea}: ${TEXT.allAreas}`}</option>
                {Object.entries(AREAS).map(([key, label]) => (
                  <option key={key} value={key}>
                    {label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="table-wrap" role="region" aria-label={TEXT.caption} tabIndex={0}>
            <table className="kit-table kit-matrix">
              <caption className="visually-hidden">{TEXT.caption}</caption>
              <thead>
                <tr>
                  <th scope="col">{TEXT.permissionHeading}</th>
                  {ROLES.map((role) => (
                    <th key={role} scope="col" aria-label={ROLE_LABELS[role]}>
                      <span>{ROLE_LABELS[role]}</span>
                      {mine.has(role) && (
                        <small className="hint" style={{ display: 'block' }}>
                          {TEXT.yours}
                        </small>
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {permissions.map((permission) => (
                  <tr key={permission}>
                    <th scope="row">
                      <strong>{PERMISSION_TEXT[permission].label}</strong>
                      <small className="hint" style={{ display: 'block' }}>
                        {AREAS[areaOf(permission)]} · <code>{permission}</code>
                      </small>
                    </th>
                    {ROLES.map((role) => {
                      const has = ROLE_PERMISSIONS[role].includes(permission);
                      return (
                        <td key={role} className={mine.has(role) ? 'kit-mine' : undefined}>
                          <span className={has ? 'kit-yes' : 'kit-no'}>{has ? '✓' : '—'}</span>
                          <span className="visually-hidden">{has ? TEXT.yes : TEXT.no}</span>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </TabPanel>
      )}

      {tab === 'byRole' && (
        <TabPanel id="byRole">
          <div className="grid grid-2">
            {ROLES.map((role) => {
              const has = ROLE_PERMISSIONS[role];
              const lacks = PERMISSIONS.filter((permission) => !has.includes(permission));
              return (
                <section key={role} className="panel" aria-labelledby={`role-${role}`}>
                  <div className="panel-header">
                    <div>
                      <h2 id={`role-${role}`}>{ROLE_LABELS[role]}</h2>
                      <p>{ROLE_SUMMARY[role]}</p>
                    </div>
                    {mine.has(role) && <span className="status status-green">{TEXT.you}</span>}
                  </div>
                  <p className="hint">{scopeOf(role)}</p>
                  <h3>{TEXT.canDo}</h3>
                  <ul className="plain-list">
                    {has.map((permission) => (
                      <li key={permission}>
                        <strong>{PERMISSION_TEXT[permission].label}</strong>:{' '}
                        {PERMISSION_TEXT[permission].description}
                      </li>
                    ))}
                  </ul>
                  {lacks.length > 0 && (
                    <>
                      <h3>{TEXT.cannotDo}</h3>
                      <p className="hint">
                        {lacks.map((permission) => PERMISSION_TEXT[permission].label).join(', ')}.
                      </p>
                    </>
                  )}
                </section>
              );
            })}
          </div>
        </TabPanel>
      )}

      {tab === 'rules' && (
        <TabPanel id="rules">
          <p>{TEXT.rulesIntro}</p>
          <div className="kit-stack" style={{ marginTop: 12 }}>
            {RULES.map((rule) => (
              <Callout key={rule.title} tone="info" title={rule.title}>
                {rule.body}
              </Callout>
            ))}
            <section className="panel">
              <div className="panel-header">
                <div>
                  <h2>{TEXT.holders}</h2>
                  <p>Who holds each permission today.</p>
                </div>
              </div>
              <ul className="plain-list">
                {PERMISSIONS.map((permission) => (
                  <li key={permission}>
                    <strong>{PERMISSION_TEXT[permission].label}</strong>:{' '}
                    {holdersOf(permission)
                      .map((role) => ROLE_LABELS[role])
                      .join(', ')}
                  </li>
                ))}
              </ul>
            </section>
          </div>
        </TabPanel>
      )}
    </div>
  );
}
