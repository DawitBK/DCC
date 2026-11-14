'use client';

import { useCallback, useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type {
  CompanyDto,
  MeResponse,
  NotificationDto,
  Permission,
  UserDto,
} from '@dcc/contracts';
import { EmptyState } from '@/components/empty-state';
import { ErrorBox } from '@/components/error-box';
import { NotificationBell } from '@/components/notification-bell';
import { SignOutButton } from '@/components/sign-out-button';
import { ToastProvider } from '@/components/toast';
import { screenAllowed, WorkspaceShell } from '@/components/workspace-shell';
import { canIn, hasGroupScope } from '@/lib/access';
import { shortId } from '@/lib/format';
import { useApiData } from '@/lib/use-api';
import { WorkspaceProvider, type Workspace } from '@/lib/workspace';
import { screenForPath, WORKSPACE_ROUTES, type WorkspaceScreen } from '@/lib/workspace-routes';
import { AccessScreen } from './screens/access-screen';
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

const ALL = '';

const TEXT = {
  groupName: 'Kerchanshe Group',
  allCompanies: 'All companies',
  companyWorkspace: 'Company workspace',
  noRoleTitle: 'You’re signed in, but don’t have a DCC role yet.',
  noRoleBody: 'Ask a DCC administrator to assign your role and company access.',
  brandMark: 'DCC',
  you: 'You',
  person: (id: string) => `Person ${id}`,
  nobody: '—',
  unknownCompany: (id: string) => `Company ${id}`,
  companiesError: 'The list of companies could not be loaded',
  notAllowedTitle: 'This screen is not part of your role',
  notAllowedBody: 'Your DCC role does not include it. Ask a DCC administrator if you need it.',
};

/** Where a notification takes the person: the screen that shows the thing it is about. */
function screenForNotification(notification: NotificationDto): WorkspaceScreen {
  switch (notification.eventType) {
    case 'content.submitted':
      return 'approvals';
    case 'content.approved':
    case 'content.rejected':
      return 'composer';
    case 'publishing.frozen':
      return 'publishing';
    case 'incident.opened':
      return 'incidents';
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
      <SignedInWorkspace me={me} initialScreen={initialScreen} />
    </ToastProvider>
  );
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
  const screen = screenForPath(pathname) ?? initialScreen;
  const [bellKey, setBellKey] = useState(0);

  const companiesApi = useApiData<CompanyDto[]>('/companies');
  const peopleApi = useApiData<UserDto[]>(me.permissions.includes('user.read') ? '/users' : null);
  const companies = useMemo(() => companiesApi.data ?? [], [companiesApi.data]);
  const people = peopleApi.data;

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
      `/${WORKSPACE_ROUTES[target]}${company ? `?companyId=${encodeURIComponent(company)}` : ''}`,
    [],
  );
  const go = useCallback(
    (target: WorkspaceScreen) => router.push(hrefFor(target, companyId)),
    [router, hrefFor, companyId],
  );

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
      personName: (userId) => {
        if (!userId) return TEXT.nobody;
        if (userId === me.user.id) return TEXT.you;
        const person = people?.find((item) => item.id === userId);
        return person ? person.displayName || person.email : TEXT.person(shortId(userId));
      },
      go,
      reloadCompanies,
      reloadPeople,
      refreshNotifications: () => setBellKey((value) => value + 1),
    };
  }, [me, companies, companyId, people, go, reloadCompanies, reloadPeople]);

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
        session={<SignOutButton compact />}
      >
        <ErrorBox error={companiesApi.error} title={TEXT.companiesError} loading />
        {!screenAllowed(me, screen) ? (
          <EmptyState title={TEXT.notAllowedTitle}>{TEXT.notAllowedBody}</EmptyState>
        ) : (
          <>
            {screen === 'dashboard' && <DashboardScreen />}
            {screen === 'composer' && <ComposerScreen />}
            {screen === 'approvals' && <ApprovalsScreen />}
            {screen === 'publishing' && <PublishingScreen />}
            {screen === 'calendar' && <CalendarScreen />}
            {screen === 'analytics' && <AnalyticsScreen />}
            {screen === 'accounts' && <AccountsScreen />}
            {screen === 'companies' && <CompaniesScreen />}
            {screen === 'access' && <AccessScreen />}
            {screen === 'audit' && <AuditScreen />}
            {screen === 'security' && <SecurityScreen />}
            {screen === 'incidents' && <IncidentsScreen />}
            {screen === 'inbox' && <InboxScreen />}
          </>
        )}
      </WorkspaceShell>
    </WorkspaceProvider>
  );
}
