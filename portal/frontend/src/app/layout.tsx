import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Digital Communications Control Center',
  description: 'Kerchanshe Group digital communications governance',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <main className="mx-auto max-w-3xl p-6">{children}</main>
      </body>
    </html>
  );
}
