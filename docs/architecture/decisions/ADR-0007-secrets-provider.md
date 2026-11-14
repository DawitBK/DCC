# ADR-0007: Secrets provider interface; production starts with a key file

**Status:** Accepted, 2026-11-14 (decision D-05) · **Deciders:** Dawit

**Context.** The proposal names Azure Key Vault "or equivalent". The Group's servers are on-premises Windows hosts and no key service exists. DCC needs encryption now (the stored IdP id_token) and may need more later (any engine credentials it holds). The repository is public, so no real secret may ever be committed.
**Decision.** Code depends only on the `SecretsProvider` interface (`encrypt`/`decrypt` with a purpose string bound as authenticated data). There are two implementations:

- `LocalDevSecretsProvider` (AES-256-GCM, key from an environment variable): development and the mirror only. The configuration loader refuses it when the environment is production.
- `KeyFileSecretsProvider` (AES-256-GCM, a key ring in a file on the server, outside the repository, readable only by the DCC service account): **production**. The file holds several keys and names the active one, so a key can be rotated without losing data: every ciphertext names the key it was made with, and the key id is authenticated.

**Options considered.** (a) Azure Key Vault or a managed HSM: the strongest, needs a cloud subscription and network path the Group does not have. (b) HashiCorp Vault on the Group network: strong, a new system to run and keep alive. (c) A key file with strict file permissions and a written rotation procedure: the cheapest start. Chosen: (c), because what the key protects today is small (an identity token that lives at most eight hours and is useful only as a logout hint) and the interface lets (a) or (b) replace it later without touching callers.
**Consequences.** Production can start. The accepted limit is written down: whoever can read files as the DCC service account can read the key. Procedure, rotation and what to do when the file is lost: [SECRETS-AND-KEYS](../../devops/SECRETS-AND-KEYS.md). Revisit this decision if DCC begins to hold social network tokens or other long-lived credentials itself.
