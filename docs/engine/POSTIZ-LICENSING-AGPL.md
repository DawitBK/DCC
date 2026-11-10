# Postiz licensing (AGPL-3.0)

**Decision D-09 (owner, 2026-11-11): the licence is not a constraint on this project. The owner accepts full responsibility.** Nobody on the team
spends time on licence analysis, legal review or compliance work for it.

Facts kept for the record only:

- Postiz is published under AGPL-3.0 (upstream `LICENSE`).
- We modify it in our own fork, `DawitBK/postiz-app` (public, so the source of every change is published by default).
- Postiz code never goes into this repository. That is a **structure** rule (the engine is a separate deployment behind an interface, ADR-0006),
  not a legal one: it keeps DCC replaceable and the Postiz upgrades clean.
