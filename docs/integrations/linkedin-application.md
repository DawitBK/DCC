# LinkedIn Community Management API: application draft (#37)

Owner: Woluman · Written: 2026-11-18 · Status: **draft, DO NOT SUBMIT**

> **Do not submit until every field in section 2 is filled in and Dawit says go.** A refused app can never apply again; a new app would be needed.

Dawit's direction (#37): apply **once, as Kerchanshe Group**, on a **new LinkedIn app with no other LinkedIn product on it** (not the test app used on a
developer computer). Requirements and limits: [linkedin.md](linkedin.md). Screen recording: [REVIEW-RECORDINGS.md](REVIEW-RECORDINGS.md).

## 1. Steps, in order

1. Abenezer collects the values of section 2 (he sends the private ones to Dawit directly, not in Git or in a public issue).
2. Dawit confirms the values and says go.
3. Create a **new** app at developer.linkedin.com, signed in with the **business email** of section 2. App name: `DCC (Kerchanshe Group)`
   (no "LinkedIn" or "Microsoft" in the name or logo). Logo: the Group logo.
4. Link the app to the **Kerchanshe Group LinkedIn Page**. The Page's **super admin** verifies the app (LinkedIn sends them a link).
5. Products tab: request **Community Management API** only. Nothing else on this app, ever.
6. Fill in the form with section 3. Record the date in [linkedin.md](linkedin.md), "How long approval takes".
7. When the Development tier is granted: put the app's client id and secret in `postiz.env` on the engine computer (`LINKEDIN_CLIENT_ID`,
   `LINKEDIN_CLIENT_SECRET`), never in Git. Connect the Group Page in Postiz, run the live check (W-03).
8. Standard tier later, with the screen recording ([REVIEW-RECORDINGS.md](REVIEW-RECORDINGS.md)).

## 2. Values still missing (fill in, then delete this table's "missing")

Write **"decided"** here, not the value itself, for the private ones.

| Value                                               | Public or private | State   |
| --------------------------------------------------- | ----------------- | ------- |
| Legal name of the organisation                      | public            | missing |
| Registered address                                  | public            | missing |
| Public website                                      | public            | missing |
| Privacy policy page covering DCC (exists, or write) | public            | missing |
| Business email for the application (no personal)    | private           | missing |
| Super admin of the Group's LinkedIn Page            | private           | missing |

## 3. Draft answers for the form

**Company and product overview**

> Kerchanshe Group is a diversified Ethiopian business group (coffee, manufacturing, agriculture, automotive, construction, equipment and
> hospitality). DCC (Digital Communications Control Center) is the Group's internal tool for its own official social media accounts. Staff of the
> Group's companies prepare posts in DCC; the right person reviews and approves each post; only approved posts are published to the company's
> own LinkedIn Page. Every action is recorded for audit. DCC is not offered to anyone outside the Group.

**Use case**

> We will use the Community Management API to (1) publish approved posts (text, images, video) to the LinkedIn Pages of Kerchanshe Group
> and its companies, as the Page; (2) read the comments on those posts so the Group's communication team can see them in one place;
> (3) reply to those comments as the Page after a staff member writes the reply in DCC. Only administrators of the Group's own Pages connect
> them. We do not post as members, do not message members, do not collect or sell member data, and show a commenter only the name and the
> comment text that LinkedIn returns.

**Who uses it**

> Only employees of Kerchanshe Group and its companies, signed in through the Group's own single sign-on, using the Group's own LinkedIn Pages.
> The received account workbook does not confirm a LinkedIn Page count. It has 13 account rows, but their `Platform` cells contain 11 URL values and 2 `NA` values, while the separate public-link field is blank. Ask Abenezer to correct the platform and URL fields, then confirm the Page count before submitting.

**Data handling**

> Access tokens are stored only on the Group's own server and are never shown to users. Comment data is kept only as long as needed to answer
> it, under the Group's privacy policy (link above).

These texts are **drafts**: Abenezer or Dawit should check the facts (number of Pages, privacy wording) before submitting.

## 4. Limits that matter for us (Development tier)

- 500 calls per app and 100 per member, per day. Reconcile the Page count before estimating polling load; plan polling sparingly (inbox, W-08).
- The integration must be finished within 12 months of getting Development access, before asking for Standard.
- Postiz's comment call still sends LinkedIn API version `202306` (assessment finding F-5): fix in the fork before comments are used.
