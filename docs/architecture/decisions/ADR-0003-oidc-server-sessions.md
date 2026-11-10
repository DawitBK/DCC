# ADR-0003: Existing SSO through OIDC; server-side sessions in PostgreSQL

**Status:** Accepted · **Deciders:** Dawit

**Context.** The Group already has an IdP/SSO. DCC must not create another identity system or local passwords. The SSO supports only confidential clients (`client_secret_post`) and can add a coarse application-role claim.
**Decision.** DCC is an OIDC relying party (authorization code + PKCE, state, nonce, `email_verified` required) using the maintained `openid-client` library. After login DCC issues its own opaque session id in an HttpOnly, SameSite=Lax cookie; only the SHA-256 of the id is stored, in PostgreSQL, with absolute and idle expiry. DCC never holds the IdP's access or refresh tokens; the id_token is kept encrypted only as the logout hint. Authorization (companies, roles) is DCC's own; the IdP's `app_roles` claim only bootstraps group administrators (`dcc-group-admin`). Back-channel logout is implemented, so disabling or demoting someone at the IdP ends their DCC sessions.
**Alternatives.** JWT-in-browser sessions (rejected: tokens in the browser, no instant revocation). Redis sessions (not needed yet, ADR-0004). Letting SSO roles be the whole permission model (rejected: the IdP says it is only a coarse signal and company scoping is DCC's job).
**Consequences.** Verified end to end against the real dev SSO (sign-in, role claim, demotion, back-channel logout). The browser is same-origin with the API through the web app's `/api` proxy, so no CORS.
Detail: [identity-and-sso/INTEGRATION](../../identity-and-sso/INTEGRATION.md).
