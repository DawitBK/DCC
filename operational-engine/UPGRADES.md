# Postiz upgrade procedure (W-09)

**Owner:** Woluman · **Status:** draft; rehearse on an isolated test host before use on a shared host. Production changes are manual and require Dawit's approval.

Postiz runs separately from DCC. Its database, scheduled-work state and uploaded media must be protected together. Do not upgrade from `latest`, use a moving tag, or change `VERSION` before the candidate has been tested.

## 1. Prepare and protect the current installation

1. Agree a maintenance window with Dawit. Record the current upstream version (`VERSION`), fork commit on `postiz-develop`, image name/tag/digest, compose file, and the current Postiz/Temporal configuration version. Confirm who can restore the host.
2. Stop changes to scheduling during the maintenance window. Record pending scheduled posts and any unresolved DCC publications so they can be checked after the upgrade.
3. Make a consistent, access-restricted backup of **all** Postiz state before changing the image: Postiz database, Temporal database and search data, Redis data, configuration, and the `postiz-uploads` media volume. Use the host's approved backup procedure; never put a live env file or API key in the backup directory's Git history or in command output.
4. Verify that each backup exists, is readable, has enough free space, and can be restored to a separate test instance. Do not proceed if a volume or database backup is missing or unreadable.

## 2. Build and test the candidate from our fork

1. In the separate Postiz fork, fetch upstream tags and create an upgrade branch from `postiz-develop`. Rebase `postiz-develop` on the selected upstream release tag; resolve the small customizations listed in `CUSTOMIZATIONS.md` and keep the inbox work in its own fork files. Never push to upstream or build from the fork's `main`.
2. Build the fork with the recipe used for the pinned release (`Dockerfile.dev`, `NEXT_PUBLIC_VERSION` set to the exact release), and tag the image with an unambiguous candidate tag. For example, the pinned release uses `POSTIZ_IMAGE=dcc-postiz` and `POSTIZ_VERSION=v2.25.3-local`; choose a new version-specific tag for an upgrade. Do not overwrite the old image tag.
3. Start a separate test stack with test data and a test API key. Keep registration closed after the administrator is created; expose only the intended engine port and keep databases and Temporal services internal.
4. Check startup and migration logs, health of all containers, sign-in, closed registration and the Postiz public API. From DCC, run the adapter checks. With an authorized test channel, verify a scheduled test post and deletion; verify media upload and inbox/reply features if the release changes those areas. A real-network check needs the relevant developer app and test account.
5. Record the upstream tag, fork commit, image digest, changes, checks, failures and backup/restore result. Ask Dawit to review the candidate before changing a shared installation.

## 3. Upgrade the approved host

1. Confirm Dawit's approval, the verified backup, the maintenance window and the exact candidate image/tag. Copy the new `POSTIZ_IMAGE`/`POSTIZ_VERSION` values into the host's private `postiz.env`; never commit them or display secrets in logs.
2. Recheck that the published Postiz port is restricted to the DCC server path, user networks cannot reach the admin screen, registration is closed, and no routine operator has a Postiz account. Keep DCC as the only publisher.
3. Recreate only the Postiz application container from the candidate image; keep its existing named volumes. Wait for readiness, then check the API and DCC adapter. Reconcile scheduled and pending publications before reopening normal scheduling.
4. After successful checks, update `operational-engine/VERSION` through a reviewed DCC pull request to the upstream base release. Record the custom fork commit and image tag alongside the release in the change record.

## 4. Roll back

If startup, data migration or adapter checks fail, stop scheduling and restore the previous `POSTIZ_IMAGE` and `POSTIZ_VERSION`. Recreate the Postiz application using the old image. If the new release changed stored data, restore the matching pre-upgrade database and volume backups as a set; do not mix a new database with old media or Temporal data. Verify the previous API and DCC adapter before resuming scheduling, and record the failure for the next upgrade attempt.

## Rehearsal status

The repository has a repeatable local start procedure and has run the pinned stock image and a fork-built image with the same code. It has **not** rehearsed an upstream upgrade, volume restore, reboot recovery on a server, or DCC-only network restriction. Those checks remain open under W-09; this draft is not evidence that the server installation is complete.
