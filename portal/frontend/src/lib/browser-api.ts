'use client';

import type { ApiError } from '@dcc/contracts';

/** Same-origin browser requests only. DCC session credentials remain in the HttpOnly cookie. */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const basePath = process.env.NEXT_PUBLIC_DCC_BASE_PATH ?? '';
  const headers = new Headers(options.headers);
  headers.set('Accept', 'application/json');
  const response = await fetch(`${basePath}/api${path}`, {
    ...options,
    credentials: 'same-origin',
    headers,
  });

  if (response.status === 401) {
    window.location.assign(`${basePath}/?error=session`);
    throw new Error('Your session has ended. Sign in again to continue.');
  }

  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const apiError = body as Partial<ApiError> | null;
    throw new Error(apiError?.message || `The request could not be completed (${response.status}).`);
  }

  return body as T;
}
