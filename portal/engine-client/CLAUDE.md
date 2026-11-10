# portal/engine-client: how the portal talks to the engine (read the root `CLAUDE.md` first; it is binding)

- **Woluman's** area, except `src/governed.ts` and `src/engine.ts` (the interface and the approval gate), which need **Dawit's review** for every change.
- Nothing publishes unless it passes `GovernedEngine` (not frozen, approved version, idempotency). The raw engine only accepts an `ApprovedPublishRequest`. Do not add a way around it.
- The real engine is our customised Postiz (`operational-engine/`, fork `DawitBK/postiz-app`). Do not copy Postiz code in here.
- The adapter has **never been run against a live Postiz**. Do not mark it verified until a test against a running Postiz passes and the result is written down.
- A publish whose outcome is unknown (timeout, 5xx) must never be retried blindly.
- The unified inbox is the optional `InboxEngine` interface. Replies are public communication: they need permission and an audit event in the portal before the engine is called.
