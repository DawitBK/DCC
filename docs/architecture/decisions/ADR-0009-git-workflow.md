# ADR-0009: Lightweight GitFlow, pull-request based

**Status:** Accepted · **Deciders:** Dawit

**Decision.** `main` (releases, protected) and `develop` (integration, protected) are the only permanent branches. All work happens on short-lived branches (`feature/ fix/ hotfix/ release/ docs/ infra/ chore/ refactor/ test/`) named `<type>/<person>/<topic>`, merged by pull request with one review and green CI, squash-merged. Releases are cut as `release/x.y.z` from `develop`, tagged on `main`, merged back. Hotfixes branch from `main` and are merged to both. No permanent frontend/backend/postiz/personal branches.
**Why.** A branch should be a change, not a department: long-lived team branches delay integration and create giant merges.
**Limits to know.** CODEOWNERS and reviews decide who must approve, not who can edit; GitHub cannot stop a collaborator with write access from changing any folder. Protection on a Free-plan account works for public repositories only (decision D-01).
Full guide: [GIT-WORKFLOW](../../team/GIT-WORKFLOW.md).
