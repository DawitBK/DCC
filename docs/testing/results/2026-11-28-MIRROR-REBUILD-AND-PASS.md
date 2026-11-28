# Record: the mirror rebuilt on `develop` and passed again (2026-11-28)

Test environment = the mirror (decision D-28). The owner's PC had restarted overnight: only PostgreSQL was up, Docker Desktop and every mirror process were down.

## What was done

- `develop` at `1e04d6c` (pull request 140) was pulled; `npm install` and `npm run build:packages` ran clean.
- `npm run mirror:db` applied migration `202611271000` (alert numbers stored sealed) to the mirror database: 1 applied, 31 already up to date.
- `npm run build:mirror` built the release (packages, backend, web).
- Docker Desktop was started; `start-mirror-all.ps1` brought up the shared containers (Redis, MinIO, ClamAV) and the whole mirror (SSO, DMS, GMS, DCC and Apache on 8090). The DCC API (9716) answered `{"status":"ok"}`, the web (9717), Apache (8090) and the SSO (9300, 9301) were listening.
- A session was made for one sample person of each of the **eleven roles** and a real Chromium opened every one of the **21 screens** through Apache (`http://localhost:8090/dcc`) at 1280 and 390 px wide.

## Result

| What                                           | Result                                                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 11 roles x 21 screens x 2 widths               | **462 page loads, 0 findings**: no console error or warning, no failed request, no content security policy violation, no horizontal scroll, never sent to sign-in |
| Picture upload in the composer, through Apache | the file uploaded (one thumbnail) and the draft saved: "Saved. The post was read again from DCC."                                                                 |

The mirror now carries the freeze that cancels scheduled posts, the sealed alert numbers and the locked approval decisions (pull requests 137 to 140).

## What it does not show

- The same limits as [the 2026-11-27 pass](2026-11-27-MIRROR-FINAL-SCREENS-PASS.md): the practice engine only, plain http, test sign-ins (inserted sessions), not the mirror's own SSO; no keyboard walk or accessibility check on the mirror.
- The new behaviours (a freeze cancelling a scheduled post, the sealed number) were proven by automatic tests on the development copy, not by a hand run on the mirror.
