# Definition of Ready and Definition of Done

## Ready (a task may start)

- [ ] It has an issue with a clear description, an owner, a priority, and **acceptance criteria you can check**.
- [ ] Its dependencies are done or agreed (see DEPENDENCIES), and it relies on no undecided business rule (see OPEN-DECISIONS).
- [ ] You know which folders you will change and who owns them (OWNERSHIP).
- [ ] If it changes a shared contract or the database, the other side has been told.

## Done (a task may be closed)

- [ ] Acceptance criteria met, shown by evidence in the pull request (commands run and results, screenshots for UI).
- [ ] **Tests** written for the behaviour; for company data: attack tests (another company cannot read or write it). Bug fixes include a test that fails without the fix.
- [ ] `npm run lint && npm run typecheck && npm test && npm run build` pass; CI is green.
- [ ] **Security**: permission check per company, audit event for changes, no secrets or tokens in code, logs or responses, input validated.
- [ ] **Database**: migration added (never edited), RLS for company tables, `schema.ts` updated.
- [ ] **Documentation** updated (docs folder of the area, `.env.example` for new settings, API docs).
- [ ] Reviewed by one person (plus the code owner for protected areas); conversations resolved; merged by squash into `develop`.
- [ ] Honest status: if something is only a scaffold or unverified, the docs and the pull request say so.

"It compiles" and "it works on my screen" are not done.
