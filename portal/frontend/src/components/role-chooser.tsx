'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { ROLE_LABELS, SetActingRoleRequest, type MeResponse, type Role } from '@dcc/contracts';
import { ApiRequestError, apiSend } from '@/lib/browser-api';
import { ROLE_SUMMARY } from '@/lib/labels';
import { toApiError } from '@/lib/use-api';
import { ErrorBox } from './error-box';
import { ThemeToggle } from './theme-toggle';

const TEXT = {
  brandMark: 'DCC',
  title: 'Choose how you want to work',
  intro: (name: string) =>
    `${name}, you hold more than one DCC role. Choose one to see only what that role does, or work with all of them together. You can change this at any time from the top bar.`,
  all: 'All my roles together',
  allSummary: 'Everything each of your roles allows, in one workspace.',
  current: 'Current',
  working: 'One moment…',
  notAvailableTitle: 'Choosing one role is not available on this server yet',
  notAvailableBody: 'You are working with all your roles together.',
  continueAll: 'Continue with all my roles',
  switcherLabel: (current: string) => `Working as: ${current}. Change role`,
  menuTitle: 'Work as',
};

/** The words for the role in force: the acting role, the only role, or "all together". */
export function actingRoleLabel(me: MeResponse): string | null {
  const roles = rolesOf(me);
  if (me.actingRole) return ROLE_LABELS[me.actingRole];
  if (roles.length > 1) return TEXT.all;
  return roles[0] ? ROLE_LABELS[roles[0]] : null;
}

/** Every role the person holds. An API that does not send `roles` yet is read from the memberships. */
export function rolesOf(me: MeResponse): Role[] {
  const listed = (me as Partial<MeResponse>).roles;
  return listed ?? [...new Set(me.memberships.map((membership) => membership.role))];
}

const CHOSEN_KEY = 'dcc.roleChosenBy';

/**
 * Whether this person already chose in this browser tab session. Only the fact that a choice was made
 * is kept (with the person's id, so another person on the same tab is asked again); never a token.
 */
export function roleChoiceMade(userId: string): boolean {
  try {
    return window.sessionStorage.getItem(CHOSEN_KEY) === userId;
  } catch {
    return false;
  }
}

function rememberRoleChoice(userId: string): void {
  try {
    window.sessionStorage.setItem(CHOSEN_KEY, userId);
  } catch {
    // Storage switched off: the person is simply asked again next time.
  }
}

/**
 * `PUT /api/me/acting-role`. Gives back null when the API accepted it, 'unavailable' when the API has
 * no such endpoint yet (404), or the error when it refused.
 */
async function sendActingRole(role: Role | null): Promise<null | 'unavailable' | ApiRequestError> {
  try {
    await apiSend('PUT', '/me/acting-role', SetActingRoleRequest.parse({ role }));
    return null;
  } catch (failure) {
    const refused = toApiError(failure);
    return refused.status === 404 ? 'unavailable' : refused;
  }
}

type Choice = { role: Role | null; label: string; summary: string };

function choicesFor(me: MeResponse): Choice[] {
  return [
    ...rolesOf(me).map((role) => ({
      role,
      label: ROLE_LABELS[role],
      summary: ROLE_SUMMARY[role],
    })),
    { role: null, label: TEXT.all, summary: TEXT.allSummary },
  ];
}

/** What the chooser and the switcher share: send the choice, remember that one was made, report back. */
function useRoleChoice(me: MeResponse, onChanged: () => void) {
  const [busy, setBusy] = useState<Role | null | undefined>(undefined);
  const [error, setError] = useState<ApiRequestError | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const choose = async (role: Role | null): Promise<boolean> => {
    setBusy(role);
    setError(null);
    const result = await sendActingRole(role);
    setBusy(undefined);
    if (result === 'unavailable') {
      setUnavailable(true);
      return false;
    }
    if (result) {
      setError(result);
      return false;
    }
    rememberRoleChoice(me.user.id);
    onChanged();
    return true;
  };
  return { busy, error, unavailable, choose };
}

/** The screen right after sign-in for a person with more than one role. */
export function RoleChooser({
  me,
  onChanged,
  onSkip,
}: {
  me: MeResponse;
  /** The API took the choice: read `/api/me` again and show the workspace. */
  onChanged: () => void;
  /** Go on without a choice (only offered when the API cannot take one yet). */
  onSkip: () => void;
}) {
  const { busy, error, unavailable, choose } = useRoleChoice(me, onChanged);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => heading.current?.focus(), []);

  return (
    <main className="role-chooser">
      <ThemeToggle className="theme-toggle-floating" />
      <div className="role-chooser-box">
        <div className="brand-mark" aria-hidden="true">
          {TEXT.brandMark}
        </div>
        <h1 ref={heading} tabIndex={-1}>
          {TEXT.title}
        </h1>
        <p>{TEXT.intro(me.user.displayName || me.user.email)}</p>
        <ErrorBox error={error} />
        {unavailable ? (
          <div className="demo-banner" role="alert">
            <span aria-hidden="true">ⓘ</span>
            <div>
              <strong>{TEXT.notAvailableTitle}</strong>
              {TEXT.notAvailableBody}
              <div style={{ marginTop: 10 }}>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => {
                    rememberRoleChoice(me.user.id);
                    onSkip();
                  }}
                >
                  {TEXT.continueAll}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <ul className="role-card-list">
            {choicesFor(me).map((choice) => (
              <li key={choice.role ?? 'all'}>
                <button
                  type="button"
                  className={`role-card ${choice.role === null ? 'role-card-all' : ''}`}
                  disabled={busy !== undefined}
                  onClick={() => void choose(choice.role)}
                >
                  <strong>{choice.label}</strong>
                  <span>{busy === choice.role ? TEXT.working : choice.summary}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

/** The role next to the person's name in the top bar: a button that opens the same choices. */
export function RoleSwitcher({ me, onChanged }: { me: MeResponse; onChanged: () => void }) {
  const { busy, error, unavailable, choose } = useRoleChoice(me, onChanged);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLSpanElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const listId = useId();
  const current = actingRoleLabel(me) ?? '';

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      button.current?.focus();
    };
    const onPointer = (event: PointerEvent) => {
      if (!wrap.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onPointer);
    };
  }, [open]);

  return (
    <span className="role-switcher" ref={wrap}>
      <button
        ref={button}
        type="button"
        className="role-switcher-button"
        aria-expanded={open}
        aria-controls={listId}
        aria-label={TEXT.switcherLabel(current)}
        onClick={() => setOpen((value) => !value)}
      >
        {current} <span aria-hidden="true">▾</span>
      </button>
      {open && (
        <div className="role-menu" id={listId}>
          <strong className="role-menu-title">{TEXT.menuTitle}</strong>
          {error && (
            <p className="field-error" role="alert">
              {error.message}
            </p>
          )}
          {unavailable && (
            <p className="field-error" role="alert">
              {TEXT.notAvailableTitle}. {TEXT.notAvailableBody}
            </p>
          )}
          <ul>
            {choicesFor(me).map((choice) => {
              const isCurrent = (me.actingRole ?? null) === choice.role;
              return (
                <li key={choice.role ?? 'all'}>
                  <button
                    type="button"
                    className="role-menu-item"
                    aria-current={isCurrent ? 'true' : undefined}
                    disabled={busy !== undefined}
                    onClick={async () => {
                      if (isCurrent) return setOpen(false);
                      if (await choose(choice.role)) {
                        setOpen(false);
                        button.current?.focus();
                      }
                    }}
                  >
                    <span>
                      {choice.label}
                      <small>{busy === choice.role ? TEXT.working : choice.summary}</small>
                    </span>
                    {isCurrent && <span className="status status-green">{TEXT.current}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </span>
  );
}
