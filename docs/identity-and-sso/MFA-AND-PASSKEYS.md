# Two-factor sign-in and passkeys: the written answer (L-05)

Owner: Dawit (who also owns the SSO). Date: 2026-11-14. This closes backlog task L-05 and risk RK-11.
Every statement below was read from the source of the SSO and of DCC; what was run and what was not is said at the end.

## The short answer

| Question from the proposal                                      | Answer                                                                                                                               |
| --------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Can two-factor sign-in be enforced for everyone who uses DCC?   | **Yes, and it is, twice.** The SSO refuses a DCC sign-in without a second factor, and DCC itself refuses one as well.                |
| Is it enforced for 100% of DCC users, not only privileged ones? | **Yes.** There is no DCC role that signs in without it. "100% two-factor" is true by construction, not by counting.                  |
| Passkeys for privileged roles?                                  | **Not available.** The SSO has no passkey (WebAuthn) support today. The second factor is an authenticator app (one-time codes).      |
| Is a second factor asked again before a sensitive action?       | **Yes** ([re-authentication](INTEGRATION.md#re-authentication-for-sensitive-actions)): a sign-in no older than 15 minutes is needed. |

## How it works

**Lock 1, in the SSO.** The SSO has a platform setting, `mfa.requiredApps`: the list of applications whose sign-in needs a second
factor. `dcc` is in that list on the development SSO and on the mirror SSO. For a listed application:

- a person with an authenticator app enrolled signs in with password and code, and the identity token says `amr: ["pwd","otp","mfa"]`;
- a person without one is refused, with the message to turn it on under Portal > Security;
- a person who still has an SSO session made with a password only is sent through sign-in again, so an old password-only session
  cannot walk into DCC;
- if the SSO cannot read the setting, it treats the second factor as required (it fails closed).

Only a platform administrator of the SSO can change that list.

**Lock 2, in DCC.** DCC reads the `amr` claim of every identity token and refuses a sign-in that does not contain `mfa`
(reason code `mfa_required` in the audit trail). This is on by default in production and on the mirror, and
`DCC_REQUIRE_MFA=false` makes the production API refuse to start. So DCC does not depend on a setting that lives in another system.

**Why two locks.** Either one alone can be undone by one person in one place. With both, turning two-factor off for DCC needs a
change in the SSO console **and** a change of the DCC server configuration that the API itself refuses.

## What follows for the project

- The proposal's promise "100% MFA for DCC users" can be made. Wording to use: "every DCC sign-in uses two factors: password and an
  authenticator app code".
- **Do not promise passkeys.** If the Group wants them, it is a change to the SSO (a new sign-in method for every system, not only
  DCC), to be planned in the SSO's own programme. DCC needs no change for it: a passkey sign-in would still arrive with `mfa`.
- Every person must enrol an authenticator app in the SSO portal **before** their first DCC sign-in. This is step 1 of the
  [company onboarding checklist](../rollout/COMPANY-ONBOARDING-CHECKLIST.md) and of the training.
- A lost phone is handled in the SSO (recovery codes, or an SSO administrator resets the second factor). DCC has nothing to reset.

## What was run, and what was not

| Check                                                                                     | State                                                                                        |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| DCC refuses an identity token without `mfa`                                               | unit-tested (`platform.test.ts`)                                                             |
| Production configuration refuses `DCC_REQUIRE_MFA=false`                                  | unit-tested                                                                                  |
| The SSO's rule for listed applications, including the old-session case and failing closed | read in the SSO source (`auth/mfa-policy.ts`, `oidc/provider.ts`); the SSO has its own tests |
| `dcc` is in `mfa.requiredApps` on the development and mirror SSO                          | set on 2026-11-11                                                                            |
| **A full sign-in to DCC through the SSO with an authenticator code, in a browser**        | **not run yet.** It needs the SSO running and a test person with an authenticator app.       |
| The same on the live SSO                                                                  | not done: DCC is not deployed, and `dcc` is not registered on the live SSO                   |

The one open item is the browser run. It is test 1 of the [integration test plan](../testing/INTEGRATION-TEST-PLAN.md) and must
pass on the test server before milestone M3.
