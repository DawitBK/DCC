# Screen recordings for network reviewers (#40)

Owner: Woluman · Written: 2026-11-18

Dawit's direction (#40): **narrated screen recordings first, made on a developer computer.** A temporary separate installation with test data,
reachable from outside during a review, is allowed **only with Dawit's explicit approval each time**, and is removed afterwards.

## Rules for every recording

- Made on a developer computer, with **test accounts and a test Page only**. Never a real company Page, never real staff data.
- **Nothing secret on screen:** no `.env` or `postiz.env`, no API keys, no passwords typed visibly, no browser tabs with private mail. Close
  everything else before recording. Watch the whole recording once before sending it.
- High resolution (at least 1280 x 720), downloadable file, spoken narration in English, about 3 to 6 minutes.
- Show **DCC's screens** for the business flow (write, approve, publish) and **the network's own sign-in screen** for granting access.
- Keep the files outside the repository (they are large and may show test account names). Note the date and file name in the network's doc.

## LinkedIn (Standard tier, after Development tier works)

LinkedIn asks to see (see [linkedin.md](linkedin.md)):

1. A Page administrator connecting the Page: the full LinkedIn sign-in and the permissions screen.
2. A post written in DCC, approved by a second person, then published; show it on the LinkedIn test Page.
3. A member's comment on that post, and how it appears in DCC (needs the inbox, W-08).
4. Which personal fields of the commenter DCC shows (name and comment text only).

LinkedIn also asks for **test credentials** for its reviewers. That needs reviewer access to our closed engine: ask Dawit when we get there.

## Meta (only if Advanced Access is ever needed)

Today's route (#38) is Standard Access with app roles, which needs no review. If Advanced Access becomes necessary, Meta wants to **use** the
app; a recording may not be accepted. Plan if needed: one recording per permission requested (connect the Page, publish, read and reply to a
comment), then ask Dawit about a temporary installation.

## TikTok (later phase, #41)

TikTok's audit checks the posting screen rules (see [tiktok.md](tiktok.md)). The recording must show every required
field in DCC's composer. Not before TikTok's phase.

## Status

| Network  | Recording   | Date | File (kept outside Git) |
| -------- | ----------- | ---- | ----------------------- |
| LinkedIn | not started |      |                         |
| Meta     | not needed  |      |                         |
| TikTok   | later phase |      |                         |
