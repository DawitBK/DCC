# ADR-0005: Kysely and plain SQL migrations

**Status:** Accepted · **Deciders:** Dawit

**Context.** No ORM was established for DCC. The platform's key database features (RLS policies, `SECURITY DEFINER` functions, the audit hash chain, transaction-local settings) are SQL, and ORM migration tools do not generate them.
**Decision.** One data-access approach: **Kysely** (typed query builder, thin, transactions explicit) with hand-written interfaces in `platform/database/schema.ts`, and **plain SQL migration files** run by a small runner (`migrate.ts`): timestamp-named (`YYYYMMDDHHMM__name.sql`) so parallel branches do not collide, each in a transaction, checksummed so an applied file cannot be edited.
**Alternatives.** Prisma (RLS needs workarounds; Postiz uses it but DCC is separate), TypeORM and Drizzle (workable, but generated migrations still would not carry our policies). Do not mix approaches.
**Consequences.** Developers write SQL for schema changes and update the matching TypeScript interface in the same pull request. Migrations are reviewed by Dawit and Hirko (CODEOWNERS).
