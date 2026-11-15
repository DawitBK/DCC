'use client';

import { useEffect, useState } from 'react';
import type { ContentItemDto, ContentVersionDto } from '@dcc/contracts';
import { ApiRequestError, apiFetch } from './browser-api';
import { toApiError } from './use-api';

/**
 * The list of content items carries no text (`ContentItemDto` has no body). To show what a post
 * says, its versions are read one item at a time: `GET /api/content-items/:id/versions`.
 * Callers pass only the items on screen (`limit`), so a long list does not mean a flood of requests.
 */
export function useContentVersions(
  items: ContentItemDto[],
  refreshKey = 0,
  limit = 30,
): {
  versionsByItem: Record<string, ContentVersionDto[]>;
  error: ApiRequestError | null;
} {
  const ids = items
    .slice(0, limit)
    .map((item) => `${item.id}:${item.currentVersionId ?? ''}`)
    .join(',');
  const [versionsByItem, setVersions] = useState<Record<string, ContentVersionDto[]>>({});
  const [error, setError] = useState<ApiRequestError | null>(null);

  useEffect(() => {
    const itemIds = ids ? ids.split(',').map((entry) => entry.split(':')[0]!) : [];
    if (itemIds.length === 0) {
      setVersions({});
      setError(null);
      return;
    }
    let current = true;
    Promise.all(
      itemIds.map(async (id) => {
        const versions = await apiFetch<ContentVersionDto[]>(`/content-items/${id}/versions`);
        return [id, versions] as const;
      }),
    )
      .then((entries) => {
        if (!current) return;
        setVersions(Object.fromEntries(entries));
        setError(null);
      })
      .catch((failure: unknown) => {
        if (current) setError(toApiError(failure));
      });
    return () => {
      current = false;
    };
  }, [ids, refreshKey]);

  return { versionsByItem, error };
}

/** The version the item currently points at (what would be reviewed or published). */
export function currentVersionOf(
  item: ContentItemDto,
  versions: ContentVersionDto[] | undefined,
): ContentVersionDto | undefined {
  return versions?.find((version) => version.id === item.currentVersionId);
}

/** Newest first. */
export function byNewest<T extends { updatedAt?: string; createdAt?: string }>(rows: T[]): T[] {
  const stamp = (row: T) => row.updatedAt ?? row.createdAt ?? '';
  return [...rows].sort((a, b) => stamp(b).localeCompare(stamp(a)));
}
