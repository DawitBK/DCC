'use client';

import { useCallback, useEffect, useState } from 'react';
import { ApiRequestError, apiFetch } from './browser-api';

export type ApiData<T> = {
  /** null until the first answer arrives (or when the read is switched off). */
  data: T | null;
  error: ApiRequestError | null;
  loading: boolean;
  /** Ask the API again. Screens call this after every change: what is shown is always what the API says. */
  reload: () => void;
};

export function toApiError(error: unknown): ApiRequestError {
  if (error instanceof ApiRequestError) return error;
  return new ApiRequestError(error instanceof Error ? error.message : 'Something went wrong.', {
    status: 0,
  });
}

/** Reads one API path. Pass `null` to skip (for example: the person may not see it). */
export function useApiData<T>(path: string | null): ApiData<T> {
  const [state, setState] = useState<{
    path: string | null;
    data: T | null;
    error: ApiRequestError | null;
  }>({ path: null, data: null, error: null });
  const [loading, setLoading] = useState(path !== null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (path === null) {
      setState({ path: null, data: null, error: null });
      setLoading(false);
      return;
    }
    let current = true;
    setLoading(true);
    apiFetch<T>(path)
      .then((data) => {
        if (current) setState({ path, data, error: null });
      })
      .catch((error: unknown) => {
        if (current) setState({ path, data: null, error: toApiError(error) });
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => {
      current = false;
    };
  }, [path, version]);

  const reload = useCallback(() => setVersion((value) => value + 1), []);
  // Never show the answer of a previous path under a new one.
  const fresh = state.path === path;
  return {
    data: fresh ? state.data : null,
    error: fresh ? state.error : null,
    loading: loading || (path !== null && !fresh),
    reload,
  };
}
