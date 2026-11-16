# Run the whole system on your laptop and test it from start to end

This page takes you from `git pull` to a working DCC on your own laptop, with sample data, a posting engine, and a way to test the whole flow.

You do **not** need the company SSO. You sign in with a small helper that works only on your own computer.
You do **not** need Apache or the "mirror". Those are Dawit's.

Time: about 30 minutes the first time (the engine adds about 15 more). Every step says what you should see. If you do not see it, go to [04-WHEN-YOU-ARE-STUCK](04-WHEN-YOU-ARE-STUCK.md).

## What you will have at the end

| Part            | Address                 | What it is                                 |
| --------------- | ----------------------- | ------------------------------------------ |
| Web app         | `http://localhost:7717` | The screens                                |
| API (backend)   | `http://localhost:7716` | The rules, approvals and records           |
| Database        | port 5436 (Docker)      | Practice data only                         |
| Engine (Postiz) | `http://localhost:4007` | The part that posts. Optional. See Part 4. |

## Part 0: What you need first

Git, Node.js 22, Docker Desktop and VS Code, and access to the GitHub project. If not, do steps 1 to 3 of [01-SETUP-YOUR-COMPUTER](01-SETUP-YOUR-COMPUTER.md) first.

Docker Desktop must be **running** (whale icon, "running") before Part 1.

All commands below are for **PowerShell** in the **DCC folder** (in VS Code: Terminal, New Terminal).

## Part 1: Get the code and set it up

### First time on this laptop

```
mkdir C:\work
cd C:\work
git clone https://github.com/DawitBK/DCC.git
cd DCC
git switch develop
```

### Already have the project

```
cd C:\work\DCC
git switch develop
git pull
```

You should see `Already up to date.` or a list of changed files.

### Make your settings file

```
Copy-Item .env.example .env
```

Leave it as it is. It already works on your laptop. Never put a real password or key in any file you send to GitHub.

### Install everything

```
npm run setup
```

This takes a few minutes. It installs the packages, starts a practice database in Docker, and adds three fake companies.
You should see `migrations: ... applied` and `seed: group "kerchanshe" with 3 demo companies ready`.

If you pulled new work later, run this instead:

```
npm install
npm run build:packages
npm run db:migrate
```

## Part 2: Start the backend and the web app

You need **two terminals**. Click the **+** in the VS Code terminal for the second one.

**Terminal 1:**

```
npm run dev:backend
```

Wait for `Nest application successfully started`. Then open `http://localhost:7716/api/health/live`. You should see `{"status":"ok"}`.

**Terminal 2:**

```
npm run dev:frontend
```

Wait for `Ready`. Then open `http://localhost:7717`. You should see "Digital Communications Control Center" and a sign-in button.

Do **not** press the sign-in button. It goes to the company SSO, which you do not have. Use Part 3 instead.

To stop a terminal: click it and press **Ctrl+C**.

**If you see `EACCES` or "address already in use":** Windows has reserved the port. Open `.env` and change these to free numbers, for example:

```
DCC_API_PORT=7916
DCC_WEB_PORT=7917
DCC_WEB_ORIGIN=http://localhost:7917
DCC_API_INTERNAL_URL=http://127.0.0.1:7916
```

Save, stop both terminals, start them again, and use 7917 and 7916 from here on. More: [WINDOWS-PORTS](../devops/WINDOWS-PORTS.md).

## Part 3: Sign in without the SSO, and load sample data

### Sign in as any role

Open a **third** terminal and type:

```
npm run dev:session -- you@example.test group_admin
```

It prints a long line of letters and numbers. That is your sign-in ticket. Put it in the browser:

1. Open `http://localhost:7717` and press **F12**.
2. Chrome or Edge: tab **Application**, then **Cookies**, then click the site address. Firefox: tab **Storage**, then **Cookies**.
3. Add a cookie. **Name:** `dcc_sid`. **Value:** the long line (no spaces). **Path:** `/`.
4. Press **F5**.

You should see your name and the role. The ticket lasts 8 hours. When it runs out, run the command again and replace the cookie value.

`group_admin` is the all-powerful role. The 11 roles are:

| Level   | Roles                                                                                                                 |
| ------- | --------------------------------------------------------------------------------------------------------------------- |
| Group   | `group_admin`, `group_cto`, `security_admin`, `group_marketing`                                                       |
| Company | `company_admin`, `company_executive`, `company_marketing_manager`, `content_creator`, `content_reviewer`, `publisher` |
| Either  | `auditor`                                                                                                             |

A company role needs a company name at the end, for example:

```
npm run dev:session -- creator@example.test content_creator demo-company-a
```

### Load the sample data (recommended)

The empty system has little to look at. This adds three companies, people in every role, linked accounts, and posts in every state (draft, in review, approved, published, scheduled, rejected). It also adds a publishing freeze and some incidents.

The backend (Terminal 1) must be running. Then:

```
$env:I_UNDERSTAND_THIS_SEEDS_SAMPLE_DATA = "dcc_dev"
node scripts/run-with-env.mjs .env node scripts/demo/seed-sample-data.mjs
```

You should see `Sample data ready in "dcc_dev"` and a short list. It is safe to run twice.

The sample companies are `kerchanshe-coffee`, `kerchanshe-equipment` and `buna-pen-and-plate`. To sign in as a creator inside one of them:

```
npm run dev:session -- creator@example.test content_creator kerchanshe-coffee
```

## Part 4: Add the posting engine (Postiz)

Skip this part if you only work on screens or the backend. Without it, DCC uses a **fake engine**: everything works, and nothing leaves your laptop.
That is enough for most testing. Come back here when you need to test against real Postiz.

### Start it

```
cd operational-engine
Copy-Item postiz.env.example postiz.env
```

Open `operational-engine\postiz.env` and set these lines (the file is private and never goes to GitHub):

```
MAIN_URL=http://localhost:4007
FRONTEND_URL=http://localhost:4007
NEXT_PUBLIC_BACKEND_URL=http://localhost:4007/api
JWT_SECRET=any-long-text-you-make-up
POSTIZ_DB_PASSWORD=any-text
TEMPORAL_DB_PASSWORD=any-text
NOT_SECURED=true
DISABLE_REGISTRATION=false
```

(Remove the `#` in front of `NOT_SECURED=true` if there is one. The first three lines in the template point to a made-up address: that is why you change them.)

Then:

```
docker compose -f compose.postiz.yml --env-file postiz.env up -d
```

The first start downloads about 3 GB and takes several minutes. Wait 2 or 3 minutes after it finishes.

### Make the engine administrator and get the key

1. Open `http://localhost:4007`. Create **one** account with your own email and any password.
2. Open `operational-engine\postiz.env`, change `DISABLE_REGISTRATION=false` to `true`, then run the `docker compose ... up -d` line again. Registration is now closed.
3. In Postiz: **Settings**, then **Public API**. Copy the API key.
4. Open `.env` in the DCC folder (the main one, not the engine one) and set:

```
ENGINE_PROVIDER=postiz
POSTIZ_BASE_URL=http://localhost:4007/api/public/v1
POSTIZ_API_KEY=paste-the-key-here
DCC_ENGINE_ALLOW_UNVERIFIED=true
DCC_ENGINE_PRACTICE_CHANNELS=true
```

5. Stop the backend (Ctrl+C in Terminal 1) and start it again: `npm run dev:backend`.

`DCC_ENGINE_PRACTICE_CHANNELS=true` shows real channels and practice channels side by side. Practice channels have ids that start with `fake-`. Nothing sent to them leaves your laptop. Keep it on.

### Check DCC can talk to it

From the DCC folder:

```
$env:POSTIZ_BASE_URL = "http://localhost:4007/api/public/v1"
$env:POSTIZ_API_KEY = "paste-the-key-here"
npm run verify:live -w @dcc/engine-client
```

You should see the checks pass for reading channels and for the refusal cases.

### Stop it

```
cd operational-engine
docker compose -f compose.postiz.yml --env-file postiz.env down
```

(Add `-v` only if you want to delete the engine's data too.)

### Real social accounts

To connect a real test account you first need a developer app on that network. That is a separate job: [CONNECT-REAL-ACCOUNTS](../engine/CONNECT-REAL-ACCOUNTS.md). **Nothing has been posted to a real network yet.** Until someone proves it, do not say it works.

### Only for Woluman: running our own copy of Postiz

The steps above use the normal Postiz image. To run an image built from our fork, follow "Run an image built from the fork" in [operational-engine/CUSTOMIZATIONS.md](../../operational-engine/CUSTOMIZATIONS.md). The fork branch is `postiz-develop`.

## Part 5: Test it from start to end

The rule that matters most: **the person who wrote a post can never approve it.** So you need **at least three different people** (three tickets). Swap the cookie value in the browser each time, or use a different browser for each person.

Make the three tickets once (the sample data must be loaded):

```
npm run dev:session -- creator@example.test content_creator kerchanshe-coffee
npm run dev:session -- reviewer@example.test content_reviewer kerchanshe-coffee
npm run dev:session -- publisher@example.test publisher kerchanshe-coffee
```

Copy each long line into a text note (a plain note on your own laptop, not GitHub), named by role.

### The walk-through

| Step | Sign in as                  | Do this                                                                    | You should see                                                             |
| ---- | --------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1    | `group_admin`               | Open the dashboard, Companies, Social accounts, People                     | The three companies, their accounts and people                             |
| 2    | `content_creator`           | Composer: write a post for one account, add a picture, look at the preview | A preview for that network. The post is saved as a draft.                  |
| 3    | `content_creator`           | Submit the post for review                                                 | The state changes to "in review"                                           |
| 4    | `content_creator`           | Try to approve your own post                                               | **Refused.** This is correct.                                              |
| 5    | `content_reviewer`          | Approvals: open the post and approve it                                    | The state changes to "approved"                                            |
| 6    | `publisher`                 | Publishing: publish it now, or schedule it                                 | "Published" (or "scheduled" and it shows in the Calendar)                  |
| 7    | `publisher`                 | Schedule another post, then cancel it                                      | The state changes to cancelled                                             |
| 8    | `publisher`                 | Publishing: use "Check with the engine" on the published post              | The state agrees with the engine                                           |
| 9    | `group_admin`               | Freeze publishing for the company, then try to publish as the publisher    | **Refused** while frozen. Lift the freeze afterwards.                      |
| 10   | `group_admin`               | Audit: find your steps                                                     | Every step above is on record, with who did it                             |
| 11   | `company_marketing_manager` | Inbox: open a message and reply                                            | The reply is saved. With practice channels the messages are practice ones. |
| 12   | any company role            | Open a company you do not belong to (change the address, or try its data)  | **Nothing shown, or refused.** One company never sees another's data.      |

The names of the screens in the menu may differ a little. If a screen is missing or something looks wrong, that is useful: write down the step, what you did and what you saw.

Fuller role-by-role scripts: [UAT-SCRIPTS](../testing/UAT-SCRIPTS.md).

### Run the automatic tests

```
npm test
```

You should see three groups of `passed` and no `FAIL`. Takes about a minute.

Before you send any work to GitHub, run all of these and make sure none of them fails:

```
npm run lint
npm run typecheck
npm test
npm run build
npm run format:check
npm run secrets:scan
```

How to send your work: [02-HOW-TO-SEND-YOUR-WORK](02-HOW-TO-SEND-YOUR-WORK.md).

## Every morning (2 minutes)

1. Start Docker Desktop and wait until it runs.
2. `git switch develop`, then `git pull`.
3. If the pull brought new work: `npm install`, `npm run build:packages`, `npm run db:migrate`.
4. `npm run dev:backend` and `npm run dev:frontend`.
5. If your ticket ran out: `npm run dev:session -- ...` again, and replace the cookie value.
6. If you use the engine: `cd operational-engine`, then `docker compose -f compose.postiz.yml --env-file postiz.env up -d`.

## Things that go wrong

| What you see                                             | What it means                           | What to do                                                                   |
| -------------------------------------------------------- | --------------------------------------- | ---------------------------------------------------------------------------- |
| `Refused: this only works for a local development setup` | Your `.env` is not the development one  | Check `.env` was copied from `.env.example` and `NODE_ENV=development`       |
| `No group yet. Run: npm run db:seed`                     | The database is empty                   | `npm run db:seed`                                                            |
| `No company "..."`                                       | Wrong company name in the command       | Use `demo-company-a`, or a sample company name from Part 3                   |
| The page says "Sign in" even with the cookie             | Ticket expired, or a space in the value | Run `dev:session` again; paste with no spaces; Path must be `/`              |
| "You're signed in but don't have a DCC role yet"         | You used the real sign-in button        | Use `dev:session` instead                                                    |
| Port error (`EACCES`, "address already in use")          | Windows or another program holds it     | Change the ports in `.env` (Part 2)                                          |
| The database does not start                              | Docker Desktop is not running           | Start Docker Desktop, wait, then `npm run infra:up`                          |
| Engine page does not open at `localhost:4007`            | Postiz is still starting                | Wait 2 or 3 minutes, then check `docker ps`                                  |
| Posts to the engine fail after a restart                 | The key in `.env` is old or missing     | Copy the key again from Postiz Settings, Public API, and restart the backend |

If you are still stuck: [04-WHEN-YOU-ARE-STUCK](04-WHEN-YOU-ARE-STUCK.md). If it needs a decision, write the question in plain words and send it to Dawit.

## Rules to remember

- This is for **your laptop only**. `dev:session` refuses to run anywhere else.
- Never commit `.env` or `postiz.env`. Never send a key or password to anyone.
- Do not touch the SSO, Apache, the mirror or any live server.
- Work on a branch, never on `develop` or `main`, and never merge your own pull request.
