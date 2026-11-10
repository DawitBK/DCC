# Deployment and rollback

Owner: Dawit. **Draft procedure: nothing has been deployed.** Production needs the open decisions D-04 (test/UAT host), D-05 (secrets), D-08 (encryption/TLS) first.
No production or live service is changed without the owner's explicit go-ahead.

## Release

1. `release/x.y.z` is cut from `develop` ([GIT-WORKFLOW](../team/GIT-WORKFLOW.md)); only fixes and documentation go in.
2. CI green; UAT on the test environment; security checks signed off by Dawit.
3. Merge to `main`, tag `vx.y.z`.

## Deploy (per environment)

1. Back up the database ([BACKUP-AND-RECOVERY](BACKUP-AND-RECOVERY.md)).
2. Check out the tag on the server; `npm ci`; `npm run build` (build packages, API, web).
3. Make sure the environment file exists, is complete and passes the API's own checks (it refuses to start otherwise).
4. Apply migrations **as `dcc_owner`**: `npm run db:migrate`. Migrations are forward-only; each runs in a transaction.
5. Start or restart the two Node processes (API on 7716, web on 7717); the reverse proxy routes to them.
6. Verify: `/api/health/ready` is 200; sign in; a read endpoint; the audit chain verifies (`GET /api/audit/verify`).
7. Record version, time and who deployed.

## Rollback

- **Code only** (no migration in the release): check out the previous tag, `npm ci`, `npm run build`, restart.
- **With a migration:** migrations are forward-only. Prefer writing the release so the previous code still works with the new schema (add, do not
  remove or rename, in the same release). If you must go back further, restore the pre-deploy backup into a new database and switch to it
  (this loses data written since the backup: decide with the owner).
- After any rollback: verify as in step 6.

## Not yet written

Server provisioning, process supervision (a restart-on-failure supervisor like the Group's other systems use), reverse-proxy route for DCC, TLS,
monitoring hookup, log shipping. These need the target host to exist.
