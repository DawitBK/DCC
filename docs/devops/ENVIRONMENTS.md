# Environments, configuration and CI/CD

Owner: Dawit. Decision: [ADR-0010](../architecture/decisions/ADR-0010-deployment-model.md).

## Environments

| Environment | Where                                                          | Database              | Config                         |
| ----------- | -------------------------------------------------------------- | --------------------- | ------------------------------ |
| Development | each developer's PC; PostgreSQL in Docker (`npm run infra:up`) | `dcc_dev`, `dcc_test` | `.env` from `.env.example`     |
| CI          | GitHub Actions runner with a throwaway PostgreSQL service      | created per run       | values in `ci.yml` (throwaway) |
| Test / UAT  | a Group server (decision D-04)                                 | its own               | server env file, outside Git   |
| Production  | a Group server behind the shared reverse proxy                 | its own               | server env file, outside Git   |

Postiz runs separately (infra/postiz). A template for the server environment files is `.env.example`: copy it and replace every
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

## CI/CD

`.github/workflows/ci.yml` runs on every pull request and push to `main`/`develop`:

| Job                        | Steps                                                                                                                                          |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| verify                     | `npm ci`, format check, lint, build shared packages, typecheck, create DB roles, **tests (incl. real-PostgreSQL isolation tests)**, full build |
| security                   | `npm audit --omit=dev --audit-level=high`, secret scan                                                                                         |
| CodeQL (separate workflow) | static analysis on pull requests, pushes and weekly                                                                                            |

Dependabot proposes weekly updates. **Deployment is manual and approved**: there is no automatic deploy. Production access and credentials
are never in GitHub. Docker image builds are not part of CI because DCC does not ship images (ADR-0010).

Not yet configured (Dawit): GitHub secret scanning + push protection (repository setting), required checks and branch protection
([BRANCH-PROTECTION](../team/BRANCH-PROTECTION.md)), a release workflow that produces a build artefact.
