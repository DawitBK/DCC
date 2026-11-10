import { cookies } from 'next/headers';
import type { MeResponse } from '@dcc/contracts';

const API = process.env.DCC_API_INTERNAL_URL ?? 'http://127.0.0.1:7716';

/**
 * Server-side: ask the API who the browser's session belongs to, forwarding only the cookie.
 * Returns null when signed out. The API is the authority; the web app never decodes a token.
 */
export async function getMe(): Promise<MeResponse | null> {
  const jar = await cookies();
  const cookieHeader = jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join('; ');
  if (!cookieHeader) return null;
  try {
    const res = await fetch(`${API}/api/me`, {
      headers: { cookie: cookieHeader },
      cache: 'no-store',
    });
    return res.ok ? ((await res.json()) as MeResponse) : null;
  } catch {
    return null;
  }
}
