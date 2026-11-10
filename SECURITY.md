# Security policy

DCC controls the Group's official social media accounts, so a security flaw here can become a public
incident. Please treat it that way.

## Reporting a vulnerability

**Do not open a public issue.** Tell Dawit (project lead) directly, or use GitHub's private
"Report a vulnerability" button on this repository (Security tab). Include what you found, how to
reproduce it, and what you think the impact is. You will get an acknowledgement; the fix is reviewed
by Dawit before release.

## This repository is public: what must never be committed

- Passwords, API keys, OAuth client secrets, signing or encryption keys, tokens, `.env` files.
- Social media account credentials of any kind. Account connection is done through the official
  OAuth flow in Postiz, never by sharing passwords (the inventory template has no password column on purpose).
- Real personal data: employee names, emails, phone numbers, ID numbers.
- Real company inventories (accounts, owners, administrators): they live outside this repository (decision D-02).
- The confidential proposal and team-allocation PDFs.
- Real production hostnames, IP addresses, or server details.

If something sensitive is committed by mistake: tell Dawit immediately. Removing it from the latest commit is
**not enough**: it stays in history, so anything real must be treated as leaked and rotated.

## What the project already enforces

Authentication only through the existing Kerchanshe SSO; server-side sessions; deny-by-default API;
company isolation enforced in the database (row-level security) and tested by attack; audit trail with
tamper detection; secret scanning and dependency audit in CI. See [security standards](docs/security/SECURITY-STANDARDS.md).
