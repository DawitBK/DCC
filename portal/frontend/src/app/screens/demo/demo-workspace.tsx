'use client';

import { useState } from 'react';
import type { MeResponse } from '@dcc/contracts';
import { ToastProvider, useToast } from '@/components/toast';
import { WorkspaceShell } from '@/components/workspace-shell';
import {
  DEMO_COMPANIES,
  DEMO_COMPANY_CONFIG,
  DEMO_GROUP_NAME,
  DEMO_POSTS,
  type DemoPost,
  type DemoStatus,
} from '@/lib/demo-data';
import type { WorkspaceScreen } from '@/lib/workspace-routes';
import { DemoAccess } from './demo-access';
import { DemoAccounts } from './demo-accounts';
import { AnalyticsScreen as DemoAnalytics } from './demo-analytics';
import { DemoApprovals } from './demo-approvals';
import { DemoAudit } from './demo-audit';
import { DemoCalendar } from './demo-calendar';
import { DemoCompanies } from './demo-companies';
import { DemoComposer } from './demo-composer';
import { DemoDashboard } from './demo-dashboard';
import { DemoInbox } from './demo-inbox';
import { DemoIncidents } from './demo-incidents';
import { DemoPublishing } from './demo-publishing';
import { DemoSecurity } from './demo-security';

const ALL = 'All companies';

const TEXT = {
  pill: 'DEMO PREVIEW',
  notifications: 'Notifications',
  caughtUp: 'You’re all caught up in this demo workspace.',
  switchRole: 'Switch role',
  exit: 'Exit preview',
  companyWorkspace: 'Company workspace',
  bannerTitle: 'DEMO PREVIEW · Frontend only',
  bannerBody:
    'This sample role and its data are local to your browser. No DCC APIs or authentication sessions are used.',
  draftSaved: 'Draft saved in this demo only.',
  submitted: 'Sample draft moved to the review queue. Nothing was sent to the backend.',
  statusChanged: (status: string) => `Demo status changed to “${status}”.`,
  publishing: 'Publishing action simulated. No network post was made.',
  rescheduled: 'Sample schedule updated in this browser only.',
};

/**
 * The dev-only "Preview Frontend as Any Role" workspace. Everything here is SAMPLE data held in the
 * browser: it calls no API. The signed-in workspace (`../../dcc-workspace.tsx`) never imports this
 * folder, so a signed-in person can never be shown sample data.
 */
export function DemoWorkspace(props: {
  me: MeResponse;
  initialCompanyName?: string;
  onSwitchPreviewRole: () => void;
  onExitPreview: () => void;
}) {
  return (
    <ToastProvider>
      <DemoWorkspaceBody {...props} />
    </ToastProvider>
  );
}

function DemoWorkspaceBody({
  me,
  initialCompanyName,
  onSwitchPreviewRole,
  onExitPreview,
}: {
  me: MeResponse;
  initialCompanyName?: string;
  onSwitchPreviewRole: () => void;
  onExitPreview: () => void;
}) {
  const showToast = useToast();
  const [screen, setScreen] = useState<WorkspaceScreen>('dashboard');
  const [company, setCompany] = useState(initialCompanyName ?? DEMO_COMPANIES[0]!);
  const [posts, setPosts] = useState(DEMO_POSTS);

  const role = me.memberships[0]?.role;
  const isGroupScope = me.memberships.some((membership) => membership.companyId === null);
  const companyNames = isGroupScope
    ? DEMO_COMPANIES.slice(1)
    : [initialCompanyName ?? DEMO_COMPANY_CONFIG[0].name];
  const companyChoices = isGroupScope ? [ALL, ...companyNames] : companyNames;

  const addPost = (title: string, selectedCompany: string, status: DemoStatus, caption: string) =>
    setPosts((current): DemoPost[] => [
      {
        id: `DCC-${1050 + current.length}`,
        title,
        company: selectedCompany === ALL ? DEMO_COMPANY_CONFIG[0].name : selectedCompany,
        creator: me.user.displayName || 'You',
        platforms: ['Instagram'],
        status,
        date: '2026-11-17',
        time: '09:00',
        caption,
      },
      ...current,
    ]);

  return (
    <WorkspaceShell
      me={me}
      screen={screen}
      onNavigate={setScreen}
      contextLabel={company === ALL ? DEMO_GROUP_NAME : TEXT.companyWorkspace}
      companyValue={company}
      companyOptions={companyChoices.map((item) => ({
        value: item,
        label: item === ALL ? `${DEMO_GROUP_NAME} · ${ALL}` : item,
      }))}
      onCompanyChange={setCompany}
      accent={DEMO_COMPANY_CONFIG.find((item) => item.name === company)?.accent}
      pill={<span className="demo-mode-pill">{TEXT.pill}</span>}
      tools={
        <button
          className="icon-button"
          aria-label={TEXT.notifications}
          onClick={() => showToast(TEXT.caughtUp)}
        >
          ♧
        </button>
      }
      session={
        <>
          <button className="btn btn-outline preview-switch" onClick={onSwitchPreviewRole}>
            {TEXT.switchRole}
          </button>
          <button className="btn btn-outline preview-exit" onClick={onExitPreview}>
            {TEXT.exit}
          </button>
        </>
      }
      banner={
        <div className="demo-banner preview-banner">
          <span aria-hidden="true">ⓘ</span>
          <div>
            <strong>{TEXT.bannerTitle}</strong>
            {TEXT.bannerBody}
          </div>
        </div>
      }
    >
      {screen === 'dashboard' && (
        <DemoDashboard me={me} company={company} posts={posts} go={setScreen} />
      )}
      {screen === 'composer' && (
        <DemoComposer
          company={company}
          onSave={(title, selectedCompany) => {
            addPost(title, selectedCompany, 'Draft', 'Sample caption saved from the demo composer.');
            showToast(TEXT.draftSaved);
          }}
          onSubmit={(title, selectedCompany) => {
            addPost(
              title,
              selectedCompany,
              'Needs review',
              'Sample submission from the demo composer.',
            );
            showToast(TEXT.submitted);
          }}
        />
      )}
      {screen === 'approvals' && (
        <DemoApprovals
          company={company}
          posts={posts}
          update={(id, status) => {
            setPosts((current) =>
              current.map((post) => (post.id === id ? { ...post, status } : post)),
            );
            showToast(TEXT.statusChanged(status));
          }}
        />
      )}
      {screen === 'publishing' && (
        <DemoPublishing
          company={company}
          posts={posts}
          onAction={() => showToast(TEXT.publishing)}
        />
      )}
      {screen === 'calendar' && (
        <DemoCalendar
          company={company}
          posts={posts}
          showToast={showToast}
          onReschedule={(id, date, time) => {
            setPosts((current) =>
              current.map((post) => (post.id === id ? { ...post, date, time } : post)),
            );
            showToast(TEXT.rescheduled);
          }}
        />
      )}
      {screen === 'analytics' && (
        <DemoAnalytics company={company} isGroupAdmin={role === 'group_admin'} />
      )}
      {screen === 'accounts' && <DemoAccounts company={company} />}
      {screen === 'companies' && <DemoCompanies company={company} />}
      {screen === 'access' && <DemoAccess company={company} />}
      {screen === 'audit' && <DemoAudit company={company} />}
      {screen === 'security' && <DemoSecurity />}
      {screen === 'incidents' && <DemoIncidents />}
      {screen === 'inbox' && <DemoInbox />}
    </WorkspaceShell>
  );
}
