import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { NextConfig } from 'next';

// Development convenience: share the repo-root .env with the API. Real environment variables win.
const rootEnv = resolve(__dirname, '..', '..', '.env');
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const apiInternalUrl = process.env.DCC_API_INTERNAL_URL ?? 'http://127.0.0.1:7716';

const config: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Monorepo: pin the root so Turbopack does not pick up a stray lockfile higher up the disk.
  turbopack: { root: resolve(__dirname, '..', '..') },
  async rewrites() {
    // The browser only ever talks to the web origin. /api/* is proxied to the DCC API, so the session
    // cookie is same-origin and the API needs no CORS.
    return [{ source: '/api/:path*', destination: `${apiInternalUrl}/api/:path*` }];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default config;
