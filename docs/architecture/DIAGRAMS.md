# DCC diagrams

Mermaid renders directly on GitHub. Diagrams marked **(planned)** show the intended design of parts that are not built yet.

## 1. System context

```mermaid
flowchart LR
  user([Staff: executives, admins, marketing, reviewers])
  dcc[DCC Governance Portal]
  sso[Existing Kerchanshe SSO / IdP]
  postiz[Postiz publishing engine]
  nets[(Facebook · Instagram · LinkedIn · YouTube · TikTok · X)]
  user -->|browser| dcc
  dcc <-->|OIDC sign-in| sso
  dcc -->|authorised posts, status| postiz
  postiz -->|official APIs| nets
```

## 2. Containers

```mermaid
flowchart TB
  subgraph DCC["DCC (this repository)"]
    web[web: Next.js]
    api[api: NestJS]
    db[(PostgreSQL: dcc)]
  end
  subgraph PZ["Postiz host (separate)"]
    pz[Postiz app]
    pzdb[(Postiz Postgres)]
    redis[(Redis)]
    temporal[Temporal + its DB + Elasticsearch]
  end
  web -->|same-origin /api proxy| api
  api --> db
  api -->|public API + API key| pz
  pz --> pzdb & redis & temporal
```

## 3. API components

```mermaid
flowchart LR
  req[HTTP request] --> mw[request id · helmet · origin check]
  mw --> guard[SessionGuard: session, access from DB, permission gate]
  guard --> ctl[Controller: zod validation]
  ctl --> svc[Service: authz.can]
  svc --> tdb[TenantDb.run: sets RLS context]
  tdb --> pg[(PostgreSQL RLS)]
  svc --> audit[audit_append, same transaction]
```

## 4. Tenancy model

```mermaid
erDiagram
  groups ||--o{ companies : has
  companies ||--o{ brands : has
  companies ||--o{ social_accounts : has
  brands |o--o{ social_accounts : labels
  users ||--o{ memberships : holds
  groups ||--o{ memberships : scopes
  companies |o--o{ memberships : "scopes (null = whole group)"
  social_accounts ||--o{ account_assignments : "assigned via"
  users ||--o{ account_assignments : receives
```

Every company-scoped table carries `company_id` and an RLS policy; see [TENANCY-AND-RLS](../security/TENANCY-AND-RLS.md).

## 5. Sign-in (implemented, verified against the dev SSO)

```mermaid
sequenceDiagram
  participant B as Browser
  participant W as DCC web
  participant A as DCC API
  participant S as SSO
  B->>W: GET /api/auth/login
  W->>A: proxy
  A->>A: state + nonce + PKCE verifier saved (single use)
  A-->>B: 302 to SSO /authorize
  B->>S: sign in (MFA per SSO policy)
  S-->>B: 302 /api/auth/callback?code&state
  B->>A: callback
  A->>S: exchange code (server to server)
  A->>A: verify id_token (signature, iss, aud, exp, nonce), email_verified
  A->>A: upsert user, sync admin role claim, create session, audit
  A-->>B: Set-Cookie dcc_sid (HttpOnly, SameSite=Lax) + 302 /
```

## 6. Authorization and isolation

```mermaid
flowchart TB
  r[Request with cookie] --> s[Session lookup, absolute and idle expiry]
  s --> m[Read caller memberships from DB, every request]
  m --> p{Role grants permission for THIS company?}
  p -- no --> d[403 and audit security.access_denied]
  p -- yes --> t[Transaction: set app.user_id, app.group_ids, app.company_ids]
  t --> q[Queries filtered by RLS even if the code forgets]
```

## 7. Content approval and publishing (planned; gate implemented)

```mermaid
sequenceDiagram
  participant C as Creator
  participant D as DCC API
  participant R as Reviewer / Approver
  participant G as GovernedEngine
  participant P as Postiz
  C->>D: submit content version N
  D->>R: review request (creator != approver)
  R->>D: approve version N (approver, time recorded)
  D->>G: publish(content, N, channel, idempotency key)
  G->>G: frozen? approved for N? key already used?
  G->>P: POST /posts (only if all pass)
  P-->>G: post id
  G-->>D: operation id recorded
```

## 8. Postiz integration and status (planned)

```mermaid
flowchart LR
  d[DCC] -->|POST /posts| p[Postiz]
  p -.->|webhook: needs a public HTTPS URL| d
  d -->|GET /posts?startDate&endDate poll| p
  d --> rec[Reconciliation: Postiz posts vs approved DCC records, unknown post raises an incident]
```

Postiz webhooks must target a public HTTPS address and refuse internal ones, so polling is the baseline and the webhook an option. See [POSTIZ-INTEGRATION](../engine/POSTIZ-INTEGRATION.md).

## 9. Social account authorisation (planned)

```mermaid
sequenceDiagram
  participant A as Account owner
  participant PZ as Postiz (restricted admin UI)
  participant N as Network OAuth
  participant D as DCC
  A->>PZ: connect channel (Woluman/Dawit, not end users)
  PZ->>N: OAuth with minimum scopes
  N-->>PZ: tokens (stay in Postiz)
  D->>PZ: GET /integrations
  D->>D: link engine_channel_id to a social_accounts record
```

DCC never stores social tokens.

## 10. Incident response (planned)

```mermaid
flowchart LR
  a[Alert: unknown post, token expiry, admin change] --> t[Triage by security admin]
  t --> f[Freeze publishing for account or company]
  f --> r[Recover: backup admin, revoke tokens]
  r --> c[Communications statement, approved]
  c --> v[Post-incident review, stored on the incident]
```

## 11. Environments

```mermaid
flowchart LR
  dev[Developer PC: Docker PostgreSQL, Node, dev SSO] --> ci[GitHub Actions: lint, types, tests, build, audit, CodeQL]
  ci --> uat[Test / UAT server: Node processes, own database]
  uat --> prod[Production server: Node processes behind the Group reverse proxy]
  postizhost[Separate Linux host with Docker: Postiz] --- uat & prod
```
