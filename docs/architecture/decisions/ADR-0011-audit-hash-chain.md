# ADR-0011: Append-only audit trail with a hash chain

**Status:** Accepted · **Deciders:** Dawit

**Context.** The proposal requires a "tamper-evident" audit trail: who posted, approved, changed access, signed in.
**Decision.** `audit_events` rows are written only through the `audit_append` SQL function (the runtime role has no INSERT, UPDATE, DELETE or TRUNCATE on the table). Each row stores `hash = SHA-256(previous hash | fields)`, serialised by a lock so concurrent writers keep one chain. `audit_verify()` re-walks the chain and names the first broken row. Triggers also block UPDATE/DELETE/TRUNCATE by the table owner.
**What it is not.** Not tamper-proof: a database superuser or the owner role can disable the trigger and rewrite the whole chain. Detection of partial edits and deletions is real and tested; stronger assurance needs the chain head and rows shipped to storage DCC administrators cannot write (SIEM, write-once storage), which is infrastructure (decision D-06).
Detail: [AUDIT](../../security/AUDIT.md).
