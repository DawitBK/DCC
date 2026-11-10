# operational-engine: the customised Postiz (Woluman)

Postiz is a **separate service** with its own databases and lifecycle ([ADR-0006](../docs/architecture/decisions/ADR-0006-postiz-separate-service.md)).
Nothing in this folder runs by default; the DCC development stack does not need it (`ENGINE_PROVIDER=fake`).

## What upstream ships

Postiz's own `docker-compose.yaml` runs nine containers: Postiz (app, port 5000), its PostgreSQL, Redis, **Temporal** with its own PostgreSQL and
**Elasticsearch**, a Temporal admin tool and UI, and Sentry Spotlight. The `latest` tag is floating: **never use it**. Pin the release in `VERSION`.

## Plan

1. Run it on a **separate Linux host with Docker** (decision D-03), not on the Group's production application server.
2. Start from the upstream compose file **at the pinned tag**, copy it here as `compose.postiz.yml` with changes listed in `CUSTOMIZATIONS.md`
   (write that file: every deviation from upstream, and why). Remove what you do not need (e.g. Spotlight) only after checking Postiz still starts.
3. Keep settings in an env file **outside Git**; `postiz.env.example` lists the names. Required controls: `DISABLE_REGISTRATION=true`,
   strong `JWT_SECRET`, Postiz not reachable from user networks, admin UI restricted.
4. Create an API key in Postiz for DCC; set `POSTIZ_BASE_URL` and `POSTIZ_API_KEY` in DCC's environment on the DCC server only.
5. Register each network's developer app (Meta, LinkedIn, Google/YouTube, TikTok, X) **now**: approvals take weeks and block testing.
6. Switch DCC to the real engine with `ENGINE_PROVIDER=postiz`, then run the adapter checks and record results in `docs/engine/`.

## Files

- `VERSION`: the pinned Postiz release. Change it only through a reviewed pull request after testing.
- `postiz.env.example`: variable **names** to fill in (values are never committed).
