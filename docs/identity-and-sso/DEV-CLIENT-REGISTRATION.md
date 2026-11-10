# Registering DCC in the dev SSO

The SSO has a generic mechanism for new applications: two JSON settings in its **own environment file**
(`PRODUCT_CLIENTS_JSON`, `PRODUCT_APPS_JSON`). No SSO source change is needed. This is a one-time step per
developer machine that runs the SSO, and it is done by whoever administers that SSO.

## Steps (dev SSO)

1. Generate a secret (do not reuse one): `node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"`
2. In the SSO backend's development env file add (one line each, values shown with the default dev ports):

   ```
   PRODUCT_CLIENTS_JSON=[{"client_id":"dcc","client_secret":"<the secret>","redirect_uris":["http://localhost:7717/api/auth/callback"],"post_logout_redirect_uris":["http://localhost:7717/"],"name":"DCC","backchannel_logout_uri":"http://127.0.0.1:7716/api/auth/backchannel-logout","roles":[{"name":"dcc-group-admin","label":"DCC group administrator"}]}]
   PRODUCT_APPS_JSON=[{"rp":"dcc","label":"DCC","name":"Digital Communications Control Center","url":"http://localhost:7717"}]
   ```

3. Put the **same secret** in DCC's `.env` as `OIDC_CLIENT_SECRET`.
4. Restart the SSO backend. If the client already exists and you changed addresses, run in the SSO backend:
   `npm run client:uris` (dry run), then `npm run client:uris -- --apply`, then restart.
5. Make yourself a DCC group administrator: in the SSO admin console grant the application role `dcc-group-admin`
   for the `dcc` app to your account (API: `PUT /api/v1/admin/app-roles/dcc/users/<email>` with `{roles:["dcc-group-admin"]}`),
   then sign in to DCC. In development you may instead set `DCC_DEV_BOOTSTRAP_ADMIN_EMAILS=you@example.test` in DCC's `.env` (refused in production).
6. Seed data must exist first: `npm run db:seed` creates the group (`kerchanshe`) that the admin role attaches to.

## If your ports differ

If Windows refuses the ports (`listen EACCES`), use others and keep **all** of these in step: `DCC_API_PORT`,
`DCC_WEB_PORT`, `DCC_WEB_ORIGIN`, `DCC_API_INTERNAL_URL`, `OIDC_REDIRECT_URI`, `OIDC_POST_LOGOUT_URI`, and the SSO client's
three addresses. Rebuild the web app afterwards (`npm run build -w @dcc/web`): its proxy target is fixed at build time.

## Rotating the secret

Generate a new one, update the SSO setting and DCC's `.env`, restart both. Production rotation is a deployment task
(secret handling decision D-05); nothing real is ever pasted into chat, issues or Git.

## Common failures

| Symptom                                    | Cause                                                                                           |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `invalid_redirect_uri` at the SSO          | the addresses stored in the SSO differ from DCC's: run `client:uris`                            |
| Sign-in returns to `/?error=signin_failed` | check the API log line for the reason code (`token_exchange_failed`, `email_not_verified`, ...) |
| Signed in but "no role yet"                | expected for a new person: a group administrator must grant a role                              |
| Browser lands on the SSO backend port      | `OIDC_INTERNAL_URL` is set but `OIDC_ISSUER` is wrong                                           |
