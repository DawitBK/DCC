# Security standards

Owner: Dawit. Reference: OWASP ASVS (target level 2). Status column is honest: **Done** is implemented and tested;
**Scaffold** exists but needs finishing; **Open** is not started or needs a decision.

| Area                                    | Standard                                                                                                                                                                                 | Status                          |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| Authentication                          | Only through the existing SSO (OIDC code + PKCE, state, nonce, issuer/audience/signature/expiry via `openid-client`, `email_verified` required). No DCC passwords.                       | Done (verified against dev SSO) |
| MFA                                     | Enforced by the SSO. DCC does not currently require a particular `amr`. Whether the SSO can force MFA for DCC and passkeys for privileged roles must be confirmed.                       | Open (D-07)                     |
| Sessions                                | Opaque 256-bit id, HttpOnly + SameSite=Lax cookie (`__Host-` prefix and Secure in production), hash stored, absolute (8 h) and idle (30 min) expiry, ended by back-channel logout.       | Done                            |
| Re-authentication for sensitive actions | Proposal asks for it (delete, add admin). Needs the SSO `max_age`/`acr` support.                                                                                                         | Open                            |
| Authorization                           | Deny by default (global guard); permission gate per route plus per-company check in services; roles in `portal/contracts`.                                                               | Done                            |
| Separation of duties                    | `assertDifferentPeople` helper; creator cannot approve. Must be called by the approval workflow.                                                                                         | Scaffold                        |
| Tenant isolation                        | PostgreSQL RLS, tested by attack.                                                                                                                                                        | Done                            |
| CSRF                                    | SameSite=Lax cookie **and** Origin check on every state-changing request.                                                                                                                | Done                            |
| CORS                                    | Off. The browser uses the web origin's `/api` proxy.                                                                                                                                     | Done                            |
| Headers                                 | API: helmet, strict CSP (`default-src 'none'`), HSTS in production. Web: nosniff, frame deny, referrer policy. Full nonce-based CSP for the web app is Rahel's task with Dawit's review. | Done (API) / Open (web CSP)     |
| Input validation                        | zod schemas shared with the web app; UUID params parsed.                                                                                                                                 | Done                            |
| Output encoding / XSS                   | React escapes by default; no `dangerouslySetInnerHTML` without review.                                                                                                                   | Standard                        |
| Rate limiting                           | In-process throttling (300/min, 20/min on login routes). Single API instance only.                                                                                                       | Done (single instance)          |
| Secrets                                 | Never in Git; env files git-ignored; CI secret scan; `SecretsProvider` interface; dev provider refused in production.                                                                    | Scaffold (D-05)                 |
| Social tokens                           | Stay in Postiz. DCC stores none.                                                                                                                                                         | By design                       |
| Encryption at rest/in transit           | TLS at the reverse proxy; database and disk encryption are infrastructure.                                                                                                               | Open (D-08)                     |
| Audit                                   | Append-only hash chain.                                                                                                                                                                  | Done (see AUDIT.md for limits)  |
| Logging                                 | JSON logs with request id; secrets, tokens, cookies redacted at any depth. Never log request bodies.                                                                                     | Done                            |
| Dependencies                            | `npm audit` (high+) and Dependabot; CodeQL for static analysis.                                                                                                                          | Done                            |
| Secret scanning                         | `npm run secrets:scan` in CI; enable GitHub secret scanning and push protection on the repository.                                                                                       | Done / Open (repo setting)      |
| Penetration test                        | Planned before go-live (proposal week 7).                                                                                                                                                | Open                            |
| Incident handling                       | Freeze switch and playbooks are backend/process work (Hirko, Dawit).                                                                                                                     | Open                            |

## Rules for everyone

- Treat anything from a browser, from Postiz, and from a social network as untrusted input.
- Never log a token, cookie, authorization header, client secret or password.
- A new endpoint is authenticated by default. Making one `@Public()` needs Dawit's review.
- A new table that holds company data gets RLS in the same migration.
- Security-relevant changes (CODEOWNERS list) are reviewed by Dawit before merge.
