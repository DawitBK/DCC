# When you are stuck

Being stuck is normal. Everyone is stuck every day. The only wrong thing is staying stuck silently for hours or "fixing" it by guessing.

## The ladder (climb one step at a time)

1. **Breathe. Read the error message slowly, from the top.** The first red line is usually the real problem. The rest is noise.
2. **Look in the table below.** The most common problems are already there.
3. **Try for 15 minutes.** Not 3 hours. Set a timer.
4. **Ask your AI helper**, the safe way (see below).
5. **Ask the person whose room it is** (map in [03](03-WHAT-YOU-MAY-TOUCH.md)).
6. **Ask Dawit.** For anything about safety, login, the database, Git trouble, or "I am not sure if I may".

## Common problems and what to do

| What you see                                                     | What it means                                         | What to do                                                                                                            |
| ---------------------------------------------------------------- | ----------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `docker: error during connect` / setup cannot start the database | Docker Desktop is not running                         | Start Docker Desktop, wait until it says running, repeat the command                                                  |
| `listen EACCES` or `address already in use`                      | Windows or another program blocks that port number    | Change the ports in your `.env` (see the "EACCES" box in [01](01-SETUP-YOUR-COMPUTER.md))                             |
| `Cannot find module '@dcc/contracts'` (or `@dcc/engine-client`)  | the shared parts are not built yet                    | `npm run build:packages`                                                                                              |
| `relation "xxx" does not exist` / the page shows database errors | your practice database is behind                      | `npm run db:migrate`                                                                                                  |
| `No group yet. Run: npm run db:seed`                             | the demo data is missing                              | `npm run db:seed`                                                                                                     |
| The page says "Sign in" but you set the cookie                   | the cookie expired or the value has a space           | run `npm run dev:session -- ...` again and paste the new value; no spaces                                             |
| Frontend loads but the data never appears                        | the frontend cannot reach the backend                 | Is the backend terminal running? Do the ports in `.env` match each other?                                             |
| `npm test` fails right after `git pull`                          | new work needs installing                             | `npm install`, `npm run build:packages`, `npm run db:migrate`, then `npm test` again                                  |
| `npm run setup` says `DCC_LOCAL_ENCRYPTION_KEY is required`      | you did not paste your key into `.env`                | do Step 6 of [01](01-SETUP-YOUR-COMPUTER.md)                                                                          |
| Robot shows red ❌ on GitHub but it works on your computer       | you did not run all the checks, or your branch is old | run the six checks from [02](02-HOW-TO-SEND-YOUR-WORK.md) section C; then `git fetch` and `git rebase origin/develop` |
| `CONFLICT (content): Merge conflict in ...`                      | you and someone else changed the same lines           | **do not guess.** Type `git rebase --abort` and ask Dawit                                                             |
| `Permission denied` / `403` when pushing                         | you pushed to a protected branch or lack access       | you must push your **own** branch, never `develop`/`main`. If it still fails, tell Dawit                              |
| A file you never touched shows up in `git status`                | a tool created it                                     | do **not** add it. Ask                                                                                                |
| You think the project's rules are wrong                          | maybe, maybe not                                      | do not change them. Write the question and send it to Dawit                                                           |

## How to ask a good question (copy this)

Send this in the group chat. A good question gets an answer in minutes; "it does not work" gets 10 questions back.

```
Who I am / my task:      (for example: Rahel, R-03 components)
What I wanted to do:     (one sentence)
What I typed:            (the exact command or what I clicked)
What I expected:         (one sentence)
What happened instead:   (paste the FIRST red error lines; screenshot if it is a screen)
What I already tried:    (one or two bullets)
My branch name:          (output of: git branch --show-current)
```

**Never paste** your `.env` file or any password, key or token into a chat. If an error message contains one, cut that part out first.

## How to write down a decision question (for Dawit)

Use a GitHub **Issue** with the **"Decision needed"** template when it is something the whole team will need to know later ("who approves campaign posts?").
Write: the question, the options you see, which one you would choose and why, and who must decide. Dawit answers in the issue so the answer is written down for everybody.

## Using an AI helper safely

AI helpers (Claude, Copilot, Cursor, ChatGPT...) are useful and also confidently wrong. The rules:

1. **Tell it who you are and your task**, and point it at `CLAUDE.md` if it does not read it itself. Claude Code and most editors load it automatically.
2. **Read every file it wants to change before you accept it.** If it touches a folder that is not yours (map in [03](03-WHAT-YOU-MAY-TOUCH.md)), say no.
3. **Never paste secrets, your `.env`, or private information into an AI chat.**
4. **It says "done" or "all tests pass"? Run the commands yourself.** An AI can be wrong about its own work.
5. **If the AI suggests turning off a test, a lint rule, a safety check or "just adding Redis/Docker/a new library", say no** and ask Dawit.
6. **If the AI suggests renaming or moving folders**, say no. The structure is final.
7. **If it goes in circles after three tries**, stop, close the chat, and ask a person.
8. The AI must not push to `develop`/`main`, merge, or force-push. If it tries, stop it.
9. Do not copy large blocks of code you do not understand. You must be able to explain, in your own simple words, what your change does. If you cannot, ask before you send it.

## Things to say to Dawit immediately

- "I think I committed or pushed a secret." (say it at once, there is no blame, just speed)
- "I think I saw one company's data in another company's screen." (that is a serious safety bug)
- "I changed something outside my folder by accident."
- "I do not understand what I am supposed to do." (we will explain it better; that is on us)
- "I will not make my deadline." (earlier is always better than later)
