# operational-engine: the customised Postiz (read the root `CLAUDE.md` first; it is binding)

- **Woluman's** area. Postiz is customised in our fork `DawitBK/postiz-app` (clone it into `operational-engine/postiz-app/`, which git ignores). **No Postiz source code is ever committed to the DCC repo.**
- This folder holds only notes, the pinned version (`VERSION`), environment templates and deployment instructions. Never put real keys, tokens or passwords here.
- Postiz runs on WSL2 Ubuntu with Docker, away from the DCC processes. DCC is the authority on approvals: the Postiz API key lives only on the DCC server, no end users get Postiz accounts, registration is off.
- Do not add infrastructure beyond what Postiz itself needs. Deployments are manual and approved by Dawit.
