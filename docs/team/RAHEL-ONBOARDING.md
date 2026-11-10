# Rahel: UI/UX design and frontend

Your area: `apps/web/` and `docs/design/`. You design and build the whole user interface; the platform foundation gives you a working shell to build on.
Not yours: `apps/api/` (ask Hirko for API needs), `packages/contracts/` (propose changes by issue).

## Read first (in this order)

1. [README](../../README.md) and [OWNERSHIP](OWNERSHIP.md), then [GIT-WORKFLOW](GIT-WORKFLOW.md).
2. The DCC proposal and team document (from Dawit): section 8 is the design brief, 7.1/7.3 the modules and roles.
3. [ARCHITECTURE](../architecture/ARCHITECTURE.md) (5 minutes) and [identity/INTEGRATION](../identity-and-sso/INTEGRATION.md): you never handle tokens; the browser only has a session cookie.

## Set up

```bash
git clone https://github.com/DawitBK/DCC.git && cd DCC && cp .env.example .env
npm run setup && npm run dev:api && npm run dev:web      # http://localhost:7717
```

Signing in needs the dev SSO ([DEV-CLIENT-REGISTRATION](../identity-and-sso/DEV-CLIENT-REGISTRATION.md)); ask Dawit to set up or share a dev SSO session. Until
then you can work on screens with static data. Windows `EACCES` on a port: [WINDOWS-PORTS](../devops/WINDOWS-PORTS.md).

## What exists in `apps/web`

Next.js 16 (App Router) + Tailwind 4. A layout, the brand **design tokens** (`globals.css`, from proposal 8.3: navy, gold, teal, mint, cloud, alert red; 16 px minimum body text),
a home page that shows sign-in or the signed-in person's roles (`getMe()` in `src/lib/api.ts`), and a sign-out button. All browser calls go to the same origin under `/api/*` (proxied to the API).
**It is a scaffold, not a design.**

## Rules for the frontend

- Never put tokens in localStorage or the page. The session is an HttpOnly cookie you cannot (and should not) read.
- Role-based **visibility** uses `permissions` and `memberships` from `GET /api/me`. That is for showing or hiding only; the API re-checks everything.
- Types and role/permission names come from `@dcc/contracts`. Never retype them.
- Accessibility target is WCAG 2.2 AA: keyboard, focus, contrast, no colour-only status (proposal 8.4). Screens must work at phone width.
- Text is externalised for English now and Amharic later: do not hard-code strings in components you will have to find again.

## Your first tasks (details and acceptance criteria in [BACKLOG](../project/BACKLOG.md))

| ID   | Task                                                                                                                    | Depends on                         |
| ---- | ----------------------------------------------------------------------------------------------------------------------- | ---------------------------------- |
| R-01 | Study the Group's existing UIs (Office Suite, SSO portal) and the sample dashboard; write `docs/design/UX-DIRECTION.md` | none                               |
| R-02 | Interactive HTML prototype covering every area of the proposal's screen list, with real navigation and workflows        | R-01, Abenezer's workflow findings |
| R-03 | Design system: tokens, type scale, components (forms, tables, calendar, status chips, dialogs), accessibility notes     | R-01                               |
| R-04 | After the prototype is approved: app shell (navigation, company switcher, role-based home) on real `/api/me`            | R-02, H-03                         |
| R-05 | Web Content-Security-Policy (nonce based) reviewed with Dawit                                                           | R-04                               |

Ask questions in an issue (template _Decision needed_) or message Dawit. Do not wait silently on a blocker.
