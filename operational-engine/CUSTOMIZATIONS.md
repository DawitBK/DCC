# What we changed from upstream Postiz, and how to run it

Pinned release: see `VERSION` (v2.25.3). Upstream file: `docker-compose.yaml` at that tag.

## Differences in `compose.postiz.yml`

| Upstream                                             | Here                                                          | Why                                                           |
| ---------------------------------------------------- | ------------------------------------------------------------- | ------------------------------------------------------------- |
| image tag `latest`                                   | the pinned tag (`POSTIZ_VERSION`, default from `VERSION`)     | `latest` moves; a moving engine cannot be verified            |
| port `4007` open on every network interface          | bound to `127.0.0.1` only                                     | only DCC on the same host talks to the engine                 |
| `DISABLE_REGISTRATION: false`                        | `true` by default                                             | only engine administrators get an account                     |
| passwords and the JWT secret written in the file     | read from `postiz.env` (development placeholders as defaults) | no real value in Git                                          |
| Sentry Spotlight, Temporal UI, Temporal admin tools  | removed                                                       | not needed to run; fewer open ports (8969, 8080, 7233 closed) |
| Temporal port `7233` published                       | not published                                                 | internal to the engine                                        |
| two networks, fixed container names                  | one network, names from the compose project `dcc-engine`      | does not collide with another Postiz on the same computer     |
| anonymous volumes for Temporal's database and search | named volumes                                                 | data survives a `down`; removed only with `down -v`           |
| dozens of empty variables for networks we do not use | only X, LinkedIn, Facebook/Instagram, YouTube, TikTok         | the six networks of the proposal                              |

`dynamicconfig/development-sql.yaml` is copied unchanged from upstream (Temporal needs it).

No Postiz source code is in this repository. Code changes (the unified inbox, W-08) live in the fork `DawitBK/postiz-app`.

## Run it on a developer computer (proved 2026-11-14)

1. Docker Desktop running. In `operational-engine/`: `cp postiz.env.example postiz.env`, then for a local start set
   `DISABLE_REGISTRATION=false` and `NOT_SECURED=true` in it (no HTTPS on a developer computer).
2. `docker compose -f compose.postiz.yml --env-file postiz.env up -d`. The first start downloads about 3 GB and takes a few minutes.
3. Open `http://localhost:4007`, create the one engine administrator account, then set `DISABLE_REGISTRATION=true` and run step 2 again.
4. In Postiz: Settings, Public API: copy the API key. Put it in DCC's `.env` (never in Git):
   `ENGINE_PROVIDER=postiz`, `POSTIZ_BASE_URL=http://localhost:4007/api/public/v1`, `POSTIZ_API_KEY=<the key>`, `DCC_ENGINE_ALLOW_UNVERIFIED=true`.
5. Check the adapter against it (from the repository root):
   `POSTIZ_BASE_URL=http://localhost:4007/api/public/v1 POSTIZ_API_KEY=<the key> npm run verify:live -w @dcc/engine-client`

Stop: `docker compose -f compose.postiz.yml --env-file postiz.env down` (add `-v` to delete its data too).

## What is proven and what is not

Proven on 2026-11-14 against Postiz v2.25.3 running from this file: the stack starts; an account and an API key can be made;
DCC's adapter lists channels and posts, a wrong key is refused, an unknown channel is refused before anything is sent, an engine
that does not answer is reported as "outcome unknown".

**Not proven:** connecting a real social network (each needs that network's developer app: tasks W-02, D-11), a real post,
scheduling and deleting a post, media, the inbox (W-08, in the fork). To prove a post once a channel is connected, run step 5 with
`POSTIZ_VERIFY_CHANNEL_ID=<channel id>`: it schedules one post a year ahead, finds it and deletes it.

The server installation (WSL2 Ubuntu, HTTPS, backups of the engine's volumes) is not done: there is no test server yet.
