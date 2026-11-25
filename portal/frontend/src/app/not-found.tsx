import type { Metadata } from 'next';
import Link from 'next/link';

const TEXT = {
  title: 'This page does not exist',
  body: 'The address may be wrong, or the page may have moved.',
  home: 'Go to DCC',
};

export const metadata: Metadata = { title: 'Page not found · DCC' };

/** Our own 404 page: Next's built-in one carries an inline style that the content security policy would block. */
export default function NotFound() {
  return (
    <main className="empty-state" style={{ minHeight: '100vh' }}>
      <div>
        <h1 className="not-found-title">{TEXT.title}</h1>
        <p>{TEXT.body}</p>
        <div style={{ marginTop: 20 }}>
          <Link className="btn btn-primary" href="/">
            {TEXT.home}
          </Link>
        </div>
      </div>
    </main>
  );
}
