# ADR-0007: Secrets provider interface; production key service pending

**Status:** Proposed (production choice needs the architect) · **Deciders:** Dawit

**Context.** The proposal names Azure Key Vault "or equivalent". The Group's servers are on-premises Windows hosts; no key service has been chosen. DCC needs encryption now (the stored IdP id_token) and will need more (any engine credentials it holds).
**Decision.** Code depends only on the `SecretsProvider` interface (`encrypt`/`decrypt` with a purpose string bound as authenticated data). The one implementation today is `LocalDevSecretsProvider` (AES-256-GCM, key from an environment variable). It is marked not production-grade and the configuration loader refuses it when `NODE_ENV=production`.
**Options for production (decision D-05).** (a) Azure Key Vault / managed HSM, (b) HashiCorp Vault on the Group network, (c) an OS-protected key file with strict access plus documented rotation, acceptable for a first pilot only if the owner accepts the risk. Recommendation: decide before the pilot; (c) is the cheapest start.
**Consequences.** Until decided, DCC cannot run in production, by design.
