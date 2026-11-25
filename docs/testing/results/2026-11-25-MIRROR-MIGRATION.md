# Record: the mirror database migrated and the mirror release built, 2026-11-25

Run by the lead's engineering assistant on the owner's PC. The mirror (`dccprod` on the native PostgreSQL 18, settings in `.env.mirror`) is the test and UAT
environment (decision D-28). It was **not running** during this work and was **not started**: `start-mirror-all.ps1` also starts the SSO, DMS and GMS mirrors,
which is the owner's call.

## What was done

1. **Backup first**: `node scripts/db/backup.mjs` with `.env.mirror` (PostgreSQL 18's `pg_dump`; its folder is not on the shell's path by default): a dump and a manifest in the git-ignored `backups/`.
   The manifest records the audit chain head: **event 162 of 162**.
2. **Migrations**: `npm run mirror:db` applied the **five** migrations of 2026-11-24 to the populated database (`inbox_assignment`, `audit_group_id`, `notification_inbox_assigned`,
   `incident_detail`, `idempotency_retention`); 17 were already applied.
3. **The audit chain after the change to its hash function** (H-18 added a `group` field to the hash only for events that carry one): the database's own `audit_verify()` returned
   **ok, 162 events checked, none broken**, with 162 events in the table and none yet carrying a group. This is the claim of the H-18 design (an old event hashes exactly as before) shown on real,
   populated data, not only in a test.
4. **The mirror release builds**: `npm run build:mirror` (shared packages, backend, the web app for the mirror) finished without error.

## Not done

- The mirror services were not restarted, so nothing was served from the new build and **no mirror pass of the final screens was run** (the passes of 2026-11-24 and 2026-11-25 were on the dev setup and, earlier, on the mirror before these changes).
- The audit checkpoint job was not run after the migration (`npm run audit:checkpoint -- write` then `verify` is the next step, with the second copy).
- A restore of the dump was not rehearsed in this session (a full rehearsal was done on 2026-10-10 / 2026-11-14 on older data).

## To finish it (the owner, or an assistant with the owner's go-ahead)

Start the mirror as usual (`start-mirror-all.ps1` one folder up), then the mirror pass as in the [2026-11-25 return trip and mirror record](2026-11-25-RETURN-TRIP-AND-MIRROR-RUN.md), and write the audit checkpoint.
