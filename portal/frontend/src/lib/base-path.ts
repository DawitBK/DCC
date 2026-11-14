/**
 * The path the app is served under (for example `/dcc`), or '' at the site root.
 *
 * Next adds it by itself in `redirect()`, `<Link>` and `router.push()`: never add it there.
 * Plain strings do NOT get it: `href` on an `<a>`, `fetch()`, `window.location`. Use `withBasePath` for those.
 */
export const BASE_PATH = process.env.NEXT_PUBLIC_DCC_BASE_PATH ?? '';

/** For plain strings only (`<a href>`, `fetch`, `window.location`). */
export function withBasePath(path: string): string {
  return `${BASE_PATH}${path}`;
}

/** The current page as Next knows it: path + query, WITHOUT the base path. Used for `returnTo`. */
export function currentPathWithoutBasePath(): string {
  const { pathname, search } = window.location;
  const path =
    BASE_PATH && (pathname === BASE_PATH || pathname.startsWith(`${BASE_PATH}/`))
      ? pathname.slice(BASE_PATH.length)
      : pathname;
  return `${path || '/'}${search}`;
}
