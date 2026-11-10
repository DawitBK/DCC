# ADR-0010: DCC deploys as Node processes; Docker for Postiz and local PostgreSQL

**Status:** Proposed (confirm with the architect before the first server install) · **Deciders:** Dawit

**Context.** The Group's production servers run Node processes started by script, without Docker, behind a shared reverse proxy. The proposal says "Docker on Kubernetes". The instruction for this project is to avoid unnecessary DevOps complexity.
**Decision.** DCC (web and API) is built (`npm run build`) and run as two Node processes like the Group's other systems, behind the same reverse proxy on its registered ports (API 7716, web 7717; mirror 9716/9717). No Docker images or orchestration for DCC. Docker is used where it is genuinely required: the local PostgreSQL for developers, and Postiz (its stack needs Docker and several services) on a separate Linux host.
**Alternatives.** Containerise DCC too (cheap to add later: the build output is self-contained; revisit if the Group adopts containers).
**Consequences.** Environments: development (developer PC), test/UAT, production, each with its own database and `.env` file (never in Git). Runbook: [DEPLOYMENT-AND-ROLLBACK](../../devops/DEPLOYMENT-AND-ROLLBACK.md). Open: where the test/UAT environment runs (D-04).
