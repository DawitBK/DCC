# Environments, configuration and CI/CD

Owner: Dawit. Decision: [ADR-0010](../architecture/decisions/ADR-0010-deployment-model.md).

## Environments

| Environment | Where                                                          | Database              | Config                         |
| ----------- | -------------------------------------------------------------- | --------------------- | ------------------------------ |
| Development | each developer's PC; PostgreSQL in Docker (`npm run infra:up`) | `dcc_dev`, `dcc_test` | `.env` from `.env.example`     |
| CI          | GitHub Actions runner with a throwaway PostgreSQL service      | created per run       | values in `ci.yml` (throwaway) |
| Test / UAT  | a Group server (decision D-04)                                 | its own               | server env file, outside Git   |
| Production  | a Group server behind the shared reverse proxy                 | its own               | server env file, outside Git   |

Postiz runs separately (operational-engine), from our fork `DawitBK/postiz-app`, on **WSL2 (Ubuntu) with Docker** (D-03, D-04). It is a separate machine or
at least a separate environment from the DCC processes. Plan for WSL's quirks: it stops when its VM is shut down, so set it to start at boot
(Windows scheduled task that runs a command in the distro, or `systemd=true` in `/etc/wsl.conf` plus Docker enabled); prefer WSL2 mirrored
networking so the DCC server can reach it on a stable address; avoid Windows' reserved port ranges ([WINDOWS-PORTS](WINDOWS-PORTS.md)); keep
the Postiz volumes on the Linux filesystem (not `/mnt/c`) for speed and file-permission correctness; include them in the backups. Production address
is path-based over HTTPS behind Apache like the other systems (D-14). Deployments are manual and approved (D-20).

A template for the server environment files is `.env.example`: copy it and replace every
development value. The API **refuses to start in production** with localhost addresses, non-HTTPS addresses, a placeholder secret, the
development secrets provider, or the development admin list.

## Configuration rules

- Every host, port, URL and credential comes from the environment. The only defaults in code are the registered development ports and local addresses, and they are refused in production.
- Variable names are DCC-specific (`DCC_*`, `OIDC_*`, `POSTIZ_*`) so a stray machine-wide `DATABASE_URL` can never be picked up.
- Real environment variables win over `.env`. Never commit `.env` (it is git-ignored); only `.env.example` is committed.
- Next.js **bakes the API address into the web build** (`next build`). Changing `DCC_API_INTERNAL_URL` requires a rebuild of the web app, not just a restart.

## Ports (platform registry)

|                           | Development / production | Mirror |
| ------------------------- | ------------------------ | ------ |
| DCC API                   | 7716                     | 9716   |
| DCC web                   | 7717                     | 9717   |
| Local PostgreSQL (Docker) | 5436                     |        |

On some Windows machines these are unusable: [WINDOWS-PORTS](WINDOWS-PORTS.md).

## Setting up the mirror on another PC (what bit on 2026-11-16)

Git carries none of the settings. In order: create `.env.mirror` (`NODE_ENV=production`, `DCC_ENVIRONMENT=mirror`, database `dccprod` on the
**native** PostgreSQL 5432, ports 9716/9717, `DCC_WEB_BASE_PATH=/dcc`, `DCC_WEB_DIST_DIR=.next-mirror`, `DCC_TRUST_PROXY_HOPS=2`, its own
encryption key); register the `dcc` client in the **mirror SSO's** `.env.mirror` (`PRODUCT_CLIENTS_JSON`, `PRODUCT_APPS_JSON`, the same secret
as DCC's `OIDC_CLIENT_SECRET`, redirects on `http://localhost:8090/dcc/...`); then `npm run mirror:db`, run the seed once with
`NODE_ENV=development` (it refuses when `NODE_ENV=production`; the env file still selects `dccprod`), `npm run build:mirror`, and start with
`start-mirror-all.ps1`. Facts that each cost time:

- **The mirror SSO database must be up to date first.** With `idpprod` missing SSO migrations 030 to 032 every `/authorize` answers 500 and the
  SSO readiness says `schema: degraded`. Run `npm run db:migrate:mirror` in `SSO/backend`, then restart the SSO backend (it registers product
  clients only at boot).
- **The mirror SSO frontend is a build.** Rebuild it (`npm run build:mirror` in `SSO/frontend`, after `npm run stop:supervised`, because the
  running process locks `.next-mirror`) or the console lacks newer screens such as the per-user "App access" panel.
- **The Apache rule for DCC is slash-less**, like `/dms` and `/gms`: `ProxyPass "/dcc" "http://127.0.0.1:9717/dcc"`. Next.js redirects
  `/dcc/` to `/dcc`, so a trailing-slash rule plus a redirect for bare `/dcc` loops forever. `apache/conf/extra/httpd-mirror.conf` is
  git-ignored: its `ServerRoot` must name this checkout's `apache` folder, not another PC's.
- **The SSO platform administrator needs `DCC_PLATFORM_OWNER_EMAILS`**, not an application role (see
  [DEV-CLIENT-REGISTRATION](../identity-and-sso/DEV-CLIENT-REGISTRATION.md), step 5).

## CI/CD

`.github/workflows/ci.yml` runs on every pull request and push to `main`/`develop`:

| Job                        | Steps                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| verify                     | `npm ci`, format check, lint, build shared packages, typecheck, create DB roles, **tests (incl. real-PostgreSQL isolation tests)**, full build |
| security                   | `npm audit --omit=dev --audit-level=high`, secret scan                                                                                         |
| CodeQL (separate workflow) | static analysis on pull requests, pushes and weekly                                                                                            |

Dependabot proposes weekly updates. **Deployment is manual and approved**: there is no automatic deploy. Production access and credentials
are never in GitHub. Docker image builds are not part of CI because DCC does not ship images (ADR-0010).

Configured (read from the GitHub API on 2026-11-14): secret scanning and push protection, Dependabot security updates, branch protection on
`main` and `develop` with the two CI checks required ([BRANCH-PROTECTION](../team/BRANCH-PROTECTION.md)). Not yet configured: automatic deletion of
merged branches (a repository setting, the owner's click), a release workflow that produces a build artefact.
