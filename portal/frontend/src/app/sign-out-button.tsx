'use client';

import { useState } from 'react';

/** Ends the DCC session, then sends the browser to the IdP to end the shared SSO session too. */
export function SignOutButton() {
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      disabled={busy}
      className="rounded bg-navy px-4 py-2 text-white hover:opacity-90 disabled:opacity-50"
      onClick={async () => {
        setBusy(true);
        const res = await fetch(`${process.env.NEXT_PUBLIC_DCC_BASE_PATH ?? ''}/api/auth/logout`, {
          method: 'POST',
        });
        const body = (await res.json().catch(() => ({}))) as { logoutUrl?: string | null };
        window.location.href = body.logoutUrl ?? `${process.env.NEXT_PUBLIC_DCC_BASE_PATH ?? ''}/`;
      }}
    >
      Sign out
    </button>
  );
}
