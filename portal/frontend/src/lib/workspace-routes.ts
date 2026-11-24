export const WORKSPACE_ROUTES = {
  dashboard: 'dashboard',
  composer: 'create-content',
  approvals: 'approvals',
  inbox: 'inbox',
  publishing: 'publishing',
  calendar: 'calendar',
  analytics: 'analytics',
  accounts: 'social-accounts',
  companies: 'companies',
  access: 'governance',
  policies: 'approval-policies',
  audit: 'audit',
  security: 'security',
  incidents: 'incidents',
} as const;

export type WorkspaceScreen = keyof typeof WORKSPACE_ROUTES;

const SCREENS_BY_SEGMENT = Object.fromEntries(
  Object.entries(WORKSPACE_ROUTES).map(([screen, segment]) => [segment, screen]),
) as Record<string, WorkspaceScreen>;

export function screenForSegment(segment: string | undefined): WorkspaceScreen | undefined {
  return segment ? SCREENS_BY_SEGMENT[segment] : undefined;
}

export function screenForPath(pathname: string): WorkspaceScreen | undefined {
  const segment = pathname.split('/').filter(Boolean).at(-1);
  return screenForSegment(segment);
}

/** The browser tab title of each screen ("Publishing · DCC"), so a person with several tabs open can tell them apart. */
export const SCREEN_TITLES: Record<WorkspaceScreen, string> = {
  dashboard: 'Dashboard',
  composer: 'Create content',
  approvals: 'Review and approvals',
  inbox: 'Unified inbox',
  publishing: 'Publishing',
  calendar: 'Content calendar',
  analytics: 'Analytics and reports',
  accounts: 'Social accounts',
  companies: 'Companies and brands',
  access: 'Access governance',
  policies: 'Approval rules',
  audit: 'Activity audit',
  security: 'Security center',
  incidents: 'Incidents',
};
