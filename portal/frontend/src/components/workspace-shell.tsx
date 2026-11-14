'use client';

import { useState, type CSSProperties, type ReactNode } from 'react';
import { ROLE_LABELS, type MeResponse, type Permission } from '@dcc/contracts';
import { initials } from '@/lib/format';
import type { WorkspaceScreen } from '@/lib/workspace-routes';

/** `permission`: one, or several where holding any of them is enough. */
type NavEntry = {
  id: WorkspaceScreen;
  label: string;
  icon: string;
  permission?: Permission | Permission[];
};

function allowed(me: MeResponse, entry: NavEntry | undefined): boolean {
  if (!entry?.permission) return true;
  const needed = Array.isArray(entry.permission) ? entry.permission : [entry.permission];
  return needed.some((permission) => me.permissions.includes(permission));
}

/** The menu. An entry is shown only to people who hold its permission somewhere (the API still decides). */
const NAV: NavEntry[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'composer', label: 'Create content', icon: '＋', permission: 'content.create' },
  { id: 'approvals', label: 'Approvals', icon: '✓', permission: 'content.review' },
  { id: 'inbox', label: 'Unified inbox', icon: '✉', permission: 'inbox.read' },
  {
    id: 'publishing',
    label: 'Publishing',
    icon: '◷',
    permission: ['content.publish', 'publishing.freeze'],
  },
  { id: 'calendar', label: 'Content calendar', icon: '▣', permission: 'content.read' },
  { id: 'analytics', label: 'Analytics & reports', icon: '▤', permission: 'report.read' },
  { id: 'accounts', label: 'Social accounts', icon: '◎', permission: 'account.read' },
  { id: 'companies', label: 'Companies & brands', icon: '⌂', permission: 'company.read' },
  { id: 'access', label: 'Access governance', icon: '♙', permission: 'user.read' },
  { id: 'policies', label: 'Approval rules', icon: '⚖', permission: 'approval_policy.manage' },
  { id: 'audit', label: 'Activity audit', icon: '≋', permission: 'audit.read' },
  { id: 'security', label: 'Security center', icon: '⬡', permission: 'security.read' },
  { id: 'incidents', label: 'Incidents', icon: '⚑', permission: 'incident.read' },
];

const TEXT = {
  brandMark: 'DCC',
  brandName: 'Kerchanshe',
  brandSub: 'Digital Communications',
  workspace: 'Workspace',
  mainNavigation: 'Main navigation',
  closeNavigation: 'Close navigation',
  openNavigation: 'Open navigation',
  companyContext: 'Company context',
  sidebarTitle: 'DCC governance portal',
  sidebarBody: 'Approvals, publishing and account oversight in one place.',
  noRole: 'No DCC role assigned',
};

export type CompanyOption = { value: string; label: string };

/** True when the menu would show this screen to this person. */
export function screenAllowed(me: MeResponse, screen: WorkspaceScreen): boolean {
  return allowed(
    me,
    NAV.find((item) => item.id === screen),
  );
}

/**
 * The frame every screen sits in: side menu, top bar with the company switcher, and the content area.
 * It holds no data of its own, so the signed-in workspace and the dev-only role preview share it.
 */
export function WorkspaceShell({
  me,
  screen,
  onNavigate,
  contextLabel,
  companyValue,
  companyOptions,
  onCompanyChange,
  pill,
  tools,
  session,
  accent = '#0e7c86',
  banner,
  children,
}: {
  me: MeResponse;
  screen: WorkspaceScreen;
  onNavigate: (screen: WorkspaceScreen) => void;
  /** The small line above the company switcher. */
  contextLabel: string;
  companyValue: string;
  companyOptions: CompanyOption[];
  onCompanyChange: (value: string) => void;
  pill?: ReactNode;
  /** Top-bar tools left of the person's name (the notification bell). */
  tools?: ReactNode;
  /** Top-bar buttons right of the person's name (sign out, or the preview controls). */
  session: ReactNode;
  accent?: string;
  banner?: ReactNode;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const allowedNav = NAV.filter((item) => allowed(me, item));
  const role = me.memberships[0]?.role;
  const roleLabel = role ? ROLE_LABELS[role] : TEXT.noRole;
  const person = me.user.displayName || me.user.email;

  return (
    <div className="app-shell">
      <button
        aria-label={TEXT.closeNavigation}
        className={`mobile-overlay ${menuOpen ? 'is-open' : ''}`}
        tabIndex={menuOpen ? 0 : -1}
        onClick={() => setMenuOpen(false)}
      />
      <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`} aria-label={TEXT.mainNavigation}>
        <div className="brand-lockup">
          <div className="brand-mark">{TEXT.brandMark}</div>
          <div>
            <div className="brand-name">{TEXT.brandName}</div>
            <div className="brand-sub">{TEXT.brandSub}</div>
          </div>
        </div>
        <div className="workspace-label">{TEXT.workspace}</div>
        <nav className="nav-list">
          {allowedNav.map((item) => (
            <button
              key={item.id}
              className="nav-item"
              aria-current={screen === item.id ? 'page' : undefined}
              onClick={() => {
                setMenuOpen(false);
                onNavigate(item.id);
              }}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <strong style={{ color: 'white' }}>{TEXT.sidebarTitle}</strong>
          <br />
          {TEXT.sidebarBody}
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu"
              aria-label={TEXT.openNavigation}
              aria-expanded={menuOpen}
              onClick={() => setMenuOpen(true)}
            >
              ☰
            </button>
            <div className="company-context">
              <span className="company-context-label">{contextLabel}</span>
              <select
                className="company-select"
                aria-label={TEXT.companyContext}
                value={companyValue}
                onChange={(event) => onCompanyChange(event.target.value)}
              >
                {companyOptions.map((item) => (
                  <option key={item.value} value={item.value}>
                    {item.label}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="topbar-right">
            {pill}
            {tools}
            <div className="user-avatar" aria-hidden="true">
              {initials(person)}
            </div>
            <div className="user-copy">
              <strong>{person}</strong>
              <span>{roleLabel}</span>
            </div>
            {session}
          </div>
        </header>
        <main className="content-wrap" style={{ '--workspace-accent': accent } as CSSProperties}>
          {banner}
          {children}
        </main>
      </div>
    </div>
  );
}
