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
