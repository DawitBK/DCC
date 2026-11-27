# Handoff for any agent on any machine, 2026-11-27 (read this first)

This page is the single starting point. It replaces the need to read the earlier handoffs in order; they stay for detail ([2026-11-25](NEXT-AGENT-HANDOFF-2026-11-25.md) holds the long history and the proofs). Everything here was true on `develop` at commit `05938f5` (pull request 139) and was checked on 2026-11-27. If you have the owner's private memory folder, it adds nothing that is not here or in the linked pages; if you do not, you lose nothing.

## 1. Who and how the owner works

- **The owner is Dawit, the architect and team leader.** Since 2026-11-25 he owns every area (frontend, backend, engine, requirements, documents). [OWNERSHIP](../team/OWNERSHIP.md) says who knows an area best; it no longer says who may not touch it.
- **What he wants:** results that run, pushed in small finished pieces, honest limits, plain words. Not explanations in place of work. He is angry about waste: tokens, waiting, and tasks handed to people that could be closed at once.
- **Rules that follow from that (they were learned the hard way):**
  - Do the work inline. **Do not launch several long agents and never wait or poll with sleeps**: five long agents plus waiting burned the shared usage limit on 2026-11-25 and nothing came back. One agent at most, for work that is truly independent.
  - **Fix, review and merge things yourself.** Do not hand the owner or a developer a finding you can close. A small design question: decide it, write the decision down (`docs/project/OPEN-DECISIONS.md`, assumptions in `ASSUMPTIONS.md`) and go on. Ask only what is truly his (legal, money, people, a company's own facts). Educated guesses recorded as assumptions are the rule (D-29).
  - **Merge your own pull request when CI is green** (this is for a session working for Dawit himself; `AGENTS.md` rule 5 "never merge" still binds a session that works for another developer). `gh pr checks N --watch` (run it in the background), then `gh pr merge N --merge`. Never `--admin`, never force-push, never push to `develop` or `main`. GitHub refuses a review approval on your own pull request: that is expected.
  - **No model, AI or assistant name in commits, pull requests or trailers** (owner's order, 2026-10-20). No `Co-Authored-By` line for an assistant.
  - **Never `git add -A` at the repository root of the whole workspace**; add your own files (the owner moves files by hand). Inside DCC, stage the folders you changed.
  - Test environment = the **mirror** (decision D-28); there is no separate test server. A fix on dev also has to reach the mirror (see section 6).
  - Real browser proof beats "it compiles": run it, look at it, judge by the page.
- **People:** Rahel (screens), Hirko (backend), Woluman (engine), Abenezer (requirements and facts), Melkit (a developer with a software engineering degree, joined 2026-11-27, area confirmed after the first test round). The owner takes over what they do not deliver. **Evaluations of named people, the owner's WhatsApp messages and passwords are never in this repository**: they live in `DCC/private/` on the owner's main PC (git-ignored).

## 2. What exists and is proven

- All **21 screens** are real, on a shared kit (`portal/frontend/src/components/kit/`), a grouped menu with counts, detail pages at `/<screen>/<id>`, Ctrl K, dark theme, phone width. The menu depends on the role (the Group administrator sees 16, a content creator 13: the table is in [TEAM-TEST-GUIDE](../testing/TEAM-TEST-GUIDE.md) T0).
- The backend is complete, including Round 2 and 3 (time limits and escalation, emergency approval, the working-hours inbox clock, sensitive-reply approval, moderation, two-person freeze lift, post-incident review, removing and correcting a published post, SMS/Teams/e-mail alerts that send nothing until IT supplies the values). Description: [round2.md](../api/round2.md).
- **Gate on 2026-11-27, all green:** `npm run lint`, `npm run typecheck`, `npm run format:check`, `npm run secrets:scan`, `npm run verify:parity` (116 of 116 routes, 31 of 31 permissions), `npm test` (23 + 38 + 808 tests), VS Code Problems empty. CI runs five checks on every pull request.
- **Browser passes:** dev copy 924 page loads (11 roles x 21 screens x phone and desktop x light and dark) with axe, problems fixed and the touched screens re-checked; the mirror through Apache with test sign-ins 462 loads, 0 findings ([record](../testing/results/2026-11-27-MIRROR-FINAL-SCREENS-PASS.md)). The **real SSO** was exercised on the development SSO (13 of 13 sign-in checks and all six "sign in again" actions): the mirror pass itself did not sign in through the SSO.
- **Engine:** a governed publish, schedule, cancel, check and the inbox (read and reply) pass against Postiz built from the fork and the **practice network**: 16 of 16 and 6 of 6, including a channel connected through Postiz's own Add Channel screen ([record](../testing/results/2026-11-27-ENGINE-CONNECT-CHANNEL.md), [PRACTICE-NETWORK](../engine/PRACTICE-NETWORK.md)).
- **Audit checkpoint job:** the Windows task `DCC-Mirror-Audit-Checkpoint` runs daily at 18:30 and ten minutes after sign-in on the owner's PC; the second copy and the sealing key are on the WSL Linux host.
- **Code review of Round 2 and 3 (owner's session, 2026-11-27):** four defects found by tests that failed first and fixed (decisions on one approval request were not serialised: two approvers at once never settled it; a double click counted twice; emergency against normal approval; a writer could send a rejected sensitive reply around the approvers). [Record](../testing/results/2026-11-27-ROUND2-3-CODE-REVIEW.md), including what was **not** read line by line.
- **Decisions of 2026-11-27:** a publishing freeze also **cancels scheduled posts** of the frozen company or account (`FreezeService.holdScheduled`; people re-schedule after the lift); alert mobile numbers are **stored sealed** through the secrets provider (migration `202611271000`; old plain rows still open and are sealed when saved again).

## 3. What is NOT done (and why), in order of value

1. **Real networks.** No post, no channel, no inbox read has ever run on a real Facebook, Instagram, LinkedIn, YouTube, TikTok or X. It needs developer apps (GitHub issues 37, 38, 39, 41, 42; needs company details only the owner can give). The engine side is ready: after that only a client id and secret are pasted. **Never say it works on a real network.**
2. **The readers of the real networks' inbox** have only a Facebook spec (the fork `DawitBK/postiz-app`, branch `feat/dawit/practice-network`, `libraries/nestjs-libraries/src/integrations/inbox/readers`). Specs for Instagram, LinkedIn, YouTube, TikTok and X are Hirko's task (due 2026-12-02).
3. **Engine administrator sign-in through the Group SSO (W-07)**, hiding unused Postiz modules, registration closed in the fork, a modest Kerchanshe look, restart after reboot (W-09): Woluman's tasks, plus the exact redirect addresses and scopes per network in `docs/engine/CONNECT-REAL-ACCOUNTS.md`.
4. **The live server** (deployment is the owner's act) and the production SSO client registration.
5. **The usability test with real people (L-19)**, 6 to 8 staff, before 2026-12-23 (Abenezer books them).
6. **The Round 2 intake gaps** and the marketing lead's signature on the approval matrix (version 0.2 is a working policy, unsigned): Abenezer; IT's webhook, SMS gateway, mail server and work mobile numbers for alerts.
7. A post carrying a **picture** has never run live (practice network included); keyboard walk and axe have not been run on the mirror; Firefox, Safari, screen readers and real devices have never been tested.
8. **Names:** a person the viewer may not list shows as "Person 4b5e7da0" (Rahel and Hirko); the two response fields `ContentMediaDto.mimeType` and `uploadedBy` that no screen reads (Hirko decides).
9. **Not proven:** that the Postiz fork removes an already published post from a real network; posts handed to the engine at the very instant of a freeze, or with an unknown outcome and no engine id, are not cancelled by it ("Check with the engine" finds them).
10. **The mirror has not been rebuilt** since pull requests 137 to 139 (freeze, sealed numbers, approval lock): `npm run mirror:db`, `npm run build:mirror`, restart the mirror API (9716) and web (9717), then the mirror pass (`docs/testing/results/2026-11-27-MIRROR-FINAL-SCREENS-PASS.md` says how). The audit-checkpoint task keeps running unchanged.

## 4. The test round that is running

New on 2026-11-27: a full test round by the team, with [TEAM-TEST-GUIDE](../testing/TEAM-TEST-GUIDE.md) (tests T0 to T16, plain words, with and without the SSO, a finding template and severity levels). Proposed dates: set-up by Monday 2026-11-30, first report Wednesday 2026-12-02, second Friday 2026-12-04, fixes and retest from 2026-12-05; code complete 2026-12-18. **Findings come back to the owner** (GitHub issues titled `[test] ...` or a message). Triage them, fix them yourself, and answer each with fixed, not a bug (with the reason), or later (with the date).

## 5. Run it (development)

- Setup: `npm install`, `npm run build:packages`, `npm run db:migrate`, then the full walk-through in [05-RUN-EVERYTHING-ON-YOUR-LAPTOP](../team/05-RUN-EVERYTHING-ON-YOUR-LAPTOP.md). Database in Docker (5436): `npm run infra:up`; backend `npm run dev:backend` (7716, or 7916 on the owner's PC); web `npm run dev:frontend` (7717 or 7917).
- **Sign in without the SSO:** `npm run dev:session -- <email> <role> [company-slug]`; the last line is the cookie `dcc_sid` (strip a trailing carriage return when you pipe it). A ticket dies after 30 minutes unused and counts as freshly signed in for 15 minutes (the six sensitive actions need that).
- **Sample data:** `I_UNDERSTAND_THIS_SEEDS_SAMPLE_DATA=dcc_dev node scripts/run-with-env.mjs .env node scripts/demo/seed-sample-data.mjs`. **Working rules** (twelve categories, approval rule per category, seven incident categories with playbooks): `scripts/demo/load-working-defaults.mjs` (needs two tickets; the exact commands are in TEAM-TEST-GUIDE section A; `--dry-run` prints the matrix).
- **Engine:** the practice network exists only in the image built from the fork; follow [PRACTICE-NETWORK](../engine/PRACTICE-NETWORK.md). Proof scripts: `scripts/verify/practice-network-e2e.mjs`, `npm run verify:live -w @dcc/engine-client`, `scripts/verify/engine-connect-channel.mjs` (their headers say what they need).
- Verification scripts: `scripts/verify/parity-check.mjs`, `screens-pass.mjs` (needs Playwright and axe-core installed outside the repository), `sso-browser-checks.mjs` (real SSO, about 25 minutes for check 12).
- The mirror: `start-mirror-all.ps1` (one folder up), web `http://localhost:8090/dcc`, API 9716, settings in the git-ignored `.env.mirror`.

## 6. Things that cost time (do not repeat them)

- **A fix on dev must also reach the mirror** (and production): verify where the mirror really runs from first. Migrations: `npm run db:migrate` (dev) and `npm run mirror:db`.
- After `git pull`: `npm run build:packages`, or the backend watch shows one compile error. Run `npm run db:migrate` after a pull that brought migrations.
- The dev frontend serves every page from one compiler: one missing import makes every page answer 500 for everybody. Keep it compiling after every save.
- The fork clone (`operational-engine/postiz-app`, git-ignored) uses TypeScript 5.5.4, which rejects `"ignoreDeprecations": "6.0"`; VS Code shows red lines on the fork's tsconfig without it. Keep that line **out** while building the image and put it back afterwards (the line is never committed).
- **Git Bash** rewrites `\\server\share` paths (it created the stray `C:\wsl.localhost` folder tree) and breaks on backticks and some heredocs: write a script file and run it; run anything with a network path from PowerShell.
- A dev backend crash shows as port 7916 down. A long browser run needs a fresh session per context (the screens-pass script does this).
- The camera of the guide-video tool needs a non-empty `cam` on every line (`cam: ['@Digital Communications'], spot: [], z: 1.0`), or the renderer crashes. The owner-only guides are in `KERCHANSHE-TECH/guides/` (git-excluded).
- A task that changes the owner's PC was refused by the permission check until he said so explicitly; the audit-checkpoint task registration script had a PowerShell parse error (`${TaskName}:`), fixed.
- The tool refuses to delete `C:\wsl.localhost`: it is an empty tree with one stale test file; the owner removes it with `rmdir /s /q C:\wsl.localhost` in his own terminal.

## 7. Local-only things that are never in Git (so a second machine does not have them)

`DCC/private/` (the owner's messages and the engine's development administrator login), `.env`, `.env.mirror`, `operational-engine/postiz.env`, the key files and the audit sealing key, the workbooks of the marketing team, the owner-only guide videos. A second machine makes its own `.env` from `.env.example`; real values are never copied into a file that is committed.

## 8. Where everything else is

[HANDOVER](HANDOVER.md) (how to run, sections older than this page where they differ) · [BACKLOG](BACKLOG.md) · [OPEN-DECISIONS](OPEN-DECISIONS.md) (D-28 mirror is the test environment, D-29 educated guesses, D-31 the in-process sweep, D-33 Round 3) · [ASSUMPTIONS](ASSUMPTIONS.md) · [MILESTONES](MILESTONES.md) · [REQUIREMENTS-REGISTER](../requirements/REQUIREMENTS-REGISTER.md) · [APPROVAL-AND-PUBLISHING-POLICY](../requirements/APPROVAL-AND-PUBLISHING-POLICY.md) · [INCIDENT-PLAYBOOKS](../security/INCIDENT-PLAYBOOKS.md) · [PARITY-REPORT](../design/PARITY-REPORT.md) · test records in `docs/testing/results/` · the root `CLAUDE.md` (binding rules).
