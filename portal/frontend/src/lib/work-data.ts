'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import type { ApprovalRequestDto, BrandDto, ContentVersionDto } from '@dcc/contracts';
import { apiFetch, type ApiRequestError } from './browser-api';
import { toApiError } from './use-api';

/**
 * Several small reads at once, keyed by id: the brands of each company, the approval and the versions of each
 * post on a list. Callers pass only the ids on screen, so a long list does not mean a flood of requests.
 * Nothing is cached between screens: what is shown is what the API said a moment ago.
 */
export function useBatch<T>(
  keys: readonly string[],
  read: (key: string) => Promise<T>,
  refreshKey = 0,
): { byKey: Record<string, T>; loading: boolean; error: ApiRequestError | null } {
  const joined = keys.join(',');
  const [state, setState] = useState<{
    joined: string;
    byKey: Record<string, T>;
    error: ApiRequestError | null;
  }>({ joined: '', byKey: {}, error: null });
  // The reader is recreated by every render of the caller; only the keys decide when to read again.
  const reader = useRef(read);
  reader.current = read;

  useEffect(() => {
    const wanted = joined ? joined.split(',') : [];
    if (wanted.length === 0) {
      setState({ joined, byKey: {}, error: null });
      return;
    }
    let current = true;
    Promise.all(wanted.map(async (key) => [key, await reader.current(key)] as const))
      .then((entries) => {
        if (current) setState({ joined, byKey: Object.fromEntries(entries), error: null });
      })
      .catch((failure: unknown) => {
        if (current) setState({ joined, byKey: {}, error: toApiError(failure) });
      });
    return () => {
      current = false;
    };
  }, [joined, refreshKey]);

  return {
    byKey: state.joined === joined ? state.byKey : {},
    loading: joined !== '' && state.joined !== joined,
    error: state.joined === joined ? state.error : null,
  };
}

/** `GET /api/companies/:id/brands` for each company id. A company whose brands cannot be read is skipped. */
export function useBrands(companyIds: readonly string[]): {
  brands: BrandDto[];
  loading: boolean;
} {
  const ids = useMemo(() => [...new Set(companyIds)].sort(), [companyIds]);
  const batch = useBatch<BrandDto[]>(ids, (id) =>
    apiFetch<BrandDto[]>(`/companies/${id}/brands`).catch(() => []),
  );
  const brands = useMemo(() => Object.values(batch.byKey).flat(), [batch.byKey]);
  return { brands, loading: batch.loading };
}

/** `GET /api/content-items/:id/approval` for each post: the request of its current version, or null when none was opened. */
export function useApprovals(itemIds: readonly string[], refreshKey = 0) {
  return useBatch<ApprovalRequestDto | null>(
    itemIds,
    (id) => apiFetch<ApprovalRequestDto | null>(`/content-items/${id}/approval`),
    refreshKey,
  );
}

/** `GET /api/content-items/:id/versions` for each post. */
export function useVersions(itemIds: readonly string[], refreshKey = 0) {
  return useBatch<ContentVersionDto[]>(
    itemIds,
    (id) => apiFetch<ContentVersionDto[]>(`/content-items/${id}/versions`),
    refreshKey,
  );
}
