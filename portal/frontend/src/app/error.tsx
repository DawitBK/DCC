'use client';

const TEXT = {
  title: 'This page could not be shown',
  body: 'Something went wrong while showing it. Try again; if it keeps happening, tell the DCC team.',
  retry: 'Try again',
  reference: 'Reference',
};

/** Our own error page: Next's built-in one carries an inline style that the content security policy would block. */
export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main className="empty-state" style={{ minHeight: '100vh' }}>
      <div>
        <strong>{TEXT.title}</strong>
        <p>{TEXT.body}</p>
        {error.digest && (
          <p>
            {TEXT.reference}: <code>{error.digest}</code>
          </p>
        )}
        <div style={{ marginTop: 20 }}>
          <button type="button" className="btn btn-primary" onClick={reset}>
            {TEXT.retry}
          </button>
        </div>
      </div>
    </main>
  );
}
