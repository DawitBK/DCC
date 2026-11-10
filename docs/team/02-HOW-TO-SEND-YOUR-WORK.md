# How to save and send your work (Git, step by step)

**The picture to keep in your head:**

```
GitHub (shared)         develop  ← everyone's finished work lives here (you never edit it directly)
                           │
                           │  1. you make your OWN branch from it
                           ▼
Your computer           feature/yourname/what-you-do   ← you work and save here
                           │
                           │  2. you send it to GitHub and open a "pull request"
                           ▼
                     someone checks it, the robot (CI) checks it
                           │
                           │  3. after OK, a person merges it into develop
                           ▼
                        develop (now includes your work)
```

Think of `develop` as the master notebook. You photocopy a page (your branch), write on the copy, and hand it in. A checker approves it and **puts it into the master notebook**. You never write in the master notebook yourself.

## A. Starting a new piece of work

Do this at the start of **every** new task.

1. Open the terminal in VS Code (inside the DCC folder).
2. Go to the master copy and get the newest version:

   ```
   git switch develop
   git pull
   ```

   **You should see:** `Already up to date.` or a list of new files.

3. Make your own branch. The name has three parts: **kind / your name / what it is**. Small letters, dashes, no spaces.

   ```
   git switch -c feature/rahel/company-list-screen
   ```

   **You should see:** `Switched to a new branch 'feature/rahel/company-list-screen'`.

   | Kind       | Use it for             | Example                            |
   | ---------- | ---------------------- | ---------------------------------- |
   | `feature/` | something new          | `feature/hirko/social-account-api` |
   | `fix/`     | repairing a mistake    | `fix/rahel/button-focus`           |
   | `docs/`    | only writing documents | `docs/abenezer/account-inventory`  |
   | `test/`    | only adding tests      | `test/hirko/approval-attack-tests` |

4. Check which branch you are on **any time**:

   ```
   git branch --show-current
   ```

   If it says `develop` or `main`: **stop. Do not change any file.** Make your branch first (step 3).

## B. While you work: save often

Every time you finish a small piece (a screen part, a document section, one function), save a snapshot (**commit**):

1. See what you changed:

   ```
   git status
   ```

   Red names = changed files that are not saved yet. **Read the list.** If you see a file you did not mean to change, or `.env`, stop and ask.

2. Choose exactly which files to save (do **not** use `git add .` unless the list is only your files):

   ```
   git add portal/frontend/src/app/companies/page.tsx
   ```

   (Several files: put a space between them.)

3. Save the snapshot with a short message that starts with a word and a colon:

   ```
   git commit -m "feat: add company list screen"
   ```

   Starts with: `feat:` new thing · `fix:` repair · `docs:` documents · `test:` tests · `refactor:` tidy without changing behaviour · `chore:` boring housekeeping.
   Write what you did, in English, in the present tense. No secrets in the message.

**Commit small and often.** One idea per commit. It is easier to check and easier to undo.

## C. Before you send: run the checks (2 minutes)

The robot on GitHub will run these anyway. Running them first saves you embarrassment.

```
npm run lint
npm run typecheck
npm test
npm run build
npm run format:check
npm run secrets:scan
```

All must finish without red errors. If `format:check` complains, run `npm run format`, then `git status`, `git add` the changed files and commit again.
If you only wrote **documents**, you still run `npm run format:check` and `npm run secrets:scan`.
**Never** make a check pass by deleting a test or turning a rule off. If a check blocks you and you do not understand why: [04](04-WHEN-YOU-ARE-STUCK.md).

## D. Sending your work

1. Get the newest `develop` into your branch (so your work fits with everyone else's):

   ```
   git fetch
   git rebase origin/develop
   ```

   **You should see:** `Successfully rebased` or `Current branch ... is up to date`.
   If it says **CONFLICT**: do not panic and do not guess. Type `git rebase --abort` (this undoes it safely) and ask Dawit.

2. Send your branch to GitHub:

   ```
   git push -u origin feature/rahel/company-list-screen
   ```

   (Use **your** branch name.) The first time Git prints a link starting with `https://github.com/DawitBK/DCC/pull/new/...`.

3. Open that link (or go to the repo on GitHub and press **Compare & pull request**).
4. **Very important:** check that it says **base: `develop`**. If it says `main`, change it to `develop`.
5. Fill the form. It is a short checklist. Write what you did and **how you tested it** (which commands, what you saw; a screenshot if it is a screen).
6. Press **Create pull request**. Do **not** press merge.
7. Tell the owner of the area in the group chat: "PR is ready, please check."

## E. After you sent it

- Wait for the **green ✅** from the robot. If it shows a red ❌, click **Details**, read the first error, fix it on your computer, commit, and `git push` again (no new branch needed).
- A reviewer may write comments. That is normal and kind: they are helping. Fix what they ask, push again, and reply "done" to each comment.
- When it is approved and green, **a person merges it** (Dawit or the area owner). You do not merge.
- After it is merged: `git switch develop`, `git pull`, and start a **new** branch for the next task. Never reuse the old branch.

## F. The never list

| Never                                                     | Why                                                            |
| --------------------------------------------------------- | -------------------------------------------------------------- |
| Work or commit while on `develop` or `main`               | those are shared; a mistake there hurts everyone               |
| `git push --force` or `git push -f`                       | it can erase other people's work                               |
| `git reset --hard`, `git clean -fd` (without asking)      | they delete your work for ever                                 |
| `git commit --no-verify`                                  | it skips the safety checks                                     |
| Commit `.env`, passwords, keys, tokens, real private data | the project is **public**; leaked secrets stay leaked for ever |
| Open a pull request into `main`                           | only Dawit does releases                                       |
| Merge your own pull request                               | a second pair of eyes is the whole point                       |
| Edit a database migration that is already in `develop`    | it would break everyone's database                             |

## G. If you did something wrong

Almost everything can be fixed. **Stop, do not try more commands, and tell Dawit exactly what you typed.** Two cases you can fix yourself:

- **"I committed on `develop` by mistake" (nothing pushed yet):**
  `git switch -c feature/yourname/what-it-was` (this keeps your work on a new branch), then tell Dawit so `develop` is put right.
- **"I typed a secret into a file I already committed":** tell Dawit **immediately**, before pushing. If you already pushed, the secret must be treated as stolen and replaced. Say so at once. Honesty here saves the project.
