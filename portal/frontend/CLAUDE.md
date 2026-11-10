# portal/frontend: the Next.js web app (read the root `CLAUDE.md` first; it is binding)

- This is **Rahel's** area. Build the **real screens directly**. There is **no Figma and no prototype phase** (decision D-13).
- The browser only ever talks to its own address under `/api/...` (the backend is behind it). Never call the backend on another address. Never store tokens or session ids anywhere: the session is an HttpOnly cookie you cannot read.
- Show or hide things using `GET /api/me` (`permissions`, `memberships`). The backend re-checks everything, so hiding a button is never security.
- Types and role/permission names come from `@dcc/contracts`. Never retype them.
- Brand design tokens are in `src/app/globals.css`. Body text at least 16 px. WCAG 2.2 AA: keyboard, focus, contrast, no colour-only status, works at phone width.
- Do not hard-code user-visible text in many places: English now, Amharic later.
- The app can be served under a path (`DCC_WEB_BASE_PATH`, for example `/dcc`): never write links or fetches that ignore the base path (see `src/app/page.tsx`).
- Need an API change? Ask Hirko. Need a change to `portal/contracts`? Open an issue.
