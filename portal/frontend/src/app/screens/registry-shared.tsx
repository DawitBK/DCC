'use client';

import {
  useEffect,
  useId,
  useMemo,
  useState,
  type CSSProperties,
  type MouseEvent,
  type ReactNode,
} from 'react';
import {
  PERMISSIONS,
  ROLE_LABELS,
  type BrandDto,
  type MembershipRecordDto,
  type Permission,
  type SocialAccountDto,
} from '@dcc/contracts';
import { Dialog, DialogActions } from '@/components/dialog';
import { ErrorBox } from '@/components/error-box';
import { StatusChip } from '@/components/status-chip';
import { Callout } from '@/components/kit/parts';
import { ApiRequestError, apiFetch } from '@/lib/browser-api';
import { withBasePath } from '@/lib/base-path';
import { PLATFORM_LABELS } from '@/lib/labels';
import { needsRoleHint } from '@/lib/permissions-ui';
import { toApiError, useAction } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { workspaceHref, type WorkspaceScreen } from '@/lib/workspace-routes';
import './registry-shared.css';

const SHARED_TEXT = {
  opensNewTab: '(opens in a new tab)',
  notShown: 'Not shown to your role',
  you: 'You',
  groupLevel: 'Whole group',
  sso: 'Set by the SSO',
  dccSource: 'Set in DCC',
  working: 'One moment…',
  cancel: 'Cancel',
  loading: 'Loading',
  viewOnlyTitle: 'You can look, but not change',
  viewOnlyBody: (label: string, roles: string) =>
    `${label} needs one of these roles: ${roles}. The buttons that need it are shown greyed out, with the reason beside them.`,
  noAccess: (what: string) => `${what} is not shown to your role`,
};

/** Is it a plain left click? Then the app opens the screen itself; anything else (new tab, copy link) uses the real address. */
function plainClick(event: MouseEvent): boolean {
  return !(
    event.defaultPrevented ||
    event.button !== 0 ||
    event.metaKey ||
    event.ctrlKey ||
    event.shiftKey ||
    event.altKey
  );
}

/**
 * A real link to another screen or record. A plain click moves inside the app, keeping the chosen company;
 * "open in a new tab" and "copy link" use the address, with the base path the app is served under.
 */
export function RecordLink({
  screen,
  id,
  params,
  children,
  className = 'rg-link',
  label,
  keepCompany = true,
}: {
  screen: WorkspaceScreen;
  id?: string | null;
  params?: Record<string, string>;
  children: ReactNode;
  className?: string;
  label?: string;
  /** false = do not carry the top-bar company over (a link to a record of another company). */
  keepCompany?: boolean;
}) {
  const { open, companyId } = useWorkspace();
  const href = withBasePath(
    workspaceHref(screen, { id, params, companyId: keepCompany ? companyId : null }),
  );
  return (
    <a
      className={className}
      href={href}
      aria-label={label}
      onClick={(event) => {
        if (!plainClick(event)) return;
        event.preventDefault();
        open(screen, id ?? null, params);
      }}
    >
      {children}
    </a>
  );
}

/** A person's name, linking to their page when this viewer may open people pages and the person is one they may see. */
export function PersonName({ userId, emptyText }: { userId: string | null; emptyText?: string }) {
  const { me, people, can, personName } = useWorkspace();
  if (!userId) return <span className="rg-muted">{emptyText ?? '—'}</span>;
  const known = userId === me.user.id || (people ?? []).some((person) => person.id === userId);
  const name =
    userId === me.user.id ? `${personName(userId)} (${me.user.displayName})` : personName(userId);
  return can('user.read') && known ? (
    <RecordLink screen="access" id={userId} keepCompany={false}>
      {name}
    </RecordLink>
  ) : (
    <>{name}</>
  );
}

export function CompanyLink({ companyId }: { companyId: string }) {
  const { companyName, can } = useWorkspace();
  return can('company.read') ? (
    <RecordLink screen="companies" id={companyId} keepCompany={false}>
      {companyName(companyId)}
    </RecordLink>
  ) : (
    <>{companyName(companyId)}</>
  );
}

export function AccountLink({
  account,
  tab,
}: {
  account: Pick<SocialAccountDto, 'id' | 'displayName' | 'platform'>;
  tab?: string;
}) {
  return (
    <RecordLink
      screen="accounts"
      id={account.id}
      params={tab ? { tab } : undefined}
      keepCompany={false}
    >
      {account.displayName} ({PLATFORM_LABELS[account.platform]})
    </RecordLink>
  );
}

/** The two-letter network mark and the network's name. */
export function PlatformBadge({ platform }: { platform: SocialAccountDto['platform'] }) {
  return (
    <span className="rg-platform">
      <span className="account-icon" aria-hidden="true">
        {platform.slice(0, 2).toUpperCase()}
      </span>
      {PLATFORM_LABELS[platform]}
    </span>
  );
}

/** The engine's practice channels: nothing sent to them reaches a real network. */
export function isPracticeChannel(engineChannelId: string | null | undefined): boolean {
  return Boolean(engineChannelId?.startsWith('fake-'));
}

/**
 * A button the person may not use stays visible and says why, instead of vanishing: it is greyed out, still
 * reachable with the keyboard (`aria-disabled`, not `disabled`) and the reason is attached to it. `compact`
 * keeps the reason for screen readers and as a tooltip only (for rows of a table, where the page already
 * carries one "you can look, but not change" note).
 */
export function GatedButton({
  allowed,
  permission,
  reason,
  className = 'btn btn-outline',
  onClick,
  children,
  compact = false,
  busy = false,
  type = 'button',
  label,
}: {
  allowed: boolean;
  permission: Permission;
  /** Overrides the standard "needs one of these roles" sentence (for example when the rule is not a permission). */
  reason?: string;
  className?: string;
  onClick?: () => void;
  children: ReactNode;
  compact?: boolean;
  busy?: boolean;
  type?: 'button' | 'submit';
  label?: string;
}) {
  const reasonId = useId();
  if (allowed)
    return (
      <button
        type={type}
        className={className}
        onClick={onClick}
        disabled={busy}
        aria-label={label}
      >
        {children}
      </button>
    );
  const why = reason ?? needsRoleHint(permission);
  return (
    <span className="rg-gated">
      <button
        type="button"
        className={`${className} rg-gated-button`}
        aria-disabled="true"
        aria-describedby={reasonId}
        aria-label={label}
        title={why}
        onClick={(event) => event.preventDefault()}
      >
        {children}
      </button>
      <small id={reasonId} className={compact ? 'visually-hidden' : 'rg-gated-reason'}>
        {why}
      </small>
    </span>
  );
}

/** One note per screen or tab: the person can read this but not change it, and which roles can. */
export function ViewOnlyNote({
  permission,
  children,
}: {
  permission: Permission;
  children?: ReactNode;
}) {
  const hint = needsRoleHint(permission);
  return (
    <Callout tone="info" title={SHARED_TEXT.viewOnlyTitle}>
      {children ?? hint}
    </Callout>
  );
}

/** A section the person's role is not allowed to read, said plainly (never a blank panel or a bare error). */
export function NoAccessNote({ permission, what }: { permission: Permission; what: string }) {
  return (
    <Callout tone="info" title={SHARED_TEXT.noAccess(what)}>
      {needsRoleHint(permission)}
    </Callout>
  );
}

/** A row of lines that shimmer while the first answer is on its way. */
export function LoadingBlock({ lines = 3, label }: { lines?: number; label?: string }) {
  return (
    <div
      className="rg-loading"
      role="status"
      aria-live="polite"
      aria-label={label ?? SHARED_TEXT.loading}
    >
      {Array.from({ length: lines }, (_, index) => (
        <span
          key={index}
          className="kit-skeleton"
          style={{ width: `${92 - ((index * 17) % 38)}%`, height: 16 }}
        />
      ))}
      <span className="visually-hidden">{label ?? SHARED_TEXT.loading}</span>
    </div>
  );
}

/** The facts at the top of a list or a detail page. */
export function FactStrip({ children, columns }: { children: ReactNode; columns?: number }) {
  return (
    <div
      className="kit-facts rg-facts"
      data-cols={columns}
      style={columns ? ({ '--rg-cols': columns } as CSSProperties) : undefined}
    >
      {children}
    </div>
  );
}

/** The kind of membership: a role, where it applies, and who set it (DCC or the SSO). */
export function MembershipLine({
  membership,
  companyLabel,
}: {
  membership: Pick<MembershipRecordDto, 'role' | 'companyId' | 'source'>;
  companyLabel: string | null;
}) {
  return (
    <span className="rg-membership">
      <strong>{ROLE_LABELS[membership.role]}</strong>
      <span className="rg-scope">
        {membership.companyId ? companyLabel : SHARED_TEXT.groupLevel}
      </span>
      {membership.source === 'idp' && <StatusChip label={SHARED_TEXT.sso} tone="blue" />}
    </span>
  );
}

/**
 * A yes/no confirmation for a risky change, with what it will do written out. The answer of the API is shown
 * in the dialog when it refuses; the dialog closes only after the API accepted.
 */
export function ConfirmDialog({
  title,
  children,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: {
  title: string;
  children: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  /** Does the change. It throws when the API refuses; the refusal is then shown in the dialog, with its request id. */
  onConfirm: () => Promise<unknown>;
  onClose: () => void;
}) {
  const action = useAction();
  return (
    <Dialog title={title} onClose={onClose}>
      <div className="rg-confirm-body">{children}</div>
      <ErrorBox error={action.error} />
      <DialogActions>
        <button type="button" className="btn btn-outline" onClick={onClose}>
          {SHARED_TEXT.cancel}
        </button>
        <button
          type="button"
          className={danger ? 'btn btn-danger' : 'btn btn-primary'}
          disabled={action.busy}
          onClick={async () => {
            const failure = await action.run(onConfirm);
            if (!failure) onClose();
          }}
        >
          {action.busy ? SHARED_TEXT.working : confirmLabel}
        </button>
      </DialogActions>
    </Dialog>
  );
}

/** Every area of the product that has permissions, with its permissions in catalogue order. Derived from `PERMISSIONS`. */
export type PermissionArea = { id: string; label: string; permissions: Permission[] };

const AREA_LABELS: Record<string, string> = {
  company: 'Companies',
  brand: 'Brands',
  user: 'People and roles',
  account: 'Social accounts',
  content: 'Content',
  approval_policy: 'Approval rules',
  publishing: 'Publishing freeze',
  audit: 'Audit trail',
  security: 'Security',
  incident: 'Incidents',
  report: 'Reports',
  inbox: 'Inbox',
};

export const PERMISSION_AREAS: PermissionArea[] = (() => {
  const byArea = new Map<string, Permission[]>();
  for (const permission of PERMISSIONS) {
    const area = permission.split('.')[0]!;
    byArea.set(area, [...(byArea.get(area) ?? []), permission]);
  }
  return [...byArea].map(([id, permissions]) => ({
    id,
    label: AREA_LABELS[id] ?? id,
    permissions,
  }));
})();

/** `GET /api/companies/:id/brands` for several companies at once (needs `brand.read`). */
export function useBrands(companyIds: string[], enabled: boolean) {
  const key = companyIds.join(',');
  const [state, setState] = useState<{
    key: string;
    byCompany: Record<string, BrandDto[]>;
    error: ApiRequestError | null;
  }>({ key: '', byCompany: {}, error: null });
  const [version, setVersion] = useState(0);
  useEffect(() => {
    if (!enabled || !key) return;
    let current = true;
    Promise.all(
      key.split(',').map(async (id) => {
        try {
          return [id, await apiFetch<BrandDto[]>(`/companies/${id}/brands`), null] as const;
        } catch (error) {
          return [id, [] as BrandDto[], toApiError(error)] as const;
        }
      }),
    ).then((entries) => {
      if (!current) return;
      setState({
        key,
        byCompany: Object.fromEntries(entries.map(([id, list]) => [id, list])),
        error: entries.find((entry) => entry[2])?.[2] ?? null,
      });
    });
    return () => {
      current = false;
    };
  }, [key, enabled, version]);
  return useMemo(
    () => ({
      byCompany: state.byCompany,
      error: state.error,
      loaded: state.key === key || !enabled || !key,
      reload: () => setVersion((value) => value + 1),
    }),
    [state, key, enabled],
  );
}
