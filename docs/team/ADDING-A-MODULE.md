# Adding a backend module (Hirko and anyone extending the API)

The `companies` module (`apps/api/src/modules/companies/`) is the worked example. Follow its pattern.

1. **Folder:** `apps/api/src/modules/<name>/` with `<name>.controller.ts`, `<name>.service.ts` (and later a `@Module`).
2. **Contract first:** put request schemas (zod) and response types in `packages/contracts/src/` and export them. Run `npm run build:packages`. Tell Rahel what changed.
3. **Controller:** declare `@RequirePermission('<perm>')` (add the permission to `packages/contracts/src/permissions.ts` and its role mapping only with Dawit's review), validate bodies with `ZodValidationPipe(Schema)`, use `@CurrentAccess()`. Never read an id of a company from the body and trust it.
4. **Service:** run all queries in `this.tenant.run({userId, groupIds, companyIds}, trx => ...)`; load the company under RLS (404 if not visible); check `can(access, permission, {groupId, companyId})`; make changes; call `this.audit.record(trx, {...})` **last** in the same transaction.
5. **Migration:** new file `YYYYMMDDHHMM__<what>.sql` in `apps/api/migrations/`: table with `company_id`, RLS enabled, policies, grants to `dcc_app` (only what is needed); update `platform/database/schema.ts`.
6. **Register:** list the controller and providers in `app.module.ts`.
7. **Tests:** in `apps/api/test/` add (a) HTTP tests with real sessions like `api.e2e.test.ts`, (b) **attack tests** for any new tenant table like `tenant-isolation.test.ts`: another company's user cannot read or write it. A feature without both is not done.
8. **Docs:** update `docs/api/`, and `docs/database/DATABASE.md` if tables changed.
9. **Pull request:** migrations and anything under `platform/` get Dawit's review automatically (CODEOWNERS).

Run before you push: `npm run lint && npm run typecheck && npm test && npm run build`.
