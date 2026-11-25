'use client';

import { useCallback, useRef, type KeyboardEvent, type ReactNode } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';

export type TabDef = { id: string; label: string; count?: number | null };

/** The ids a tab and its panel give each other. One set of tabs per page, so the tab's own id is enough. */
const tabElementId = (id: string) => `kit-tab-${id}`;
const panelElementId = (id: string) => `kit-panel-${id}`;

/**
 * Tabs as the keyboard expects them: Left and Right (and Home and End) move between tabs, the active tab is
 * the one in the tab order, and each panel is labelled by its tab. Use `useTabParam` to keep the chosen tab
 * in the address (`?tab=`), so a refresh or a shared link opens the same tab.
 */
export function Tabs({
  tabs,
  active,
  onChange,
  label,
}: {
  tabs: TabDef[];
  active: string;
  onChange: (id: string) => void;
  label: string;
}) {
  const list = useRef<HTMLDivElement>(null);
  const move = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    let next: number;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    else return;
    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onChange(target.id);
    list.current?.querySelector<HTMLButtonElement>(`[data-tab="${target.id}"]`)?.focus();
  };
  return (
    <div className="kit-tabs" role="tablist" aria-label={label} ref={list}>
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={tabElementId(tab.id)}
          data-tab={tab.id}
          aria-selected={tab.id === active}
          aria-controls={tab.id === active ? panelElementId(tab.id) : undefined}
          tabIndex={tab.id === active ? 0 : -1}
          className="kit-tab"
          onClick={() => onChange(tab.id)}
          onKeyDown={(event) => move(event, index)}
        >
          {tab.label}
          {typeof tab.count === 'number' && <span className="kit-tab-count">{tab.count}</span>}
        </button>
      ))}
    </div>
  );
}

/** The panel of one tab. Render only the active one. The active tab's `aria-controls` points at this element. */
export function TabPanel({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div
      role="tabpanel"
      className="kit-tabpanel"
      data-panel={id}
      id={panelElementId(id)}
      aria-labelledby={tabElementId(id)}
      tabIndex={-1}
    >
      {children}
    </div>
  );
}

/** The chosen tab, kept in `?tab=` (other parts of the address, such as `companyId`, stay). */
export function useTabParam(ids: string[], fallback: string): [string, (id: string) => void] {
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const wanted = params.get('tab');
  const active = wanted && ids.includes(wanted) ? wanted : fallback;
  const set = useCallback(
    (id: string) => {
      const next = new URLSearchParams(params.toString());
      if (id === fallback) next.delete('tab');
      else next.set('tab', id);
      const query = next.toString();
      router.replace(`${pathname}${query ? `?${query}` : ''}`, { scroll: false });
    },
    [router, pathname, params, fallback],
  );
  return [active, set];
}
