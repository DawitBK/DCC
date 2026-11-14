import type { ApiRequestError } from '@/lib/browser-api';

const TEXT = {
  title: 'This could not be done',
  loadTitle: 'This could not be loaded',
  requestId: 'Request id',
  quote: '(quote it if you ask for help)',
};

/**
 * Shows what the API answered, in the API's own words, with the request id.
 * Never a blank or made-up error: if the API said why, the person sees why.
 */
export function ErrorBox({
  error,
  title,
  loading = false,
}: {
  error: ApiRequestError | null | undefined;
  title?: string;
  /** true = the problem was reading data, not doing something. Only changes the heading. */
  loading?: boolean;
}) {
  if (!error) return null;
  return (
    <div className="demo-banner error-box" role="alert">
      <span aria-hidden="true">!</span>
      <div>
        <strong>{title ?? (loading ? TEXT.loadTitle : TEXT.title)}</strong>
        {error.message}
        {error.requestId && (
          <span className="error-request-id">
            {TEXT.requestId}: <code>{error.requestId}</code> {TEXT.quote}
          </span>
        )}
      </div>
    </div>
  );
}
