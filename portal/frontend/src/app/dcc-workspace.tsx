'use client';

import { Fragment, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type {
  CompanyDto,
  DashboardDto,
  MeResponse,
  NotificationDto,
  Permission,
  UserDto,
} from '@dcc/contracts';
import { PageTitle } from '@/components/page-title';
import { ErrorBox } from '@/components/error-box';
import { NotificationBell } from '@/components/notification-bell';
import { RoleChooser, RoleSwitcher, roleChoiceMade, rolesOf } from '@/components/role-chooser';
import { SignOutButton } from '@/components/sign-out-button';
import { ToastProvider } from '@/components/toast';
import { screenAllowed, WorkspaceShell } from '@/components/workspace-shell';
import { canIn, hasGroupScope } from '@/lib/access';
import { shortId } from '@/lib/format';
import { useApiData } from '@/lib/use-api';
import { WorkspaceProvider, type Workspace } from '@/lib/workspace';
import { parseWorkspacePath, workspaceHref, type WorkspaceScreen } from '@/lib/workspace-routes';
import { CommandPalette } from '@/components/kit/command-palette';
import { AccessScreen } from './screens/access-screen';
import { PoliciesScreen } from './screens/policies-screen';
import { AccountsScreen } from './screens/accounts-screen';
import { AnalyticsScreen } from './screens/analytics-screen';
import { ApprovalsScreen } from './screens/approvals-screen';
import { AuditScreen } from './screens/audit-screen';
import { CalendarScreen } from './screens/calendar-screen';
import { CompaniesScreen } from './screens/companies-screen';
import { ComposerScreen } from './screens/composer-screen';
import { DashboardScreen } from './screens/dashboard-screen';
import { InboxScreen } from './screens/inbox-screen';
import { IncidentsScreen } from './screens/incidents-screen';
import { PublishingScreen } from './screens/publishing-screen';
import { SecurityScreen } from './screens/security-screen';
import { ContentScreen } from './screens/content-screen';
import { EngineScreen } from './screens/engine-screen';
import { HelpScreen } from './screens/help-screen';
import { MyWorkScreen } from './screens/my-work-screen';
import { NotificationsScreen } from './screens/notifications-screen';
import { ProfileScreen } from './screens/profile-screen';
import { RolesScreen } from './screens/roles-screen';

const ALL = '';

const TEXT = {
  groupName: 'Kerchanshe Group',
  allCompanies: 'All companies',
  companyWorkspace: 'Company workspace',
  noRoleTitle: 'No DCC role is assigned to this account.',
  noRoleBody:
    'You are signed in. Ask a DCC administrator to assign your role and company access before continuing.',
  brandMark: 'DCC',
  you: 'You',
  person: (id: string) => `Person ${id}`,
  nobody: '—',
  unknownCompany: (id: string) => `Company ${id}`,
  companiesError: 'The list of companies could not be loaded',
  notAllowedEyebrow: 'Not available',
  notAllowedTitle: 'This screen is not available for your current role',
  notAllowedBody:
    'Your permissions do not include this screen in the selected company scope. Choose another role or ask a DCC administrator for access.',
};

/** Where a notification takes the person: the screen that shows the thing it is about. */
function screenForNotification(notification: NotificationDto): WorkspaceScreen {
  switch (notification.eventType) {
    case 'content.submitted':
      return 'approvals';
    case 'content.approved':
    case 'content.rejected':
      return 'content';
    case 'publishing.frozen':
      return 'publishing';
    case 'incident.opened':
      return 'incidents';
    case 'inbox.assigned':
      return 'inbox';
  }
}

/**
 * The signed-in workspace. Everything it shows comes from the DCC API; it imports nothing from the
 * sample data (`screens/demo`, `lib/demo-data`), so sample figures can never appear after sign-in.
 */
export function DccWorkspace({
  me,
  initialScreen = 'dashboard',
}: {
  me: MeResponse;
  initialScreen?: WorkspaceScreen;
}) {
  if (me.memberships.length === 0) {
    return (
      <main className="empty-state" style={{ minHeight: '100vh' }}>
        <div>
          <div className="brand-mark" style={{ margin: '0 auto 18px' }}>
            {TEXT.brandMark}
          </div>
          <strong>{TEXT.noRoleTitle}</strong>
          <p>{TEXT.noRoleBody}</p>
          <div style={{ marginTop: 20 }}>
            <SignOutButton />
          </div>
        </div>
      </main>
    );
  }
  return (
    <ToastProvider>
      <RoleGate me={me}>
        {/* The key re-reads every list when the role in force changes: nothing of the old role stays on screen. */}
        <SignedInWorkspace key={me.actingRole ?? ALL} me={me} initialScreen={initialScreen} />
      </RoleGate>
    </ToastProvider>
  );
}

/**
 * A person with more than one role chooses how to work before the workspace opens, once per browser
 * session. The choice lives in the API session (`PUT /api/me/acting-role`); `/api/me` is then read again.
 */
function RoleGate({ me, children }: { me: MeResponse; children: ReactNode }) {
  const router = useRouter();
  const mustAsk = rolesOf(me).length > 1 && !me.actingRole;
  // null = not known yet (the browser's session storage can only be read after the page is there).
  const [asked, setAsked] = useState<boolean | null>(mustAsk ? null : true);
  const userId = me.user.id;
  useEffect(() => {
    setAsked(mustAsk ? roleChoiceMade(userId) : true);
  }, [mustAsk, userId]);

  if (asked === null) return null;
  if (!asked) {
    return (
      <RoleChooser
        me={me}
        onChanged={() => {
          setAsked(true);
          router.refresh();
        }}
        onSkip={() => setAsked(true)}
      />
    );
  }
  return children;
}

function SignedInWorkspace({
  me,
  initialScreen,
}: {
  me: MeResponse;
  initialScreen: WorkspaceScreen;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const parsed = parseWorkspacePath(pathname);
  const screen = parsed.screen ?? initialScreen;
  const detailId = parsed.id;
  const [bellKey, setBellKey] = useState(0);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const counts = useApiData<DashboardDto>('/dashboard', { background: true });

  const companiesApi = useApiData<CompanyDto[]>('/companies');
  const peopleApi = useApiData<UserDto[]>(me.permissions.includes('user.read') ? '/users' : null);
  const companies = useMemo(() => companiesApi.data ?? [], [companiesApi.data]);
  const people = peopleApi.data;
  const peopleError = peopleApi.error;

  // The company in the address (?companyId=) is the chosen one, if the API lists it for this person.
  // Someone who can see exactly one company is always in that company.
  const wanted = searchParams.get('companyId');
  const offerAll = hasGroupScope(me) || companies.length > 1;
  const companyId =
    companies.find((item) => item.id === wanted)?.id ??
    (!offerAll && companies[0] ? companies[0].id : null);

  // router.push / router.replace add the base path by themselves.
  const hrefFor = useCallback(
    (target: WorkspaceScreen, company: string | null) =>
      workspaceHref(target, { companyId: company }),
    [],
  );
  const go = useCallback(
    (target: WorkspaceScreen) => router.push(hrefFor(target, companyId)),
    [router, hrefFor, companyId],
  );

  const open = useCallback(
    (target: WorkspaceScreen, id?: string | null, params?: Record<string, string>) =>
      router.push(workspaceHref(target, { id, companyId, params })),
    [router, companyId],
  );

  // Ctrl K (or Cmd K) opens the search and jump palette from anywhere in the workspace.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen((value) => !value);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const reloadCompanies = companiesApi.reload;
  const reloadPeople = peopleApi.reload;
  const workspace = useMemo<Workspace>(() => {
    const scopeCompanies = companyId
      ? companies.filter((item) => item.id === companyId)
      : companies;
    return {
      me,
      companies,
      companyId,
      scopeCompanies,
      companyName: (id) =>
        id === null
          ? TEXT.groupName
          : (companies.find((item) => item.id === id)?.name ?? TEXT.unknownCompany(shortId(id))),
      can: (permission: Permission, company?: string | null) => canIn(me, permission, company),
      companiesWhere: (permission) =>
        scopeCompanies.filter((item) => canIn(me, permission, item.id)),
      people,
      peopleError,
      personName: (userId) => {
        if (!userId) return TEXT.nobody;
        if (userId === me.user.id) return TEXT.you;
        const person = people?.find((item) => item.id === userId);
        return person ? person.displayName || person.email : TEXT.person(shortId(userId));
      },
      go,
      open,
      detailId,
      screenAllowed: (target) => screenAllowed(me, target),
      reloadCompanies,
      reloadPeople,
      refreshNotifications: () => setBellKey((value) => value + 1),
    };
  }, [
    me,
    companies,
    companyId,
    people,
    peopleError,
    go,
    open,
    detailId,
    reloadCompanies,
    reloadPeople,
  ]);

  return (
    <WorkspaceProvider value={workspace}>
      <WorkspaceShell
        me={me}
        screen={screen}
        onNavigate={go}
        contextLabel={companyId ? TEXT.companyWorkspace : TEXT.groupName}
        companyValue={companyId ?? ALL}
        companyOptions={[
          ...(offerAll || companies.length === 0
            ? [{ value: ALL, label: `${TEXT.groupName} · ${TEXT.allCompanies}` }]
            : []),
          ...companies.map((item) => ({ value: item.id, label: item.name })),
        ]}
        onCompanyChange={(value) =>
          router.replace(hrefFor(screen, value || null), { scroll: false })
        }
        tools={
          <NotificationBell
            refreshKey={bellKey}
            onOpenTarget={(notification) =>
              router.push(hrefFor(screenForNotification(notification), notification.companyId))
            }
          />
        }
        roleControl={
          rolesOf(me).length > 1 ? (
            <RoleSwitcher me={me} onChanged={() => router.refresh()} />
          ) : undefined
        }
        session={<SignOutButton compact />}
        onOpenPalette={() => setPaletteOpen(true)}
        badges={{
          approvals: counts.data?.pendingApprovals ?? undefined,
          incidents: counts.data?.openIncidents ?? undefined,
          notifications: counts.data?.unreadNotifications || undefined,
        }}
      >
        {paletteOpen && <CommandPalette onClose={() => setPaletteOpen(false)} />}
        <ErrorBox error={companiesApi.error} title={TEXT.companiesError} loading />
        {!screenAllowed(me, screen) ? (
          <PageTitle
            eyebrow={TEXT.notAllowedEyebrow}
            title={TEXT.notAllowedTitle}
            description={TEXT.notAllowedBody}
          />
        ) : (
          <Fragment key={companyId ?? ALL}>
            {screen === 'dashboard' && <DashboardScreen />}
            {screen === 'composer' && <ComposerScreen />}
            {screen === 'approvals' && <ApprovalsScreen />}
            {screen === 'publishing' && <PublishingScreen />}
            {screen === 'calendar' && <CalendarScreen />}
            {screen === 'analytics' && <AnalyticsScreen />}
            {screen === 'accounts' && <AccountsScreen />}
            {screen === 'companies' && <CompaniesScreen />}
            {screen === 'access' && <AccessScreen />}
            {screen === 'policies' && <PoliciesScreen />}
            {screen === 'audit' && <AuditScreen />}
            {screen === 'security' && <SecurityScreen />}
            {screen === 'incidents' && <IncidentsScreen />}
            {screen === 'inbox' && <InboxScreen />}
            {screen === 'myWork' && <MyWorkScreen />}
            {screen === 'notifications' && <NotificationsScreen />}
            {screen === 'content' && <ContentScreen />}
            {screen === 'engine' && <EngineScreen />}
            {screen === 'roles' && <RolesScreen />}
            {screen === 'profile' && <ProfileScreen />}
            {screen === 'help' && <HelpScreen />}
          </Fragment>
        )}
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}
