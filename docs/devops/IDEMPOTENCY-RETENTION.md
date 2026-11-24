# Idempotency key retention (H-15, review point O-6)

Owner: Dawit. Code: `portal/backend/src/platform/maintenance/`, migration `202611241400__idempotency_retention.sql`.
Test: `portal/backend/test/idempotency-retention.test.ts`.

`idempotency_keys` holds one small row per publish attempt (`contentItemId:version:channelId`, a state and the engine's answer). The
rows are evidence and the table is small, so **nothing removes them by itself**. This command is for the day an operator decides the
table is large enough to trim. It is never scheduled by the repository.

## Run it

```bash
npm run idempotency:prune -- --older-than-days 90            # dry run: counts only, changes nothing
npm run idempotency:prune -- --older-than-days 90 --apply    # removes the eligible keys and records it in the audit trail
# on a server, with the built code and the server's environment file:
node portal/backend/dist/platform/maintenance/idempotency-retention-cli.js --older-than-days 90
```

- The number of days is **required**: there is no default. It must be a whole number of at least **30**; the database refuses a cutoff
  newer than 30 days whatever the caller says.
- Without `--apply` it is a dry run. It uses the normal runtime role (`DCC_DATABASE_URL`), not the owner role.

## What it may remove

Only keys that are **all** of these: state `done`; last updated before the cutoff; and not belonging to a publication that is still
`pending` or `scheduled` (a scheduled post is waiting for its time and may still be cancelled or reconciled).

It never removes `in_progress` or `unknown` keys, whatever their age: those are the stuck keys that reconciliation works on. The
dry run lists how many keys fall in each group (eligible, newer than the cutoff, kept because a publication waits, never touched).

## What is recorded

Every `--apply` run (even one that removes nothing) writes **one** audit event, `maintenance.idempotency_keys_pruned`, in the same
database transaction as the removal, so a removal with no record cannot happen. Its `details` hold the cutoff, the number removed,
the counts of what was kept or untouched, the oldest and newest last-update time of the removed keys, and a SHA-256 digest of the
sorted removed keys (so a list of keys held elsewhere can be matched to the event). The keys themselves are not copied into the audit
trail. The actor is the maintenance command (`maintenance:idempotency-prune`), not a person; it has no company, so only the platform
owner reads it through the audit API.

## Read this before choosing a number

A `done` key is also what stops the **same content version being published to the same channel twice**: the key is derived from the
content item, the version number and the engine's channel. After the key is removed, nothing in the key store remembers that publish.
Publishing again then depends on the content item's own state and on the people involved. The publication row (with its engine
operation id) stays and remains the record of what was published. So: do not choose a short period, keep the audit-trail digest with
the backup, and prefer a period longer than any realistic "publish it again" window (the minimum of 30 days is a floor, not a
recommendation). A restored database restores the keys with it ([BACKUP-AND-RECOVERY](BACKUP-AND-RECOVERY.md)).

## Not done

Not scheduled (it needs the server, D-04, and the owner's decision on the number). Not run against a populated production table.
