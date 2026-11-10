# Woluman: the hands (our customised Postiz and the social networks)

**Read [START HERE](README.md), then [01 setup](01-SETUP-YOUR-COMPUTER.md), [02 sending work](02-HOW-TO-SEND-YOUR-WORK.md) and [03 what you may touch](03-WHAT-YOU-MAY-TOUCH.md) first.** Then come back.

## Who you are in this project

You build the part that **really posts** to Facebook, Instagram, LinkedIn, YouTube, TikTok and X, and later reads their comments and messages. We do not write this from nothing: we use an open-source program called **Postiz**. We made **our own copy** of it (a "fork") so we can **change it to fit DCC**, for example adding the **unified inbox** that Postiz does not have.

Think of it like this: the brain (Hirko's backend) says "this post is approved, send it". Your engine sends it. **The engine never decides anything about approvals.** It only does what it is told by the brain, and only the brain may tell it.

## Your room

- 🟢 **Yours:** `operational-engine/` (notes, pinned version, deployment files), `docs/engine/`, `docs/integrations/`, and the **separate fork repository** `DawitBK/postiz-app`.
- 🟢/🟡 **`portal/engine-client/`:** yours, **except** `src/governed.ts` and `src/engine.ts` (the approval door and the interface). Those need Dawit's review for **every** change.
- 🔴 **Never:** `portal/backend/src/platform/`, `scripts/`, `.github/`, config files. Full map: [03](03-WHAT-YOU-MAY-TOUCH.md).
- **Postiz's own source code never goes inside the DCC repository.** It lives in the fork. In your DCC folder it sits in `operational-engine/postiz-app/`, which Git ignores on purpose.

## The picture

```
 DCC backend (Hirko)                                  Our Postiz fork (you)
 ┌──────────────────────────┐   approved request     ┌──────────────────────────┐
 │ GovernedEngine (the door)│ ─────────────────────▶ │ Postiz public API        │──▶ the networks
 │ checks: frozen? approved?│    via portal/          │ + our additions (inbox)  │
 │ sent before?             │    engine-client        └──────────────────────────┘
 └──────────────────────────┘     (the adapter)
```

- **`portal/engine-client`** = the little translator on the DCC side. It already has: the interface, the approval door, a fake engine (for tests) and a Postiz adapter.
- **The adapter has never run against a real Postiz.** Proving it is your first big job (W-03). Until then we say "unverified".

## The rules for the engine (very important for safety)

1. **Only DCC may tell Postiz to publish.** The Postiz API key lives **only on the DCC server**. People never get Postiz accounts. Registration is **off**. Postiz is not reachable from user computers.
2. If someone posts directly inside Postiz (or on a network), DCC must **notice** (a "reconciliation" job that compares Postiz's posts with DCC's approved ones). You design it (W-05).
3. **Never copy a password or token into a file, a document, a chat or a pull request.** Account connection is done through each network's official "log in with..." screen inside Postiz.
4. **Never retry a publish blindly** if the result is unknown (timeout): it might have posted. Postiz has no "same request twice" protection, so DCC has its own.
5. Keep changes to Postiz **small and in their own files**. Every change we make has to be carried forward when Postiz releases a new version. The fewer lines we touch, the easier this is.
6. Do not add servers or tools (queues, extra databases) beyond what Postiz itself needs. Dawit decides.

## Your first day

1. Finish setup ([01](01-SETUP-YOUR-COMPUTER.md)). `npm test` must pass (it includes the engine tests).
2. Read, in this order: `docs/engine/POSTIZ-INTEGRATION.md` (what Postiz offers; **the list of open questions at the bottom is your homework**), `operational-engine/README.md`, `docs/architecture/decisions/ADR-0006-postiz-separate-service.md`.
3. Read the code: `portal/engine-client/src/engine.ts` (the interface), `governed.ts` (the approval door), `postiz.ts` (the adapter), and the tests next to them.
4. Ask Dawit for the proposal and team document (the PDFs; **they never go in the project**). Your section is the operational engine and the social network integrations.
5. **Start W-04 today** (developer app registrations). It takes the longest because the networks take weeks to approve.

## Setting up the engine computer (WSL2 and Docker)

Postiz needs several programs running together (it uses Docker boxes). We run it on **WSL2 Ubuntu with Docker**, separate from the DCC processes.

1. In PowerShell as administrator: `wsl --install -d Ubuntu`, restart if asked, then open "Ubuntu" from the Start menu and create your Linux user.
2. Make sure Docker works inside Ubuntu: either Docker Desktop with "WSL integration" turned on for Ubuntu, or Docker installed in Ubuntu. Check: `docker --version` inside Ubuntu.
3. Inside Ubuntu, **keep the Postiz files on the Linux disk** (for example `~/postiz`), **not** under `/mnt/c/...` (it is very slow and breaks file permissions).
4. Get the fork:

   ```
   cd ~
   git clone https://github.com/DawitBK/postiz-app.git postiz
   cd postiz
   git remote add upstream https://github.com/gitroomhq/postiz-app.git
   git fetch upstream --tags
   ```

   Ask Dawit to give you **write access** to the fork first.

5. The version we use is written in `operational-engine/VERSION` (now `v2.25.3`). Make your working branch from that exact version:

   ```
   git switch -c dcc/main v2.25.3
   git push -u origin dcc/main
   ```

   Then for each piece of work: `git switch -c feat/woluman/<topic>` from `dcc/main`, and open pull requests **inside the fork** into `dcc/main`. **Never push to `upstream`.**

6. Postiz's own start-up (its compose file, its settings file) is described in `operational-engine/README.md`. Use your **own test values**. Never commit real keys.
7. Write down the **exact working steps and the problems you hit** as you go, in `docs/engine/POSTIZ-ASSESSMENT.md` (see W-01). Another person must be able to repeat it.
8. Windows quirks: WSL stops when its virtual machine stops; and Windows reserves some port numbers (`docs/devops/WINDOWS-PORTS.md`). Use ports outside the reserved ranges.

## Your tasks, one at a time

Branch names for the DCC repo: `docs/woluman/<topic>` for documents, `feature/woluman/<topic>` for code ([02](02-HOW-TO-SEND-YOUR-WORK.md)).

### W-04: Developer app registrations (start NOW, it takes weeks)

**Why:** to post to a network, you need that network's approval. Some take days, some take weeks, some cost money. This blocks everything else if started late.

**Steps (one document per network, six in total)**

1. For each of **Meta (Facebook and Instagram), LinkedIn, YouTube (Google), TikTok, X**: find the official developer portal, create a developer app for **DCC (Kerchanshe Group)**, and list what they ask for (business verification, privacy policy page, demo video, app review, permissions).
2. For each network create `docs/integrations/<network>.md` with these headings:
   - **What this network lets us do** (post text, images, video, read comments, read messages, analytics)
   - **What we must ask permission for** (the exact permission names)
   - **What they require from us** (documents, a public privacy page, a review video, a company verification)
   - **Cost and limits** (free or paid, how many posts per day)
   - **How long approval took / is expected to take**
   - **Status** (not started / submitted on DATE / approved / refused and why)
3. Never write passwords, secret keys or tokens in these files. "The key is stored on the server" is enough.
4. Tell Dawit **at once** about anything that needs the company: business documents, a company bank card, a public web page. He arranges it.

**Done when:** all six documents exist and the applications are submitted. Keep them current.

### W-01: Run Postiz and write the assessment (about 1 week)

**Why:** before we customise something, we must understand it.

**Steps**

1. Branch `docs/woluman/postiz-assessment`.
2. Set up the engine computer (above) and start Postiz at the pinned version with a test account.
3. Create `docs/engine/POSTIZ-ASSESSMENT.md`. Write the **answers** to each question at the bottom of `docs/engine/POSTIZ-INTEGRATION.md` ("Open questions for Woluman's evaluation", nine of them). For every answer write: what you tried, what you saw, and one of **works / does not work / not tested yet**. Do not write what you assume.
4. Add: how much memory and disk it really used (needed to size the machine), how long it takes to start, and the exact steps to start and stop it.
5. Pull request. **Done when:** Dawit can read it and know exactly what Postiz can and cannot do for us.

### W-03: Prove the adapter against the real Postiz (about 3 days)

**Why:** today the adapter is only tested against pretend answers. Until it works against the real thing, we must not say it works.

**Steps**

1. Branch `feature/woluman/postiz-live-check`.
2. In Postiz create an **API key** (in its settings) and connect **one test social account** (a test page you own, never a company page).
3. Put the key in **your own `.env` only**: `ENGINE_PROVIDER=postiz`, `POSTIZ_BASE_URL=...`, `POSTIZ_API_KEY=...`. **Never commit it.**
4. Write a **live check** for the adapter: list channels, publish a short test post (as a draft or scheduled far ahead first), list posts, delete the post. Put it in a test file that **only runs when `POSTIZ_BASE_URL` is set** (so the normal `npm test` and the robot on GitHub still pass without Postiz).
5. Record what really happened in `docs/engine/POSTIZ-ASSESSMENT.md`. If the adapter needs fixing, fix it in `portal/engine-client/src/postiz.ts` and its tests.
6. Only when the live check passes, change the adapter's `capabilities()` verification from `'unverified'` to `'verified'`, in the same pull request, with Dawit reviewing.

**Done when:** the four operations work against the live Postiz and the results are written down.

### W-05: Design the "someone posted behind our back" detection (about 3 days)

**Why:** DCC's approvals mean nothing if someone can post directly in Postiz.

**Steps**

1. Branch `docs/woluman/bypass-prevention`.
2. Write `docs/engine/BYPASS-PREVENTION.md`: (a) how we prevent it (no end-user accounts, registration off, key only on the DCC server, network rules so only the DCC server reaches Postiz); (b) how we **detect** it: a regular job that lists Postiz's posts and compares with DCC's approved publications, and raises an incident for any post DCC did not authorise (Hirko builds the incident part).
3. Dawit reviews the design before anyone builds it.

### W-08: The unified inbox, built into our Postiz fork (the big one)

**Why:** the proposal promises one place for all comments and messages. Postiz does not have it. **We add it** (decision D-12).

**Steps**

1. **Study first (about 1 week).** Read how Postiz is built (its code in your fork) and how it connects to each network. For each network write down (in `docs/integrations/<network>.md`): can we read **comments**? **direct messages**? can we **reply**? What permission does it need? Does the network require a special review? **This is the real risk**: some networks only allow it for approved apps. Report to Dawit before writing any code.
2. **Agree the shape with Dawit and Hirko.** Our DCC side already has a prepared interface, `InboxEngine` in `portal/engine-client/src/engine.ts`: `listInbox(range, channel?)` and `replyToMessage(id, text)`, with a fake version that Hirko and Rahel use meanwhile. Your Postiz additions should offer the same three things under Postiz's API: list messages, read one, reply.
3. **Build it in the fork** on a branch `feat/woluman/inbox`, in **new files** wherever possible, with tests, one network at a time. Start with the easiest one.
4. **Connect it:** add an `inbox` implementation to the DCC adapter (`portal/engine-client/src/postiz.ts`) and set `capabilities().inbox` only when it truly works.
5. **Assignment and response times are DCC's job** (Hirko), not Postiz's.
6. Pull requests: the fork's changes in the fork, the adapter changes in the DCC repo.

**Done when:** a test comment on a test page shows up in the DCC adapter's `listInbox`, and a reply posts back, with the result written down.

### W-09: Provision Postiz for real use (after W-01)

Install it the way W-01 documented, on WSL2 Ubuntu with Docker, set to **start by itself after a reboot**, reachable **only** from the DCC server, registration **off**, backed up (including its volumes). Write `operational-engine/UPGRADES.md` describing how to upgrade (take a backup, rebase the fork on the new upstream version, run the live check, then change `VERSION`). Deployments to a real server are **manual and approved by Dawit**.

### W-06 and W-07 (later)

- **W-06** analytics and media upload in the adapter, with tests.
- **W-07** can Postiz's own admin screen use our SSO login? And how big must the machine be? A short written recommendation.

## Your week

| Day                        | What                                                                                      |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| Every day                  | work on your branch, commit small, push, tell the team what you did and found             |
| Whenever a network answers | update its `docs/integrations/<network>.md` and tell Dawit                                |
| Friday                     | 5 lines to Dawit: done, next, blocked by (especially network approvals), questions, risks |

## Mistakes to avoid

- Saying "it works" about the adapter before the live check passed.
- Putting any key, token, password or real account details in a file, a chat or a pull request.
- Copying Postiz code into the DCC repository.
- Making big changes all over Postiz instead of small ones in new files.
- Editing `governed.ts` or `engine.ts` without Dawit.
- Using a company's real page for tests.
- Waiting to start W-04.
- Adding infrastructure that Postiz does not need.

## Ask Dawit

Anything that needs company documents or money · write access to the fork · anything about the approval door · any change to the interface · anything about servers.
