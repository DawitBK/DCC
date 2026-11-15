# Audit trail

Owner: Dawit. Code: `portal/backend/migrations/202611101020__audit.sql`, `202611131010__audit_checkpoint.sql`,
`portal/backend/src/platform/audit/`. Tests: `portal/backend/test/audit.test.ts`, `audit-checkpoint.test.ts`.

## What is recorded today

| Area            | Actions                                                                                                                                                                     |
| --------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sign-in         | `auth.login` (with `reauthentication: true` when it was a sign-in for a sensitive action), `auth.login_failed` (reason code only), `auth.logout`, `auth.backchannel_logout` |
| Access          | `security.access_denied`, `access.group_admin_granted_by_idp`, `access.group_admin_revoked_by_idp`, `access.membership_granted`, `access.membership_revoked`                |
| Companies       | `company.created`, `brand.created`                                                                                                                                          |
| Social accounts | `account.created`, `account.updated`, `account.status_changed`, `account.backup_admin_changed`, `account.assigned`, `account.unassigned`                                    |
| Content         | `content.drafted`, `content.version_created`, `content.submitted`, `content.reviewed`, `content.approved`, `content.rejected`                                               |
| Publishing      | `publication.published`, `publication.failed`, `publication.outcome_unknown`, `publishing.frozen`, `publishing.unfrozen`                                                    |
| Incidents       | `incident.opened`, `incident.updated`                                                                                                                                       |
| The audit trail | `audit.exported`                                                                                                                                                            |

Each event has: time, actor (user id and SSO subject), action, target type and id, company id, request id, IP, a small
`details` object, and the hash fields. The names are in `AuditActions` (`audit.service.ts`); auditors rely on them, so they are
not renamed.

Rule for every new feature: **any action that changes data or access, or that a person could later ask "who did this?" about,
writes an event in the same transaction.** Keep `details` free of tokens, secrets and unnecessary personal data.

Not recorded yet: inbox replies (W-08), configuration changes made on the server (they are not made through DCC).

## How it is protected

- The runtime role can only SELECT audit rows (inside its tenant scope) and call `audit_append(...)`, `audit_verify()`,
  `audit_head()` and `audit_hash_at(...)`.
- Triggers reject UPDATE, DELETE and TRUNCATE, even from the table owner, to stop accidents.
- Each row's hash covers the previous row's hash, so editing or deleting any row breaks the chain from that point;
  `GET /api/audit/verify` (needs `audit.read`) reports the first broken row.
- **Checkpoints** (next section) catch what the chain alone cannot: a complete, consistent rewrite.

## Checkpoints: catching a rewrite by a privileged insider (decision D-06)

**The gap.** A database superuser, or `dcc_owner`, can switch the trigger off and rewrite every row with freshly computed hashes.
The forged chain is consistent, so `audit_verify()` says "ok". The test `audit-checkpoint.test.ts` does exactly this and shows it.

**The answer.** Remember what the chain looked like, somewhere the database administrators cannot write, and compare later.
A checkpoint is one line: "at this time the trail had N events, and event number X had hash H".

```bash
npm run audit:checkpoint -- write      # take a checkpoint; append it to the file and to the copy
npm run audit:checkpoint -- verify     # compare every checkpoint with the database; exit code 1 on any mismatch
# on a server, with the built code and the server's environment file:
node portal/backend/dist/platform/audit/checkpoint-cli.js write
```

| Setting                         | Meaning                                                                                                                            |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `DCC_AUDIT_CHECKPOINT_DIR`      | folder for the file on the DCC server (default `./audit-checkpoints`, git-ignored)                                                 |
| `DCC_AUDIT_CHECKPOINT_COPY_DIR` | **the second place**: a folder the DCC database administrators cannot write to (the Linux host's share). `verify` trusts this copy |
| `DCC_AUDIT_CHECKPOINT_KEY`      | sealing key, kept by whoever keeps the copy. With it, a line cannot be forged by someone who can edit the file but lacks the key   |

How it holds together:

- Each line carries a seal over its contents and the seal of the line before it. A line that is edited, dropped or put in another
  order is reported.
- `verify` asks the database for the hash of event X now. A rewritten trail has a different hash; a shortened trail has fewer
  events or no event X. Both are reported in plain words, earliest first.
- The job uses the normal runtime role and two read-only functions that return positions, counts and hashes only. No event data
  leaves the database through it.
- The database backup writes the same head into its manifest (`<dump>.manifest.json`), so a restored database can be checked
  against the moment of the backup ([BACKUP-AND-RECOVERY](../devops/BACKUP-AND-RECOVERY.md)).

**Schedule (to set up on the server, with the backup):** `write` once a day after the evening backup, `verify` once a day before
it and at every phase gate. A `verify` that fails is a **security incident**, not a maintenance task: stop, keep the copy, tell
Dawit and the Group CTO.

**What is proven and what is not.** Proven by tests against real PostgreSQL: a full consistent rewrite and a removal of the
newest events both pass `audit_verify()` and fail `verify`; an edited, dropped or re-sealed line is noticed. Run for real on the
development database and on the mirror on 2026-11-14. **Not done:** the scheduled job and the second place do not exist yet
(they need the test server, D-04). Until the copy really lives where the database administrators cannot write, the protection is
only as good as the place the file is kept.

## What it still does not protect against (read this before telling anyone it is "tamper-proof")

- Someone who controls **both** the database and the place where the copy and its key are kept.
- Events removed or rewritten **after** the last checkpoint and before the next one: at most one day with a daily job. Take
  checkpoints more often if that is too long.
- An action that never wrote an event because of a defect. The rule above and the reviews are the control for that.

The honest wording is: **tamper-evident, with an off-box checkpoint once the test server exists**. Never "tamper-proof".

## Reading

`GET /api/audit?limit=&action=&companyId=` is scoped twice: by row-level security (the caller's companies) and by the
`audit.read` permission (roles that hold it: Group CTO, Security administrator, Auditor). `GET /api/audit/export` gives the same
search as CSV; the export itself is audited, and it needs a recent sign-in ([re-authentication](../identity-and-sso/INTEGRATION.md)).
