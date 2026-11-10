# Set up your computer (about 45 minutes, once)

Do every step in order. After each step there is a **"You should see"** line. If you do not see it, stop and read [04-WHEN-YOU-ARE-STUCK](04-WHEN-YOU-ARE-STUCK.md).
These steps are for Windows. (If you use something else, tell Dawit.)

## Step 1: Install four programs

Install these, accepting the normal options (click Next).

| Program            | Where to get it                      | Check it worked: open **PowerShell** (press the Windows key, type `powershell`, Enter) and type | You should see              |
| ------------------ | ------------------------------------ | ----------------------------------------------------------------------------------------------- | --------------------------- |
| **Git**            | git-scm.com/download/win             | `git --version`                                                                                 | `git version 2.xx`          |
| **Node.js 22**     | nodejs.org (choose the **LTS 22.x**) | `node --version`                                                                                | `v22.something`             |
| **Docker Desktop** | docker.com/products/docker-desktop   | `docker --version`                                                                              | `Docker version 2x.x.x`     |
| **VS Code**        | code.visualstudio.com                | (open the program)                                                                              | a window with a code editor |

After installing Docker Desktop, **start it** (Start menu > Docker Desktop) and wait until it says it is running. It must be running whenever you work on DCC.
If you installed something while PowerShell was open, **close PowerShell and open it again**.

## Step 2: Join the GitHub project

1. You need a GitHub account (github.com). Tell Dawit your GitHub name if he does not have it.
2. Dawit sends you an **invitation** by email. Open it and press **Accept invitation**.
3. Open `https://github.com/DawitBK/DCC` in your browser. **You should see** the project page.

## Step 3: Tell Git who you are (once per computer)

In PowerShell, type these two lines (use your real name and the email of your GitHub account):

```
git config --global user.name "Your Name"
git config --global user.email "you@example.com"
```

**You should see:** nothing at all. That is correct.

## Step 4: Download the project (clone)

Pick a short folder without spaces, for example `C:\work`.

```
mkdir C:\work
cd C:\work
git clone https://github.com/DawitBK/DCC.git
cd DCC
git switch develop
```

**You should see:** `Switched to branch 'develop'` (or "Already on 'develop'").
The first time, Git may open a window to log in to GitHub. Log in there. Never type your GitHub password into anything else.

## Step 5: Open the project in VS Code (the right folder!)

```
code .
```

**You should see:** VS Code opens with folders on the left: `.github`, `docs`, `infra`, `operational-engine`, `portal`, `scripts`...
**Important:** open the folder called **DCC** itself, not a folder above it. If you see other projects next to it, you opened the wrong folder.
Open a terminal inside VS Code: menu **Terminal > New Terminal**. Use that terminal from now on. It is already inside the DCC folder.

## Step 6: Create your private settings file (`.env`)

```
Copy-Item .env.example .env
```

Now make your own secret key for your own computer. Run:

```
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

It prints a long line of letters. **Copy it.** Open the new `.env` file in VS Code, find the line `DCC_LOCAL_ENCRYPTION_KEY=` and paste the line after the `=`, like this:

```
DCC_LOCAL_ENCRYPTION_KEY=the-long-line-you-copied
```

Save the file (Ctrl+S).
**You should see** the `.env` file name in grey in VS Code. That is normal: it is hidden from Git on purpose. **Never send your `.env` to anyone and never put it on GitHub.** The other values in it are fine as they are.

## Step 7: Install and prepare everything (one command)

Make sure Docker Desktop is running, then:

```
npm run setup
```

This takes a few minutes. It downloads what the project needs, starts a practice database on your computer, and fills it with fake demo companies ("Demo Company A, B, C").
**You should see:** a lot of text, and near the end `migrations: 4 applied` and `seed: group "kerchanshe" with 3 demo companies ready`. If you see red `ERROR`, copy the whole message to Dawit.

## Step 8: Start the backend and the frontend

You need **two terminals**. In VS Code press the **+** button in the terminal to open a second one.

**Terminal 1 (the backend):**

```
npm run dev:backend
```

Wait until you see `Nest application successfully started`. Then open `http://localhost:7716/api/health/live` in your browser. **You should see:** `{"status":"ok"}`.

**Terminal 2 (the frontend):**

```
npm run dev:frontend
```

Wait until you see `Ready`. Then open `http://localhost:7717`. **You should see:** a page titled "Digital Communications Control Center" with a sign-in button.

To stop either one: click in its terminal and press **Ctrl+C**.

### If you see `EACCES` or "address already in use"

Windows sometimes blocks the door numbers. Open the file `.env`, change the two port numbers to something else, for example:

```
DCC_API_PORT=7916
DCC_WEB_PORT=7917
DCC_WEB_ORIGIN=http://localhost:7917
```

Also change `DCC_API_INTERNAL_URL=http://127.0.0.1:7916` to match. Save, stop both terminals (Ctrl+C), start them again. (Technical detail: [WINDOWS-PORTS](../devops/WINDOWS-PORTS.md).)

## Step 9: Sign in (without the company login)

The real sign-in needs the company SSO, which only runs on Dawit's computer for now. For your own practice on your own computer there is a helper that signs **you** in as any role you choose. It only works on your computer's practice database.

In a **third** terminal (or after stopping nothing: the backend can keep running):

```
npm run dev:session -- yourname@example.test group_admin
```

(`group_admin` = the all-powerful role. Others: `content_creator demo-company-a`, `content_reviewer demo-company-a`, `publisher demo-company-a`, `company_admin demo-company-a`, `auditor`, and more: see [the role list](../../portal/contracts/src/roles.ts).)

It prints a long line of letters. Then:

1. Open `http://localhost:7717` and press **F12** (developer tools opens).
2. Click the **Application** tab (Chrome/Edge) or **Storage** tab (Firefox). On the left open **Cookies** and click the site address.
3. Add a new cookie: **Name** `dcc_sid`, **Value** the long line, **Path** `/`.
4. Reload the page (F5). **You should see:** "Hello, yourname" and your role.

The note stays valid for 8 hours. If the page says sign in again, run the command again and replace the cookie value.

## Step 10: Check everything works (the tests)

```
npm test
```

This takes about a minute. **You should see:** three groups of `Tests ... passed` and no `FAIL`.
If tests fail on a fresh download, you did nothing wrong: tell Dawit with a copy of the message.

## You are ready

Go back to [START HERE](README.md) step 4. Your next reading: [02-HOW-TO-SEND-YOUR-WORK](02-HOW-TO-SEND-YOUR-WORK.md).

## Every morning (2 minutes)

1. Start Docker Desktop and wait for it to run.
2. In the terminal: `git switch develop` then `git pull` (gets everyone's new work).
3. Start your own branch or go back to the one you were on (see [02](02-HOW-TO-SEND-YOUR-WORK.md)).
4. `npm run dev:backend` and `npm run dev:frontend` if you need them.
5. If `git pull` brought new work: run `npm install` and `npm run build:packages` and `npm run db:migrate` once.
