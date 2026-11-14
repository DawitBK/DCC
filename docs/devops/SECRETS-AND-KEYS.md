# Secrets and keys

Owner: Dawit. Decisions: D-05, [ADR-0007](../architecture/decisions/ADR-0007-secrets-provider.md). Code:
`portal/backend/src/platform/crypto/secrets.ts`, `portal/backend/src/config/env.ts`. Tests: `src/platform/crypto/secrets.test.ts`.

## The rule

The repository is public. **A real secret never goes into git**, not even for a minute: once pushed it is in the history for
ever. The development values in `.env.example` are the only values committed, and the API refuses them outside development.

## What secrets DCC has, and where each lives

| Secret                              | Development                              | Mirror (this PC)                            | Test and production                                                       |
| ----------------------------------- | ---------------------------------------- | ------------------------------------------- | ------------------------------------------------------------------------- |
| Database passwords (owner, runtime) | `.env.example` values                    | `.env.mirror` (git-ignored)                 | the server environment file, outside the repository                       |
| SSO client secret                   | `.env.example` value                     | `.env.mirror`                               | the server environment file; issued by the SSO console                    |
| Encryption key                      | built-in practice key (protects nothing) | `DCC_LOCAL_ENCRYPTION_KEY` in `.env.mirror` | **the key file** (below), outside the repository and the environment file |
| Metrics token                       | none (metrics off)                       | optional                                    | the server environment file                                               |
| Audit checkpoint sealing key        | none                                     | optional                                    | kept by whoever keeps the checkpoint copy, not on the DCC server          |
| Postiz API key                      | none (fake engine)                       | none                                        | the server environment file, only on the DCC server                       |

DCC holds **no** passwords of people (the SSO does) and **no** social network tokens (Postiz does).

## The key file (production)

What the key protects today: the SSO identity token kept with each session (needed only to sign the person out of the SSO).

The production provider reads a small file, a "key ring":

```json
{
  "active": "k20261114",
  "keys": { "k20261114": "<32 random bytes, base64>" }
}
```

### Create it (once per server)

```bash
npm run secrets:keygen -- "<config folder>\dcc\dcc.keys.json"     # prints the key id, never the key
```

1. Put the file **outside** the repository checkout, next to the other systems' server settings.
2. Restrict it to the account DCC runs as:
   - Windows: `icacls "<config folder>\dcc\dcc.keys.json" /inheritance:r /grant:r "<service account>:R" "Administrators:F"`
   - Linux: `chmod 600` (the API refuses to start if other accounts can read it).
3. In the server environment file: `SECRETS_PROVIDER=key-file` and `DCC_KEY_FILE=<the absolute path>`.
4. Start the backend. A wrong path, a broken file or a short key stops it with a message that names the problem and never the key.
5. Keep a copy where the owner keeps secrets. **The key file is in no database backup on purpose**: a leaked dump alone opens nothing.

### Rotate it (yearly, and at once after any suspicion)

```bash
npm run secrets:keygen -- "<config folder>\dcc\dcc.keys.json"     # adds a new key and makes it the active one
```

Restart the backend. New data uses the new key; data made earlier names the key it was made with and still opens. Remove an old
key from the file only when nothing made with it is left: stored identity tokens die with their sessions, at most
`SESSION_TTL_MINUTES` (8 hours) later. After a suspected leak do not wait: remove the old key and run `delete from sessions`
(everyone signs in again).

### If the key file is lost

Nothing permanent is lost. Sessions made with it can no longer sign the person out of the SSO in one click, and that is all:
create a new file, restart, and people sign in again.

## What a key file does and does not protect

- **Does:** the key is not in the environment, not in the database and not in their backups. A stolen dump or a stolen
  environment file alone decrypts nothing.
- **Does not:** someone who can read files as the DCC service account can read the key. That is the accepted limit of a key file
  (decision D-05). A key service (Azure Key Vault, HashiCorp Vault) removes that limit and plugs in behind the same
  `SecretsProvider` interface without touching any caller; move to one if DCC starts holding more valuable secrets.

## Rotating the other secrets

| Secret            | How                                                                                                                                                               |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SSO client secret | new secret in the SSO console, then the server environment file, then restart the backend ([registration](../identity-and-sso/PRODUCTION-CLIENT-REGISTRATION.md)) |
| Database password | `alter role dcc_app password '...'` as a superuser, then the environment file, then restart                                                                       |
| Metrics token     | environment file and the Prometheus scrape configuration together, then restart                                                                                   |
| Postiz API key    | new key in Postiz, then the environment file, then restart; revoke the old key in Postiz                                                                          |

## What the API refuses at start (the safety net)

Outside development: a placeholder or short SSO client secret, a placeholder database password, a development administrator
list. In production also: any address that is not HTTPS or points at this computer, `SECRETS_PROVIDER=local-dev`, a `key-file`
provider without an absolute `DCC_KEY_FILE`, two-factor sign-in switched off, re-authentication switched off.
