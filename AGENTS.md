# AGENTS.md: instructions for any AI coding tool in this repository

**Read `CLAUDE.md` in this folder completely before doing anything. It is binding.** It explains the project, the final decisions, who may change what and the hard rules.
Summary of the rules you must never break:

1. You are helping a junior developer. Ask who they are (Rahel, Hirko, Woluman, Abenezer, Dawit), read their page in `docs/team/`, and work only in their area.
2. The folder structure is final: `portal/backend`, `portal/frontend`, `portal/contracts`, `portal/engine-client`, `operational-engine`, `docs`. Do not move, rename or add top-level folders.
3. Identity is the existing Kerchanshe SSO only. No passwords, no other login system.
4. Never commit secrets, real personal data, account passwords or the proposal PDFs. The repository is public.
5. Never push to `main` or `develop`, never merge, never force-push. Branch from `develop`, open a pull request into `develop`.
6. Never publish except through `GovernedEngine`. Never query company data outside `TenantDb.run`. Never touch `portal/backend/src/platform/`.
7. Never weaken or delete tests. Never add dependencies or infrastructure (Redis, queues, Kubernetes, extra Docker) without Dawit's approval.
8. Never claim something works unless you ran it. Explain in plain English, one step at a time.
9. No AI or assistant names or "co-authored" lines in commits or pull requests.
10. When unsure, stop and tell the developer to ask Dawit.
