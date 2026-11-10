# Abenezer: the facts (requirements and data collection)

**Read [START HERE](README.md) first, then [02 sending work](02-HOW-TO-SEND-YOUR-WORK.md) and [03 what you may touch](03-WHAT-YOU-MAY-TOUCH.md).** You do **not** need to install the programming tools ([01](01-SETUP-YOUR-COMPUTER.md)) to do your job. There is an easy way to send documents using only the GitHub website (see "How you send your work" below).

## Who you are in this project

You are the person who finds out **how things really work today**, so the others build the right thing. Rahel draws screens, Hirko builds rules, Woluman connects networks. All of them need **facts from you**: which companies exist, which social media pages they own, who looks after them, who approves what, how long an approval may take.

If you are vague, they will guess. If they guess, they build the wrong thing. **Your job is to remove guessing.**

## Your room

- 🟢 **Yours:** `docs/requirements/`, `docs/discovery/`, `docs/onboarding/`.
- 🟡 **Ask first:** `docs/design/`, `docs/api/`, `docs/engine/`, `docs/integrations/` (other people's rooms).
- 🔴 **Never:** the program folders (`portal/`, `operational-engine/`), `scripts/`, `.github/`, and the other `docs/` folders. Full map: [03](03-WHAT-YOU-MAY-TOUCH.md).

## THE most important rule: what may and may not go in the project

The project is **public**: anyone in the world can read it, forever, even after you delete something.

| ✅ You MAY write in the project (public facts)                      | ❌ You may NEVER write in the project                                       |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Company names, brand names, department names                        | **Passwords, recovery codes, security answers, keys, tokens** (of anything) |
| Official **public** social media page names and links               | Private phone numbers, private emails, ID numbers, home addresses           |
| Job titles and roles ("marketing manager of Company A")             | A person's name next to a sensitive fact ("Almaz holds the password")       |
| Counts and findings ("31 accounts, 9 have no backup administrator") | The proposal and team-allocation PDFs, or text copied from them in bulk     |
| How processes work, in words                                        | Anything marked confidential by the company                                 |

**Where the sensitive information goes instead:** ask Dawit which folder on the Group's shared drive to use. Real names with contact details, and any detail you are unsure about, stay **there**, not in the project.
**When in doubt: do not put it in. Ask Dawit.** Asking costs one minute. A leak cannot be undone.

**Never collect or ask anyone to send you a password**, in a message, a spreadsheet or a document. If someone sends one by accident: tell them to change it, delete the message, and tell Dawit.

## How you send your work (no programming tools needed)

You can do everything on the GitHub website.

1. Open `https://github.com/DawitBK/DCC` and go to the file you want to change (or the folder where the new file goes).
2. To **edit** a file: open it and click the **pencil** icon. To **add** a file: click **Add file > Create new file**.
3. Type your text. (Writing is in "Markdown": `# Title`, `## Heading`, `- list item`. The templates show you how.)
4. Press **Commit changes...** (green button). In the box that opens:
   - Write a short message: `docs: add organisation structure for Company A`
   - Choose **Create a new branch for this commit and start a pull request**.
   - Name the branch: `docs/abenezer/` followed by the topic, for example `docs/abenezer/organisation-structure`.
   - Press **Propose changes**, then **Create pull request**.
5. **Check it says `base: develop`**, not `main`. If it says `main`, change it to `develop`.
6. Write in the box: what you added, where the information came from (who you asked, on what date), and anything still unknown.
7. Press **Create pull request**. **Do not press merge.** Tell Dawit in the chat. He reviews and merges.

(If you prefer to use VS Code and Git like the others, follow [01](01-SETUP-YOUR-COMPUTER.md) and [02](02-HOW-TO-SEND-YOUR-WORK.md). Both ways are fine.)

## Your first day

1. Read [START HERE](README.md) (the short story of the project).
2. Read `docs/requirements/PROPOSAL-REVIEW.md`. It lists **20 places where the proposal is unclear or contradicts itself**. Resolving them with the right people is your first big job. Dawit has already decided some of them (see `docs/project/OPEN-DECISIONS.md`).
3. Ask Dawit for the proposal and the team document (the two PDFs; **they never go in the project**). Your scope is section 3 of the team document.
4. Look at the templates in `docs/discovery/` (organisation structure, account inventory, stakeholders) and `docs/requirements/REQUIREMENTS-REGISTER.template.md`.
5. Make a list of **who to talk to** in each company (marketing lead, IT, executive). Keep that list with the Group's shared drive, not in the project.

## How to collect information (the method)

For every topic: **ask, write down, check, mark what is unknown.**

1. **Prepare 5–10 questions** before each conversation. Use the questions under each task below.
2. **Ask the person who really does the work**, not only the manager. Ask "show me", not only "tell me".
3. **Write down what they said**, in their words, with the date and their **job title** (not their name, in anything public).
4. **Read it back to them** ("So the post goes to the marketing manager, then to the CEO, and it can take up to two days: is that right?").
5. **If they do not know, write "unknown: ask X"**. Never fill a gap with your own idea.
6. **If two people disagree, write both answers** and who must decide. Send it to Dawit as a decision question.
7. **Send in small pieces**, one company or one topic per pull request.

## Your tasks, one at a time

### A-01: The Group's structure

**Why:** DCC is built around Group > Company > Brand. We must get this right.

**Steps**

1. Copy `docs/discovery/ORGANISATION-STRUCTURE.template.md` to `docs/discovery/ORGANISATION-STRUCTURE.md` (as a new file).
2. Fill the table with **public facts only**: company names, which brands each company owns, business units and departments, the **role** (not the name) of the marketing lead.
3. Questions to ask: Which companies are in the Group? Which brands does each company own? Is there a communications or marketing department in each? Who in each company approves public messages? Does anyone else (an agency) post for them?
4. For each unknown: write `unknown: ask <job title>`.
5. Pull request. **Done when:** every company and brand of the Group is listed (or marked unknown), and Dawit confirms it matches reality.

### A-02: Every social media account (the inventory)

**Why:** nobody has the full list today. This is the starting list DCC will be loaded with.

**Steps**

1. Copy `docs/discovery/ACCOUNT-INVENTORY.template.csv` to `docs/discovery/ACCOUNT-INVENTORY.csv`. (Open it with Excel or Google Sheets; save it as CSV.)
2. One **row per account** (one Facebook page = one row, its Instagram = another row). Fill every column:
   - `company`, `brand`, `platform` (Facebook, Instagram, LinkedIn, YouTube, TikTok, X), `account_name`, `public_url` (the public link anyone can open)
   - `business_purpose` (what it is for)
   - `account_owner_role` (a **job title**, not a name), `responsible_team`
   - `current_access_arrangement`: describe **how** access works in general words ("shared login used by 3 people", "agency manages it"), **never** the password or the names
   - `connected_tools` (scheduling tools, agencies), `status_and_known_issues`
   - `has_backup_admin` (yes/no), `native_2fa_enabled` (yes/no/unknown), `recovery_email_phone_is_corporate` (yes/no/unknown)
3. **Never** add a password column or put credentials anywhere.
4. Questions to ask each page owner: "What is this page for? Who posts today? Who else is an administrator? Is there a second administrator if you leave? Is two-step login turned on? Is the recovery email and phone a company one or a personal one?" The last one matters a lot.
5. Also write a short summary (counts and gaps, no names) in `docs/requirements/` or in your pull request: for example "31 accounts, 9 without a backup administrator, 12 without two-step login".
6. Pull request. **Done when:** every account the Group owns is listed or marked unknown, and the summary exists.

### A-03: Who will use DCC

**Why:** to know who gets which role.

**Steps**

1. Copy `docs/discovery/STAKEHOLDERS.template.csv` to a **working copy kept on the Group shared drive** (ask Dawit which folder). It has columns for names and contacts, which **must stay off the project**.
2. For the **public** version in the project, create `docs/discovery/STAKEHOLDERS-ROLES.csv` with **only**: `company_or_unit`, `role_title`, `interest_in_dcc`, `expected_dcc_role` (creator, reviewer, publisher, company admin, executive, auditor...), `approval_authority_for` (what they may approve). **No names, no contacts.**
3. Questions: Who creates content? Who checks it? Who may press publish? Who should only watch? Who is the top approver for sensitive matters?
4. **Done when:** every company has its people (by role) with an expected DCC role.

### A-04: How things work today

**Why:** DCC should fit real life, and the new process must be explained against the old one.

**Steps**

1. Create `docs/requirements/CURRENT-PROCESSES.md`.
2. For each company (or each kind of company) describe, in numbered steps: how a post is **made**, **reviewed**, **approved**, **published**; what happens in an **emergency** (a wrong post, a hacked account); how problems are **reported**; how **reports** to management are produced today and how often.
3. For each step write: **who** (job title), **tool** (phone, WhatsApp, email, an agency), **how long it takes**.
4. Questions: "Walk me through the last post you published, from the idea to the 'post' button. Who saw it before? What if it was wrong? Who is called if the page is hacked?"
5. Mark every place where the process is **missing or unclear**.

### A-05: The approval matrix and publishing rules (this unblocks Hirko)

**Why:** the whole approval workflow depends on these answers. Hirko will build **exactly** what you write, so it must be exact.

**Steps**

1. Create `docs/requirements/APPROVAL-AND-PUBLISHING-POLICY.md`.
2. The proposal contains a starting table of categories (routine, campaign, Group-level, financial, crisis, sensitive). **Validate it** with the people in charge: for **each category**, write:
   - **who writes**, **who reviews**, **who approves** (by role), **how many levels**
   - **how long** each level may take, and **what happens if time runs out** (who is asked next?)
   - **who can publish** and who can **stop** (freeze) publishing
   - **which companies differ** from the Group rule
3. Words in the proposal like "authorized executive management" or "designated executive" are not defined. Ask **who exactly** (which job title) and write it.
4. Anything not decided: write the **question and the person who must decide**. Send those to Dawit as a decision question ("Decision needed" issue). **Do not fill gaps yourself.**
5. **Done when:** Hirko can read it and build the workflow without asking you anything, and Dawit has approved it.

### A-06: The registers (always going)

1. `docs/requirements/REQUIREMENTS-REGISTER.md` (start from the template): one line per requirement, with a number, what, who asked, how important, and status.
2. `docs/requirements/DECISIONS-REGISTER.md`: every decision and every open question, with **who must decide** and **by when**.
3. Close the items in `PROPOSAL-REVIEW.md` one by one: write next to each what was decided and by whom.
4. Update them **every week**.

## Your week

| Day          | What                                                                                     |
| ------------ | ---------------------------------------------------------------------------------------- |
| Every day    | talk to people, write notes the same day, send small pull requests                       |
| Twice a week | check with Hirko and Rahel: "is anything I wrote unclear?"                               |
| Friday       | 5 lines to Dawit: done, next, blocked by (who has not answered), decisions needed, risks |

## Mistakes to avoid

- Writing a **password, private contact or personal detail** in the project. (Re-read the green/red table.)
- Filling an unknown with a guess. "Unknown: ask the marketing manager" is a **good** answer.
- One huge pull request with everything.
- Using names instead of job titles in public files.
- Writing "the usual process" without the steps.
- Forgetting the date and the job title of who said it.
- Pressing **merge**.

## Ask Dawit

Which shared-drive folder to use · anything you are unsure about being public or private · a decision nobody can make · a person who will not answer you · anything the proposal says that does not match what you find.
