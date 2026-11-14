# Hirko: the brain (backend and business rules)

**Read [START HERE](README.md), then [01 setup](01-SETUP-YOUR-COMPUTER.md), [02 sending work](02-HOW-TO-SEND-YOUR-WORK.md) and [03 what you may touch](03-WHAT-YOU-MAY-TOUCH.md) first.** Then come back.

## Who you are in this project

You build the **rules and the records**: who may do what, how a post is created, checked and approved, what is saved, and what is written in the audit notebook. The screens (Rahel) and the publishing hands (Woluman) both depend on you.
Dawit already built the **foundation** under you: login, the walls between companies, the audit notebook. Your job is to build the business parts **on top of it**, in the same way as the example module, and never around it.

## Your room

- 🟢 **Yours:** `portal/backend/src/modules/` (new folders for each of your modules), `docs/api/`, and **new** migration files for your own tables in `portal/backend/migrations/` (Dawit reviews every one).
- 🟡 **Ask first:** `portal/contracts/` (shared words with the frontend: you add to it, then tell Rahel), `portal/engine-client/`.
- 🔴 **Never:** `portal/backend/src/platform/` and `src/config/` (Dawit's safety foundation), `scripts/`, `.github/`, config files. Full map: [03](03-WHAT-YOU-MAY-TOUCH.md).
- One small allowed exception: the list of audit action names (`AuditActions` in `platform/audit/audit.service.ts`). When you need a new action name (like `content.approved`), add **only that line**, in its own commit, and say so in the pull request. Dawit will review it.

## The four ideas that everything rests on (read twice)

**1. Company walls.** Every company's data lives in the same database but behind **walls**. The database itself refuses to show Company B's rows to a person from Company A. To use the walls you must **always** run company data queries through `TenantDb.run(...)`. If you forget, you see nothing (safe), but if you try to go around it, you are breaking the most important rule of the project.

**2. Permissions.** Each role can do certain things (`content.create`, `content.approve`, ...). The list is in `portal/contracts/src/permissions.ts`. In a controller you write `@RequirePermission('content.approve')`, and in the service you double-check for the specific company with `can(access, permission, { groupId, companyId })`.

**3. The audit notebook.** Every important change writes an entry **in the same step** as the change (same database transaction). If the change fails, the entry is not written; if the entry fails, the change does not happen. You call `this.audit.record(trx, {...})` **last** inside the transaction.

**4. The approval door.** Nothing is posted unless it goes through `GovernedEngine`. It checks three things: not frozen, an **approved version** exists, and it was not sent before. You will supply the real checks (see H-04 and H-05). You never talk to Postiz directly.

## Your first day

1. Finish setup ([01](01-SETUP-YOUR-COMPUTER.md)). `npm test` must pass.
2. Start the backend: `npm run dev:backend` and open `http://localhost:7716/api/docs`. This is the list of everything the backend can do today. Try `GET /api/health/live`.
3. Sign yourself in for practice (Step 9 of 01) as `group_admin`, then try `GET /api/companies` in the docs page (or with the cookie in the browser).
4. Read these, in this order (one hour in total):
   1. [ARCHITECTURE](../architecture/ARCHITECTURE.md) (sections 2 and 3)
   2. [TENANCY-AND-RLS](../security/TENANCY-AND-RLS.md) and [AUDIT](../security/AUDIT.md)
   3. [DATABASE](../database/DATABASE.md)
   4. [ADDING-A-MODULE](ADDING-A-MODULE.md) (your recipe)
5. Open and read **slowly** the worked example, the folder `portal/backend/src/modules/companies/` (two files) and `portal/backend/test/api.e2e.test.ts` plus `portal/backend/test/tenant-isolation.test.ts`. The tests are the quality bar: when you add a table, you add tests like those.
6. Ask Dawit for the proposal and team document (the PDFs; **they never go in the project**). Your modules are in section 4B of the team document.

## Your tasks, one at a time

Do them in order. Each task is its own branch and pull request ([02](02-HOW-TO-SEND-YOUR-WORK.md)). **Business rules (who approves what) come from Abenezer's register and Dawit. Never invent them: ask.**

### H-01: The plan on paper (about 1 day)

**Why:** a clear plan stops three people building the same thing three ways.

**Steps**

1. Branch `docs/hirko/module-plan`.
2. Book 30 minutes with Dawit. Bring your questions.
3. Create `docs/api/MODULE-PLAN.md` with a short section for each module you will build (use the 12 in the proposal: account registry, access governance, publishing workspace, approvals, incidents, analytics, security center, notifications...). For each module write:
   - **What it does** (2 lines, plain words)
   - **Tables it needs** (names and the important columns)
   - **Endpoints it offers** (for example `POST /api/content-items`)
   - **Permissions it uses** (from `permissions.ts`; say if a new one is needed)
   - **What it depends on** (other modules, Abenezer's decisions, Woluman's engine)
   - **Order**: which comes first
4. Pull request. **Done when:** Dawit approves the plan.

### H-02: Social account registry (about 1 week)

**Why:** the record of every social page: who owns it, the backup admin, which people are assigned, and its status. This is the heart of "know what we own".

The tables `social_accounts` and `account_assignments` **already exist** (see `portal/backend/migrations/202611101000__platform_core.sql`). A read-only list endpoint exists (`GET /api/social-accounts`).

**Steps**

1. Branch `feature/hirko/social-account-registry`.
2. **Contract first.** In `portal/contracts/src/api.ts` add the request shapes (use `zod`, copy how the company ones are written) and response types for: create an account, update an account, assign a person, set the backup admin, change status. Run `npm run build:packages`. Tell Rahel in the chat what you added.
3. **Controller.** Open `social-accounts.controller.ts` and add the new endpoints. Each has `@RequirePermission('account.manage')` and validates its body with the zod schema using `ZodValidationPipe`. **Never trust a company id coming from the request body**: get it from the account you load under the walls.
4. **Service.** Copy the pattern of `companies.service.ts`:
   - everything inside `this.tenant.run({ userId, groupIds, companyIds }, async (trx) => { ... })`,
   - load the account (if the walls hide it you get "not found": return **404**, never 403),
   - `can(access, 'account.manage', { groupId, companyId })`,
   - make the change,
   - `this.audit.record(trx, ...)` **last**.
5. **Rules to enforce** (ask Abenezer/Dawit if unsure): an account must have an **owner**; a **backup admin** must be a different person from the owner; status changes are audited; **never store a password or token** (DCC never stores social tokens: the engine connects accounts).
6. **Tests** (both kinds are required):
   - HTTP tests with real sessions like `api.e2e.test.ts`: allowed role works, forbidden role gets 403, invalid input gets 400.
   - **Attack tests** like `tenant-isolation.test.ts`: a user of Company B cannot read, change or assign accounts of Company A, even if they guess the id.
7. Update `docs/api/` with the new endpoints. Run the checks. Pull request.

**Done when:** all tests pass including attack tests, the audit notebook records every change, Rahel can build the screen from your docs.

### H-03: People and roles administration (about 1 week)

**Why:** DCC must be able to add a new company and its people "in under a day without code changes".

**Steps**

1. Branch `feature/hirko/user-access-admin`.
2. Contract first (as above). Endpoints you need: list people the caller may see; grant a role; revoke a role.
3. **Role scope rule** (already in the code, use it): group roles (`group_admin`, `group_cto`, `security_admin`, `group_marketing`) are held for the **whole group** (no company); company roles (`company_admin`, `company_executive`, `company_marketing_manager`, `content_creator`, `content_reviewer`, `publisher`) are held for **one company**; `auditor` may be either. Use `roleAllowedAtScope` from `@dcc/contracts`. The database also refuses wrong combinations.
4. **Who may grant what:** this is **not decided yet**. Ask Dawit. Do not guess. (Suggested question: "May a company administrator grant roles inside their own company only, and never group roles?" Write the answer into the plan.)
5. Use `AuditActions.membershipGranted` / `membershipRevoked` (they exist).
6. Attack tests: a company admin of A cannot grant anything in B, cannot create a group role, cannot grant themselves more.
7. Pull request.

**Done when:** grants and revokes work, are audited, and attack tests pass.

### H-04: Content and approvals (about 2 weeks, the biggest task)

**Why:** the reason DCC exists: **nothing is posted without a checker saying yes**, and everything is on record.

**Wait for:** Abenezer's A-05 (the approval matrix: how many levels, who approves which category, time limits). Do the parts that do not depend on it first (steps 1–4).

**Steps**

1. Branch `feature/hirko/content-approval`.
2. Design the tables (write them in the plan first and let Dawit see): content item, content **version** (every edit makes a new version), the request for approval, each decision (who, when, yes/no, comment), the target accounts.
3. Migration: one new file `YYYYMMDDHHMM__content_approvals.sql` (look at the existing ones for the pattern: `company_id` on every table, row security on, policies, **minimal** grants to `dcc_app`). **Never edit the existing migrations.**
4. Endpoints: create a draft; edit (creates a new version); submit for review; review; approve; reject; history of one item.
5. **Separation of duties:** the person who created the content can never approve it. Use `assertDifferentPeople(creatorId, approverId)` from `portal/backend/src/platform/authz/authz.ts`. The proposal's role table has a confusing "can publish" mark for creator and reviewer that was read as a typo: **creators and reviewers cannot publish** (assumption ASM-03, decided by Dawit).
6. **A new version needs a new approval.** If someone edits after approval, the old approval does not carry over.
7. Approval rules by category and levels: from Abenezer's decisions only. Until they arrive, build one simple rule (one reviewer who is not the creator) and make the rule easy to replace.
8. **Implement `ApprovalVerifier`** (the interface is in `portal/engine-client/src/governed.ts`): given a content version and a channel, answer "is it approved for this channel?" from your tables.
9. Tests: the happy path; creator cannot approve own work; edit after approval needs a new approval; attack tests across companies; every step is audited.
10. Update `docs/api/`. Pull request. (It will be big: split it into 2–3 pull requests, for example "drafts and versions", then "review and approve", then "verifier".)

### H-05: Publishing records, the real "sent before?" memory, and the freeze switch (about 1 week)

**Why:** the approval door needs a real memory in the database.

**Needs:** H-04 and Woluman's W-03 (the engine proven against a live Postiz).

**Steps**

1. Branch `feature/hirko/publishing-records`.
2. Tables: one row per publication (content id, approved version, approver, engine operation id, external post link, status, times, error), plus the **idempotency** table (a unique key so the same publish is never sent twice).
3. Implement `IdempotencyStore` in the database. Read the rules in `governed.ts`: a key whose result is **unknown** (timeout) must **block** a blind retry until someone reconciles.
4. Implement `FreezeCheck` and the **freeze switch** per company and per channel (FR-15). Only people with `publishing.freeze` may flip it, and it is audited. Be honest in the docs: the freeze stops publishing **through DCC**, not people posting directly on the network.
5. Tests including "double click publish sends once" and "frozen means refused".
6. Pull request.

### H-06: Incidents, analytics, notifications (later)

Details come from section 4B of the team document and the plan. Same recipe as above for every module.

### After the review of 2026-11-14: H-08, H-09, H-10

Dawit reviewed everything you merged and approved the module plan. Read the review first: `docs/project/reviews/2026-11-13-BACKEND-MODULES-REVIEW.md`. It lists what was good, five things that were fixed (with the tests that show them: `portal/backend/test/lead-review.e2e.test.ts`), and the answers to your seven questions. Your next tasks, in this order, are in `docs/project/BACKLOG.md`: **H-09** (approval policy as data, the important one), **H-08** (small follow-ups), **H-10** (security center endpoint). One more rule from now on: your pull requests go into `develop`, never into `main`.

### H-07: Keep the API documentation true (always)

After every module: `docs/api/` explains each endpoint (what it needs, what it returns, who may call it). The backend's `/api/docs` page is generated from the code; write the few things it cannot say (rules, examples).

## Your week

| Day            | What                                                                                     |
| -------------- | ---------------------------------------------------------------------------------------- |
| Every day      | `git switch develop`, `git pull`, work on your branch, commit small, push, tell the team |
| Before each PR | run all six checks ([02](02-HOW-TO-SEND-YOUR-WORK.md) section C)                         |
| Friday         | 5 lines to Dawit: done, next, blocked by, questions, risks                               |

## Mistakes to avoid (these are the ones that break the project)

- Querying company data **outside** `TenantDb.run`. Opening your own database connection. Using the owner database role.
- Forgetting the audit entry, or writing it **outside** the transaction.
- Returning 403 for "exists but not yours": use **404**, so people cannot discover other companies' ids.
- Trusting an id from the request body.
- Editing a migration that was already merged.
- A table without `company_id` and row security, or without attack tests.
- Calling Postiz directly instead of through `GovernedEngine`.
- Inventing a business rule because nobody answered. **Write the question down and ask.**
- Weakening or deleting a test to make the build green.
- Adding a new library, Redis, a queue or any new infrastructure.

## Ask Dawit

Anything in `platform/` · who may grant which role · new permissions or changing the role table · any new table design before you migrate · anything that needs a new tool.
