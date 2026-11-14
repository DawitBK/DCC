# Role guides: what you do in DCC, and what it will refuse

Quick reference for each role. Everything here is how the system behaves today (it is tested). The exact buttons and
screenshots are added per screen when the screens are final.

## Everyone

**What DCC is for.** The Group's official social media accounts are registered here, every post is approved by the right person
before it goes out, and every action is on record.

**Signing in.** DCC has no password of its own. You sign in with your Kerchanshe account, then type the 6-digit code from the
authenticator app on your phone. Set the app up once, before your first sign-in, in the SSO portal under Security. No app, no
sign-in: this is on purpose.

**"For your security, sign in again to do this."** A few actions (giving or removing a role, lifting a publishing freeze,
exporting the audit trail) need a sign-in from the last 15 minutes. Sign in again and repeat the action. Nothing is wrong.

**Your session ends** after 30 minutes without use and after 8 hours in any case. Save your draft before a long break.

**You only see your own company** (or the whole Group, if your role is at Group level). A record of another company says "not
found", even if someone sends you its address.

**Everything is recorded:** who signed in, who wrote, approved, published, froze, changed a role, and when.

**When something is refused,** the message says why and shows a request id. Give that id to whoever helps you.

**Lost phone or new phone:** your SSO administrator resets the authenticator. DCC has nothing to reset.

## Content creators and marketing managers

| You do                                                   | Good to know                                                                                      |
| -------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| Write a post and choose the accounts it is for           | The accounts are part of what gets approved. A post is published only to the accounts chosen here |
| Edit it                                                  | Every edit makes a new version. Old versions are kept and can be read, never changed              |
| Send it for approval                                     | The people who can review it are notified. You get a notification when it is approved or rejected |
| Fix it after a comment or a rejection, and send it again | The new version needs a new approval                                                              |

**DCC will refuse:**

- **Approving, rejecting or commenting on your own words.** If you wrote **any** version of a post, even a one-line fix, you
  cannot decide on it. A marketing manager who wants to stay the approver asks for the change in a comment and lets the
  creator make it.
- Sending a post that is already waiting for a decision.
- Publishing, if you are a content creator. Marketing managers can publish approved posts.
- Editing an approved post and publishing it as it is: after an edit it is a draft again.

## Content reviewers

You read submitted posts and **comment** ("please change the date"). You do not approve or reject, and you do not publish.
Your comment is kept with the post's history and the creator sees it.

## Approvers

Company executives, marketing managers (for posts they did not write) and Group marketing.

| You do                                  | Good to know                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------- |
| Open the queue of posts waiting         | Group marketing sees every company's queue; company roles see their own                       |
| Read the exact version and its accounts | You approve **this version for these accounts**. Your name and the time are recorded with it  |
| Approve, or reject with a comment       | One decision ends the request. A rejected post comes back as a new version with a new request |

**DCC will refuse:** deciding on a post you wrote any version of; deciding twice on the same request.

**What your approval means.** If the text is edited after you approved, your approval no longer applies and nothing is
published until someone approves the new version.

## Publishers

Publishers, company executives and marketing managers.

| You do                                          | Good to know                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Publish an approved post to one of its accounts | The post then says "published", and the record shows who asked and who approved |
| Press publish twice by mistake                  | Nothing bad: it is sent once                                                    |

**DCC will refuse:** a post that is not approved; a version that is not the latest; an account the post was not approved for;
an account that is archived or disconnected; anything while publishing is **frozen** for the company or that account.

**If it says the outcome is not known** (the publishing engine did not answer): **do not try again and do not post it by hand.**
The post may already be out. Look at the account, then tell your administrator; the record keeps the attempt until it is
settled.

## Company and Group administrators

| You do                                                                                  | Good to know                                                                                                          |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Register each social account: platform, name, link, owner, backup administrator, status | Every account needs an owner **and** a backup administrator. The registry-gaps report lists the ones that lack either |
| Give a person a role, and remove it                                                     | Asks for a recent sign-in. The person has the role at their next click                                                |
| Freeze publishing for the company or one account                                        | Instant, no extra sign-in: it is the emergency brake. Everyone who publishes is notified                              |
| Lift the freeze                                                                         | Asks for a recent sign-in                                                                                             |
| Group administrators also: create companies and brands, give Group-level roles          |                                                                                                                       |

**DCC will refuse:** giving yourself a role; a company administrator giving a Group-level role or any role in another company;
administrators creating, approving or publishing content (you oversee; you do not publish).

**The freeze stops publishing through DCC.** It does not stop someone who has the account's own password from posting on the
network directly. That is why account passwords are held by the owner and the backup administrator only, with two-factor
sign-in on the network itself.

**Never put an account password or recovery code into DCC,** a note field, a chat or an email. DCC connects to accounts through
each network's official authorisation and never needs the password.

## Group CTO, security administrators and auditors

| You do                                                     | Good to know                                                 |
| ---------------------------------------------------------- | ------------------------------------------------------------ |
| Search the audit trail by action, company, person and time | Auditors see their own scope and change nothing anywhere     |
| Export it                                                  | Asks for a recent sign-in, and the export itself is recorded |
| Verify the audit chain                                     | "ok" means no record was edited or removed in place          |
| Open, follow and resolve incidents (CTO and security)      | People who read incidents are notified when one is opened    |
| Freeze and lift a freeze (CTO and security)                |                                                              |

**What the audit trail proves, in honest words.** Records cannot be edited or deleted through DCC, and the chain shows any
change made in place. A daily checkpoint kept outside the database shows even a complete rewrite by someone with full database
access. It is **tamper-evident**; do not call it tamper-proof.

**A checkpoint mismatch or a broken chain is a security incident.** Do not restore, do not "repair": keep everything as it is
and call the architect and the Group CTO.
