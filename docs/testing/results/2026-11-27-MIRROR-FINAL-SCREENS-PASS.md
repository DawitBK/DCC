# Record: the mirror, signed in, all 21 screens (2026-11-27)

Closes the item "no mirror pass of the final screens has run" in [the handoff](../../project/NEXT-AGENT-HANDOFF-2026-11-25.md). Test environment = the mirror (decision D-28).

## What was done

- `develop` at the merge of pull request 131 was built for the mirror (`npm run mirror:db`, which applied the 9 new migrations of Round 2 and 3 to `dccprod`, then `npm run build:mirror`: the release built) and the mirror API (9716) and web (9717) were restarted on it.
- A session was made for one sample person of each of the **eleven roles** (the way `scripts/demo/seed-sample-data.mjs` makes them) and a real Chromium opened **every one of the 21 screens** through the mirror's Apache (`http://localhost:8090/dcc`) at 1280 and 390 px wide.

## Result

| What                                           | Result                                                                                                                                                                          |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11 roles x 21 screens x 2 widths               | **462 page loads, 0 findings**: no console error or warning, no failed request, no content security policy violation, no horizontal scroll, never sent back to the sign-in page |
| Content security policy header                 | exactly one on every page                                                                                                                                                       |
| Picture upload in the composer, through Apache | the file uploaded (one thumbnail) and the draft saved: "Saved. The post was read again from DCC."                                                                               |

## What it does not show

- The practice engine only: no real post, no real network.
- No keyboard walk or accessibility check on the mirror (the development screens pass: 924 loads, [2026-11-25 record](2026-11-25-FULL-BROWSER-PASS.md)).
- Plain http: HTTPS was not assessed (the live address has it at the shared Apache).
- The sample people only: nobody signed in through the mirror's own SSO.
