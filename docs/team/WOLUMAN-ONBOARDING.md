# Woluman: operational engine (Postiz) and social integrations

Your area: `portal/engine-client/` (adapter, tests), `operational-engine/`, `docs/engine/`, `docs/integrations/`. Not yours alone: `governed.ts` and `engine.ts`
(the governance gate and the interface: Dawit reviews them), and DCC authentication, tenancy and approval rules.

## Read first (in this order)

1. [README](../../README.md), [OWNERSHIP](OWNERSHIP.md), [GIT-WORKFLOW](GIT-WORKFLOW.md).
2. The DCC proposal and team document (from Dawit): section 2 of the team document is your scope.
3. **[POSTIZ-INTEGRATION](../engine/POSTIZ-INTEGRATION.md)** (what is verified, what is not, the open questions: that list is your assessment checklist), [ADR-0006](../architecture/decisions/ADR-0006-postiz-separate-service.md), [POSTIZ-LICENSING-AGPL](../engine/POSTIZ-LICENSING-AGPL.md).
4. `portal/engine-client/src/` (small: types, interface, `governed.ts`, `postiz.ts`, tests).

## Decisions already made (do not reopen)

Postiz is the engine. Hootsuite, Sprout Social and Buffer are **functional benchmarks**, not candidates: compare them to find gaps Postiz leaves, not to choose again.
Postiz runs as its own deployment (separate Linux/WSL2 + Docker host), from our fork `DawitBK/postiz-app` (customising Postiz, including the unified inbox, is your work package; see [POSTIZ-INTEGRATION](../engine/POSTIZ-INTEGRATION.md)). No Postiz source is copied into this repository. The AGPL licence is not a constraint (D-09): do not spend time on it. Ask Dawit for write access to the fork.

## Set up

```bash
git clone https://github.com/DawitBK/DCC.git && cd DCC && cp .env.example .env
npm run setup && npm test -w @dcc/engine-client
```

For Postiz itself: [operational-engine/README](../../operational-engine/README.md). Resource note: the upstream stack runs Temporal and Elasticsearch: give Docker enough memory.

## Your first tasks (details in [BACKLOG](../project/BACKLOG.md))

| ID   | Task                                                                                                                                                                                                                        | Depends on |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| W-01 | Run Postiz v2.25.3 locally; answer the open questions in POSTIZ-INTEGRATION; write `docs/engine/POSTIZ-ASSESSMENT.md` (architecture, APIs, security posture, resources, customisation gaps)                                 | none       |
| W-02 | Benchmark report: Hootsuite, Sprout Social, Buffer vs Postiz against the DCC requirements (cost, SSO, API, roles, data ownership); note gaps                                                                                | none       |
| W-03 | Run the `PostizEngine` adapter against your local Postiz with a **test** account: list channels, publish, list posts, delete. Fix the adapter; record results; set `verification` to `verified` only when proven            | W-01       |
| W-04 | Register developer apps per network (Meta, LinkedIn, Google/YouTube, TikTok, X); write `docs/integrations/<network>.md`: permissions, review process and time, rate limits, limitations (supported / partial / unavailable) | start now  |
| W-05 | Bypass-prevention design with Dawit and Hirko: restricting Postiz access, API key handling, reconciliation of Postiz posts against DCC records                                                                              | W-01       |
| W-06 | Analytics mapping and media upload support in the adapter                                                                                                                                                                   | W-03       |
| W-07 | Postiz admin sign-in through the SSO (feasibility), host sizing proposal                                                                                                                                                    | W-01       |

Never paste an API key, client secret or token into Git, issues or chat. Use the server/PC env file only.
