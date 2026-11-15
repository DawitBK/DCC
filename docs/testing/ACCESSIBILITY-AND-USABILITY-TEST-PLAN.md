# Accessibility and usability test plan (L-19)

Owner: Dawit. Screens: Rahel. Test users: recruited by Abenezer. Target: WCAG 2.2 level AA, usable at phone width, usable by a
first-time user without training for the three everyday tasks.

**State on 2026-11-14: not run.** The plan is ready; it starts when the first real screens are connected to the API (R-06).
Nothing in this file claims a screen is accessible.

## Part 1. Accessibility checks the team runs itself (every pull request that changes a screen)

These need no test users. Rahel runs them before asking for review; the reviewer repeats two or three at random.

| #   | Check                                                                                                                                                   | How                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| 1   | Everything works with the keyboard only: Tab reaches every control in a sensible order, Enter and Space activate, Escape closes a dialog                | unplug the mouse and do the task                                 |
| 2   | The focused control is always visible                                                                                                                   | Tab through; you must always see where you are                   |
| 3   | A dialog keeps the focus inside it and returns it to the button that opened it                                                                          | open, Tab around, close                                          |
| 4   | Every input has a visible label that is tied to it; every icon-only button has a name                                                                   | click the label: the input gets focus; read with a screen reader |
| 5   | Errors are announced and tied to their field; the message says how to fix it; colour is never the only signal                                           | submit an empty required field with a screen reader on           |
| 6   | Status chips (draft, in review, approved, rejected, published; active, needs attention, disconnected, archived) are told apart by text, not only colour | view in greyscale                                                |
| 7   | Text contrast at least 4.5 to 1; large text and interface parts at least 3 to 1                                                                         | the browser's accessibility inspector on the brand colours       |
| 8   | At 320 pixels wide and at 200% zoom: no sideways scrolling, nothing cut off, tables become readable lists                                               | browser device toolbar                                           |
| 9   | Touch targets at least 24 by 24 pixels                                                                                                                  | device toolbar, phone size                                       |
| 10  | The page has one main heading, headings in order, landmarks for navigation and main content, and a title that names the screen                          | browser accessibility tree                                       |
| 11  | A notification or a toast is announced without stealing focus, and stays long enough to read or can be reopened                                         | screen reader on                                                 |
| 12  | The session-ended and "sign in again" moments do not lose what the person typed without warning                                                         | let the session idle out with a half-written post                |
| 13  | Motion respects the "reduce motion" setting                                                                                                             | switch it on in the operating system                             |
| 14  | Text is not built into images; every text is in the page so it can be translated to Amharic later                                                       | search the code for text inside images or fixed strings in logic |

Automatic tools find about a third of problems. Use the browser's Lighthouse accessibility report on each screen as a first
pass, never as proof. Adding an automated checker to CI is a new dependency: ask Dawit when there are screens to check.

Screen readers to test with: NVDA with Firefox or Chrome on Windows (what staff have); TalkBack on an Android phone.

## Part 2. Usability test with real users (once before the pilot, once during it)

**Who:** 6 to 8 people who will really use DCC, none from the project team: two content creators, two approvers (a marketing
manager and an executive), one publisher, one company administrator, one from Group IT or security, one who is not confident
with computers. At least two on a phone.

**Where:** the test server, test people, fictional companies. Never real accounts.

**How:** one person at a time, 30 minutes, one team member guiding and one writing. The guide reads the task and then stays
silent. Do not help; write down where the person stops. Ask them to say aloud what they expect.

| Task (give the goal, not the steps)                                                            | Passes when                                                                                          |
| ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| "Sign in." (first time, with the authenticator app already set up)                             | signed in without help in under 2 minutes                                                            |
| Creator: "Write a post for your company's page about Friday's event and send it for approval." | submitted without help; they can say what happens next                                               |
| Approver: "Someone sent you a post. Find it and decide."                                       | found from the notification or the queue; decision made; they can say who wrote it and which version |
| Approver: "Ask for a change instead of approving."                                             | they find how to comment or reject, and choose the right one                                         |
| Publisher: "Publish the approved post."                                                        | published once; they can tell it worked                                                              |
| Anyone: "This post was refused. Why?"                                                          | they read the system's reason aloud and it makes sense to them                                       |
| Administrator: "Give a new colleague the reviewer role in your company."                       | done; if asked to sign in again, they are not alarmed                                                |
| Administrator: "Something is wrong on the company page. Stop all publishing now."              | frozen in under 1 minute                                                                             |
| Security: "Who approved this post, and when?"                                                  | answered from the audit screen                                                                       |

**Measure, per task:** done without help (yes or no), time, number of wrong turns, and the person's own words. After all tasks:
"What was confusing?", "What did you expect that was not there?", and a 1 to 5 score for "I could use this at work tomorrow".

**Pass mark for the pilot:** every everyday task (sign in, write and submit, decide, publish) done without help by at least 5 of
6 users; no task that nobody completes; no problem that causes a wrong publish or a wrong approval. Everything found is an
issue with a severity; severity 1 (wrong action possible, or a task nobody can do) is fixed before go-live.

## Record

One row per finding: screen, what happened, how many users, severity, issue number, fixed in which release. Kept by Rahel in
`docs/design/`, without names of the test users.
