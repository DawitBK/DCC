# Registering DCC in the test and production SSO (L-06)

Owner: Dawit. **This is the procedure; it has not been carried out.** DCC is not deployed anywhere, and nothing on the live SSO
has been touched. It is done by Dawit, on the server, on the day of the first deployment. The development version is
[DEV-CLIENT-REGISTRATION](DEV-CLIENT-REGISTRATION.md); the mirror on Dawit's PC already has its own entry.

The SSO needs **no source change**: a new application is two JSON settings in the SSO's own environment file.

## Before you start

- [ ] The DCC address is decided: `https://<host>/dcc` (path-based behind Apache, decision D-14).
- [ ] The Apache route for `/dcc` exists and reaches the DCC web process ([DEPLOYMENT-AND-ROLLBACK](../devops/DEPLOYMENT-AND-ROLLBACK.md)).
- [ ] You are at the server console. The secret is typed or pasted there only: never into chat, an issue, an email or git.

## Steps

1. **Make a secret** on the server (do not reuse the development or mirror one):

   ```
   node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
   ```

2. **Add DCC to the SSO.** In the SSO backend's `.env.production`, add the `dcc` entry to the two lists. If the lists already
   exist (another application was added before), add DCC's object **inside** the existing array; do not write a second line.

   ```
   PRODUCT_CLIENTS_JSON=[{"client_id":"dcc","client_secret":"<the secret>","redirect_uris":["https://<host>/dcc/api/auth/callback"],"post_logout_redirect_uris":["https://<host>/dcc/"],"name":"DCC","backchannel_logout_uri":"http://127.0.0.1:7716/api/auth/backchannel-logout","roles":[{"name":"dcc-group-admin","label":"DCC group administrator"}]}]
   PRODUCT_APPS_JSON=[{"rp":"dcc","label":"DCC","name":"Digital Communications Control Center","url":"https://<host>/dcc"}]
   ```

   The back-channel address is the DCC **backend on the same server** (`127.0.0.1:7716`): the SSO calls it directly, not through
   Apache. If the two ever run on different machines, it becomes the backend's internal HTTPS address.

3. **Check the SSO still starts** before restarting it: `npm run env:verify:prod` in `SSO/backend`. The SSO refuses to start in
   production if any client has a placeholder secret or a localhost redirect address, which would take sign-in down for **every**
   system. Do not restart until this passes.

4. **Put the same secret in DCC's server environment file**, with the production addresses:

   ```
   OIDC_ISSUER=https://<host>/sso
   OIDC_INTERNAL_URL=http://127.0.0.1:7300
   OIDC_CLIENT_ID=dcc
   OIDC_CLIENT_SECRET=<the secret>
   OIDC_REDIRECT_URI=https://<host>/dcc/api/auth/callback
   OIDC_POST_LOGOUT_URI=https://<host>/dcc/
   DCC_WEB_ORIGIN=https://<host>
   DCC_WEB_BASE_PATH=/dcc
   ```

5. **Restart the SSO backend** the supervised way (`npm run stop:supervised`, it comes back by itself), in a quiet moment: people
   in the other systems keep their sessions, but a sign-in in progress is interrupted.

6. **Require two factors for DCC.** In the SSO console, as platform administrator: Settings, `mfa.requiredApps`, add `dcc`.
   ([Why](MFA-AND-PASSKEYS.md).)

7. **Make the first DCC group administrator.** In the SSO console grant the application role `dcc-group-admin` for the `dcc`
   application to the Group's DCC administrator. That person becomes a DCC group administrator at their next sign-in, and grants
   every other role inside DCC.

8. **Start DCC and verify, in this order:**

   | Check                                                                    | Expected                                                       |
   | ------------------------------------------------------------------------ | -------------------------------------------------------------- |
   | `https://<host>/dcc/api/health/ready`                                    | `{"status":"ok"}`                                              |
   | Open `https://<host>/dcc` in a browser that is signed out, press sign in | the SSO asks for password **and** the authenticator code       |
   | After sign-in                                                            | the DCC home page; `/dcc/api/me` shows the group administrator |
   | Sign in as a person without the application role                         | signed in, "no role yet"                                       |
   | In the SSO console, disable a test person who is signed in to DCC        | their DCC session ends at once (back-channel logout)           |
   | Grant a role in DCC after waiting 16 minutes                             | DCC asks to sign in again, then the grant works                |
   | Sign out of DCC                                                          | signed out of the SSO as well                                  |

9. **Record** the date, who did it, and the result in the deployment record. Never the secret.

## If something is wrong

| Symptom                                                                                | Cause and fix                                                                                                                                                          |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The SSO does not start after the change                                                | step 3 was skipped: a placeholder or localhost address. Fix the entry; the other systems are down until then                                                           |
| `invalid_redirect_uri` at the SSO                                                      | the address in the SSO differs from DCC's. If the client was registered earlier with other addresses: `npm run client:uris` (dry run), then `-- --apply`, then restart |
| Back to DCC with "Sign-in could not be completed"                                      | read the DCC log line `auth.login_failed`: `mfa_required` (step 6 or the person has no authenticator), `token_exchange_failed` (secret differs), `email_not_verified`  |
| DCC shows the sign-in page again and the log says the identity provider did not answer | `OIDC_INTERNAL_URL` is wrong or the SSO is down                                                                                                                        |
| Disabling a person does not end their DCC session                                      | the back-channel address is wrong, or the DCC backend is not on 7716                                                                                                   |

## Rotating the secret later

New secret (step 1), the SSO entry, DCC's environment file, restart the SSO backend then the DCC backend. People stay signed in
to DCC; only new sign-ins use the new secret. Details for all secrets: [SECRETS-AND-KEYS](../devops/SECRETS-AND-KEYS.md).
