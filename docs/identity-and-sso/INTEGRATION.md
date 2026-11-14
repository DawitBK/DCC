# Identity and SSO integration

Owner: Dawit. Code: `portal/backend/src/platform/auth/`. Decision: [ADR-0003](../architecture/decisions/ADR-0003-oidc-server-sessions.md).

## Who does what

| Concern                                                            | Handled by                                                              |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Proving who the person is, passwords, MFA, account disablement     | **Kerchanshe SSO** (the existing IdP). DCC has no passwords.            |
| Which company and role the person has in DCC, and what they may do | **DCC** (`memberships`, `authz`, RLS)                                   |
| First group administrators                                         | SSO application role `dcc-group-admin` (claim), then DCC takes over     |
| Connecting social accounts                                         | **Postiz + each network's official OAuth**; DCC stores no social tokens |

## The flow (as built and verified against the dev SSO)

1. `GET /api/auth/login` creates a single-use login attempt (state, nonce, PKCE verifier, 10 min) and redirects to the SSO.
2. The SSO authenticates the person and redirects to `/api/auth/callback?code&state`.
3. The API exchanges the code server to server, and `openid-client` verifies the id_token (signature against the SSO's keys, issuer, audience, expiry, nonce). DCC additionally requires `email_verified === true`.
4. The person is created or refreshed in `users` (keyed by the SSO subject, via a narrow database function), the admin claim is synced, a session is created, `auth.login` is audited.
5. The browser receives only the opaque session cookie. `GET /api/me` returns identity, memberships and permissions (no tokens).
6. `POST /api/auth/logout` ends the DCC session and returns the SSO end-session address so the web app can end the shared session too.
7. **Back-channel logout** (`POST /api/auth/backchannel-logout`): the SSO posts a signed logout token when a person signs out, is disabled, or loses an application role; DCC verifies it and ends that person's sessions at once.

## Claims DCC relies on (verified on the dev SSO)

`sub`, `email`, `email_verified`, `name`, and the application-role claim `https://idp.kerchanshe.com/app_roles`
(scope `app_roles`, delivered only for the `dcc` client). An **absent** role claim means "unknown", not "no roles":
DCC changes nothing in that case. A claim that is present and lacks `dcc-group-admin` revokes only an admin grant that
came from the IdP; grants made inside DCC are never touched.

## Configuration

See `.env.example` (`OIDC_*`). `OIDC_ISSUER` is the browser-facing address; `OIDC_INTERNAL_URL` is the optional
server-to-server address when it differs. In production all addresses must be HTTPS and non-local, and the client
secret must be real; the API refuses to start otherwise.

Registering the client in the SSO: [DEV-CLIENT-REGISTRATION](DEV-CLIENT-REGISTRATION.md).

## What was verified for real (2026-11-10, against the local dev SSO)

Browser sign-in through the SSO and back; session cookie flags; nothing in localStorage/sessionStorage; `/api/me`;
forged or replayed callback rejected; logout; granting `dcc-group-admin` at the SSO made the person a DCC group
administrator at next sign-in; removing it ended their session immediately (back-channel) and removed the grant.

## Two-factor sign-in

Enforced twice, in the SSO and in DCC. The full answer, including passkeys (not available), is
[MFA-AND-PASSKEYS](MFA-AND-PASSKEYS.md).

## Re-authentication for sensitive actions

A session can live for eight hours. For a few actions DCC wants proof that the person at the keyboard signed in a short while
ago, not only that a session cookie exists.

| What                            | Detail                                                                                                                                                           |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Which actions                   | grant a role, remove a role, **lift** a publishing freeze, export the audit trail. (Freezing itself is never delayed: it is the emergency brake.)                |
| How recent                      | `DCC_REAUTH_MAX_AGE_MINUTES`, 15 by default. Production refuses 0.                                                                                               |
| What the API answers            | `401` with `"code": "reauth_required"` and the message "For your security, sign in again to do this."                                                            |
| What the web app does           | sends the browser to `/api/auth/login?reauth=1&returnTo=<the page>`; the person signs in again and repeats the action                                            |
| What the SSO is asked           | `max_age=0`: authenticate this person now, even though they still have an SSO session                                                                            |
| What DCC checks on the way back | the identity token's `auth_time` must be within the last 120 seconds. An answer from an old SSO session, or without `auth_time`, is refused (`reauth_not_fresh`) |
| What is remembered              | the session keeps `authenticated_at` (the SSO's `auth_time`). A sign-in whose time is not known counts as old                                                    |
| Audit                           | the `auth.login` event carries `reauthentication: true`; the replaced session is ended                                                                           |

To mark a new route as sensitive, add `@RequireRecentAuth()` under `@RequirePermission(...)`
(`portal/backend/src/platform/authz/decorators.ts`). A person who may not do the action at all still gets `403`, never an
invitation to sign in again. Tests: `portal/backend/test/reauthentication.e2e.test.ts`, `signin-entry.e2e.test.ts`.

Checked in the SSO source: it uses the standard `max_age` handling of its OpenID library and always puts `auth_time` in the
identity token. **Not yet run in a browser against the SSO**: test 2 of the [integration test plan](../testing/INTEGRATION-TEST-PLAN.md).

## When the SSO cannot be reached

`GET /api/auth/login` sends the person back to the DCC page with `?error=signin_unavailable` and writes the cause to the log.
(It answered a bare 500 until the mirror rehearsal of 2026-11-14 showed it.)

## Not yet done / open

- A full sign-in with an authenticator code, and a re-authentication, in a browser against the running SSO (integration tests 1 and 2).
- Production client registration: the procedure is written, not carried out ([PRODUCTION-CLIENT-REGISTRATION](PRODUCTION-CLIENT-REGISTRATION.md)).
- Mapping directory groups to DCC companies, if the Group wants that instead of manual assignment (decision for Abenezer/Dawit).
