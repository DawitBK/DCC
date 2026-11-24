import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

// The content security policy carries a nonce made per request (proxy.ts), so no page may be built ahead of time.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Digital Communications Control Center',
  description: 'Kerchanshe Group digital communications governance',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
