import { NextResponse, type NextRequest } from 'next/server';

/**
 * The web app's Content-Security-Policy, with a fresh nonce on every request (backlog R-05).
 *
 * Next.js 16 calls this file `proxy` (it was `middleware`). It runs before the page renders: the nonce goes
 * into the policy and into the request headers, and Next.js puts it on its own scripts and styles while
 * it renders. That only works for pages rendered per request, so the root layout is dynamic.
 *
 * Scripts: only 'self' and nonced ones, plus what a nonced script loads ('strict-dynamic'). No inline script
 * runs without the nonce, which is what stops an injected script. Styles: nonced or 'self' style elements;
 * React's own `style=""` attributes are allowed (`style-src-attr`) because the screens use them and a style
 * attribute cannot run code. In development Next adds style tags and needs `eval`, so those two are relaxed there only.
 *
 * `DCC_CSP_MODE=report-only` sends the same policy as `Content-Security-Policy-Report-Only` (the browser
 * only logs what it would block): the way back if enforcement ever blocks something real. Default: enforce.
 * `upgrade-insecure-requests` is left out on purpose: the mirror and development serve plain http.
 */
export function proxy(request: NextRequest) {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const isDev = process.env.NODE_ENV === 'development';
  const policy = [
    `default-src 'self'`,
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ''}`,
    isDev ? `style-src 'self' 'unsafe-inline'` : `style-src 'self' 'nonce-${nonce}'`,
    `style-src-attr 'unsafe-inline'`,
    `img-src 'self' blob: data:`,
    `media-src 'self' blob:`,
    `font-src 'self'`,
    `connect-src 'self'`,
    `object-src 'none'`,
    `base-uri 'self'`,
    `form-action 'self'`,
    `frame-ancestors 'none'`,
  ].join('; ');
  const header =
    process.env.DCC_CSP_MODE === 'report-only'
      ? 'Content-Security-Policy-Report-Only'
      : 'Content-Security-Policy';

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set(header, policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set(header, policy);
  return response;
}

export const config = {
  matcher: [
    {
      // Not the API (it has its own policy), not static files, not prefetches.
      source: '/((?!api|_next/static|_next/image|favicon.ico).*)',
      missing: [
        { type: 'header', key: 'next-router-prefetch' },
        { type: 'header', key: 'purpose', value: 'prefetch' },
      ],
    },
  ],
};
