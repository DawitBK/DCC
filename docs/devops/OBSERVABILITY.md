# Observability

Owner: Dawit. Distinguishes what **works now** from what still needs infrastructure.

## Works now (in the API)

| Capability                  | Detail                                                                                                                                                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Request and correlation ids | every response has `X-Request-Id` (an inbound sane id is honoured); the same id is in logs and in audit events                                                                                                                             |
| Structured logs             | one JSON object per line on stdout/stderr (`time, level, context, requestId, message`); secrets, tokens, cookies, authorization headers are redacted at any depth                                                                          |
| Liveness / readiness        | `GET /api/health/live` (process only) and `GET /api/health/ready` (database reachable)                                                                                                                                                     |
| Metrics                     | `GET /api/metrics` in Prometheus text format: request counts and latency histogram by method, route pattern and status class; process memory and uptime. **Off unless `METRICS_TOKEN` is set**, then needs `Authorization: Bearer <token>` |
| Error shape                 | every error returns `{statusCode, error, message, requestId}`; internal errors never leak details                                                                                                                                          |

## Not done (needs infrastructure or a later feature)

- Prometheus/Grafana deployment, dashboards and alert rules.
- Shipping logs to the Group's central logging/SIEM (the format is ready: ship stdout).
- OpenTelemetry tracing: not added; add it when there is a collector to receive it.
- Background-job metrics: there are no background jobs yet (ADR-0004).
- Error-monitoring service integration.
- Business alerts the proposal asks for (new administrator, token expiry, unexpected publishing): features owned by Hirko/Woluman, fed by audit events and the engine reconciliation.
