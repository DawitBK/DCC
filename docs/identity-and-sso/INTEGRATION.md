# Identity and SSO integration

Owner: Dawit. Code: `apps/api/src/platform/auth/`. Decision: [ADR-0003](../architecture/decisions/ADR-0003-oidc-server-sessions.md).

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

## Not yet done / open

- Confirm with the SSO owner: MFA enforcement for the `dcc` client and passkeys for privileged roles (D-07).
- Production client registration (HTTPS addresses, real secret) and the production back-channel address.
- Re-authentication for sensitive actions (needs SSO `max_age` support).
- Mapping directory groups to DCC companies, if the Group wants that instead of manual assignment (decision for Abenezer/Dawit).
