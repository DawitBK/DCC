# START HERE: the DCC team handbook

Welcome. This folder is your instruction book. It is written in simple words on purpose. If a sentence is not simple, that is our mistake: tell Dawit.

**Do these things in this order. Do not skip ahead.**

| Step | What to do                                              | Where                                                                                                                               |
| ---- | ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Read this page to the end (10 minutes)                  | here                                                                                                                                |
| 2    | Learn the words we use                                  | [00-GLOSSARY](00-GLOSSARY.md)                                                                                                       |
| 3    | Set up your computer                                    | [01-SETUP-YOUR-COMPUTER](01-SETUP-YOUR-COMPUTER.md)                                                                                 |
| 4    | Learn how to save and send your work                    | [02-HOW-TO-SEND-YOUR-WORK](02-HOW-TO-SEND-YOUR-WORK.md)                                                                             |
| 5    | Learn what you may touch and what you may not           | [03-WHAT-YOU-MAY-TOUCH](03-WHAT-YOU-MAY-TOUCH.md)                                                                                   |
| 6    | Open your own page and do your tasks one by one         | [RAHEL](RAHEL-ONBOARDING.md) · [HIRKO](HIRKO-ONBOARDING.md) · [WOLUMAN](WOLUMAN-ONBOARDING.md) · [ABENEZER](ABENEZER-ONBOARDING.md) |
| 7    | When something goes wrong or you do not know: read this | [04-WHEN-YOU-ARE-STUCK](04-WHEN-YOU-ARE-STUCK.md)                                                                                   |

## What are we building? (the short story)

The Kerchanshe Group has many companies. Each company has social media pages (Facebook, Instagram, LinkedIn, YouTube, TikTok, X). Today nobody has one clear place that says:
who owns each page, who is allowed to post, who checked the post before it went out, and what happened.

**DCC is that place.** Think of it like the security desk of a building:

- Every page is written in a list (who owns it, who is the backup).
- Nobody posts without a checker saying "yes, this is fine".
- Every action is written in a notebook that cannot be changed secretly (the "audit trail").
- A person from Company A can never see Company B's things.

## The three parts (and who builds them)

```
   People use this              The brain                         The hands
 ┌───────────────────┐    ┌─────────────────────┐        ┌────────────────────────┐
 │ portal/frontend   │───▶│ portal/backend      │───────▶│ operational-engine     │──▶ Facebook,
 │ the screens       │    │ rules, approvals,   │        │ our own version of     │    Instagram,
 │ (Rahel)           │    │ records (Hirko)     │        │ Postiz posts for us    │    LinkedIn, ...
 └───────────────────┘    └─────────┬───────────┘        │ (Woluman)              │
                                    │                    └────────────────────────┘
                                    ▼
                    The Kerchanshe SSO = the company login
                    (we never make our own passwords)
```

- **The screens** (`portal/frontend`): what people see and click. Rahel builds it.
- **The brain** (`portal/backend`): it decides who may do what, keeps the records and the notebook. Hirko builds the business parts. Dawit built the safety foundation.
- **The hands** (`operational-engine`): a customised copy of a program called **Postiz** that actually posts to the social networks. Woluman builds it. **It only posts what the brain has allowed.**
- **The login**: the Group already has a login system (SSO). DCC uses it. We do **not** create passwords.
- **Abenezer** finds out the real facts (which companies, which pages, who approves what) so the others build the right thing.
- **Dawit** is the architect and project manager. He decides, reviews and keeps everything safe.

## The 7 golden rules (print them, stick them near your screen)

1. **Work only in your own folder.** Other folders belong to someone else. Ask first.
2. **Never work directly on `main` or `develop`.** Always make your own branch (step-by-step in [02](02-HOW-TO-SEND-YOUR-WORK.md)).
3. **Never put secrets in the project.** Passwords, keys, tokens: never. This project is **public**: the whole world can read it.
4. **Never put real private information in the project.** No private phone numbers, private emails, ID numbers, no account passwords. Public facts (company names, official page links) are fine.
5. **Never change the safety parts** (`portal/backend/src/platform`). If you think they are wrong, tell Dawit.
6. **Small steps, often.** Save your work in small pieces. Send it for checking every day or two.
7. **If you are not sure, ASK.** Asking is never a mistake. Guessing is.

## Using an AI helper (Claude, Copilot, Cursor, ChatGPT...)

It is fine to use one. The project has a file called `CLAUDE.md` (and `AGENTS.md`) that tells the AI the rules. Good AI tools read it by themselves.
**You are still responsible for what you send.** Read what the AI wrote. If it wants to break a rule above, say no. If it says "it works", run it yourself. More in [04](04-WHEN-YOU-ARE-STUCK.md).

## Other documents in this folder (for later, you do not need them today)

[OWNERSHIP](OWNERSHIP.md) (the official map) · [GIT-WORKFLOW](GIT-WORKFLOW.md) (the technical version of step 4) · [ADDING-A-MODULE](ADDING-A-MODULE.md) (Hirko's recipe) · [BRANCH-PROTECTION](BRANCH-PROTECTION.md) (Dawit's).
