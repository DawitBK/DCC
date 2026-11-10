# ADR-0001: Modular monolith

**Status:** Accepted · **Deciders:** Dawit

**Context.** Five people, a two-month proposal timeline, and a platform whose other systems are single Node services.
**Decision.** One NestJS API process with internal modules and a single PostgreSQL database. Modules talk through services, never through each other's tables.
**Alternatives.** Microservices per module (rejected: operations and coordination cost with no scaling need); one big untyped service (rejected: boundaries matter for five parallel developers).
**Consequences.** Simple to run and debug. If a module ever needs to scale alone, its boundary is already a service interface.
