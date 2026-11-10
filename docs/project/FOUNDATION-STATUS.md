# Foundation status (v0.1)

Last updated 2026-11-10 by Dawit's engineering assistant. Honest classification. **Verified** means executed and observed; the evidence is named.

Legend: ✅ implemented and verified · 🟨 implemented, not fully verified · 🧱 scaffold only · 📄 documented only · ⛔ blocked by an external dependency · ❓ pending decision

## Platform

| Item                                                                   | State                 | Evidence / note                                                                                |
| ---------------------------------------------------------------------- | --------------------- | ---------------------------------------------------------------------------------------------- |
| Monorepo, build, lint, typecheck                                       | ✅                    | `npm run lint/typecheck/build` pass                                                            |
| PostgreSQL roles (`dcc_owner`, `dcc_app`), migrations, seed            | ✅                    | run on PostgreSQL 17 in Docker; `db:reset`                                                     |
| Company isolation by RLS                                               | ✅                    | 15 attack tests against real PostgreSQL; mutation check (RLS switched off) made 5 of them fail |
| Roles, permissions, authorization (`authz`)                            | ✅                    | unit and HTTP tests; role table is an interpretation of the proposal (ASM-03..05)              |
| Audit trail with hash chain                                            | ✅                    | tamper detection and concurrency tests; tamper-evident, **not** tamper-proof (D-06)            |
| Sign-in with the existing SSO                                          | ✅                    | real browser against the local dev SSO: login, cookie flags, `/api/me`, logout                 |
| Admin bootstrap from the SSO role claim, demotion, back-channel logout | ✅                    | real SSO: grant, demote, session ended at once (found and fixed a real bug on the way)         |
| Sessions, CSRF origin check, helmet, throttling, validation            | ✅                    | HTTP tests                                                                                     |
| Config validation and production refusal rules                         | ✅                    | unit tests                                                                                     |
| Health, request ids, JSON logs with redaction, metrics                 | ✅                    | health/metrics in tests; Prometheus/Grafana/SIEM **not deployed** (📄)                         |
| Backup and restore scripts                                             | ✅                    | rehearsed on dev data: restore matched row counts, audit chain verified. Not run on a server   |
| Secrets provider                                                       | 🧱                    | interface + dev implementation only; production key service ❓ D-05                            |
| CI (GitHub Actions), CodeQL, Dependabot                                | 🟨                    | workflow files written; **not yet run on GitHub** (first run is the foundation PR)             |
| Secret scan, `npm audit`                                               | ✅ locally / 🟨 in CI | `npm run secrets:scan`                                                                         |
| Branch protection                                                      | 📄                    | script ready, not applied (needs Dawit, D-19)                                                  |
| CODEOWNERS                                                             | 🟨                    | handles confirmed by Dawit; Abenezer's invitation was still pending                            |

## Business and product

| Item                                                                                | State                                                                                                                                                                             |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Companies, brands: list/create API                                                  | ✅ as the **worked example**; Hirko extends                                                                                                                                       |
| Social account registry                                                             | 🧱 (table + read-only list); governance features are H-02                                                                                                                         |
| User/membership administration API                                                  | 🧱 not built (H-03); until then memberships are created by the seed/tests or SQL                                                                                                  |
| Content, approvals, publishing records, freeze, incidents, analytics, notifications | 📄 not built (Hirko)                                                                                                                                                              |
| Web app                                                                             | 🧱 shell with sign-in/out and design tokens; the UI is Rahel's work                                                                                                               |
| Postiz adapter, governance gate, idempotency                                        | 🟨 unit-tested against stubs; **never run against a live Postiz** (W-03); DB idempotency store is H-05                                                                            |
| Postiz deployment                                                                   | 📄 plan and variable names only; host ❓ D-03                                                                                                                                     |
| Social network integrations                                                         | ⛔ need each network's developer-app approval (W-04)                                                                                                                              |
| Unified inbox                                                                       | 📄 decided: built in the Postiz fork (D-12, task W-08); fork created, nothing built yet                                                                                           |
| MFA enforcement (D-07)                                                              | ✅ DCC refuses sign-ins without `amr=mfa` (unit-tested; **not** exercised against the SSO with MFA on); the SSO's `mfa.requiredApps` setting for `dcc` is still to be switched on |
| Training, rollout                                                                   | 📄 placeholders                                                                                                                                                                   |
| Production deployment                                                               | ❓ blocked by D-04, D-05, D-08; **nothing is deployed anywhere**                                                                                                                  |

## Test results at hand-over

92 automated tests pass (11 contracts, 12 engine, 69 API including real-PostgreSQL isolation, audit, migration, session and HTTP tests). Real-browser checks against the dev SSO:
11 of 11 (sign-in/out) and 10 of 10 (role claim, demotion, back-channel logout) passed; those scripts are throw-away and not part of the repository.
