# Postiz licensing (AGPL-3.0)

Owner: Woluman researches; Dawit takes it to management and legal. **This is an engineering note, not legal advice.**

- Postiz's repository states **AGPL-3.0**. Its README says it does not gate features and offers no separate enterprise tier.
- AGPL's network clause: if you **modify** AGPL software and let users interact with it over a network, you must offer those users the
  **corresponding source of your modified version**. Unmodified use has no such obligation, beyond keeping the licence notices.
- DCC itself is a **separate program** that talks to Postiz over its public HTTP API. That separation is why DCC's own code does not need to
  be AGPL. Do not copy Postiz source into this repository and do not link Postiz code into DCC.
- If we **modify Postiz** (a fork), the fork's source must be available to its users (people with access to that Postiz). Who are "users"
  here: only the few engine administrators. Whether that triggers the obligation in practice, and what "offer the source" requires,
  is a question for legal review.
- The recommendation in ADR-0006 is to **avoid source changes at first** (configuration, the API and the DCC governance layer cover the needs)
  and to create a separate DCC-owned fork only with Dawit's approval.

## Before any production use, record here

- [ ] Exact licence file of the pinned release read and attached (`infra/postiz/VERSION` → upstream `LICENSE` at that tag).
- [ ] List of every local modification (none yet) and where its source is published.
- [ ] Legal/management decision on the AGPL obligations for the Group's usage (D-09).
- [ ] Third-party dependency licences in the Postiz image reviewed.
