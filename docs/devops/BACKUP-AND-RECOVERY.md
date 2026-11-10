# Backup and recovery

Owner: Dawit. Scripts: `scripts/db/backup.mjs`, `scripts/db/restore.mjs`. **Rehearsed on development data on 2026-11-10**:
dump, restore into a scratch database, identical row counts and `audit_verify()` returned ok. **Never run on a server yet.**

## What to back up

- The DCC PostgreSQL database (people, memberships, accounts, audit trail, later content and approvals). A backup holds personal data and
  the audit trail: store and transport it like production data.
- The server's environment file (secrets) through the Group's normal secret handling, **not** with the database dump.
- Postiz has its own databases and uploads: its backup is a separate procedure on its host (Woluman writes it).

## Targets (from the proposal, initial)

Recovery point objective 4 hours; recovery time objective 8 hours. A daily dump does **not** meet a 4-hour RPO: either dump every 4 hours
or use PostgreSQL WAL archiving. Decision D-10.

## Backup

```bash
node scripts/db/backup.mjs <output folder>     # custom-format dump as dcc_owner, file named by timestamp
```

Schedule it with the server's task scheduler when the environment exists; keep several generations; copy off the machine.

## Restore (always rehearse into a scratch database first)

```bash
node scripts/db/restore.mjs <dump file> dcc_restore_check            # dry run
node scripts/db/restore.mjs <dump file> dcc_restore_check --execute
psql ... -d dcc_restore_check -c "select * from audit_verify()"      # expect ok = t
```

Then compare row counts with the source. The script refuses to restore over the configured live database unless you set
`DCC_RESTORE_OVER_LIVE=yes` deliberately. A real recovery: stop the API, take a safety backup of what is there, restore into a new database,
verify, switch the connection, start, check `/api/health/ready` and sign in.

## After a restore

- Sessions in the dump are valid sessions: end them if the dump is old or the cause was a compromise (`delete from sessions`).
- If the audit chain does not verify, stop and escalate: that is a security incident, not a backup problem.
