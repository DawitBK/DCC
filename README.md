# DCC: Digital Communications Control Center

The Kerchanshe Group platform for governing, publishing to, monitoring and reporting on the Group's
official social media accounts. One secure place where every account is registered, every post is
approved by the right person, and every action is on record.

> **Status: foundation (v0.1).** The platform layer works and is tested: sign-in with the existing
> Kerchanshe SSO, company-isolated data, roles and permissions, an audit trail. The business
> features (content approval, incidents, analytics, the real UI) are being built by the team on
> top of it. [What is built and what is not](docs/project/FOUNDATION-STATUS.md).

## How it fits together

```
 Browser ──▶ portal/frontend (Next.js) ──▶ portal/backend (NestJS) ──▶ PostgreSQL (company isolation by RLS)
                                        │  │
              existing Kerchanshe SSO ◀─┘  └─▶ operational-engine (Postiz) ──▶ Facebook, Instagram,
              (OIDC sign-in, no DCC passwords)       customised, separate host   LinkedIn, YouTube, TikTok, X
```

- **DCC** owns governance: who may do what, approvals, audit, security, reporting.
- **Postiz** only executes publishing that DCC has authorised. It is a separate deployment and is never the source of truth.
- **SSO** proves who someone is. DCC decides what they may do.

Details: [architecture](docs/architecture/ARCHITECTURE.md) · [diagrams](docs/architecture/DIAGRAMS.md) · [decisions (ADRs)](docs/architecture/decisions/README.md)

## Repository layout

| Path                          | What                                                       | Owner                                              |
| ----------------------------- | ---------------------------------------------------------- | -------------------------------------------------- |
| `portal/frontend`             | The web app people use (Next.js)                           | Rahel                                              |
| `portal/backend/src/modules`  | Business modules                                           | Hirko                                              |
| `portal/backend/src/platform` | Identity, tenancy, audit, config, health                   | Dawit                                              |
| `portal/backend/migrations`   | SQL migrations                                             | Dawit + Hirko                                      |
| `portal/contracts`            | Shared roles, permissions, API types                       | Shared (Dawit reviews)                             |
| `portal/engine-client`        | How the portal talks to the engine: interface, gate, adapter | Woluman                                          |
| `operational-engine`          | The customised Postiz that publishes (own folder, see its README) | Woluman                                      |
| `infra`, `scripts`, `.github` | Local database, scripts, CI                                | Dawit                                              |
| `docs`                        | All documentation                                          | by folder, see [ownership](docs/team/OWNERSHIP.md) |

## Quick start (about 10 minutes)

You need Node 22+, Docker Desktop, and Git.

```bash
git clone https://github.com/DawitBK/DCC.git && cd DCC
cp .env.example .env            # then set DCC_LOCAL_ENCRYPTION_KEY (command is in the file)
npm run setup                   # install, build packages, start PostgreSQL, create roles, migrate, seed
npm run dev:backend             # backend on http://localhost:7716  (Swagger: /api/docs)
npm run dev:frontend            # frontend on http://localhost:7717
npm test                        # 103 tests, including tenant-isolation attacks against real PostgreSQL
```

Signing in needs the dev SSO and a registered `dcc` client: [DEV-CLIENT-REGISTRATION](docs/identity-and-sso/DEV-CLIENT-REGISTRATION.md).
If `listen EACCES` appears on Windows: [WINDOWS-PORTS](docs/devops/WINDOWS-PORTS.md).

## Working on DCC

1. Read [your onboarding page](docs/team/) and [OWNERSHIP](docs/team/OWNERSHIP.md).
2. Branch from `develop`, open a pull request, get one review: [GIT-WORKFLOW](docs/team/GIT-WORKFLOW.md).
3. Tests and documentation are part of the work: [Definition of Done](docs/project/DEFINITION-OF-READY-AND-DONE.md).

**This repository is public.** Never commit secrets, real personal data, real account inventories or the
confidential proposal documents. See [SECURITY.md](SECURITY.md).
