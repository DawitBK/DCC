# Record: full browser pass of the final screens, 2026-11-25 (R-09)

Run by the lead's engineering assistant: `node scripts/verify/screens-pass.mjs` in Microsoft Edge (Playwright and axe-core installed outside the
repository, `PW_CHANNEL=msedge`) against the dev backend and the dev frontend on this PC, signed in with one practice person per role (`qa.<role>@example.test`,
a fresh session per page load, written into the development database as `npm run dev:session` does).

## What was covered

11 roles x 21 screens x desktop (1280) and phone (360) x light and dark = **924 page loads**. On every load: horizontal overflow, console errors,
failed requests, content-security-policy violations and axe-core 4 with the WCAG 2.0, 2.1 and 2.2 level A and AA rules (colour contrast included).
This pass did not walk write flows (the earlier pass of 2026-11-24 did: [record](2026-11-24-BROWSER-PASS.md)).

## Result of the full run

924 loads, 54 with findings, in three groups (the counts add up to the 54 the script reported; the registry figure is the remainder after the calendar and signed-out groups, which were counted from the script's own list):

| Group                                                                                                            | Loads | Cause                                                                                                                                                                             | What was done                                                                            |
| ---------------------------------------------------------------------------------------------------------------- | ----: | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Calendar events: the accessible name did not contain the words on the button (axe `label-content-name-mismatch`) |    29 | the label was a differently worded sentence, and the three visible parts of a button (time, network, state) had no whitespace between them, so they read as one run-together word | the label now starts with the visible words, and the parts have real spaces between them |
| Account registry "Fix it" links: the same rule                                                                   |    26 | the name was "gap: open account", not starting with "Fix it"                                                                                                                      | the name now starts with "Fix it:"                                                       |
| One person (`company_marketing_manager`, phone, dark): every screen answered with the sign-in page               |    14 | the practice session was lost part-way through the run (an artifact of the test setup, the handoff note on long runs); not a screen defect                                        | re-run on its own: 42 loads, only the calendar finding above                             |

Nothing else: no horizontal overflow, no console error or warning, no failed request and no content-security-policy violation on any of the 924 loads.

## After the fixes

- Calendar and registry screens, all 11 roles, both widths, both themes: **88 loads, 0 findings** (after the second calendar fix).
- The role whose session dropped, every screen, dark theme: **42 loads**, the calendar finding only; fixed afterwards and covered by the 88 above.
- **Not re-run:** the complete 924 after the last fix. The other 19 screens had no finding in the full run and were not touched.

## Not covered

Write flows in this pass; Firefox and Safari; real devices; screen readers; zoom; the real SSO sign-in (the practice sessions bypass it, as `dev:session` does); a real engine.
