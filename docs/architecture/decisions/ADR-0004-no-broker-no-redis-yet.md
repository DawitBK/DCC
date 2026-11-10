# ADR-0004: No Redis, RabbitMQ or worker until a requirement needs them

**Status:** Accepted · **Deciders:** Dawit (instruction: avoid unnecessary DevOps complexity)

**Context.** The proposal's stack lists Redis and RabbitMQ. Today nothing needs them: sessions live in PostgreSQL, rate limiting is in-process (one API instance), and Postiz brings its own Redis and Temporal.
**Decision.** DCC runs with PostgreSQL only. When the first real background job appears (scheduled reports, engine reconciliation, token-expiry checks), add **BullMQ on Redis** (already operated for other Group systems) in a worker process, with its own ADR. RabbitMQ is not planned: no requirement needs a broker beyond a job queue.
**Consequences.** One dependency to run in dev and production. If the API is ever scaled to several instances, rate limiting and any in-memory state move to shared storage at that time.
