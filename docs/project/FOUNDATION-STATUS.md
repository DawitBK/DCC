# Status: what is built, what is verified, what is not

Last updated 2026-11-14 by Dawit's engineering assistant. Honest classification. **Verified** means executed and observed; the
evidence is named. This file started as the v0.1 foundation status and now covers everything on `develop` plus the branch
`chore/dawit/lead-tasks`.

Legend: ✅ implemented and verified · 🟨 implemented, not fully verified · 🧱 scaffold only · 📄 documented only · ⛔ blocked by an external dependency · ❓ pending decision

## Platform

| Item                                                                   | State | Evidence / note                                                                                                                                                                   |
| ---------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Monorepo, build, lint, typecheck                                       | ✅    | `npm run lint/typecheck/build` pass; CI green                                                                                                                                     |
| PostgreSQL roles (`dcc_owner`, `dcc_app`), migrations, seed            | ✅    | 11 migrations; run on PostgreSQL 17 in Docker (development) and on the native server (mirror)                                                                                     |
| Company isolation by RLS                                               | ✅    | attack tests against real PostgreSQL for the platform tables and for every module                                                                                                 |
| Roles, permissions, authorization (`authz`)                            | ✅    | unit and HTTP tests; role table is an interpretation of the proposal (ASM-03..05)                                                                                                 |
| Separation of duties on approval                                       | ✅    | nobody who wrote any version of an item may decide on it; attack tests (found and fixed in the review of 2026-11-13)                                                              |
| Audit trail with hash chain                                            | ✅    | tamper detection and concurrency tests                                                                                                                                            |
| Audit checkpoints against a full rewrite by a database insider (D-06)  | 🟨    | built; tested against real PostgreSQL; run on development and mirror. **Not in force:** the off-box copy and the daily job need a server                                          |
| Sign-in with the existing SSO                                          | ✅    | real browser against the local dev SSO (2026-11-10): login, cookie flags, `/api/me`, logout                                                                                       |
| Admin bootstrap from the SSO role claim, demotion, back-channel logout | ✅    | real SSO: grant, demote, session ended at once                                                                                                                                    |
| Two-factor sign-in required (D-07)                                     | 🟨    | DCC refuses a sign-in without `amr=mfa` (unit-tested); `dcc` is in the SSO's two-factor list on dev and mirror. **A browser sign-in with an authenticator code has not been run** |
| Re-authentication for sensitive actions                                | 🟨    | 12 tests: stale and unknown sign-in times refused, fresh ones pass, the four routes covered. **Not run in a browser against the SSO; the web app does not handle the answer yet** |
| Sessions, CSRF origin check, helmet, throttling, validation            | ✅    | HTTP tests; the origin check and the 401 shape re-checked on the running mirror 2026-11-14                                                                                        |
| Config validation and production refusal rules                         | ✅    | unit tests, including the key-file and re-authentication rules                                                                                                                    |
| Health, request ids, JSON logs with redaction, metrics                 | ✅    | tests; metric lines read from a live process 2026-11-14. Prometheus/Grafana/SIEM **do not exist** (📄 scrape job and alert rules ready)                                           |
| Backup with manifest, and restore                                      | ✅    | rehearsed 2026-11-14 on development data: restored head equal to the manifest, chain verified, row counts equal. Not run on a server                                              |
| Secrets provider for production (key file with rotation)               | 🟨    | built; 7 tests; the key tool run for real. **Never used in a real server start** (the mirror uses the development provider)                                                       |
| Deployment and rollback procedure                                      | 🟨    | rehearsed on the mirror 2026-11-14, including the previous release's code on the new schema (170 tests and a live start). **Not rehearsed on a server**                           |
| CI (GitHub Actions), CodeQL, Dependabot, GitGuardian                   | ✅    | run on every pull request; `npm audit` reports 0 findings on 2026-11-14                                                                                                           |
| Branch protection, secret scanning, push protection                    | ✅    | active on `main` and `develop` (read from the GitHub API 2026-11-14)                                                                                                              |
| CODEOWNERS                                                             | 🟨    | handles confirmed by Dawit; Abenezer's invitation was pending at the last check                                                                                                   |

## Business and product

| Item                                                                                     | State | Note                                                                                                                                                         |
| ---------------------------------------------------------------------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Companies, brands: list and create                                                       | ✅    | rename, suspend and archive are task H-08                                                                                                                    |
| Social account registry: owner, backup admin, assignment, status, gaps report            | ✅    | reviewed 2026-11-13                                                                                                                                          |
| People and roles administration                                                          | ✅    | reviewed; removing the last group administrator is not refused yet (H-08)                                                                                    |
| Content drafting, versions, review, approve, reject                                      | ✅    | reviewed; one high finding fixed. The rule is the simple one (one approver who wrote nothing); routing by category waits for the signed matrix (A-05, H-09)  |
| Publishing records, idempotency, freeze                                                  | ✅    | against the **fake engine only**; reviewed, three findings fixed                                                                                             |
| Incidents, in-app notifications, operations overview, dashboard, audit search and export | ✅    | first cut, reviewed; one finding fixed (group-level people were not notified)                                                                                |
| Web app                                                                                  | 🧱    | on `develop`: the shell with sign-in. In pull request 25 (not merged): real screens; companies, brands and accounts read the API, the rest shows sample data |
| Postiz adapter                                                                           | 🟨    | unit-tested against stand-ins; **never run against a live Postiz** (W-03). The backend refuses `ENGINE_PROVIDER=postiz` until then                           |
| Postiz deployment                                                                        | 📄    | plan only (D-03); not provisioned                                                                                                                            |
| Social network integrations                                                              | ⛔    | need each network's developer-app approval (W-04)                                                                                                            |
| Unified inbox                                                                            | 📄    | decided: built in the Postiz fork (D-12, W-08); nothing built                                                                                                |
| Reconciliation of posts made outside DCC                                                 | 📄    | W-05; nothing built. Until then a Postiz administrator could post without DCC knowing                                                                        |
| Approval routing by content category                                                     | 📄    | H-09 and A-05                                                                                                                                                |
| Training, pilot, onboarding                                                              | 📄    | plans, role guides and the checklist are written; nothing has been carried out                                                                               |
| Production deployment                                                                    | ❓    | **nothing is deployed anywhere.** Needs the server (D-04)                                                                                                    |

## Test results

227 automated tests pass on 2026-11-14 (11 contracts, 13 engine client, 203 backend, the backend ones against a real PostgreSQL):
`npm test`. Lint, typecheck, format check, secret scan and the full build pass. Real-browser checks against the dev SSO were
last run on 2026-11-10 (sign-in, role claim, demotion, back-channel logout); nothing in a browser has been run since.

## Environments on 2026-11-14 (what actually runs)

| Environment           | State                                                                                                                                                                                                                                                                         |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Development (this PC) | Database in Docker on 5436 with all 11 migrations. Backend 7916 and frontend 7917 when started (7716/7717 are inside a Windows reserved range here).                                                                                                                          |
| Mirror (this PC)      | **Backend 9716 and frontend 9717 run the branch build** against `dccprod` (native PostgreSQL, all 11 migrations). The mirror SSO was not running during the rehearsal, so no sign-in was done. The gateway (Apache 8090) cannot start: Windows reserves 8012-8111 on this PC. |
| Test / production     | **Not deployed.** No server yet (D-04).                                                                                                                                                                                                                                       |

## The honest short list of what stands between this and a pilot

1. A server (D-04), and on it: the deployment, the key file, the backup and checkpoint jobs, HTTPS behind Apache.
2. A real Postiz, the adapter proven against it (W-03), and reconciliation (W-05).
3. At least one network's developer-app approval (W-04).
4. The screens connected to the API (R-06), and "sign in again" handled (R-07).
5. The signed approval matrix (A-05) and the policy mechanism (H-09).
6. The browser runs against the SSO: two-factor sign-in and re-authentication.
7. The penetration test (M5).
