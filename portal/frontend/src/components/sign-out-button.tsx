'use client';

import { useState } from 'react';
import { withBasePath } from '@/lib/base-path';

const TEXT = { busy: 'Signing out…', compact: 'Sign out', full: 'Sign out of DCC' };

/** Ends the DCC session, then sends the browser to the IdP to end the shared SSO session too. */
export function SignOutButton({ compact = false }: { compact?: boolean }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      className={`btn ${compact ? 'btn-outline' : 'btn-dark'}`}
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          const response = await fetch(withBasePath('/api/auth/logout'), {
            method: 'POST',
            credentials: 'same-origin',
          });
          const body = (await response.json().catch(() => ({}))) as { logoutUrl?: string | null };
          window.location.href = body.logoutUrl ?? withBasePath('/');
        } catch {
          window.location.href = withBasePath('/');
        }
      }}
    >
      {busy ? TEXT.busy : compact ? TEXT.compact : TEXT.full}
    </button>
  );
}
