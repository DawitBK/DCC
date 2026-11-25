'use client';

import { Fragment, useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { MeResponse, Permission } from '@dcc/contracts';
import { initials } from '@/lib/format';
import type { WorkspaceScreen } from '@/lib/workspace-routes';
import { actingRoleLabel } from './role-chooser';
import { ThemeToggle } from './theme-toggle';

/** `permission`: one, or several where holding any of them is enough. */
export type NavEntry = {
  id: WorkspaceScreen;
  label: string;
  icon: string;
  permission?: Permission | Permission[];
  group: string;
};

export function allowed(me: MeResponse, entry: NavEntry | undefined): boolean {
  if (!entry?.permission) return true;
  const needed = Array.isArray(entry.permission) ? entry.permission : [entry.permission];
  return needed.some((permission) => me.permissions.includes(permission));
}

/** The menu, in groups. An entry is shown only to people who hold its permission somewhere (the API still decides). */
export const NAV: NavEntry[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦', group: 'Overview' },
  { id: 'myWork', label: 'My work', icon: '☑', group: 'Overview' },
  { id: 'notifications', label: 'Notifications', icon: '◉', group: 'Overview' },
  {
    id: 'composer',
    label: 'Create content',
    icon: '＋',
    permission: 'content.create',
    group: 'Content',
  },
  {
    id: 'content',
    label: 'Content library',
    icon: '▤',
    permission: 'content.read',
    group: 'Content',
  },
  {
    id: 'approvals',
    label: 'Approvals',
    icon: '✓',
    permission: 'content.review',
    group: 'Content',
  },
  {
    id: 'calendar',
    label: 'Content calendar',
    icon: '▣',
    permission: 'content.read',
    group: 'Content',
  },
  {
    id: 'publishing',
    label: 'Publishing',
    icon: '◷',
    permission: ['content.publish', 'publishing.freeze'],
    group: 'Content',
  },
  { id: 'inbox', label: 'Unified inbox', icon: '✉', permission: 'inbox.read', group: 'Content' },
  {
    id: 'analytics',
    label: 'Analytics & reports',
    icon: '▥',
    permission: 'report.read',
    group: 'Insight',
  },
  {
    id: 'accounts',
    label: 'Social accounts',
    icon: '◎',
    permission: 'account.read',
    group: 'Registry',
  },
  {
    id: 'companies',
    label: 'Companies & brands',
    icon: '⌂',
    permission: 'company.read',
    group: 'Registry',
  },
  {
    id: 'engine',
    label: 'Publishing engine',
    icon: '⚙',
    permission: 'account.read',
    group: 'Registry',
  },
  {
    id: 'access',
    label: 'Access governance',
    icon: '♙',
    permission: 'user.read',
    group: 'Governance',
  },
  { id: 'roles', label: 'Roles & permissions', icon: '⚿', group: 'Governance' },
  {
    id: 'policies',
    label: 'Approval rules',
    icon: '⚖',
    permission: 'approval_policy.manage',
    group: 'Governance',
  },
  {
    id: 'incidents',
    label: 'Incidents',
    icon: '⚑',
    permission: 'incident.read',
    group: 'Governance',
  },
  {
    id: 'security',
    label: 'Security center',
    icon: '⬡',
    permission: 'security.read',
    group: 'Security',
  },
  { id: 'audit', label: 'Activity audit', icon: '≋', permission: 'audit.read', group: 'Security' },
  { id: 'profile', label: 'My profile & access', icon: '☺', group: 'Account' },
  { id: 'help', label: 'Help & guides', icon: '?', group: 'Account' },
];

const TEXT = {
  brandMark: 'DCC',
  brandName: 'Kerchanshe',
  brandSub: 'Digital Communications',
  mainNavigation: 'Main navigation',
  skipToContent: 'Skip to main content',
  closeNavigation: 'Close navigation',
  openNavigation: 'Open navigation',
  hideNavigation: 'Hide navigation',
  showNavigation: 'Show navigation',
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
  roleControl,
  session,
  accent = '#0e7c86',
  banner,
  badges,
  onOpenPalette,
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
  /** Replaces the plain role line under the name (the role switcher, for people with several roles). */
  roleControl?: ReactNode;
  /** Top-bar buttons right of the person's name (sign out, or the preview controls). */
  session: ReactNode;
  accent?: string;
  banner?: ReactNode;
  /** Small counts beside menu entries (approvals waiting, open incidents, unread notifications). */
  badges?: Partial<Record<WorkspaceScreen, number>>;
  /** Opens the search and jump palette (Ctrl+K). */
  onOpenPalette?: () => void;
  children: ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarHidden, setSidebarHidden] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);
  // Escape closes the phone menu and puts the focus back on its button.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setMenuOpen(false);
      menuButton.current?.focus();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [menuOpen]);
  const allowedNav = NAV.filter((item) => allowed(me, item));
  const roleLabel = actingRoleLabel(me) ?? TEXT.noRole;
  const person = me.user.displayName || me.user.email;

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">
        {TEXT.skipToContent}
      </a>
      <button
        aria-label={TEXT.closeNavigation}
        className={`mobile-overlay ${menuOpen ? 'is-open' : ''}`}
        tabIndex={menuOpen ? 0 : -1}
        onClick={() => setMenuOpen(false)}
      />
      <aside
        id="main-navigation"
        className={`sidebar ${menuOpen ? 'is-open' : ''} ${sidebarHidden ? 'is-hidden' : ''}`}
        aria-label={TEXT.mainNavigation}
      >
        <div className="brand-lockup">
          <div className="brand-mark">{TEXT.brandMark}</div>
          <div>
            <div className="brand-name">{TEXT.brandName}</div>
            <div className="brand-sub">{TEXT.brandSub}</div>
          </div>
        </div>
        <nav className="nav-list">
          {allowedNav.map((item, index) => (
            <Fragment key={item.id}>
              {allowedNav[index - 1]?.group !== item.group && (
                <div className="nav-group-label" role="presentation">
                  {item.group}
                </div>
              )}
              <button
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
                {badges?.[item.id] ? (
                  <span className="nav-badge" aria-label={`${badges[item.id]} waiting`}>
                    {badges[item.id]}
                  </span>
                ) : null}
              </button>
            </Fragment>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <strong style={{ color: 'white' }}>{TEXT.sidebarTitle}</strong>
          <br />
          {TEXT.sidebarBody}
        </div>
      </aside>
      <div className={`main-column ${sidebarHidden ? 'sidebar-hidden' : ''}`}>
        <header className="topbar">
          <div className="topbar-left">
            <button
              type="button"
              className="icon-button sidebar-toggle"
              aria-label={sidebarHidden ? TEXT.showNavigation : TEXT.hideNavigation}
              aria-controls="main-navigation"
              aria-expanded={!sidebarHidden}
              onClick={() => setSidebarHidden((value) => !value)}
            >
              <span aria-hidden="true">☰</span>
            </button>
            <button
              type="button"
              ref={menuButton}
              className="mobile-menu"
              aria-label={menuOpen ? TEXT.closeNavigation : TEXT.openNavigation}
              aria-expanded={menuOpen}
              aria-controls="main-navigation"
              onClick={() => setMenuOpen((value) => !value)}
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
            {onOpenPalette && (
              <button
                type="button"
                className="kit-search-button"
                onClick={onOpenPalette}
                title="Search and jump to a screen, company or account"
              >
                <span aria-hidden="true">⌕</span>
                <span className="kit-search-text">Search</span>
                <kbd className="kit-kbd">Ctrl K</kbd>
              </button>
            )}
            <ThemeToggle />
            {tools}
            <div className="user-avatar" aria-hidden="true">
              {initials(person)}
            </div>
            <div className="user-copy">
              <strong>{person}</strong>
              {roleControl ?? <span>{roleLabel}</span>}
            </div>
            {session}
          </div>
        </header>
        <main
          id="main-content"
          tabIndex={-1}
          className="content-wrap"
          style={{ '--workspace-accent': accent } as CSSProperties}
        >
          {banner}
          {children}
        </main>
      </div>
    </div>
  );
}
