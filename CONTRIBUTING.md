# Contributing to DCC

Short version: small branches from `develop`, one reviewer, green CI, tests and docs included.
Full detail: [GIT-WORKFLOW](docs/team/GIT-WORKFLOW.md) and [OWNERSHIP](docs/team/OWNERSHIP.md).

## The rules that matter

1. **Never push to `main` or `develop`.** Open a pull request into `develop`.
2. **One branch per task**, named `<type>/<you>/<what>`: `feature/hirko/company-registry-api`,
   `docs/abenezer/account-inventory`, `fix/rahel/nav-focus`. Types: `feature fix hotfix release docs infra chore refactor test`.
   There are no permanent frontend/backend/postiz branches.
3. **Commit messages are conventional:** `feat: add company registry endpoints`, `fix: ...`, `docs: ...`, `test: ...`, `chore: ...`, `ci: ...`, `refactor: ...`.
4. **Keep your branch current:** `git fetch && git rebase origin/develop` (your own branch only; never rewrite shared branches).
5. **One review is the norm.** Changes to security-critical areas (CODEOWNERS) also need Dawit.
6. **Do not edit a migration that has been merged.** Add a new one.
7. **Tests prove behaviour.** A bug fix includes a test that fails without the fix.
8. **Never commit** secrets, `.env`, real people's data, real account inventories, or the proposal PDFs. CI scans for secrets, but you are the first line.

## Before you open a pull request

```bash
npm run lint && npm run typecheck && npm test && npm run build
```

## Where to work

You can edit any file, but ownership decides who must review it. Stay in your area; for anything that touches
another person's area, talk to them first and say so in the pull request. If you are unsure whether something
is yours, ask in the issue before you start.

## Questions and decisions

Open an issue with the _Decision needed_ template. Do not guess at business rules: Abenezer collects them,
Dawit approves them, and they are recorded in the [decision register](docs/project/OPEN-DECISIONS.md).
