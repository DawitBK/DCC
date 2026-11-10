#!/usr/bin/env bash
# Applies the branch protection documented in docs/team/BRANCH-PROTECTION.md to `main` and `develop`.
# DRY RUN by default: prints what it would send. Add --apply to change GitHub. Needs `gh` logged in as a repo admin.
# Free-plan note: protection works on PUBLIC repositories. Do not make the repo private before enabling it.
set -euo pipefail

REPO="${DCC_REPO:-DawitBK/DCC}"
APPLY=false
[ "${1:-}" = "--apply" ] && APPLY=true

payload() {
  cat <<'JSON'
{
  "required_status_checks": { "strict": true, "contexts": [
    "verify (install, lint, typecheck, test, build)",
    "security (dependencies and secrets)"
  ] },
  "enforce_admins": false,
  "required_pull_request_reviews": {
    "required_approving_review_count": 0,
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": false
  },
  "restrictions": null,
  "required_conversation_resolution": true,
  "allow_force_pushes": false,
  "allow_deletions": false
}
JSON
}

for branch in main develop; do
  echo "== $REPO : $branch"
  if $APPLY; then
    payload | gh api -X PUT "repos/$REPO/branches/$branch/protection" --input - >/dev/null && echo "protection applied"
  else
    echo "(dry run) would PUT repos/$REPO/branches/$branch/protection with:"; payload
  fi
done
$APPLY || echo "Nothing changed. Re-run with --apply once the CI workflow has run at least once (the check names must exist)."
