'use client';

import { REAUTH_REQUIRED_CODE, type ApiError } from '@dcc/contracts';
import { currentPathWithoutBasePath, withBasePath } from './base-path';

const TEXT = {
  sessionEnded: 'Your session has ended. Sign in again to continue.',
  reauth: 'For your security, sign in again to do this. You are being sent to the sign-in page.',
  fallback: (status: number) => `The request could not be completed (${status}).`,
  network: 'DCC could not be reached. Check your connection and try again.',
};

export type ApiIssue = { path: string; message: string };

/** What a refused request looks like to a screen: the API's own words plus the request id to quote to support. */
export class ApiRequestError extends Error {
  readonly status: number;
  readonly requestId: string | undefined;
  readonly code: string | undefined;
  /** Field-level problems the API reported for a request body (validation errors only). */
  readonly issues: ApiIssue[];

  constructor(
    message: string,
    options: { status: number; requestId?: string; code?: string; issues?: ApiIssue[] },
  ) {
    super(message);
    this.name = 'ApiRequestError';
    this.status = options.status;
    this.requestId = options.requestId;
    this.code = options.code;
    this.issues = options.issues ?? [];
  }
}

function readIssues(body: unknown): ApiIssue[] {
  const issues = (body as { issues?: unknown } | null)?.issues;
  if (!Array.isArray(issues)) return [];
  return issues.flatMap((issue) => {
    const { path, message } = (issue ?? {}) as { path?: unknown; message?: unknown };
    return typeof message === 'string'
      ? [{ path: typeof path === 'string' ? path : '', message }]
      : [];
  });
}

/**
 * Same-origin browser request to the DCC API. The session stays in the HttpOnly cookie.
 * Returns the raw response when it is OK; otherwise throws `ApiRequestError`.
 *
 * A 401 has two meanings (docs/api/README.md):
 *  - `code: reauth_required`: the session is fine but this action needs a fresh sign-in. The browser goes to
 *    the sign-in with `reauth=1` and comes back to the same page.
 *  - anything else: the session has ended. The browser goes to the sign-in page.
 */
export async function apiRequest(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers);
  if (!headers.has('Accept')) headers.set('Accept', 'application/json');
  let response: Response;
  try {
    response = await fetch(withBasePath(`/api${path}`), {
      ...options,
      credentials: 'same-origin',
      headers,
    });
  } catch {
    throw new ApiRequestError(TEXT.network, { status: 0 });
  }
  if (response.ok) return response;

  const body: unknown = await response.json().catch(() => null);
  const apiError = body as Partial<ApiError> | null;
  const details = {
    status: response.status,
    requestId: apiError?.requestId ?? response.headers.get('x-request-id') ?? undefined,
    code: apiError?.code,
    issues: readIssues(body),
  };

  if (response.status === 401) {
    if (apiError?.code === REAUTH_REQUIRED_CODE) {
      const returnTo = encodeURIComponent(currentPathWithoutBasePath());
      window.location.assign(withBasePath(`/api/auth/login?reauth=1&returnTo=${returnTo}`));
      throw new ApiRequestError(apiError.message || TEXT.reauth, details);
    }
    window.location.assign(withBasePath('/?error=session'));
    throw new ApiRequestError(TEXT.sessionEnded, details);
  }

  throw new ApiRequestError(apiError?.message || TEXT.fallback(response.status), details);
}

/** JSON in, JSON out. An empty answer (204) gives `undefined`. */
export async function apiFetch<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await apiRequest(path, options);
  if (response.status === 204) return undefined as T;
  return (await response.json().catch(() => null)) as T;
}

/** A state-changing request with a JSON body. */
export function apiSend<T>(
  method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
  path: string,
  body?: unknown,
): Promise<T> {
  return apiFetch<T>(path, {
    method,
    ...(body === undefined
      ? {}
      : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
}

/** Query string from the filters that are filled in. */
export function queryString(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : '';
}
