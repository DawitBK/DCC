# Technical review checklist

For reviewers. One reviewer is the norm; use the security section whenever the change touches CODEOWNERS-protected areas.

## Every change

- [ ] Does what the issue asks; nothing unrelated sneaked in.
- [ ] Tests prove the behaviour (and would fail without the change). CI is green.
- [ ] Readable: names, small functions, no dead code, comments explain _why_.
- [ ] Docs and `.env.example` updated where needed.
- [ ] Stays in the author's area, or the owner of the other area knows.

## Backend

- [ ] Queries run inside `TenantDb.run`; permission checked per company with `authz.can`; audit event written last in the same transaction.
- [ ] New table: `company_id`, RLS, policies, minimal grants, attack tests, `schema.ts` updated, migration new (not edited).
- [ ] Input validated with zod; errors use the standard shape; nothing sensitive in errors or logs.
- [ ] No direct calls to Postiz or the identity provider outside their packages.

## Frontend

- [ ] No tokens or secrets in the browser; visibility checks are cosmetic only; types from `@dcc/contracts`.
- [ ] Keyboard, focus, contrast, no colour-only status; works at phone width.

## Security (Dawit)

- [ ] No new `@Public()` route without a reason. No weakening of cookie, CSRF, CSP or CORS settings.
- [ ] No new dependency with a risky install script or abandoned maintainer; `npm audit` clean.
- [ ] Secrets only from the environment; nothing real committed.
- [ ] Changes to roles/permissions update the separation-of-duties tests.

## Engine

- [ ] Publishing only through `GovernedEngine`; idempotency and unknown-outcome behaviour preserved; API key never logged.
