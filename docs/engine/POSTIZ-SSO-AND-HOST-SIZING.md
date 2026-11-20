# Postiz admin sign-in and host sizing (W-07)

**Checked:** 19 November 2026 · **Postiz:** pinned v2.25.3 · **Status:** code review and local measurement; no SSO or production-load test.

## Kerchanshe SSO feasibility

The fork has a generic OAuth sign-in provider. Its code accepts authorization, token and user-info URLs; asks for `openid profile email`; exchanges an authorization code; and reads `sub` and `email` from the user-info response. This is close to the OIDC shape used by Kerchanshe SSO, so using the existing SSO appears technically feasible without adding another identity provider.

It is **not ready to enable as configured**. Postiz looks up an existing user by provider subject. If it does not find one, its flow returns a token to the registration screen, which can create a Postiz user. That is a mismatch with DCC's existing-user-only policy and closed-registration control unless the fork is configured or changed to reject unprovisioned identities. The generic provider also has a fixed callback (`FRONTEND_URL/settings`) and requires the identity provider's user-info response to contain `sub` and `email`; both must be confirmed with the SSO owner. Do not configure credentials or enable the button until Dawit approves the flow and the unprovisioned-user path is blocked.

**Next proof:** in a test instance, configure only the Kerchanshe OIDC endpoints, confirm the callback and claims with the SSO owner, sign in with a pre-provisioned engine admin, then verify that an unprovisioned user is refused and cannot register. This is a needs-real-SSO test; no SSO credentials belong in Git.

## Capacity evidence

On the measured developer computer, the six-container stack used about **1.56 GiB while starting** and **2.35 GiB at rest**, with no channels or posts. At rest that was about 64% of the 3.7 GiB available to WSL, leaving little headroom for DCC, other processes or real publishing load. The measured stack had already downloaded its images, so the recorded 2.35 GiB is memory use, not disk size. The local setup notes call for at least 8 GB assigned to Docker Desktop.

Use **8 GB RAM as a minimum starting allocation for an isolated test host**, not a production guarantee. The 2.35 GiB observation is an empty-stack baseline; concurrency, connected accounts, scheduled work, logs, database growth, backups and operating-system needs were not measured. No safe production CPU/RAM/disk figure can be concluded from this run. Before sizing a production host, measure sustained and peak use with representative channels and posts, and include space for database/media backups. Production server selection and provisioning remain Dawit's decision.
