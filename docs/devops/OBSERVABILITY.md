# Observability

Owner: Dawit. Distinguishes what **works now**, what is **ready to switch on**, and what still needs infrastructure.

## Works now (in the API)

| Capability                  | Detail                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Request and correlation ids | every response has `X-Request-Id` (an inbound sane id is honoured); the same id is in logs and in audit events                                                                                                                             |
| Structured logs             | one JSON object per line on stdout/stderr (`time, level, context, requestId, message`); secrets, tokens, cookies, authorization headers are redacted at any depth                                                                          |
| Liveness / readiness        | `GET /api/health/live` (process only) and `GET /api/health/ready` (database reachable)                                                                                                                                                     |
| Metrics                     | `GET /api/metrics` in Prometheus text format: request counts and latency histogram by method, route pattern and status class; process memory and uptime. **Off unless `METRICS_TOKEN` is set**, then needs `Authorization: Bearer <token>` |
| Error shape                 | every error returns `{statusCode, error, message, requestId}` and, where the web app must react, a `code`; internal errors never leak details                                                                                              |
| Audit checkpoint            | `checkpoint-cli.js verify` exits 1 and prints the reason when the audit trail no longer matches its checkpoints ([AUDIT](../security/AUDIT.md))                                                                                            |

## Ready to switch on (files in the repository, nothing deployed)

| File                                  | What it is                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `infra/monitoring/prometheus-dcc.yml` | the scrape job to copy into the Group's Prometheus: the backend on `127.0.0.1:7716`, bearer token |
| `infra/monitoring/dcc-alerts.yml`     | seven alert rules that use only the metrics above                                                 |

To switch on: set `METRICS_TOKEN` in the server environment file, restart the backend, give Prometheus the same token in a file
only its account can read, add the job and the rules, reload Prometheus. Scrape the backend on the server itself: the metrics
route is not routed through Apache and must stay that way.

### The alerts and what to do

| Alert                 | Meaning                                                 | First action                                                                                     |
| --------------------- | ------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `DccBackendDown`      | the backend has not answered for 2 minutes              | process and log on the server, then PostgreSQL                                                   |
| `DccBackendRestarted` | it restarted outside a deployment                       | the log just before the restart; repeating means a crash loop                                    |
| `DccServerErrors`     | 5xx answers                                             | request ids in the log (`level: error`, `context: Http`); a 5xx is a defect or a dead dependency |
| `DccSignInFailing`    | people return from the SSO but nobody ends up signed in | `auth.login_failed` events: the reason code says which side is wrong                             |
| `DccManyRefusals`     | unusually many 401/403/404/429                          | `security.access_denied` events; a broken screen or someone probing                              |
| `DccSlowRequests`     | 95% of requests slower than 1.5 seconds                 | PostgreSQL load                                                                                  |
| `DccMemoryGrowing`    | more than 1.5 GB of memory for 15 minutes               | restart in a quiet moment and report it                                                          |

The thresholds are starting values, chosen without production traffic. Review them after the first two weeks of the pilot.
Checked on 2026-11-14 with a throwaway Prometheus in Docker (removed afterwards): `promtool check rules` accepts the file (7
rules); with the scrape job from this repository and the bearer token the running backend was scraped ("up"), the request,
uptime and latency queries returned values, and all 7 rules loaded and evaluated without error. `DccBackendDown` went to
"pending" for a target that did not answer; the run was ended before its two minutes were up, so **"firing" and the delivery
of an alert to a person were not seen**: that needs the Group's own Prometheus and an alert receiver.

### Checks that are not metrics (schedule them with the backup)

| Check                                          | How                                                       | When                          |
| ---------------------------------------------- | --------------------------------------------------------- | ----------------------------- |
| The site answers from outside                  | the Group's uptime monitor on `/dcc/api/health/ready`     | every minute                  |
| The audit trail matches its checkpoints        | `checkpoint-cli.js verify`, alert on a non-zero exit code | daily and before every deploy |
| The newest backup is recent and has a manifest | age of the newest `*.dump.manifest.json`                  | daily                         |

## Logs

Each line is one JSON object, so any collector can ship stdout as it is. On the server, write the two processes' output to
files with rotation (the supervisor does this for the other systems) and keep 90 days. Find everything about one request with
its `requestId`: the browser shows it in every error message.

## Not done (needs infrastructure or a later feature)

- **Prometheus, Grafana and the alert receiver themselves**: the Group has none running for DCC. The files above are ready for
  the day one exists; until then the uptime monitor and the daily checks are the monitoring.
- Shipping logs to a central store or SIEM: no such store exists yet. The format is ready.
- OpenTelemetry tracing: not added; add it when there is a collector to receive it.
- Background-job metrics: there are no background jobs yet (ADR-0004).
- Business alerts the proposal asks for (new administrator, token expiry, unexpected publishing): the security center endpoint
  (task H-10) and the engine reconciliation (W-05) produce them.
