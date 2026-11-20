# Security posture (H-10)

## Endpoint

`GET /api/security/posture`

Permission: `security.read`.

The response reports only signals held by DCC: audit-chain status, recent administrator grants, account registry gaps, publishing freezes, and open incidents. It also includes `notMonitored`, which explicitly lists signals DCC cannot currently verify.

The response is scoped to companies the caller may see. It does not expose account tokens, passwords, or network-side security state.
