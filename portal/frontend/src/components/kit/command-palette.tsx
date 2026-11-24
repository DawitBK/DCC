'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ContentItemDto, SocialAccountDto } from '@dcc/contracts';
import { PLATFORM_LABELS } from '@/lib/labels';
import { excerpt } from '@/lib/format';
import { useApiData } from '@/lib/use-api';
import { useWorkspace } from '@/lib/workspace';
import { NAV } from '../workspace-shell';
import type { WorkspaceScreen } from '@/lib/workspace-routes';

type Entry = {
  id: string;
  kind: string;
  label: string;
  hint?: string;
  run: () => void;
};

const TEXT = {
  placeholder: 'Search screens, companies, accounts, people and posts',
  label: 'Search and jump',
  empty: 'Nothing found.',
  hint: 'Enter opens, arrow keys move, Escape closes',
  screen: 'Screen',
  company: 'Company',
  account: 'Account',
  person: 'Person',
  post: 'Post',
  action: 'Action',
  createPost: 'Create a post',
  openApprovals: 'Open the approvals queue',
  freezePublishing: 'Freeze publishing',
};

/**
 * Search and jump (Ctrl K). It finds screens, companies, accounts, people and posts in what the API already
 * lets this person see, and opens them. It never reaches data the screens could not: it reads the same lists.
 */
export function CommandPalette({ onClose }: { onClose: () => void }) {
  const workspace = useWorkspace();
  const { me, companies, people, can, open, screenAllowed } = workspace;
  const accounts = useApiData<SocialAccountDto[]>(can('account.read') ? '/social-accounts' : null);
  const content = useApiData<ContentItemDto[]>(can('content.read') ? '/content-items' : null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLUListElement>(null);

  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    input.current?.focus();
    return () => before?.focus?.();
  }, []);

  const entries = useMemo<Entry[]>(() => {
    const out: Entry[] = [];
    const go = (screen: WorkspaceScreen, id?: string) => () => {
      open(screen, id ?? null);
      onClose();
    };
    for (const item of NAV) {
      if (screenAllowed(item.id))
        out.push({
          id: `s-${item.id}`,
          kind: TEXT.screen,
          label: item.label,
          hint: item.group,
          run: go(item.id),
        });
    }
    if (me.permissions.includes('content.create'))
      out.push({ id: 'a-create', kind: TEXT.action, label: TEXT.createPost, run: go('composer') });
    if (me.permissions.includes('content.review'))
      out.push({
        id: 'a-approvals',
        kind: TEXT.action,
        label: TEXT.openApprovals,
        run: go('approvals'),
      });
    if (me.permissions.includes('publishing.freeze'))
      out.push({
        id: 'a-freeze',
        kind: TEXT.action,
        label: TEXT.freezePublishing,
        run: go('publishing'),
      });
    for (const company of companies)
      out.push({
        id: `c-${company.id}`,
        kind: TEXT.company,
        label: company.name,
        hint: company.slug,
        run: go('companies', company.id),
      });
    for (const account of accounts.data ?? [])
      out.push({
        id: `acc-${account.id}`,
        kind: TEXT.account,
        label: `${account.displayName} (${PLATFORM_LABELS[account.platform]})`,
        hint: `${account.handle} · ${workspace.companyName(account.companyId)}`,
        run: go('accounts', account.id),
      });
    for (const person of people ?? [])
      out.push({
        id: `p-${person.id}`,
        kind: TEXT.person,
        label: person.displayName || person.email,
        hint: person.email,
        run: go('access', person.id),
      });
    for (const item of content.data ?? [])
      out.push({
        id: `i-${item.id}`,
        kind: TEXT.post,
        label: excerpt(item.preview?.excerpt ?? item.id, 70),
        hint: `${workspace.companyName(item.companyId)} · ${item.status}`,
        run: go('content', item.id),
      });
    return out;
  }, [me, companies, people, accounts.data, content.data, open, onClose, screenAllowed, workspace]);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const found = needle
      ? entries.filter((entry) =>
          `${entry.label} ${entry.hint ?? ''} ${entry.kind}`.toLowerCase().includes(needle),
        )
      : entries.filter((entry) => entry.kind === TEXT.screen || entry.kind === TEXT.action);
    return found.slice(0, 40);
  }, [entries, query]);

  const index = Math.min(active, Math.max(0, shown.length - 1));

  useEffect(() => {
    list.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest' });
  }, [index, shown]);

  const onKey = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    } else if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActive(Math.min(index + 1, shown.length - 1));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActive(Math.max(index - 1, 0));
    } else if (event.key === 'Enter') {
      event.preventDefault();
      shown[index]?.run();
    }
  };

  return (
    <div
      className="kit-palette-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        className="kit-palette"
        role="dialog"
        aria-modal="true"
        aria-label={TEXT.label}
        onKeyDown={onKey}
      >
        <input
          ref={input}
          type="text"
          role="combobox"
          aria-expanded="true"
          aria-controls="kit-palette-list"
          aria-activedescendant={shown[index] ? `kit-palette-${shown[index]!.id}` : undefined}
          placeholder={TEXT.placeholder}
          aria-label={TEXT.label}
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setActive(0);
          }}
        />
        <ul id="kit-palette-list" role="listbox" ref={list}>
          {shown.length === 0 && (
            <li className="kit-palette-kind" style={{ padding: 14 }}>
              {TEXT.empty}
            </li>
          )}
          {shown.map((entry, position) => (
            <li key={entry.id} role="presentation">
              <button
                type="button"
                role="option"
                id={`kit-palette-${entry.id}`}
                aria-selected={position === index}
                onMouseEnter={() => setActive(position)}
                onClick={entry.run}
              >
                <span>
                  {entry.label}
                  {entry.hint && <small className="hint"> · {entry.hint}</small>}
                </span>
                <span className="kit-palette-kind">{entry.kind}</span>
              </button>
            </li>
          ))}
        </ul>
        <div className="kit-palette-foot">{TEXT.hint}</div>
      </div>
    </div>
  );
}
