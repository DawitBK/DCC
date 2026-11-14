# Deployment and rollback

Owner: Dawit. **Nothing is deployed to a server yet.** The procedure below was rehearsed end to end on the mirror (this PC) on
2026-11-14; the record is at the end. No production or live service is changed without the owner's explicit go-ahead, and
deployments are manual (decision D-20).

## Release

1. `release/x.y.z` is cut from `develop` ([GIT-WORKFLOW](../team/GIT-WORKFLOW.md)); only fixes and documentation go in.
2. CI green; UAT on the test environment ([UAT scripts](../testing/UAT-SCRIPTS.md)); security checks signed off by Dawit.
3. Merge to `main`, tag `vx.y.z`.

## First deployment only

| Step                                                                                           | Where it is written                                                                     |
| ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Server environment file, outside the repository, from `.env.example` with every value replaced | [ENVIRONMENTS](ENVIRONMENTS.md)                                                         |
| Key file and `SECRETS_PROVIDER=key-file`                                                       | [SECRETS-AND-KEYS](SECRETS-AND-KEYS.md)                                                 |
| Database roles and the empty database: `npm run db:bootstrap`                                  | this file, step 4                                                                       |
| Register DCC in the SSO, require two factors, first administrator                              | [PRODUCTION-CLIENT-REGISTRATION](../identity-and-sso/PRODUCTION-CLIENT-REGISTRATION.md) |
| Apache route `/dcc` to the web process (7717), HTTPS                                           | same pattern as `/dms` and `/gms` on the Group server                                   |
| Scheduled tasks: backup every 4 hours, audit checkpoint once a day                             | [BACKUP-AND-RECOVERY](BACKUP-AND-RECOVERY.md), [AUDIT](../security/AUDIT.md)            |
| Metrics token and the Prometheus scrape job                                                    | [OBSERVABILITY](OBSERVABILITY.md)                                                       |

## Deploy (every release)

1. **Back up** the database: `node scripts/db/backup.mjs <folder>`. Keep the dump and its manifest.
2. **Check the audit trail before touching anything:** `node portal/backend/dist/platform/audit/checkpoint-cli.js verify`.
   A mismatch stops the deployment: it is a security incident.
3. Check out the tag on the server; `npm ci`; `npm run build`.
4. Make sure the environment file is complete. The API checks it at start and refuses to run with a problem, naming it.
5. Apply migrations **as `dcc_owner`**: `npm run db:migrate`. Migrations are forward-only; each runs in a transaction.
6. Restart the two Node processes (API on 7716, web on 7717). The web app must be **rebuilt**, not only restarted, when
   `DCC_API_INTERNAL_URL` or `DCC_WEB_BASE_PATH` changed: Next.js fixes them at build time.
7. **Verify**, in this order:
   - `GET /api/health/ready` answers `{"status":"ok","checks":{"database":"up"}}`, directly and through the web address;
   - the sign-in page opens and says what it should (look at the page, not only at the status code);
   - sign in; `/api/me` shows the right person and roles;
   - one read screen works (companies);
   - `checkpoint-cli.js write`, then `verify`: all agree.
8. Take a second backup (the state right after the deployment).
9. Record the version, the time, who deployed and the result.

## Rollback

- **Code only, the usual case.** Check out the previous tag, `npm ci`, `npm run build`, restart, verify as in step 7.
  This is safe **because every migration must be additive**: new tables, new columns with a default, new functions. The previous
  code must keep working on the new schema. Proven for this release, see the record below.
- **Rule for every migration** (reviewed in every pull request): never drop or rename a table or column, and never add a
  required column without a default, in the same release that stops using the old shape. Removing something takes two releases:
  first stop using it, then remove it.
- **If the data itself is wrong** (a migration damaged it): stop the API, restore the pre-deployment backup into a **new**
  database, compare it with the manifest, switch the connection, start. This loses what was written since the backup: the owner
  decides. Procedure: [BACKUP-AND-RECOVERY](BACKUP-AND-RECOVERY.md).
- After any rollback: verify as in step 7, and write down what happened.

## Rehearsal record: mirror, 2026-11-14

Environment: the mirror on Dawit's PC (`.env.mirror`: production mode, database `dccprod` on the native PostgreSQL 17, backend
9716, web 9717 under `/dcc`). From `main` at `5b72fe2` (4 migrations applied) to the branch `chore/dawit/lead-tasks`.

| Step                          | What happened                                                                                                                                                                                                               |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backup before                 | dump and manifest written. The manifest had no audit head because the old schema has no `audit_head()`: the script warned and carried on                                                                                    |
| Build                         | `npm run build:mirror`: packages, backend, web. Passed                                                                                                                                                                      |
| Migrate                       | 7 migrations applied (4 of Hirko's modules, 3 of this release), 4 already up to date                                                                                                                                        |
| Start                         | backend ready in under 20 seconds; web ready                                                                                                                                                                                |
| Health                        | ready directly and through the web address under `/dcc`                                                                                                                                                                     |
| No session                    | `/dcc/api/me` answers 401 in the standard error shape                                                                                                                                                                       |
| Cross-site request            | a POST from another origin is refused with 403                                                                                                                                                                              |
| Metrics without a token       | 404 (off unless a token is set)                                                                                                                                                                                             |
| Sign-in page                  | title and sign-in text present in the page                                                                                                                                                                                  |
| Audit checkpoint              | `write` then `verify` against the copy: all agree                                                                                                                                                                           |
| Backup after                  | dump and manifest, this time with the audit head                                                                                                                                                                            |
| **Defect found**              | with the mirror SSO stopped, `GET /api/auth/login` answered a bare 500. Fixed the same day: it now returns to `/dcc/?error=signin_unavailable`, the page shows the message, the log has the cause. Re-checked on the mirror |
| **Rollback, tests**           | the previous release's code (`5b72fe2`) with the three new migrations added: all of its 170 backend tests pass on the new schema                                                                                            |
| **Rollback, live**            | stopped the new backend, started the previous release's build against the migrated `dccprod`: ready, 52 routes, health through the web address, no errors in its log                                                        |
| Roll forward                  | stopped the old build, started the new one: ready                                                                                                                                                                           |
| Restore (on development data) | restored a dump into `dcc_restore_check`: audit head equal to the manifest (event 17, same hash), chain verifies, row counts equal                                                                                          |

**What this rehearsal did not cover, and still must be done on the test server:** a sign-in through the SSO (the mirror SSO was
not running), the Apache route (port 8090 is inside a Windows reserved range on this PC), HTTPS, the key-file provider in a real
start (unit-tested and the tool was run, but the mirror uses the development provider), the scheduled tasks, and a supervisor
that restarts the processes after a failure or a reboot.

## Not yet written

Server provisioning and the process supervisor (use the one the Group's other systems use: restart on exit, start at boot not at
logon), and log shipping. These need the target host to exist (decision D-04).
