'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import {
  ROLE_LABELS,
  type BrandDto,
  type CompanyDto,
  type MeResponse,
  type Permission,
  type SocialAccountDto,
} from '@dcc/contracts';
import { apiFetch } from '@/lib/browser-api';
import {
  DEMO_ACCOUNTS,
  DEMO_ACTIVITY,
  DEMO_AUDIT,
  DEMO_COMPANIES,
  DEMO_COMPANY_CONFIG,
  DEMO_GROUP_NAME,
  DEMO_PEOPLE,
  DEMO_POSTS,
  type DemoPost,
  type DemoStatus,
} from '@/lib/demo-data';
import { screenForPath, WORKSPACE_ROUTES, type WorkspaceScreen } from '@/lib/workspace-routes';
import { AnalyticsScreen } from './analytics-screen';

type Screen = WorkspaceScreen;
type NavEntry = {
  id?: Screen;
  label: string;
  icon: string;
  permission?: Permission;
  comingSoon?: boolean;
};
const NAV: NavEntry[] = [
  { id: 'dashboard', label: 'Dashboard', icon: '▦' },
  { id: 'composer', label: 'Create content', icon: '＋', permission: 'content.create' },
  { id: 'approvals', label: 'Approvals', icon: '✓', permission: 'content.review' },
  { id: 'inbox', label: 'Unified inbox', icon: '✉', permission: 'account.read' },
  { id: 'publishing', label: 'Publishing', icon: '◷', permission: 'content.publish' },
  { id: 'calendar', label: 'Content calendar', icon: '▣', permission: 'content.read' },
  { id: 'analytics', label: 'Analytics & reports', icon: '▤', permission: 'report.read' },
  { id: 'accounts', label: 'Social accounts', icon: '◎', permission: 'account.read' },
  { id: 'companies', label: 'Companies & brands', icon: '⌂', permission: 'company.read' },
  { id: 'access', label: 'Access governance', icon: '♙', permission: 'user.read' },
  { id: 'audit', label: 'Activity audit', icon: '≋', permission: 'audit.read' },
  { id: 'security', label: 'Security center', icon: '⬡', permission: 'security.read' },
  { id: 'incidents', label: 'Incidents', icon: '⚑', permission: 'incident.read' },
];

const STATUS_CLASS: Record<DemoStatus | string, string> = {
  'Needs review': 'status-amber',
  'Changes requested': 'status-red',
  Approved: 'status-green',
  Scheduled: 'status-blue',
  Published: 'status-green',
  Draft: 'status-gray',
  Connected: 'status-green',
  'Needs attention': 'status-amber',
  Disconnected: 'status-red',
  Active: 'status-green',
  High: 'status-red',
  Medium: 'status-amber',
  Low: 'status-blue',
  Open: 'status-red',
  Investigating: 'status-amber',
  Resolved: 'status-green',
};
const PLATFORM_NAMES = ['Facebook', 'Instagram', 'LinkedIn', 'X', 'YouTube', 'TikTok'];

export function DccWorkspace({
  me,
  initialScreen = 'dashboard',
  initialCompanyId,
  initialCompanyName,
  demoMode = false,
  onSwitchPreviewRole,
  onExitPreview,
}: {
  me: MeResponse;
  initialScreen?: Screen;
  initialCompanyId?: string;
  initialCompanyName?: string;
  demoMode?: boolean;
  onSwitchPreviewRole?: () => void;
  onExitPreview?: () => void;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const [previewScreen, setPreviewScreen] = useState<Screen>(initialScreen);
  const screen = demoMode ? previewScreen : (screenForPath(pathname) ?? initialScreen);
  const [company, setCompany] = useState(initialCompanyName ?? DEMO_COMPANIES[0]);
  const [liveCompanies, setLiveCompanies] = useState<CompanyDto[] | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [toast, setToast] = useState('');
  const [posts, setPosts] = useState(DEMO_POSTS);
  const [modal, setModal] = useState<{ title: string; body: string; action?: () => void } | null>(
    null,
  );

  const allowedNav = NAV.filter(
    (item) => !item.permission || me.permissions.includes(item.permission),
  );
  const role = me.memberships[0]?.role;
  const roleLabel = role ? ROLE_LABELS[role] : 'No DCC role assigned';
  const isGroupScope = me.memberships.some((membership) => membership.companyId === null);
  const companyNames = liveCompanies
    ? liveCompanies.map((item) => item.name)
    : demoMode && !isGroupScope
      ? [initialCompanyName ?? DEMO_COMPANY_CONFIG[0].name]
      : isGroupScope
        ? DEMO_COMPANIES.slice(1)
        : [DEMO_COMPANIES[1]];
  const companyChoices = isGroupScope ? ['All companies', ...companyNames] : companyNames;
  useEffect(() => {
    if (demoMode) {
      setLiveCompanies(null);
      return;
    }
    let current = true;
    apiFetch<CompanyDto[]>('/companies')
      .then((items) => {
        if (!current) return;
        setLiveCompanies(items);
        const chosen = items.find((item) => item.id === initialCompanyId);
        if (chosen) setCompany(chosen.name);
        else if (!me.memberships.some((membership) => membership.companyId === null) && items[0])
          setCompany(items[0].name);
      })
      .catch(() => {
        if (current) setLiveCompanies(null);
      });
    return () => {
      current = false;
    };
  }, [demoMode, initialCompanyId, initialCompanyName, me.memberships]);
  const showToast = (message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(''), 3200);
  };
  const chooseCompany = (next: string) => {
    setCompany(next);
    if (demoMode) return;
    const url = new URL(window.location.href);
    if (next === 'All companies') {
      url.searchParams.delete('company');
      url.searchParams.delete('companyId');
    } else {
      const selected = liveCompanies?.find((item) => item.name === next);
      if (selected) url.searchParams.set('companyId', selected.id);
      else url.searchParams.set('company', next.toLowerCase().replaceAll(' ', '-'));
      url.searchParams.delete('company');
    }
    router.replace(`${pathname}${url.search}`, { scroll: false });
  };
  const changeScreen = (next: Screen) => {
    setMenuOpen(false);
    if (demoMode) {
      setPreviewScreen(next);
      return;
    }
    router.push(`/${WORKSPACE_ROUTES[next]}`);
  };

  if (me.memberships.length === 0) {
    return (
      <main className="empty-state" style={{ minHeight: '100vh' }}>
        <div>
          <div className="brand-mark" style={{ margin: '0 auto 18px' }}>
            DCC
          </div>
          <strong>You’re signed in, but don’t have a DCC role yet.</strong>
          <p>Ask a DCC administrator to assign your role and company access.</p>
          <div style={{ marginTop: 20 }}>
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="app-shell">
      <button
        aria-label="Close navigation"
        className={`mobile-overlay ${menuOpen ? 'is-open' : ''}`}
        onClick={() => setMenuOpen(false)}
      />
      <aside className={`sidebar ${menuOpen ? 'is-open' : ''}`} aria-label="Main navigation">
        <div className="brand-lockup">
          <div className="brand-mark">DCC</div>
          <div>
            <div className="brand-name">Kerchanshe</div>
            <div className="brand-sub">Digital Communications</div>
          </div>
        </div>
        <div className="workspace-label">Workspace</div>
        <nav className="nav-list">
          {allowedNav.map((item) => (
            <button
              key={item.id ?? item.label}
              className="nav-item"
              aria-current={item.id && screen === item.id ? 'page' : undefined}
              disabled={item.comingSoon}
              onClick={() => item.id && changeScreen(item.id)}
            >
              <span className="nav-icon" aria-hidden="true">
                {item.icon}
              </span>
              {item.label}
              {item.comingSoon && <span className="nav-soon">Coming soon</span>}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <strong style={{ color: 'white' }}>DCC governance portal</strong>
          <br />
          Approvals, publishing and account oversight in one place.
        </div>
      </aside>
      <div className="main-column">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="mobile-menu"
              aria-label="Open navigation"
              onClick={() => setMenuOpen(true)}
            >
              ☰
            </button>
            <div className="company-context">
              <span className="company-context-label">
                {company === 'All companies' ? DEMO_GROUP_NAME : 'Company workspace'}
              </span>
              <select
                className="company-select"
                aria-label="Company context"
                value={company}
                onChange={(event) => chooseCompany(event.target.value)}
              >
                {companyChoices.map((item) => (
                  <option key={item} value={item}>
                    {item === 'All companies' ? `${DEMO_GROUP_NAME} · All companies` : item}
                  </option>
                ))}
              </select>
            </div>
          </div>
          <div className="topbar-right">
            {demoMode && <span className="demo-mode-pill">DEMO PREVIEW</span>}
            <button
              className="icon-button"
              aria-label="Notifications"
              onClick={() => showToast('You’re all caught up in this demo workspace.')}
            >
              ♧
            </button>
            <div className="user-avatar" aria-hidden="true">
              {initials(me.user.displayName || me.user.email)}
            </div>
            <div className="user-copy">
              <strong>{me.user.displayName || me.user.email}</strong>
              <span>{roleLabel}</span>
            </div>
            {demoMode ? (
              <>
                <button className="btn btn-outline preview-switch" onClick={onSwitchPreviewRole}>
                  Switch role
                </button>
                <button className="btn btn-outline preview-exit" onClick={onExitPreview}>
                  Exit preview
                </button>
              </>
            ) : (
              <SignOutButton compact />
            )}
          </div>
        </header>
        <main
          className="content-wrap"
          style={
            {
              '--workspace-accent':
                DEMO_COMPANY_CONFIG.find((item) => item.name === company)?.accent ?? '#0e7c86',
            } as React.CSSProperties
          }
        >
          <div className={`demo-banner ${demoMode ? 'preview-banner' : ''}`}>
            <span aria-hidden="true">ⓘ</span>
            <div>
              <strong>
                {demoMode ? 'DEMO PREVIEW · Frontend only' : 'Preview interface · Demo workflows'}
              </strong>
              {demoMode
                ? 'This sample role and its data are local to your browser. No DCC APIs or authentication sessions are used.'
                : 'Read-only company, account and audit data may come from DCC APIs. Unconnected workflows use sample data; actions here never publish content or record live approvals.'}
            </div>
          </div>
          {screen === 'dashboard' && (
            <Dashboard me={me} company={company} posts={posts} go={changeScreen} />
          )}
          {screen === 'composer' && (
            <Composer
              company={company}
              onSave={(title, selectedCompany) => {
                setPosts((current) => [
                  {
                    id: `DCC-${1050 + current.length}`,
                    title,
                    company:
                      selectedCompany === 'All companies'
                        ? DEMO_COMPANY_CONFIG[0].name
                        : selectedCompany,
                    creator: me.user.displayName || 'You',
                    platforms: ['Instagram'],
                    status: 'Draft',
                    date: '2026-11-17',
                    time: '09:00',
                    caption: 'Sample caption saved from the demo composer.',
                  },
                  ...current,
                ]);
                showToast('Draft saved in this demo only.');
              }}
              onSubmit={(title, selectedCompany) => {
                setPosts((current) => [
                  {
                    id: `DCC-${1050 + current.length}`,
                    title,
                    company:
                      selectedCompany === 'All companies'
                        ? DEMO_COMPANY_CONFIG[0].name
                        : selectedCompany,
                    creator: me.user.displayName || 'You',
                    platforms: ['Instagram'],
                    status: 'Needs review',
                    date: '2026-11-17',
                    time: '09:00',
                    caption: 'Sample submission from the demo composer.',
                  },
                  ...current,
                ]);
                showToast(
                  'Sample draft moved to the review queue. Nothing was sent to the backend.',
                );
              }}
            />
          )}
          {screen === 'approvals' && (
            <Approvals
              company={company}
              posts={posts}
              update={(id, status) => {
                setPosts((current) =>
                  current.map((post) => (post.id === id ? { ...post, status } : post)),
                );
                showToast(`Demo status changed to “${status}”.`);
              }}
            />
          )}
          {screen === 'publishing' && (
            <Publishing
              company={company}
              posts={posts}
              onAction={() => showToast('Publishing action simulated. No network post was made.')}
            />
          )}
          {screen === 'calendar' && (
            <Calendar
              company={company}
              posts={posts}
              showToast={showToast}
              onReschedule={(id, date, time) => {
                setPosts((current) =>
                  current.map((post) => (post.id === id ? { ...post, date, time } : post)),
                );
                showToast('Sample schedule updated in this browser only.');
              }}
            />
          )}
          {screen === 'analytics' && (
            <AnalyticsScreen company={company} isGroupAdmin={role === 'group_admin'} />
          )}
          {screen === 'accounts' && (
            <Accounts company={company} liveCompanies={liveCompanies} demoMode={demoMode} />
          )}
          {screen === 'companies' && <Companies company={company} liveCompanies={liveCompanies} />}
          {screen === 'access' && <Access company={company} />}
          {screen === 'audit' && (
            <Audit company={company} liveCompanies={liveCompanies} demoMode={demoMode} />
          )}
          {screen === 'security' && <Security />}
          {screen === 'incidents' && <Incidents />}
          {screen === 'inbox' && <Inbox />}
        </main>
      </div>
      {toast && (
        <div role="status" aria-live="polite" className="toast">
          {toast}
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setModal(null);
          }}
        >
          <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title">
            <h2 id="modal-title">{modal.title}</h2>
            <p>{modal.body}</p>
            <div className="modal-actions">
              <button className="btn btn-outline" onClick={() => setModal(null)}>
                Close
              </button>
              {modal.action && (
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    modal.action?.();
                    setModal(null);
                  }}
                >
                  Confirm demo action
                </button>
              )}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}

function initials(value: string) {
  return (
    value
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0].toUpperCase())
      .join('') || 'D'
  );
}
function PageTitle({
  eyebrow = 'DCC workspace',
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="page-heading">
      <div>
        <p className="eyebrow">{eyebrow}</p>
        <h1>{title}</h1>
        <p>{description}</p>
      </div>
      {action && <div className="heading-actions">{action}</div>}
    </div>
  );
}
function DemoStatusChip({ value }: { value: string }) {
  return <span className={`status ${STATUS_CLASS[value] ?? 'status-gray'}`}>{value}</span>;
}
function StatCard({
  label,
  value,
  change,
  icon,
}: {
  label: string;
  value: string;
  change: string;
  icon: string;
}) {
  return (
    <article className="stat-card">
      <div className="stat-top">
        <span>{label}</span>
        <span className="stat-icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="stat-value">{value}</div>
      <div className="stat-foot">
        <span className="positive">{change}</span> vs. previous 30 days
      </div>
    </article>
  );
}
function SectionPanel({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="panel">
      <div className="panel-header">
        <div>
          <h2>{title}</h2>
          {subtitle && <p>{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
function SignOutButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`btn ${compact ? 'btn-outline' : 'btn-dark'}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const response = await fetch(
            `${process.env.NEXT_PUBLIC_DCC_BASE_PATH ?? ''}/api/auth/logout`,
            { method: 'POST', credentials: 'same-origin' },
          );
          const body = (await response.json().catch(() => ({}))) as { logoutUrl?: string | null };
          window.location.href =
            body.logoutUrl ?? `${process.env.NEXT_PUBLIC_DCC_BASE_PATH ?? ''}/`;
        } catch {
          window.location.href = `${process.env.NEXT_PUBLIC_DCC_BASE_PATH ?? ''}/`;
        }
      }}
    >
      {busy ? 'Signing out…' : compact ? 'Sign out' : 'Sign out of DCC'}
    </button>
  );
}

function Dashboard({
  me,
  company,
  posts,
  go,
}: {
  me: MeResponse;
  company: string;
  posts: DemoPost[];
  go: (screen: Screen) => void;
}) {
  const primaryRole = me.memberships[0]?.role;
  const groupAdmin = primaryRole === 'group_admin';
  const isCreator = primaryRole === 'content_creator';
  const isReviewer = primaryRole === 'content_reviewer';
  const companyIndex = DEMO_COMPANY_CONFIG.findIndex((item) => item.name === company);
  const workspacePosts = posts.filter(
    (post) => company === 'All companies' || post.company === company,
  );
  const countScale =
    company === 'All companies' ? 1 : 0.12 + (Math.max(companyIndex, 0) % 5) * 0.07;
  const title = isCreator
    ? 'Your drafts and ideas'
    : isReviewer
      ? 'Reviews waiting for you'
      : primaryRole === 'publisher'
        ? 'Approved content ready to publish'
        : primaryRole === 'auditor'
          ? 'Governance overview'
          : primaryRole === 'group_cto' || primaryRole === 'security_admin'
            ? 'Security and governance overview'
            : groupAdmin
              ? company === 'All companies'
                ? 'Group communications overview'
                : `${company} workspace overview`
              : primaryRole === 'company_admin'
                ? `${company} workspace overview`
                : `Good morning, ${(me.user.displayName || 'there').split(' ')[0]}`;
  const description = isCreator
    ? 'Pick up a draft or start a new piece of content.'
    : isReviewer
      ? 'Review submitted content and help your team move forward.'
      : primaryRole === 'publisher'
        ? 'See approved posts and upcoming sample publishing activity.'
        : primaryRole === 'auditor'
          ? 'Review activity, account health and available governance records.'
          : groupAdmin && company === 'All companies'
            ? 'Compare communications activity across the configurable Group portfolio.'
            : `A company-level view of ${company} content, channels and team activity.`;
  const tablePosts = workspacePosts.slice(0, 4);
  const totalPosts = Math.round(128 * countScale);
  const publishedPosts = Math.round(96 * countScale);
  const scheduledPosts = Math.max(
    1,
    workspacePosts.filter((post) => post.status === 'Scheduled').length,
  );
  const pendingPosts = workspacePosts.filter((post) => post.status === 'Needs review').length;
  const activity =
    company === 'All companies'
      ? DEMO_ACTIVITY
      : [
          {
            person: `Sample team · ${company}`,
            action: 'updated company content and account planning',
            time: 'Today',
          },
        ];
  return (
    <>
      <PageTitle
        title={title}
        description={`${description} · ${company}`}
        action={
          <>
            <button className="btn btn-outline" onClick={() => go('calendar')}>
              View calendar
            </button>
            {me.permissions.includes('content.create') && (
              <button className="btn btn-primary" onClick={() => go('composer')}>
                ＋ Create content
              </button>
            )}
          </>
        }
      />
      <div className="grid grid-4" style={{ marginBottom: 18 }}>
        <StatCard
          label="Total posts"
          value={String(totalPosts)}
          change={company === 'All companies' ? 'Across the Group' : company}
          icon="▤"
        />
        <StatCard
          label="Published"
          value={String(publishedPosts)}
          change="Sample performance"
          icon="↗"
        />
        <StatCard
          label="Scheduled"
          value={String(company === 'All companies' ? 18 : scheduledPosts)}
          change="Upcoming content"
          icon="◷"
        />
        <StatCard
          label="Pending approvals"
          value={String(company === 'All companies' ? 13 : pendingPosts)}
          change="Needs attention"
          icon="✓"
        />
      </div>
      <div className="grid grid-2" style={{ marginBottom: 18 }}>
        <SectionPanel
          title="Content performance"
          subtitle="Engagement across channels · last 30 days"
          action={
            <button className="text-link" onClick={() => go('analytics')}>
              Full report →
            </button>
          }
        >
          <Chart />
        </SectionPanel>
        <SectionPanel
          title="Recent team activity"
          subtitle={company === 'All companies' ? 'Across all sample workspaces' : `In ${company}`}
        >
          <div className="activity-list">
            {activity.map((entry) => (
              <div className="activity-row" key={entry.person + entry.time}>
                <span className="activity-dot" />
                <div className="activity-copy">
                  <strong>{entry.person}</strong> {entry.action}
                  <small>{entry.time}</small>
                </div>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
      <div className="grid grid-2">
        <SectionPanel
          title={
            isCreator ? 'My recent drafts' : isReviewer ? 'Waiting for review' : 'Recent content'
          }
          action={
            <button
              className="text-link"
              onClick={() => go(isReviewer ? 'approvals' : 'publishing')}
            >
              View all →
            </button>
          }
        >
          {tablePosts.length ? (
            <PostTable posts={tablePosts} compact />
          ) : (
            <div className="empty-state">
              <div>
                <strong>No sample content yet</strong>
                <p>Content for {company} will appear here.</p>
              </div>
            </div>
          )}
        </SectionPanel>
        <SectionPanel
          title="Upcoming schedule"
          subtitle={`Next posts planned for ${company}`}
          action={
            <button className="text-link" onClick={() => go('calendar')}>
              Open calendar →
            </button>
          }
        >
          <div className="activity-list">
            {workspacePosts
              .filter((post) => post.status === 'Scheduled' || post.status === 'Approved')
              .slice(0, 3)
              .map((post) => (
                <div className="activity-row" key={post.id}>
                  <span className="activity-dot" />
                  <div className="activity-copy">
                    <strong>{post.title}</strong>
                    <span> · {post.platforms.join(', ')}</span>
                    <small>
                      {post.company} · {post.date} at {post.time}
                    </small>
                  </div>
                </div>
              ))}
          </div>
        </SectionPanel>
      </div>
      {groupAdmin && company === 'All companies' && (
        <div style={{ marginTop: 18 }}>
          <SectionPanel
            title="Portfolio performance by company"
            subtitle="Sample comparison · select a workspace from the company switcher to focus its dashboard"
          >
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Company / institution</th>
                    <th>Followers</th>
                    <th>Engagement rate</th>
                    <th>Published posts</th>
                    <th>Trend</th>
                  </tr>
                </thead>
                <tbody>
                  {DEMO_COMPANY_CONFIG.map((item, index) => (
                    <tr key={item.id}>
                      <td>
                        <span
                          className="account-icon"
                          style={{ backgroundColor: `${item.accent}20`, color: item.accent }}
                        >
                          {item.name.slice(0, 1)}
                        </span>
                        {item.name}
                      </td>
                      <td>{(12800 + index * 7350).toLocaleString()}</td>
                      <td>{(4.8 + (index % 5) * 0.7).toFixed(1)}%</td>
                      <td>{32 + index * 7}</td>
                      <td>
                        <span className="positive">↑ {(3.2 + index * 0.4).toFixed(1)}%</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <small className="hint">
              Fictional demo metrics only. The listed company names are configurable examples, not a
              final legal entity list.
            </small>
          </SectionPanel>
        </div>
      )}
    </>
  );
}

function Chart() {
  return (
    <>
      <div
        className="bar-chart"
        role="img"
        aria-label="Sample engagement chart: weekly reach and interactions trending upward over the last six weeks"
      >
        {[
          [35, 25],
          [48, 36],
          [42, 31],
          [65, 43],
          [58, 50],
          [78, 60],
          [72, 68],
          [92, 76],
          [84, 68],
          [100, 82],
          [88, 78],
          [110, 90],
        ].map(([a, b], index) => (
          <div className="bar-group" key={index}>
            <i className="bar" style={{ height: `${a}px` }} />
            <i className="bar secondary" style={{ height: `${b}px` }} />
          </div>
        ))}
      </div>
      <div className="chart-labels">
        <span>Oct 1</span>
        <span>Oct 8</span>
        <span>Oct 15</span>
        <span>Oct 22</span>
        <span>Oct 29</span>
        <span>Nov 5</span>
      </div>
      <div className="legend">
        <span>
          <i />
          Reach
        </span>
        <span>
          <i className="gold" />
          Interactions
        </span>
      </div>
    </>
  );
}

function PostTable({ posts, compact = false }: { posts: DemoPost[]; compact?: boolean }) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Content</th>
            <th>Status</th>
            {!compact && <th>Company</th>}
            <th>{compact ? 'Date' : 'Channels'}</th>
          </tr>
        </thead>
        <tbody>
          {posts.map((post) => (
            <tr key={post.id}>
              <td>
                <span className="post-title">{post.title}</span>
                <span className="subline">
                  {post.id} · {post.creator}
                </span>
              </td>
              <td>
                <DemoStatusChip value={post.status} />
              </td>
              {!compact && <td>{post.company}</td>}
              <td>
                {compact ? `${post.date.slice(5)} · ${post.time}` : post.platforms.join(', ')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Composer({
  company,
  onSave,
  onSubmit,
}: {
  company: string;
  onSave: (title: string, company: string) => void;
  onSubmit: (title: string, company: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [selectedCompany, setSelectedCompany] = useState(
    company === 'All companies' ? DEMO_COMPANY_CONFIG[0].name : company,
  );
  const [captions, setCaptions] = useState<Record<string, string>>({ Instagram: '' });
  const [platforms, setPlatforms] = useState<string[]>(['Instagram']);
  const [mediaName, setMediaName] = useState('');
  const [selectedPlatform, setSelectedPlatform] = useState('Instagram');
  const limit = selectedPlatform === 'X' ? 280 : selectedPlatform === 'Instagram' ? 2200 : 3000;
  const caption = captions[selectedPlatform] ?? '';
  const togglePlatform = (name: string) =>
    setPlatforms((current) =>
      current.includes(name) ? current.filter((item) => item !== name) : [...current, name],
    );
  const save = () => {
    if (!title.trim()) return;
    onSave(title.trim(), selectedCompany);
    setTitle('');
    setCaptions({ Instagram: '' });
  };
  return (
    <>
      <PageTitle
        title="Create content"
        description="Draft once, tailor each channel, and send it through the DCC review path."
        action={<span className="status status-blue">Approval required before publishing</span>}
      />
      <div className="composer-layout">
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Post details</h2>
              <p>Only sample content is saved in this browser preview.</p>
            </div>
            <span className="status status-gray">Draft</span>
          </div>
          <div className="grid grid-2">
            <div className="field-group">
              <label className="label" htmlFor="post-title">
                Internal title or campaign
              </label>
              <input
                className="field"
                id="post-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Community update"
              />
            </div>
            <div className="field-group">
              <label className="label" htmlFor="post-company">
                Company workspace
              </label>
              <select
                className="select-field"
                id="post-company"
                value={selectedCompany}
                onChange={(event) => setSelectedCompany(event.target.value)}
              >
                {(company === 'All companies'
                  ? DEMO_COMPANY_CONFIG.map((item) => item.name)
                  : [company]
                ).map((name) => (
                  <option key={name}>{name}</option>
                ))}
              </select>
            </div>
          </div>
          <div className="field-group">
            <span className="label">Publish to</span>
            <div className="platform-list">
              {PLATFORM_NAMES.map((name) => (
                <label className="platform-option" key={name}>
                  <input
                    type="checkbox"
                    checked={platforms.includes(name)}
                    onChange={() => togglePlatform(name)}
                  />
                  {name}
                </label>
              ))}
            </div>
            <small className="hint">
              Select the company accounts for each channel in a connected production workflow.
            </small>
          </div>
          <div className="field-group">
            <label className="label" htmlFor="caption">
              {selectedPlatform} caption
            </label>
            <textarea
              className="textarea-field"
              id="caption"
              value={caption}
              maxLength={limit}
              onChange={(event) =>
                setCaptions((current) => ({ ...current, [selectedPlatform]: event.target.value }))
              }
              placeholder={`Write a clear message for ${selectedPlatform}…`}
            />
            <small className="hint">
              {caption.length} / {limit} characters · Separate caption draft for the selected
              channel.
            </small>
          </div>
          <div className="field-group">
            <span className="label">Media</span>
            <label className="upload-zone">
              <span>
                {mediaName ? `Selected: ${mediaName}` : 'Add an image or video to your draft'}
                <small className="hint">
                  This preview reads the filename only. The file is not uploaded.
                </small>
                <input
                  type="file"
                  accept="image/*,video/*"
                  onChange={(event) => setMediaName(event.target.files?.[0]?.name ?? '')}
                />
              </span>
            </label>
          </div>
          <div className="grid grid-2">
            <div className="field-group">
              <label className="label" htmlFor="hashtags">
                Hashtags
              </label>
              <input id="hashtags" className="field" placeholder="#Coffee #Community" />
            </div>
            <div className="field-group">
              <label className="label" htmlFor="post-link">
                Link
              </label>
              <input
                id="post-link"
                className="field"
                type="url"
                placeholder="https://example.com"
              />
            </div>
          </div>
          <div className="heading-actions">
            <button className="btn btn-outline" onClick={save} disabled={!title.trim()}>
              Save draft
            </button>
            <button
              className="btn btn-primary"
              onClick={() => {
                if (!title.trim()) return;
                onSubmit(title.trim(), selectedCompany);
                setTitle('');
                setCaptions({ Instagram: '' });
              }}
              disabled={!title.trim() || platforms.length === 0}
            >
              Submit for review
            </button>
          </div>
          <small className="hint" style={{ marginTop: 12 }}>
            A creator cannot approve their own content. Review and publication are separate steps.
          </small>
        </section>
        <section className="panel">
          <div className="panel-header">
            <div>
              <h2>Channel preview</h2>
              <p>Check your message before it enters review.</p>
            </div>
            <select
              aria-label="Preview channel"
              className="select-field"
              style={{ width: 130, padding: 7 }}
              value={selectedPlatform}
              onChange={(event) => setSelectedPlatform(event.target.value)}
            >
              {platforms.map((platform) => (
                <option key={platform}>{platform}</option>
              ))}
            </select>
          </div>
          <div className="preview-card">
            <div className="preview-head">
              <div className="preview-avatar">K</div>
              <div>
                <strong>
                  {company === 'All companies' ? DEMO_COMPANY_CONFIG[0].name : company}
                </strong>
                <small>{selectedPlatform} · Sample placeholder, not a connected account</small>
              </div>
            </div>
            <div className="preview-image">
              {mediaName ? `Media selected: ${mediaName}` : 'Media preview area'}
            </div>
            <div className="preview-body">
              {caption || 'Your caption preview will appear here as you write.'}
            </div>
            <div className="preview-actions">
              <span>♡ Like</span>
              <span>◯ Comment</span>
              <span>↗ Share</span>
            </div>
          </div>
          <div className="panel" style={{ marginTop: 15, background: '#f8fbfc' }}>
            <strong style={{ fontSize: 12 }}>Review path</strong>
            <p style={{ margin: '6px 0 0', color: '#718091', fontSize: 11, lineHeight: 1.55 }}>
              Creator submits → assigned reviewer checks → approved content can be scheduled by an
              authorized publisher.
            </p>
          </div>
        </section>
      </div>
    </>
  );
}

function Approvals({
  company,
  posts,
  update,
}: {
  company: string;
  posts: DemoPost[];
  update: (id: string, status: DemoStatus) => void;
}) {
  const [activeId, setActiveId] = useState(
    posts.find((post) => post.status === 'Needs review')?.id ?? '',
  );
  const [comment, setComment] = useState('');
  const [filter, setFilter] = useState('Needs review');
  const visible = posts.filter(
    (post) =>
      (company === 'All companies' || post.company === company) &&
      (filter === 'All statuses' || post.status === filter),
  );
  const selected = visible.find((post) => post.id === activeId) ?? visible[0];
  return (
    <>
      <PageTitle
        title="Review & approvals"
        description="Review submitted content, leave clear feedback, and record the decision."
        action={<span className="status status-amber">Separation of duties enforced by DCC</span>}
      />
      <div className="filter-row">
        <select
          className="select-field"
          aria-label="Filter approvals"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option>Needs review</option>
          <option>Changes requested</option>
          <option>Approved</option>
          <option>All statuses</option>
        </select>
        <span className="status status-gray">{visible.length} sample items</span>
      </div>
      <div className="grid grid-2">
        <SectionPanel title="Review queue" subtitle="Choose an item to inspect">
          {visible.length ? (
            <div className="activity-list">
              {visible.map((post) => (
                <button
                  key={post.id}
                  className="activity-row"
                  style={{
                    width: '100%',
                    border: 0,
                    borderBottom: '1px solid #eff2f5',
                    background: activeId === post.id ? '#f2f8f8' : 'white',
                    textAlign: 'left',
                  }}
                  onClick={() => setActiveId(post.id)}
                >
                  <span className="activity-dot" />
                  <span className="activity-copy" style={{ flex: 1 }}>
                    <strong>{post.title}</strong>
                    <small>
                      {post.creator} · {post.company} · {post.date}
                    </small>
                  </span>
                  <DemoStatusChip value={post.status} />
                </button>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <div>
                <strong>Nothing in this view</strong>
                <p>New submissions will appear here.</p>
              </div>
            </div>
          )}
        </SectionPanel>
        <SectionPanel
          title={selected?.title ?? 'Select content'}
          subtitle={
            selected
              ? `${selected.id} · submitted by ${selected.creator}`
              : 'Post details and review history'
          }
        >
          {selected ? (
            <>
              <div className="preview-card" style={{ marginBottom: 14 }}>
                <div className="preview-head">
                  <div className="preview-avatar">{initials(selected.creator)}</div>
                  <div>
                    <strong>{selected.company}</strong>
                    <small>{selected.platforms.join(' · ')}</small>
                  </div>
                </div>
                <div className="preview-image">Sample post media preview</div>
                <div className="preview-body">{selected.caption}</div>
              </div>
              <div className="grid grid-2" style={{ marginBottom: 13 }}>
                <div>
                  <small className="hint">CREATOR</small>
                  <strong style={{ display: 'block', fontSize: 12 }}>{selected.creator}</strong>
                </div>
                <div>
                  <small className="hint">SUBMITTED</small>
                  <strong style={{ display: 'block', fontSize: 12 }}>
                    {selected.date} · {selected.time}
                  </strong>
                </div>
              </div>
              <label className="label" htmlFor="review-comment">
                Review comment
              </label>
              <textarea
                id="review-comment"
                className="textarea-field"
                style={{ minHeight: 80 }}
                value={comment}
                onChange={(event) => setComment(event.target.value)}
                placeholder="Share specific, helpful feedback…"
              />
              <div className="heading-actions" style={{ marginTop: 13 }}>
                <button
                  className="btn btn-outline"
                  onClick={() => update(selected.id, 'Changes requested')}
                >
                  ↩ Request changes
                </button>
                <button className="btn btn-danger" onClick={() => update(selected.id, 'Draft')}>
                  Reject
                </button>
                <button className="btn btn-primary" onClick={() => update(selected.id, 'Approved')}>
                  Approve
                </button>
              </div>
              <small className="hint">
                Demo only: decisions update sample status in this page and are not recorded by DCC.
              </small>
            </>
          ) : (
            <div className="empty-state">
              <div>
                <strong>No item selected</strong>
                <p>Select a post from the queue to review it.</p>
              </div>
            </div>
          )}
        </SectionPanel>
      </div>
    </>
  );
}

function Publishing({
  company,
  posts,
  onAction,
}: {
  company: string;
  posts: DemoPost[];
  onAction: () => void;
}) {
  const [filter, setFilter] = useState('All content');
  const [platform, setPlatform] = useState('All platforms');
  const [companyFilter, setCompanyFilter] = useState(company);
  const [date, setDate] = useState('');
  useEffect(() => setCompanyFilter(company), [company]);
  const groupView = company === 'All companies';
  const activeCompany = groupView ? companyFilter : company;
  const items = posts.filter(
    (post) =>
      (filter === 'All content' || post.status === filter) &&
      (platform === 'All platforms' || post.platforms.includes(platform)) &&
      (activeCompany === 'All companies' || post.company === activeCompany) &&
      (!date || post.date === date),
  );
  return (
    <>
      <PageTitle
        title="Publishing workspace"
        description={`Approved, scheduled and published content · ${company}`}
        action={
          <button className="btn btn-primary" onClick={onAction}>
            ＋ Schedule approved post
          </button>
        }
      />
      <div className="filter-row">
        <select
          className="select-field"
          aria-label="Filter publishing status"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option>All content</option>
          <option>Approved</option>
          <option>Scheduled</option>
          <option>Published</option>
        </select>
        <select
          className="select-field"
          aria-label="Filter by platform"
          value={platform}
          onChange={(event) => setPlatform(event.target.value)}
        >
          <option>All platforms</option>
          {PLATFORM_NAMES.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        {groupView && (
          <select
            className="select-field"
            aria-label="Filter by company"
            value={companyFilter}
            onChange={(event) => setCompanyFilter(event.target.value)}
          >
            {DEMO_COMPANIES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        )}
        <input
          className="field"
          style={{ width: 190 }}
          type="date"
          aria-label="Filter by date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
      </div>
      <SectionPanel
        title="Publishing queue"
        subtitle="Publishing states shown here use sample data"
      >
        <PostTable posts={items} />
        {items.length === 0 && (
          <div className="empty-state">
            <div>
              <strong>No matching sample content</strong>
              <p>Try changing or clearing one of the filters.</p>
            </div>
          </div>
        )}
      </SectionPanel>
      <div className="grid grid-3" style={{ marginTop: 18 }}>
        {[
          [
            'Approved and ready',
            String(
              posts.filter(
                (post) =>
                  post.status === 'Approved' &&
                  (activeCompany === 'All companies' || post.company === activeCompany),
              ).length,
            ),
            'Ready for a publisher to schedule',
          ],
          [
            'Scheduled',
            String(
              posts.filter(
                (post) =>
                  post.status === 'Scheduled' &&
                  (activeCompany === 'All companies' || post.company === activeCompany),
              ).length,
            ),
            'Planned in this workspace',
          ],
          [
            'Published this month',
            String(
              posts.filter(
                (post) =>
                  post.status === 'Published' &&
                  (activeCompany === 'All companies' || post.company === activeCompany),
              ).length,
            ),
            'Sample historical activity',
          ],
        ].map(([title, number, note]) => (
          <article className="stat-card" key={title}>
            <div className="stat-top">{title}</div>
            <div className="stat-value">{number}</div>
            <div className="stat-foot">{note}</div>
          </article>
        ))}
      </div>
    </>
  );
}

function Calendar({
  company,
  posts,
  showToast,
  onReschedule,
}: {
  company: string;
  posts: DemoPost[];
  showToast: (message: string) => void;
  onReschedule: (id: string, date: string, time: string) => void;
}) {
  const [view, setView] = useState('Month');
  const [month, setMonth] = useState(10);
  const [selected, setSelected] = useState<DemoPost | null>(null);
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [companyFilter, setCompanyFilter] = useState(company);
  const [platform, setPlatform] = useState('All platforms');
  useEffect(() => setCompanyFilter(company), [company]);
  const monthName = new Date(2026, month, 1).toLocaleString('en', {
    month: 'long',
    year: 'numeric',
  });
  const monthOffset = new Date(2026, month, 1).getDay();
  const daysInMonth = new Date(2026, month + 1, 0).getDate();
  const monthCellCount = Math.ceil((monthOffset + daysInMonth) / 7) * 7;
  const weekStart = 12 - new Date(2026, month, 12).getDay();
  const days =
    view === 'Month'
      ? Array.from({ length: monthCellCount }, (_, index) => index - monthOffset + 1)
      : view === 'Week'
        ? Array.from({ length: 7 }, (_, index) => index + weekStart)
        : [12];
  const groupView = company === 'All companies';
  const activeCompany = groupView ? companyFilter : company;
  const events = posts.filter(
    (post) =>
      (post.status === 'Scheduled' || post.status === 'Approved') &&
      (activeCompany === 'All companies' || post.company === activeCompany) &&
      (platform === 'All platforms' || post.platforms.includes(platform)),
  );
  return (
    <>
      <PageTitle
        title="Content calendar"
        description="Coordinate planned content across company channels."
        action={
          <button
            className="btn btn-primary"
            onClick={() =>
              showToast('Scheduling controls are a local demo. No post was scheduled.')
            }
          >
            ＋ Plan a post
          </button>
        }
      />
      <SectionPanel title="Publishing calendar" subtitle="Select a sample item to view its status">
        <div className="calendar-toolbar">
          <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
            <button
              className="btn btn-outline"
              aria-label="Previous month"
              onClick={() => setMonth((value) => value - 1)}
            >
              ‹
            </button>
            <strong style={{ minWidth: 160, textAlign: 'center', fontSize: 14 }}>
              {monthName}
            </strong>
            <button
              className="btn btn-outline"
              aria-label="Next month"
              onClick={() => setMonth((value) => value + 1)}
            >
              ›
            </button>
          </div>
          <div className="heading-actions">
            {['Month', 'Week', 'Day'].map((item) => (
              <button
                key={item}
                className={`btn ${view === item ? 'btn-dark' : 'btn-outline'}`}
                aria-pressed={view === item}
                onClick={() => setView(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-row">
          <select
            className="select-field"
            aria-label="Calendar company filter"
            value={companyFilter}
            onChange={(event) => setCompanyFilter(event.target.value)}
          >
            {(groupView ? DEMO_COMPANIES : [company]).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <select
            className="select-field"
            aria-label="Calendar platform filter"
            value={platform}
            onChange={(event) => setPlatform(event.target.value)}
          >
            <option>All platforms</option>
            {PLATFORM_NAMES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </div>
        <div className="calendar-scroll">
          <div className={`calendar-grid ${view === 'Day' ? 'calendar-grid-day' : ''}`}>
            {(view === 'Day'
              ? ['Selected day']
              : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
            ).map((day) => (
              <div className="calendar-day-label" key={day}>
                {day}
              </div>
            ))}
            {days.map((day, index) => {
              const calendarDate = new Date(2026, month, day);
              const eventsForDay = events.filter(
                (post) =>
                  Number(post.date.slice(-2)) === calendarDate.getDate() &&
                  Number(post.date.slice(5, 7)) === calendarDate.getMonth() + 1,
              );
              return (
                <div className="calendar-cell" key={`${month}-${index}`}>
                  <span
                    className="calendar-date"
                    style={{ opacity: calendarDate.getMonth() === month ? 1 : 0.35 }}
                  >
                    {calendarDate.getDate()}
                  </span>
                  {eventsForDay.map((event, eventIndex) => (
                    <button
                      className={`calendar-event ${eventIndex % 2 ? 'gold-event' : ''}`}
                      key={event.id}
                      title={`${event.time} · ${event.title}`}
                      onClick={() => {
                        setSelected(event);
                        setDate(event.date);
                        setTime(event.time);
                      }}
                    >
                      {event.time} {event.title}
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        {selected && (
          <div className="panel" style={{ marginTop: 16, background: '#f8fbfc' }}>
            <div className="panel-header">
              <div>
                <h2>Reschedule sample post</h2>
                <p>
                  {selected.title} · {selected.company}
                </p>
              </div>
              <button className="btn btn-outline" onClick={() => setSelected(null)}>
                Close
              </button>
            </div>
            <div className="grid grid-2">
              <div className="field-group">
                <label className="label" htmlFor="calendar-date">
                  New date
                </label>
                <input
                  className="field"
                  id="calendar-date"
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                />
              </div>
              <div className="field-group">
                <label className="label" htmlFor="calendar-time">
                  New time
                </label>
                <input
                  className="field"
                  id="calendar-time"
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                />
              </div>
            </div>
            <button
              className="btn btn-primary"
              disabled={!date || !time}
              onClick={() => {
                onReschedule(selected.id, date, time);
                setSelected(null);
              }}
            >
              Save sample schedule
            </button>
          </div>
        )}
        <small className="hint">
          Calendar events and rescheduling are sample interactions only.
        </small>
      </SectionPanel>
    </>
  );
}

function Accounts({
  company,
  liveCompanies,
  demoMode,
}: {
  company: string;
  liveCompanies: CompanyDto[] | null;
  demoMode: boolean;
}) {
  const [filter, setFilter] = useState('All platforms');
  const [query, setQuery] = useState('');
  const [liveAccounts, setLiveAccounts] = useState<SocialAccountDto[] | null>(null);
  useEffect(() => {
    if (demoMode) {
      setLiveAccounts(null);
      return;
    }
    let current = true;
    apiFetch<SocialAccountDto[]>('/social-accounts')
      .then((accountRows) => {
        if (current) setLiveAccounts(accountRows);
      })
      .catch(() => {
        if (current) setLiveAccounts(null);
      });
    return () => {
      current = false;
    };
  }, [demoMode]);
  const liveRows = liveAccounts?.map((account) => ({
    key: account.id,
    name: account.displayName,
    handle: account.handle,
    platform: account.platform,
    company:
      liveCompanies?.find((item) => item.id === account.companyId)?.name ?? 'Company workspace',
    brand: account.brandId ? 'Brand linked' : 'No brand linked',
    owner: 'Owner details not provided by this read-only endpoint',
    status: account.status.replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()),
  }));
  const rows = liveRows ?? DEMO_ACCOUNTS.map((account) => ({ ...account, key: account.handle }));
  const scopedAccounts = rows.filter(
    (account) => company === 'All companies' || account.company === company,
  );
  const accounts = rows.filter(
    (account) =>
      (company === 'All companies' || account.company === company) &&
      (filter === 'All platforms' || account.platform === filter) &&
      `${account.name} ${account.handle} ${account.company}`
        .toLowerCase()
        .includes(query.toLowerCase()),
  );
  const connectedCount = scopedAccounts.filter(
    (item) => item.status === 'Active' || item.status === 'Connected',
  ).length;
  const attentionCount = scopedAccounts.filter(
    (item) => item.status.toLowerCase() === 'needs attention',
  ).length;
  return (
    <>
      <PageTitle
        title="Social accounts"
        description={`Review account ownership and connection health · ${company}. Connections are managed through the approved engine workflow.`}
        action={
          <button
            className="btn btn-outline"
            onClick={() =>
              window.alert('Account connections are managed through the approved engine workflow.')
            }
          >
            Connection guidance
          </button>
        }
      />
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <StatCard
          label="Accounts in view"
          value={String(scopedAccounts.length)}
          change={liveAccounts ? 'Live read-only list' : 'Sample placeholders'}
          icon="◎"
        />
        <StatCard
          label="Connected"
          value={String(connectedCount)}
          change={liveAccounts ? 'Read-only status' : 'No verified connection status'}
          icon="✓"
        />
        <StatCard
          label="Needs attention"
          value={String(attentionCount)}
          change={liveAccounts ? 'Read-only status' : 'No verified connection status'}
          icon="!"
        />
      </div>
      <div className="filter-row">
        <select
          className="select-field"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          aria-label="Filter accounts by platform"
        >
          <option>All platforms</option>
          {PLATFORM_NAMES.map((name) => (
            <option key={name}>{name}</option>
          ))}
        </select>
        <input
          className="field"
          style={{ maxWidth: 230 }}
          placeholder="Search accounts"
          aria-label="Search accounts"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <SectionPanel
        title="Account registry"
        subtitle={
          liveAccounts
            ? 'Read-only account list from DCC'
            : 'Mock placeholders only · no real connected handles'
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Account</th>
                <th>Company / brand</th>
                <th>Owner</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {accounts.map((account) => (
                <tr key={account.key}>
                  <td>
                    <span className="account-icon">
                      {account.platform.slice(0, 2).toUpperCase()}
                    </span>
                    <span className="post-title">{account.name}</span>
                    <span className="subline">
                      {account.platform} · {account.handle}
                    </span>
                  </td>
                  <td>
                    {account.company}
                    <span className="subline">{account.brand}</span>
                  </td>
                  <td>{account.owner}</td>
                  <td>
                    <DemoStatusChip value={account.status} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {accounts.length === 0 && (
          <div className="empty-state">
            <div>
              <strong>No matching accounts</strong>
              <p>Try another search or platform filter.</p>
            </div>
          </div>
        )}
      </SectionPanel>
      <small className="hint">
        Mock rows are placeholders, not real social profiles. Live connections and statuses appear
        only when returned by the read-only API.
      </small>
    </>
  );
}

function Companies({
  company,
  liveCompanies,
}: {
  company: string;
  liveCompanies: CompanyDto[] | null;
}) {
  const [brands, setBrands] = useState<Record<string, BrandDto[]>>({});
  useEffect(() => {
    if (!liveCompanies) return;
    let current = true;
    Promise.all(
      liveCompanies.map(
        async (item) =>
          [
            item.id,
            await apiFetch<BrandDto[]>(`/companies/${item.id}/brands`).catch(() => []),
          ] as const,
      ),
    ).then((entries) => {
      if (current) setBrands(Object.fromEntries(entries));
    });
    return () => {
      current = false;
    };
  }, [liveCompanies]);
  const records = liveCompanies
    ? liveCompanies
        .filter((item) => company === 'All companies' || item.name === company)
        .map((item) => ({
          id: item.id,
          name: item.name,
          status: item.status[0].toUpperCase() + item.status.slice(1),
          brandNames: brands[item.id]?.map((brand) => brand.name) ?? [],
        }))
    : DEMO_COMPANY_CONFIG.filter(
        (item) => company === 'All companies' || item.name === company,
      ).map((item) => ({
        id: item.id,
        name: item.name,
        status: 'Sample only',
        brandNames: [] as string[],
      }));
  const brandCount = liveCompanies
    ? Object.values(brands).reduce((total, items) => total + items.length, 0)
    : null;
  return (
    <>
      <PageTitle
        title="Companies & brands"
        description="A clear view of company workspaces and the brands they manage."
        action={
          <button
            className="btn btn-outline"
            onClick={() =>
              window.alert('Company creation and brand changes are not connected in this screen.')
            }
          >
            Management guidance
          </button>
        }
      />
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <StatCard
          label="Companies"
          value={liveCompanies ? String(liveCompanies.length) : String(DEMO_COMPANY_CONFIG.length)}
          change={liveCompanies ? 'Read-only list' : 'Configurable sample workspaces'}
          icon="⌂"
        />
        <StatCard
          label="Brands"
          value={brandCount === null ? 'Not configured' : String(brandCount)}
          change={liveCompanies ? 'Read-only lists' : 'No sample brand names supplied'}
          icon="◇"
        />
        <StatCard label="Social accounts" value="—" change="See account registry" icon="◎" />
      </div>
      <div className="grid grid-3">
        {records.map((item) => (
          <article key={item.id} className="panel">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div className="stat-icon">{item.name.slice(0, 1)}</div>
              <DemoStatusChip value={item.status} />
            </div>
            <h2 style={{ margin: '16px 0 5px', fontSize: 16 }}>{item.name}</h2>
            <p style={{ margin: 0, color: '#7a8997', fontSize: 12 }}>
              {item.brandNames.length
                ? `${item.brandNames.length} brands`
                : 'Brand names not configured'}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 16 }}>
              {item.brandNames.map((brand) => (
                <span className="status status-gray" key={brand}>
                  {brand}
                </span>
              ))}
            </div>
            <span className="subline">
              {liveCompanies
                ? 'Company and brand records from DCC'
                : 'Configurable sample workspace; legal status not verified'}
            </span>
          </article>
        ))}
      </div>
      {records.length === 0 && (
        <div className="empty-state">
          <div>
            <strong>No companies in this scope</strong>
            <p>The API returned no company workspaces for your access.</p>
          </div>
        </div>
      )}
      <small className="hint">
        Live company and brand views use read-only DCC APIs. Mock workspaces show no claimed brands
        or connected accounts.
      </small>
    </>
  );
}

function Access({ company }: { company: string }) {
  const people = DEMO_PEOPLE.filter(
    (person) => company === 'All companies' || person.company === company,
  );
  return (
    <>
      <PageTitle
        title="Access governance"
        description={`Review team roles for ${company}. The API remains the authority for access decisions.`}
        action={
          <button
            className="btn btn-outline"
            onClick={() => window.alert('Role assignments are not changed in this preview.')}
          >
            Role management guidance
          </button>
        }
      />
      <div className="demo-banner">
        <span aria-hidden="true">ⓘ</span>
        <div>
          Role labels come from the shared DCC contracts. Memberships and activity on this screen
          are fictional sample data.
        </div>
      </div>
      <SectionPanel
        title="Team access"
        subtitle={`${people.length} sample team members · ${company}`}
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Team member</th>
                <th>Role</th>
                <th>Company scope</th>
                <th>Recent activity</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {people.map((person) => (
                <tr key={person.name}>
                  <td>
                    <span
                      className="user-avatar"
                      style={{
                        display: 'inline-grid',
                        width: 29,
                        height: 29,
                        marginRight: 8,
                        verticalAlign: 'middle',
                        fontSize: 10,
                      }}
                    >
                      {initials(person.name)}
                    </span>
                    {person.name}
                  </td>
                  <td>{person.role}</td>
                  <td>{person.company}</td>
                  <td>{person.activity}</td>
                  <td>
                    <DemoStatusChip value="Active" />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {people.length === 0 && (
          <div className="empty-state">
            <div>
              <strong>No sample team members</strong>
              <p>There are no demo membership records for this workspace yet.</p>
            </div>
          </div>
        )}
      </SectionPanel>
    </>
  );
}

type AuditEvent = {
  id: string;
  occurred_at: string;
  actor_user_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  company_id: string | null;
  company_name?: string;
};
type AuditVerifyResult = { ok: boolean; checked: number; firstBrokenId: string | null };

function Audit({
  company,
  liveCompanies,
  demoMode,
}: {
  company: string;
  liveCompanies: CompanyDto[] | null;
  demoMode: boolean;
}) {
  const [events, setEvents] = useState<AuditEvent[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [eventType, setEventType] = useState('All event types');
  const [search, setSearch] = useState('');
  const [date, setDate] = useState('');
  const [verification, setVerification] = useState<AuditVerifyResult | null>(null);
  const [verifying, setVerifying] = useState(false);
  useEffect(() => {
    if (demoMode) {
      setEvents(DEMO_AUDIT);
      return;
    }
    let current = true;
    apiFetch<AuditEvent[]>('/audit?limit=100')
      .then((items) => {
        if (current) setEvents(items);
      })
      .catch((error: unknown) => {
        if (current) {
          setEvents([]);
          setLoadError(
            error instanceof Error ? error.message : 'Audit records could not be loaded.',
          );
        }
      });
    return () => {
      current = false;
    };
  }, [demoMode]);
  const filtered = (events ?? []).filter((event) => {
    const category = event.action.split('.')[0];
    const matchesType =
      eventType === 'All event types' ||
      (eventType === 'Access'
        ? category === 'access'
        : eventType === 'Security'
          ? category === 'security' || category === 'auth'
          : eventType === 'Company'
            ? category === 'company'
            : category === eventType.toLowerCase());
    const companyName =
      event.company_name ?? liveCompanies?.find((item) => item.id === event.company_id)?.name ?? '';
    const searchable =
      `${event.action} ${event.target_type ?? ''} ${event.target_id ?? ''} ${companyName} ${event.actor_user_id ?? ''}`.toLowerCase();
    const companyMatches =
      company === 'All companies' || company === companyName || (!liveCompanies && !demoMode);
    return (
      matchesType &&
      companyMatches &&
      searchable.includes(search.toLowerCase()) &&
      (!date || event.occurred_at.slice(0, 10) === date)
    );
  });
  const verify = async () => {
    setVerifying(true);
    setVerification(null);
    try {
      if (demoMode) {
        setVerification({ ok: true, checked: filtered.length, firstBrokenId: null });
      } else {
        setVerification(await apiFetch<AuditVerifyResult>('/audit/verify'));
      }
    } catch (error) {
      setLoadError(
        error instanceof Error ? error.message : 'Audit verification could not be completed.',
      );
    } finally {
      setVerifying(false);
    }
  };
  return (
    <>
      <PageTitle
        title="Activity audit"
        description="Review recorded activity and check the audit chain."
        action={
          <button className="btn btn-outline" disabled={verifying} onClick={verify}>
            {verifying ? 'Checking…' : demoMode ? 'Check sample log' : '✓ Check the notebook'}
          </button>
        }
      />
      {verification && (
        <div className="demo-banner">
          <span aria-hidden="true">{verification.ok ? '✓' : '!'}</span>
          <div>
            <strong>
              {demoMode
                ? 'Sample check complete'
                : verification.ok
                  ? 'Audit chain check passed'
                  : 'Audit chain needs attention'}
            </strong>
            {demoMode
              ? 'Simulated result; no audit endpoint was called.'
              : `${verification.checked} entries checked${verification.firstBrokenId ? ` · First issue: ${verification.firstBrokenId}` : ''}.`}
          </div>
        </div>
      )}
      {loadError && (
        <div className="demo-banner" role="alert">
          <span aria-hidden="true">!</span>
          <div>
            <strong>Audit data is unavailable</strong>
            {loadError}
          </div>
        </div>
      )}
      <div className="filter-row">
        <input
          className="field"
          type="date"
          aria-label="Filter audit by date"
          value={date}
          onChange={(event) => setDate(event.target.value)}
        />
        <select
          className="select-field"
          aria-label="Filter audit event type"
          value={eventType}
          onChange={(event) => setEventType(event.target.value)}
        >
          {['All event types', 'Company', 'Access', 'Security', 'Content', 'Account'].map(
            (item) => (
              <option key={item}>{item}</option>
            ),
          )}
        </select>
        <input
          className="field"
          placeholder="Search audit activity"
          aria-label="Search audit events"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
      </div>
      <SectionPanel
        title="Activity log"
        subtitle={
          events === null
            ? 'Loading audit records…'
            : demoMode
              ? `${filtered.length} sample entries for ${company}`
              : `${filtered.length} records from the read-only audit API`
        }
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Event</th>
                <th>Actor ID</th>
                <th>Company</th>
                <th>Time</th>
                <th>Target</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((event) => (
                <tr key={event.id}>
                  <td>
                    <span className="post-title">
                      {event.action.replaceAll('.', ' ').replaceAll('_', ' ')}
                    </span>
                    <span className="subline">{event.id.slice(0, 8)}</span>
                  </td>
                  <td>{event.actor_user_id?.slice(0, 8) ?? 'System'}</td>
                  <td>
                    {event.company_name ??
                      liveCompanies?.find((item) => item.id === event.company_id)?.name ??
                      (event.company_id ? 'Company scope' : 'Group')}
                  </td>
                  <td>{new Date(event.occurred_at).toLocaleString()}</td>
                  <td>
                    {event.target_type ?? '—'}
                    {event.target_id ? ` · ${event.target_id.slice(0, 8)}` : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {events !== null && filtered.length === 0 && !loadError && (
          <div className="empty-state">
            <div>
              <strong>No matching audit events</strong>
              <p>Try changing or clearing a filter.</p>
            </div>
          </div>
        )}
      </SectionPanel>
      <small className="hint">
        {demoMode
          ? 'All entries and checks are fictional local demo data.'
          : 'Audit records are read-only. Verification checks the live audit chain; it does not make the chain tamper-proof.'}
      </small>
    </>
  );
}

function Inbox() {
  return (
    <>
      <PageTitle
        title="Unified inbox"
        description="A shared queue for social conversations across connected company accounts."
      />
      <SectionPanel
        title="Inbox integration"
        subtitle="Unified inbox is not connected in this DCC frontend yet"
      >
        <div className="empty-state">
          <div>
            <strong>Conversation management is coming soon</strong>
            <p>
              When the approved inbox integration is available, this page will show messages grouped
              by company and social account.
            </p>
          </div>
        </div>
      </SectionPanel>
      <small className="hint">No social messages are fetched or displayed here.</small>
    </>
  );
}

function Security() {
  return (
    <>
      <PageTitle
        title="Security center"
        description="A focused view of account connection health and governance signals."
        action={
          <button
            className="btn btn-outline"
            onClick={() => window.alert('Demo only: security report is not exported.')}
          >
            Export summary
          </button>
        }
      />
      <div className="grid grid-3" style={{ marginBottom: 18 }}>
        <StatCard label="Account health" value="21 / 24" change="3 need attention" icon="◎" />
        <StatCard label="Review controls" value="Active" change="Approval required" icon="✓" />
        <StatCard label="Open incidents" value="2" change="1 high priority" icon="!" />
      </div>
      <div className="grid grid-2">
        <SectionPanel title="Governance signals" subtitle="Sample operational indicators">
          {[
            ['MFA required for DCC sign-in', 'Enforced by DCC / SSO', 'Connected'],
            ['Approval before publishing', 'Required by workflow', 'Connected'],
            ['Social account connection', '3 sample accounts need attention', 'Needs attention'],
            ['Audit history', 'Append-only audit trail', 'Connected'],
          ].map(([title, detail, status]) => (
            <div className="activity-row" key={title}>
              <span className="activity-dot" />
              <div className="activity-copy" style={{ flex: 1 }}>
                <strong>{title}</strong>
                <small>{detail}</small>
              </div>
              <DemoStatusChip value={status} />
            </div>
          ))}
        </SectionPanel>
        <SectionPanel title="Recent security activity" subtitle="Examples only">
          <div className="activity-list">
            {DEMO_ACTIVITY.slice(1).map((entry) => (
              <div className="activity-row" key={entry.action}>
                <span className="activity-dot" />
                <div className="activity-copy">
                  <strong>{entry.person}</strong> {entry.action}
                  <small>{entry.time}</small>
                </div>
              </div>
            ))}
          </div>
        </SectionPanel>
      </div>
      <small className="hint">
        This display does not inspect live security state or replace the backend security controls.
      </small>
    </>
  );
}

function Incidents() {
  const [filter, setFilter] = useState('All incidents');
  const rows = [
    [
      'INC-204',
      'Sample account placeholder needs review',
      DEMO_COMPANY_CONFIG[0].name,
      'Medium',
      'Open',
      'Today · 08:10',
    ],
    [
      'INC-203',
      'Sample schedule window missed',
      DEMO_COMPANY_CONFIG[7].name,
      'High',
      'Investigating',
      'Nov 10 · 14:26',
    ],
    [
      'INC-202',
      'Sample access review due',
      DEMO_COMPANY_CONFIG[8].name,
      'Low',
      'Resolved',
      'Nov 8 · 09:42',
    ],
  ];
  const visible = rows.filter((row) => filter === 'All incidents' || row[4] === filter);
  return (
    <>
      <PageTitle
        title="Incidents"
        description="Track communication workflow issues and their response status."
        action={
          <button
            className="btn btn-primary"
            onClick={() => window.alert('Demo only: incident creation is not connected.')}
          >
            ＋ Report incident
          </button>
        }
      />
      <div className="filter-row">
        <select
          className="select-field"
          aria-label="Filter incidents"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          <option>All incidents</option>
          <option>Open</option>
          <option>Investigating</option>
          <option>Resolved</option>
        </select>
        <select className="select-field" aria-label="Filter incident priority">
          <option>All priorities</option>
          <option>High</option>
          <option>Medium</option>
          <option>Low</option>
        </select>
      </div>
      <SectionPanel
        title="Incident register"
        subtitle="Fictional sample incidents for the demo workspace"
      >
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Reference</th>
                <th>Incident</th>
                <th>Company</th>
                <th>Priority</th>
                <th>Status</th>
                <th>Updated</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((row) => (
                <tr key={row[0]}>
                  {row.map((value, index) => (
                    <td key={`${row[0]}-${index}`}>
                      {index === 3 || index === 4 ? <DemoStatusChip value={value} /> : value}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </SectionPanel>
    </>
  );
}
