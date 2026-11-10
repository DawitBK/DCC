# Branch protection (Dawit's action)

**State on 2026-11-10: NOT applied.** The script is ready; applying it is the repository administrator's decision (Dawit), because it changes how everyone,
including the administrator, can merge.

## Rules to apply to `main` and `develop`

- Require a pull request before merging; **1** approving review; dismiss stale approvals on new commits.
- Require review from **Code Owners** (CODEOWNERS paths).
- Require the status checks `verify (install, lint, typecheck, test, build)` and `security (dependencies and secrets)`, with the branch up to date.
- Require conversation resolution.
- No force pushes, no deletions.
- Administrators are **not** forced to follow the rules (so Dawit can merge his own pull requests, where he is the only code owner, and handle emergencies).
  Use that sparingly: ask a teammate for a review whenever possible.

## Apply

1. Open one pull request so CI runs at least once (GitHub only offers checks it has seen).
2. `bash scripts/github/apply-branch-protection.sh` (dry run: prints the rules) then `bash scripts/github/apply-branch-protection.sh --apply`.
   Or by hand: Settings → Branches → Add branch protection rule (or Rulesets), with the list above.
3. In Settings → Code security: enable **secret scanning** and **push protection**, Dependabot alerts, and private vulnerability reporting.

## Plan limits (why the repository is public)

GitHub's Free plan supports branch protection on **public** repositories only; a private repository on Free cannot enforce it. If the repository
must become private (decision D-01), upgrade the plan or move it to an organisation first, or the rules become agreement-only.

## What protection cannot do

It does not stop a collaborator from editing a folder that belongs to someone else; it makes sure nothing reaches `develop` without review and CI.
See [OWNERSHIP](OWNERSHIP.md).
