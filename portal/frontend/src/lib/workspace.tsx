'use client';

import { createContext, useContext } from 'react';
import type { CompanyDto, MeResponse, Permission, UserDto } from '@dcc/contracts';
import type { ApiRequestError } from './browser-api';
import type { WorkspaceScreen } from './workspace-routes';

/** What every signed-in screen can ask the workspace for. All of it comes from the API. */
export type Workspace = {
  me: MeResponse;
  /** Every company the API lets this person see (`GET /api/companies`). */
  companies: CompanyDto[];
  /** The company chosen in the top bar; null = all companies. */
  companyId: string | null;
  /** The chosen company, or all of them when none is chosen. */
  scopeCompanies: CompanyDto[];
  companyName: (companyId: string | null) => string;
  /** UI visibility only (from `GET /api/me`). No company id = "anywhere". The API re-checks. */
  can: (permission: Permission, companyId?: string | null) => boolean;
  /** The companies in scope where the person holds the permission (for company pickers in forms). */
  companiesWhere: (permission: Permission) => CompanyDto[];
  /** People this person may see (`GET /api/users`); null when they hold no `user.read`. */
  people: UserDto[] | null;
  /** Why the people list could not be read, when it could not. */
  peopleError: ApiRequestError | null;
  /** A person's name for display: "You", their name when the people list has them, else a short id. */
  personName: (userId: string | null) => string;
  go: (screen: WorkspaceScreen) => void;
  reloadCompanies: () => void;
  reloadPeople: () => void;
  /** Ask the bell to re-read the unread count (after an action that may have notified someone). */
  refreshNotifications: () => void;
};

const WorkspaceContext = createContext<Workspace | null>(null);
export const WorkspaceProvider = WorkspaceContext.Provider;

export function useWorkspace(): Workspace {
  const workspace = useContext(WorkspaceContext);
  if (!workspace) throw new Error('useWorkspace must be used inside the signed-in workspace.');
  return workspace;
}
