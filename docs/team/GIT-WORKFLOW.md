# Git workflow

Decision: [ADR-0009](../architecture/decisions/ADR-0009-git-workflow.md). Lightweight GitFlow, pull-request based, built for five people.

## Branches

| Branch                                | Purpose                                  | Rules                                     |
| ------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| `main`                                | released code, tagged                    | protected; only release and hotfix merges |
| `develop`                             | integration: always working and testable | protected; only reviewed pull requests    |
| `feature/<you>/<topic>`               | new capability                           | from `develop`, short-lived               |
| `fix/<you>/<topic>`                   | non-urgent defect                        | from `develop`                            |
| `docs/ infra/ chore/ refactor/ test/` | as named                                 | from `develop`                            |
| `release/x.y.z`                       | stabilise a release                      | from `develop`; only fixes and docs       |
| `hotfix/<you>/<topic>`                | urgent production fix                    | from `main`                               |

Examples: `feature/hirko/company-registry-api`, `docs/abenezer/account-inventory`, `fix/rahel/nav-focus`, `feature/woluman/postiz-live-check`,
`infra/dawit/ci-hardening`. With an issue number: `feature/DCC-014-company-registry-api`. **No** permanent `frontend`, `backend`, `postiz` or per-person branches.

## Day to day

```bash
git switch develop && git pull
git switch -c feature/hirko/company-registry-api
# work in small commits:  feat: add company registry list endpoint
git fetch && git rebase origin/develop        # often; only on your own branch
git push -u origin feature/hirko/company-registry-api
# open a pull request into develop
```

1. Create an issue with acceptance criteria and an assignee (templates provided).
2. Branch from the latest `develop`; do only what the issue says.
3. Add or update tests and docs.
4. Open a pull request **into `develop`**; fill in the template (issue, scope, API/database/security impact, test evidence).
5. CI must be green. One review from someone else; the code owner (see CODEOWNERS) for protected areas; Dawit for security-critical changes.
6. Resolve all conversations. **Squash merge** (keeps `develop` readable). Delete the branch.

Ordinary changes need **one** reviewer. More reviewers only for high-risk or cross-cutting work.

## Commit messages

Conventional: `feat: ...`, `fix: ...`, `docs: ...`, `test: ...`, `refactor: ...`, `chore: ...`, `ci: ...`. Imperative, specific, no secrets.

## Releases

1. Cut `release/x.y.z` from `develop`; freeze features; only stabilisation and docs.
2. Full tests and UAT; Dawit signs off security.
3. Merge to `main` (a merge commit, to keep the release visible), tag `vx.y.z`, merge back into `develop`.

## Hotfixes

Branch `hotfix/...` from `main`; fix, test; pull request into `main`; tag; merge forward into `develop` (and any open `release/*`).

## Never

Push to `main`/`develop`, force-push or rewrite shared branches, commit secrets or real data, merge with failing CI, edit an applied migration.
Branch protection: [BRANCH-PROTECTION](BRANCH-PROTECTION.md).
