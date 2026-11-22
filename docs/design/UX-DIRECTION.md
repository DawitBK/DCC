# DCC UX Direction

## Agreed existing behavior

DCC uses the existing Kerchanshe SSO, the real Next.js app, the established navy/gold/teal brand tokens, and the shared workspace shell. The backend decides access from `GET /api/me`; hiding a control in the frontend is a usability aid, not a security boundary. The 11 roles already live in `portal/contracts/src/roles.ts`, and permission checks live in `portal/contracts/src/permissions.ts`.

- Use calm, clear, human language and one primary action per screen.
- Keep the side navigation, top-bar company context, role/name controls, status chips, tables, dialogs, forms and notifications consistent.
- Show only navigation and actions supported by the person's permissions. Backend re-checking remains authoritative.
- Keep risky actions clear: show the approval path while composing and confirm publishing freezes, role changes and other sensitive actions.
- Keep English text in shared label/access files so Amharic may be added later.
- Never use sample data after sign-in; sample data remains development-only behind the role preview.

## Role-based goals and priorities

- **Content operations:** content creator and company marketing manager: draft, edit, submit and track content. Primary screen: Create content.
- **Content control:** content reviewer, Group marketing and company executive: comment, approve or reject the submitted version. Primary screen: Approvals.
- **Publishing operations:** publisher, company marketing manager and company executive: publish or schedule approved content, cancel schedules and review outcomes. Primary screens: Publishing and Content calendar.
- **Company administration:** company administrator: manage one company's brands, accounts, people, approval rules and freezes. Primary screens: Companies & brands, Social accounts, Access governance and Approval rules.
- **Group administration:** Group administrator: manage Group companies and brands, access and governance. Primary screens: Companies & brands, Access governance and Approval rules.
- **Security and accountability:** Group CTO, security administrator and auditor: inspect audit, security, incidents and account gaps. Primary screens: Security center and Activity audit.
- **Incident operations:** Group CTO and security administrator manage incidents; company executive manages incidents for its company. Primary screen: Incidents.

People with several roles choose one acting role or all roles together. The role chooser and top-bar switcher already provide this behavior.

## Dashboard and quick actions

The existing dashboard is one permission-filtered home screen for all roles. Keep it that way unless Dawit confirms a separate role dashboard.

Recommended priorities:

- **Content:** drafts/rejected posts, waiting approval and recently approved content; action: Create content or continue a post.
- **Approvals:** pending and oldest submissions, approval count and superseded requests; actions: comment, approve or reject.
- **Publishing:** approved and ready, scheduled, failed, freezes and account readiness; actions: publish, schedule or cancel.
- **Company administration:** account gaps, unlinked engines, open incidents and role changes; actions: register/manage account, give/remove role.
- **Security:** broken audit chain, MFA state, freezes, open incidents and recent administrator grants; actions: verify/export audit and open incidents.

For existing dashboard totals, make the scope explicit. The current implementation notes that five top numbers cover every visible company while some tables use the chosen company; labels and grouping should prevent users from assuming every section is filtered the same way. Do not add scope filtering or new API data without a contract change from the owning backend team.

## Workflow clarity

- **Create:** show company, category, brand, target accounts, text and media together. Keep the network preview beside or near the form and show the approval required for the post.
- **Approve:** identify the submitted version, targets, submitted by, required approval count and any policy restrictions. Clearly mark older/superseded requests and keep writer self-decision unavailable.
- **Publish:** show approval state, selected account, freeze state and account/engine readiness before the final publish or schedule action. Scheduled and published outcomes belong together with clear cancel/reconcile actions.
- **Feedback:** use text plus status/tone, not colour alone. Preserve loading, empty and error states and the request ID for backend refusals.

Existing implementation and evidence: `portal/frontend/src/app/screens/composer-screen.tsx`, `approvals-screen.tsx`, `publishing-screen.tsx`, `calendar-screen.tsx`, `portal/backend/src/modules/content/approvals.service.ts`.

## Company context and permissions

The top bar keeps the selected company in `?companyId=`. Group-level users may choose All companies or a listed company; company users should remain in their company. Navigation and screen controls are permission-aware, but data separation is finally enforced by the backend.

Make denied/empty states explain the reason: no role, no permission, no company in scope, or no records yet. Do not imply that a missing button means the user can continue through another screen. Reauthentication for sensitive actions should preserve the current page and ask the person to repeat the attempted action after fresh SSO sign-in.

Existing implementation: `portal/frontend/src/app/dcc-workspace.tsx`, `components/workspace-shell.tsx`, `lib/access.ts`, `lib/browser-api.ts`.

## Responsive, accessibility and consistency

- Keep the app phone-friendly: the navigation becomes a mobile menu, tables must remain readable or scroll intentionally, and approval actions must remain reachable.
- Keep keyboard focus visible, support Tab/Enter/Space/Escape, and use semantic labels and dialogs.
- Use at least 16 px text where the existing component system supports it, 4.5:1 text contrast, and non-colour status indicators.
- Reuse existing components and the existing API helper; do not scatter API addresses or login wording through screens.
- Use confirmation dialogs for risky actions and plain, request-specific empty/loading/error states.
- Keep the role preview explicitly development-only and use fictional names/data.

## Recommendations requiring Dawit or team confirmation

- Dawit should confirm whether the one permission-filtered dashboard remains the final pattern or whether role-specific dashboard layouts are required.
- Dawit should confirm dashboard scope wording and whether All companies should keep aggregate cards independent of the company switcher.
- Dawit should confirm the final sensitive-action reauthentication return behavior and the H-13 acceptance criteria; no H-13 reference is currently found in the repository.
- Abenezer and Dawit should confirm the signed approval matrix. Repository assumptions remain open about creator/reviewer publishing, marketing-manager creation and inbox read/reply roles.
- Dawit should approve CSP and any authentication or routing changes; the R-05 CSP and full browser pass remain incomplete.
