# What you may touch, and what you may not

**The computer lets you edit everything. That does not mean you may.** The project has rooms, and each room has a keeper. You work in your room. When you need something from another room, you **ask its keeper**.

## The traffic-light map

🟢 = yours, work freely · 🟡 = ask the keeper first, say so in your pull request · 🔴 = never (tell Dawit if you think it is wrong)

| Folder / file                                                                                             |                         Rahel                         | Hirko | Woluman | Abenezer |
| --------------------------------------------------------------------------------------------------------- | :---------------------------------------------------: | :---: | :-----: | :------: |
| `portal/frontend/` (screens)                                                                              |                          🟢                           |  🟡   |   🟡    |    🔴    |
| `portal/backend/src/modules/` (business parts)                                                            |                          🟡                           |  🟢   |   🟡    |    🔴    |
| `portal/backend/migrations/` (database changes)                                                           |                          🔴                           |  🟢*  |   🟡    |    🔴    |
| `portal/engine-client/` (talks to the engine)                                                             |                          🔴                           |  🟡   |  🟢**   |    🔴    |
| `operational-engine/` (our Postiz)                                                                        |                          🔴                           |  🔴   |   🟢    |    🔴    |
| `portal/contracts/` (shared words between front and back)                                                 |                          🟡                           |  🟡   |   🟡    |    🔴    |
| `docs/design/`                                                                                            |                          🟢                           |  🟡   |   🟡    |    🟡    |
| `docs/api/`                                                                                               |                          🟡                           |  🟢   |   🟡    |    🟡    |
| `docs/engine/`, `docs/integrations/`                                                                      |                          🔴                           |  🟡   |   🟢    |    🟡    |
| `docs/requirements/`, `docs/discovery/`, `docs/onboarding/`                                               |                          🟡                           |  🟡   |   🟡    |    🟢    |
| `portal/backend/src/platform/` (login, safety)                                                            |                          🔴                           |  🔴   |   🔴    |    🔴    |
| `portal/backend/src/config/`, `portal/backend/test/`                                                      |                          🔴                           |  🟡   |   🔴    |    🔴    |
| `scripts/`, `infra/`, `.github/`, `package.json`, `tsconfig*`, `eslint.config.mjs`                        |                          🔴                           |  🔴   |   🔴    |    🔴    |
| `CLAUDE.md`, `AGENTS.md`, `.cursor/`, any `CLAUDE.md` in a folder                                         |                          🔴                           |  🔴   |   🔴    |    🔴    |
| `docs/architecture`, `docs/security`, `docs/devops`, `docs/project`, `docs/team`, `docs/identity-and-sso` |                          🔴                           |  🔴   |   🔴    |    🔴    |
| `.env` (your own private file)                                                                            | your own computer only, **never** shared or committed |       |         |          |

\* Hirko adds **new** migration files for his own tables only. Dawit reviews every one. **Never edit an old one.**
\** Except `governed.ts` and `engine.ts` (the approval gate): 🟡 for Woluman, Dawit reviews every change.

Dawit (the architect) may work anywhere.

## Why the red rooms are red (in one sentence each)

- **`platform/`:** this is the lock on the door: login, sessions, company separation, the audit notebook. One small mistake here and one company can see another's data.
- **`migrations/`:** a merged migration is like a chapter already printed. Changing it breaks everyone's database.
- **`scripts/`, `.github/`, `infra/`, config files:** they run the checks and the builds for everyone.
- **`CLAUDE.md` and friends:** the rules your AI helper follows. If anyone could change them, they would stop being rules.
- **Other people's rooms:** they are in the middle of their work. Changes behind their back cause surprises.

## The seven things that are never allowed, for anyone

1. Posting to a social network in any way except through DCC's approval check. (The code door for this is called `GovernedEngine`.)
2. Making our own login or passwords. We only use the company SSO.
3. Putting secrets or real private data in the project (it is public).
4. Reading or changing company data without the safe door (`TenantDb.run`). If you do not know what this means, you are not supposed to be near that code: it is Hirko's and Dawit's.
5. Storing a login token in the browser's memory (`localStorage`). The browser only holds the safe cookie.
6. Adding new tools or servers (Redis, queues, new databases, extra Docker boxes). Dawit decides this.
7. Moving or renaming folders. The structure is final.

## "But I need something in a red or yellow room!"

That happens all the time and it is fine. Do this:

1. **Write it down in one clear sentence:** "I need ___ because ___."
2. Send it to the keeper (see the map) in the group chat. For bigger things open a GitHub **Issue** (use the "task" template).
3. While you wait, **do not edit their files**. Work on something else in your own room.
4. If the keeper says "go ahead and do it", write their name and "approved by" in your pull request.
