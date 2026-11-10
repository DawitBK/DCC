# Rahel: the screens (UI/UX and frontend)

**Read [START HERE](README.md), then [01 setup](01-SETUP-YOUR-COMPUTER.md), [02 sending work](02-HOW-TO-SEND-YOUR-WORK.md) and [03 what you may touch](03-WHAT-YOU-MAY-TOUCH.md) first.** Then come back.

## Who you are in this project

You make everything people **see and click**. If the brain (backend) is a smart office, you build the front desk, the signs and the forms. People who are not technical must be able to use it without training.
You work **directly in the real app**. There is **no Figma and no separate design phase** (Dawit decided this). You sketch on paper if you like, then you build the real screen.

## Your room

- 🟢 **Yours:** `portal/frontend/` and `docs/design/`.
- 🟡 **Ask first:** `portal/backend/` (ask Hirko if you need new data), `portal/contracts/` (shared words; ask before changing).
- 🔴 **Never:** `portal/backend/src/platform/`, `scripts/`, `.github/`, config files. Full map: [03](03-WHAT-YOU-MAY-TOUCH.md).

## What exists today in `portal/frontend`

| File                          | What it is                                                                                  |
| ----------------------------- | ------------------------------------------------------------------------------------------- |
| `src/app/layout.tsx`          | the frame of every page                                                                     |
| `src/app/globals.css`         | the brand colours and sizes (navy, gold, teal, mint, cloud, alert red; text at least 16 px) |
| `src/app/page.tsx`            | the home page: shows "Sign in" or "Hello, name" and the person's roles                      |
| `src/app/sign-out-button.tsx` | the sign-out button                                                                         |
| `src/lib/api.ts`              | `getMe()`: asks the backend "who is signed in?" (only for the server side)                  |

It is a **skeleton, not a design**. Everything people will really use is for you to build.

## Words you must understand (2 minutes)

- **The browser never holds a password or token.** It only holds a "cookie" (a note) that the backend gave it. You cannot read it and you must never try. Do not use `localStorage` for anything about login.
- **The backend decides, you only show.** You hide a button when a person has no permission, to be kind. But the backend checks again for real. Hiding a button is **not** security.
- **Same address.** The browser asks the backend through the same website address: `/api/...`. Never type the backend's own address in your code.
- **Base path.** On the practice server the app lives at `/dcc` (like `/dms` and `/gms`). So browser code must never write a bare `/api/...`: use the helper you will create in R-03 (it adds the base path). See `src/app/page.tsx` for the example.

## Your first day (do these in order)

1. Finish setup ([01](01-SETUP-YOUR-COMPUTER.md)) until you see the sign-in page at `http://localhost:7717`.
2. Sign in as the **all-powerful role**: `npm run dev:session -- rahel@example.test group_admin` and put the cookie in the browser (Step 9 of 01). You should see "Hello, rahel".
3. Now try **other roles** to see what each person would see (each time: new command, new cookie):
   - `npm run dev:session -- creator@example.test content_creator demo-company-a`
   - `npm run dev:session -- reviewer@example.test content_reviewer demo-company-a`
   - `npm run dev:session -- publisher@example.test publisher demo-company-a`
   - `npm run dev:session -- auditor@example.test auditor`
4. Read `docs/requirements/PROPOSAL-REVIEW.md` (10 minutes). It lists confusing points in the proposal. Dawit has already decided some of them (see `docs/project/OPEN-DECISIONS.md`).
5. Ask Dawit for the proposal and team document (the two PDFs; **they never go in the project**). Section 8 is your design brief, 7.1 the modules, 7.3 the roles.

## What the system can already give your screens

These backend addresses exist today (the browser calls them as `/api/...`):

| Address                          | What it gives                                    | Who may use it             |
| -------------------------------- | ------------------------------------------------ | -------------------------- |
| `GET /api/me`                    | who is signed in, their roles, their permissions | everyone signed in         |
| `GET /api/companies`             | the companies the person may see                 | anyone with `company.read` |
| `GET /api/companies/{id}/brands` | brands of a company                              | anyone with `brand.read`   |
| `GET /api/social-accounts`       | the social accounts (read only)                  | anyone with `account.read` |
| `GET /api/audit`                 | the audit notebook entries                       | anyone with `audit.read`   |
| `GET /api/audit/verify`          | checks the notebook was not tampered with        | anyone with `audit.read`   |

You can see and try all of them in the backend's own documentation page: `http://localhost:7716/api/docs` (the backend must be running). Everything else (content, approvals, inbox...) is being built by Hirko and Woluman. Until it exists, use **temporary fake data** (see R-06).

## Your tasks, one at a time

Do them in order. Finish one (merged) before the next. Each task = its own branch and pull request ([02](02-HOW-TO-SEND-YOUR-WORK.md)).

### R-01: Look first, write one page (about 1 day)

**Why:** the Group already has systems (the SSO portal, the document system DMS, the GMS). DCC should feel like family, not a stranger.

**Steps**

1. Branch: `docs/rahel/ux-direction`.
2. Ask Dawit to show you (or give you a login to) the SSO portal, DMS and GMS on his practice setup. Look at them for 30 minutes. Notice how the menu is arranged, how tables look, how buttons and forms look, what words they use.
3. Create the file `docs/design/UX-DIRECTION.md`. Use these headings and write 2–5 lines under each, in plain words:
   - **What I noticed in the other Group systems** (menu, tables, buttons, words)
   - **What DCC will copy** (so it feels familiar)
   - **What DCC will do differently** (and why)
   - **The main menu I plan** (list of items, using the 12 modules below)
   - **Who the users are and what they do all day** (creator, reviewer, publisher, admin, executive, auditor)
   - **How the screen looks on a phone** (what moves where)
4. Do **not** put screenshots with real data in it. Use words or fake data.
5. Send it as a pull request. **Done when:** Dawit says "OK".

**The 12 modules** (from the proposal; they will be shown to management grouped into 7: Dawit will tell you the grouping): dashboard · company management · account registry · access governance · publishing workspace · approvals · unified inbox · security center · activity audit · incidents · analytics · AI (later release).

### R-03: Build the building blocks (about 1 week)

**Why:** every screen is made of the same small pieces: buttons, tables, forms. Build each piece once, well, and reuse it everywhere. This makes the app look consistent and also makes it usable for everyone.

**Steps**

1. Branch: `feature/rahel/components`.
2. First create the **API helper**. File `portal/frontend/src/lib/browser-api.ts`: a small function `apiFetch(path, options)` that:
   - puts the base path in front: `${process.env.NEXT_PUBLIC_DCC_BASE_PATH ?? ''}/api${path}`,
   - sends the cookie (`credentials: 'same-origin'`),
   - if the answer is **401** (not signed in) sends the person to the sign-in page,
   - returns the JSON, or throws a clear error with the message the backend gave.
     Every screen will use this and nothing else. (Look at `sign-out-button.tsx` to see the base path trick.)
3. Create the folder `portal/frontend/src/components/`. One file per piece. Start with this list: **Button** (primary, secondary, danger) · **TextField** · **Select** · **Checkbox** · **StatusChip** (colour + icon + word, never colour alone) · **Card** · **PageHeader** · **Table** (with empty and loading states) · **Dialog** (confirm) · **Toast** (success/error message) · **EmptyState** · **LoadingSpinner** · **ErrorMessage**.
4. Rules for **every** piece (this is the quality bar):
   - Works with the **keyboard only** (Tab to reach, Enter/Space to use, Esc to close a dialog). Try it without touching the mouse.
   - A **visible focus ring** when you Tab onto it.
   - Text at least **16 px**, good contrast (use the brand colours in `globals.css`; check with any online contrast checker, aim for 4.5:1).
   - **Never rely on colour alone.** A red chip also has an icon and a word: "Needs attention".
   - Works at **phone width** (browser DevTools F12, then the "device" icon).
   - **No wording written inside the component**: pass it in. We will translate to Amharic later.
5. Make a **gallery page** that shows every piece in every state (normal, hover, focus, disabled, error, loading, empty). Path: `src/app/dev/components/page.tsx`. At the top add: `if (process.env.NODE_ENV === 'production') notFound();` (import `notFound` from `next/navigation`) so it never shows in the real system.
6. Run the checks ([02](02-HOW-TO-SEND-YOUR-WORK.md) section C) and open the pull request with **screenshots of the gallery**, desktop and phone.

**Done when:** the gallery shows all pieces, they pass your keyboard, contrast and phone checks, and Dawit approved the pull request.

### R-04: The frame of the app (about 3–4 days)

**Why:** every screen sits inside the same frame: a top bar, a side menu, and the main area.

**Steps**

1. Branch: `feature/rahel/app-shell`.
2. Make a layout for signed-in pages with:
   - **Top bar:** the name "DCC", the **company switcher** (a drop-down listing the companies from `GET /api/companies`; a group-level person can also choose "All companies"), the person's name and **Sign out**.
   - **Side menu:** the 12 modules. Show only the ones the person may use. `GET /api/me` has a `permissions` list: that says what they may do. (Example: show "Activity audit" only if `audit.read` is in the list.) Items for things not built yet are shown **greyed with "Coming soon"**.
   - **Main area:** where the page goes.
3. The **home page changes by role**. A content creator sees "My drafts" (empty for now), a reviewer sees "Waiting for my review", a group admin sees an overview. For now each shows a clear empty state.
4. Remember the chosen company **in the address** (for example `/companies/<id>/...`) so a link always opens the same thing. Do not store it anywhere secret.
5. If someone is **signed in but has no role** yet, show the friendly message that already exists on the home page.
6. Test **each role** from "Your first day" step 3. One screenshot per role for the pull request.
7. Pull request.

**Done when:** every role sees the right menu, signing out works, the keyboard works, and the phone layout works.

### R-06: The real screens, one module at a time (the long job)

**Why:** this is the product.

**Build in this order; each screen is its own pull request:**

1. **Companies and brands** (endpoints exist). List, detail, "add brand" form (`POST /api/companies/{id}/brands`, only for people with `brand.manage`).
2. **Social account registry** (list exists; create/edit comes from Hirko's H-02): table with platform icon, name, status chip, owner, backup admin.
3. **Activity audit:** a table of events (`GET /api/audit`) with filters; a button "Check the notebook" that calls `GET /api/audit/verify` and shows ✅ or a warning.
4. **Access governance:** who has which role in which company (after Hirko's H-03).
5. **Publishing workspace and approvals** (after Hirko's H-04): drafts, submit, review, approve/reject, the history. **The writer of a post can never approve it**: the screen must make that clear.
6. **Unified inbox** (after Woluman's W-08).
7. **Dashboard, security center, incidents, analytics** (after Hirko's H-06). **AI:** a later release, do not build.

**For each screen (put this checklist in the pull request):**

- [ ] It uses only your components and `apiFetch`. No tokens, no `localStorage` for login.
- [ ] I tried it as **each role that should see it** and as one that should **not** (they get a clear "not allowed" message, not a broken page).
- [ ] Keyboard only works. Phone width works.
- [ ] There is an **empty state** (nothing yet), a **loading state** and an **error state**.
- [ ] Words are easy; no hard-coded wording scattered around (keep them together so they can be translated).
- [ ] Screenshots (desktop + phone) are in the pull request.
- [ ] No real names, no real companies, no real data (use "Demo Company A").

**If the data does not exist yet:** use a clearly named temporary file, for example `src/mocks/accounts.ts` with fake data, and a comment `// TEMPORARY: replace when the backend endpoint exists (H-02)`. When the real endpoint arrives, delete the mock. Write "sample data" on any screenshot that uses it.

**If you need a new endpoint or a changed answer:** do **not** edit the backend. Write to Hirko: "I need `GET /api/xxx` that returns these fields: ...", and open an issue with the "task" template.

### R-05: The browser safety rule (CSP), with Dawit (later)

When R-04 is done, Dawit sits with you for an hour to make the web app's "content security policy" strict (a rule that stops the browser from running anything we did not write). You do not do this alone. Do not add `<script>` tags from outside addresses, and do not use `dangerouslySetInnerHTML`, **ever**, without asking.

## Your week

| Day          | What                                                                                                      |
| ------------ | --------------------------------------------------------------------------------------------------------- |
| Every day    | `git switch develop`, `git pull`, work on your branch, commit small, push, and tell the team what you did |
| Twice a week | open a pull request for what is finished (small ones are better)                                          |
| Friday       | write 5 lines to Dawit: done, doing next, blocked by, questions, screenshots                              |

## Mistakes to avoid

- Building a screen for data that does not exist, then asking the backend to change to fit your screen. **Ask Hirko first**: they will tell you what is possible.
- Writing the base path or the backend address by hand.
- Using colour alone for meaning.
- Hiding a button and thinking "now it is secure".
- One giant pull request with 40 files. Small, please.
- Changing `portal/contracts` (shared words) without asking.
- Adding a new library (a "dependency") without asking Dawit.
- Copying text, images or code from the internet without telling us where from.

## Ask Dawit

The grouping of 12 modules into 7 · anything about login, cookies or the safety rule · anything that needs a new tool or library.
