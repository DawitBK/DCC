/**
 * Every screen of the signed-in workspace and the address segment it lives at.
 * A screen with a detail page also answers at `/<segment>/<id>` (see `DETAIL_SCREENS`).
 */
export const WORKSPACE_ROUTES = {
  dashboard: 'dashboard',
  myWork: 'my-work',
  notifications: 'notifications',
  composer: 'create-content',
  content: 'content',
  approvals: 'approvals',
  inbox: 'inbox',
  publishing: 'publishing',
  calendar: 'calendar',
  analytics: 'analytics',
  accounts: 'social-accounts',
  companies: 'companies',
  engine: 'engine',
  access: 'governance',
  roles: 'roles',
  policies: 'approval-policies',
  incidents: 'incidents',
  audit: 'audit',
  security: 'security',
  profile: 'profile',
  help: 'help',
} as const;

export type WorkspaceScreen = keyof typeof WORKSPACE_ROUTES;

/** Screens that open one record at `/<segment>/<id>`. The screen reads the id from the workspace (`detailId`). */
export const DETAIL_SCREENS: readonly WorkspaceScreen[] = [
  'content',
  'accounts',
  'companies',
  'access',
  'incidents',
  'publishing',
];

const SCREENS_BY_SEGMENT = Object.fromEntries(
  Object.entries(WORKSPACE_ROUTES).map(([screen, segment]) => [segment, screen]),
) as Record<string, WorkspaceScreen>;

export function screenForSegment(segment: string | undefined): WorkspaceScreen | undefined {
  return segment ? SCREENS_BY_SEGMENT[segment] : undefined;
}

/** `usePathname()` has no base path: `/content/abc` is the screen `content` and the id `abc`. */
export function parseWorkspacePath(pathname: string): {
  screen?: WorkspaceScreen;
  id: string | null;
} {
  const [segment, id] = pathname.split('/').filter(Boolean);
  const screen = screenForSegment(segment);
  return {
    screen,
    id: screen && DETAIL_SCREENS.includes(screen) && id ? decodeURIComponent(id) : null,
  };
}

export function screenForPath(pathname: string): WorkspaceScreen | undefined {
  return parseWorkspacePath(pathname).screen;
}

/** The address of a screen (and of one record on it), without the base path (the router adds it). */
export function workspaceHref(
  screen: WorkspaceScreen,
  options: { id?: string | null; companyId?: string | null; params?: Record<string, string> } = {},
): string {
  const query = new URLSearchParams(options.params ?? {});
  if (options.companyId) query.set('companyId', options.companyId);
  const text = query.toString();
  const id = options.id ? `/${encodeURIComponent(options.id)}` : '';
  return `/${WORKSPACE_ROUTES[screen]}${id}${text ? `?${text}` : ''}`;
}

/** The browser tab title of each screen ("Publishing · DCC"), so a person with several tabs open can tell them apart. */
export const SCREEN_TITLES: Record<WorkspaceScreen, string> = {
  dashboard: 'Dashboard',
  myWork: 'My work',
  notifications: 'Notifications',
  composer: 'Create content',
  content: 'Content library',
  approvals: 'Review and approvals',
  inbox: 'Unified inbox',
  publishing: 'Publishing',
  calendar: 'Content calendar',
  analytics: 'Analytics and reports',
  accounts: 'Social accounts',
  companies: 'Companies and brands',
  engine: 'Publishing engine',
  access: 'Access governance',
  roles: 'Roles and permissions',
  policies: 'Approval rules',
  incidents: 'Incidents',
  audit: 'Activity audit',
  security: 'Security center',
  profile: 'My profile and access',
  help: 'Help and guides',
};
