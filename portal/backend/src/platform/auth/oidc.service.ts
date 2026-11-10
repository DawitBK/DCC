import { createHash, randomBytes } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import * as client from 'openid-client';
import { createRemoteJWKSet, customFetch as joseCustomFetch, jwtVerify } from 'jose';
import { APP_CONFIG, type AppConfig } from '../../config/env';
import { DATABASE, type Database } from '../database/database';

export class LoginError extends Error {
  constructor(
    message: string,
    readonly reason: string,
  ) {
    super(message);
  }
}

export interface LoginResult {
  subject: string;
  email: string;
  name: string;
  idToken: string;
  sid?: string;
  /** undefined = the claim was absent (unknown), NOT "no roles". */
  appRoles?: string[];
  returnTo: string;
}

const sha256 = (v: string) => createHash('sha256').update(v).digest('hex');
const LOGIN_TTL_MS = 10 * 60_000;

/**
 * Server-to-server calls to the IdP may use an internal address. The IdP may sit behind a path on the public address
 * (mirror and production: https://host/sso) while its own server answers at the root of the internal address. Calls to
 * either address go to the internal one, minus that path. With no internal address nothing changes.
 */
export function toInternalUrl(
  url: string,
  issuerUrl: string,
  internalUrl: string | undefined,
): string {
  if (!internalUrl) return url;
  const issuer = new URL(issuerUrl);
  const issuerPath = issuer.pathname.endsWith('/') ? issuer.pathname.slice(0, -1) : issuer.pathname;
  const target = new URL(url);
  if (target.origin !== issuer.origin && target.origin !== new URL(internalUrl).origin) return url;
  let path = target.pathname;
  if (issuerPath && (path === issuerPath || path.startsWith(`${issuerPath}/`)))
    path = path.slice(issuerPath.length);
  let base = internalUrl;
  while (base.endsWith('/')) base = base.slice(0, -1);
  return `${base}${path}${target.search}`;
}

/** RFC 8176 `amr`: a sign-in that used more than one factor carries the value `mfa`. */
export function hasMfa(amr: unknown): boolean {
  return Array.isArray(amr) && amr.includes('mfa');
}

/** Only same-site relative paths: blocks open redirects through ?returnTo=. */
export function safeReturnTo(value: unknown): string {
  if (typeof value !== 'string') return '/';
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/';
  return value.slice(0, 500);
}

/**
 * OIDC authorization-code flow with PKCE against the existing Kerchanshe IdP, using the maintained
 * `openid-client` library (it validates the id_token signature against the IdP's JWKS, issuer,
 * audience, expiry, nonce and state). On top of that DCC requires `email_verified === true`
 * (SSO integration guide section 11) and consumes the login attempt exactly once.
 */
@Injectable()
export class OidcService {
  private configPromise?: Promise<client.Configuration>;

  constructor(
    @Inject(APP_CONFIG) private readonly cfg: AppConfig,
    @Inject(DATABASE) private readonly database: Database,
  ) {}

  /** Server-to-server calls may use an internal address for the IdP; the browser keeps the public issuer. */
  private readonly serverFetch = (url: string, options: RequestInit): Promise<Response> => {
    url = toInternalUrl(url, this.cfg.OIDC_ISSUER, this.cfg.OIDC_INTERNAL_URL);
    return fetch(url, options);
  };

  /**
   * Endpoints the BROWSER is sent to (authorize, end-session) must be on the public issuer, even when
   * discovery was fetched from the internal address (the IdP builds endpoint URLs from the host it was
   * asked on). Without this the browser would be sent to the IdP's internal port, and the SSO session
   * cookie, which lives on the issuer's origin, would not be seen.
   */
  private toPublic(endpoint: string | undefined): string | undefined {
    const internal = this.cfg.OIDC_INTERNAL_URL;
    if (!endpoint || !internal) return endpoint;
    const internalOrigin = new URL(internal).origin;
    return endpoint.startsWith(internalOrigin)
      ? new URL(this.cfg.OIDC_ISSUER).origin + endpoint.slice(internalOrigin.length)
      : endpoint;
  }

  private getConfiguration(): Promise<client.Configuration> {
    this.configPromise ??= client
      .discovery(
        new URL(this.cfg.OIDC_ISSUER),
        this.cfg.OIDC_CLIENT_ID,
        undefined,
        client.ClientSecretPost(this.cfg.OIDC_CLIENT_SECRET),
        {
          execute: this.cfg.isProduction ? [] : [client.allowInsecureRequests],
          [client.customFetch]: this.serverFetch,
        },
      )
      .then((discovered) => {
        const meta = { ...discovered.serverMetadata() };
        meta.authorization_endpoint = this.toPublic(meta.authorization_endpoint);
        meta.end_session_endpoint = this.toPublic(meta.end_session_endpoint);
        const c = new client.Configuration(
          meta,
          this.cfg.OIDC_CLIENT_ID,
          undefined,
          client.ClientSecretPost(this.cfg.OIDC_CLIENT_SECRET),
        );
        c[client.customFetch] = this.serverFetch;
        if (!this.cfg.isProduction) client.allowInsecureRequests(c);
        return c;
      })
      .catch((error) => {
        this.configPromise = undefined; // retry on the next login rather than caching the failure
        throw error;
      });
    return this.configPromise;
  }

  async beginLogin(returnTo: unknown): Promise<string> {
    const configuration = await this.getConfiguration();
    const state = client.randomState();
    const nonce = client.randomNonce();
    const codeVerifier = client.randomPKCECodeVerifier();
    const codeChallenge = await client.calculatePKCECodeChallenge(codeVerifier);

    await this.database.db
      .insertInto('auth_transactions')
      .values({
        state_hash: sha256(state),
        nonce,
        code_verifier: codeVerifier,
        return_to: safeReturnTo(returnTo),
        expires_at: new Date(Date.now() + LOGIN_TTL_MS),
      })
      .execute();

    return client.buildAuthorizationUrl(configuration, {
      redirect_uri: this.cfg.OIDC_REDIRECT_URI,
      scope: this.cfg.OIDC_SCOPES,
      state,
      nonce,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    }).href;
  }

  async completeLogin(callbackQuery: URLSearchParams): Promise<LoginResult> {
    if (callbackQuery.get('error'))
      throw new LoginError('The identity provider returned an error.', 'idp_error');
    const state = callbackQuery.get('state');
    if (!state) throw new LoginError('Missing state.', 'missing_state');

    // Single use: the row is deleted as it is read, so a replayed callback finds nothing.
    const tx = await this.database.db
      .deleteFrom('auth_transactions')
      .where('state_hash', '=', sha256(state))
      .where('expires_at', '>', new Date())
      .returning(['nonce', 'code_verifier', 'return_to'])
      .executeTakeFirst();
    if (!tx) throw new LoginError('Unknown or expired login attempt.', 'unknown_state');

    const configuration = await this.getConfiguration();
    const currentUrl = new URL(this.cfg.OIDC_REDIRECT_URI);
    currentUrl.search = callbackQuery.toString();

    let tokens: Awaited<ReturnType<typeof client.authorizationCodeGrant>>;
    try {
      tokens = await client.authorizationCodeGrant(configuration, currentUrl, {
        pkceCodeVerifier: tx.code_verifier,
        expectedNonce: tx.nonce,
        expectedState: state,
        idTokenExpected: true,
      });
    } catch (error) {
      throw new LoginError(
        'The sign-in could not be verified.',
        `token_exchange_failed:${(error as Error).name}`,
      );
    }

    const claims = tokens.claims();
    if (!claims || !tokens.id_token) throw new LoginError('No identity token.', 'no_id_token');
    if (claims.email_verified !== true)
      throw new LoginError('The email address is not verified.', 'email_not_verified');
    if (typeof claims.email !== 'string' || !claims.email)
      throw new LoginError('No email in the identity token.', 'no_email');

    if (this.cfg.requireMfa && !hasMfa(claims.amr))
      throw new LoginError(
        'Two-factor sign-in is required for DCC. Turn it on in the SSO portal under Security, then sign in again.',
        'mfa_required',
      );

    const rolesClaim = claims[this.cfg.OIDC_APP_ROLES_CLAIM];
    return {
      subject: claims.sub,
      email: claims.email.toLowerCase(),
      name: typeof claims.name === 'string' ? claims.name : '',
      idToken: tokens.id_token,
      sid: typeof claims.sid === 'string' ? claims.sid : undefined,
      appRoles: Array.isArray(rolesClaim)
        ? rolesClaim.filter((r): r is string => typeof r === 'string')
        : undefined,
      returnTo: tx.return_to,
    };
  }

  async endSessionUrl(idTokenHint: string | null): Promise<string | null> {
    const configuration = await this.getConfiguration();
    if (!configuration.serverMetadata().end_session_endpoint) return null;
    const params: Record<string, string> = {
      post_logout_redirect_uri: this.cfg.OIDC_POST_LOGOUT_URI,
    };
    if (idTokenHint) params.id_token_hint = idTokenHint;
    return client.buildEndSessionUrl(configuration, params).href;
  }

  /**
   * OIDC back-channel logout (SSO guide section 10): verify the signed logout token, then the caller ends
   * the person's sessions. Returns the subject or sid to end.
   */
  async verifyLogoutToken(token: string): Promise<{ sub?: string; sid?: string }> {
    const configuration = await this.getConfiguration();
    const meta = configuration.serverMetadata();
    if (!meta.jwks_uri) throw new LoginError('No JWKS.', 'no_jwks');
    const jwks = createRemoteJWKSet(new URL(meta.jwks_uri), {
      [joseCustomFetch]: this.serverFetch,
    });
    const { payload } = await jwtVerify(token, jwks, {
      issuer: meta.issuer,
      audience: this.cfg.OIDC_CLIENT_ID,
    });
    const events = payload.events as Record<string, unknown> | undefined;
    if (!events || !('http://schemas.openid.net/event/backchannel-logout' in events))
      throw new LoginError('Not a logout token.', 'no_logout_event');
    if ('nonce' in payload)
      throw new LoginError('A logout token must not carry a nonce.', 'nonce_present');
    const sub = typeof payload.sub === 'string' ? payload.sub : undefined;
    const sid = typeof payload.sid === 'string' ? payload.sid : undefined;
    if (!sub && !sid)
      throw new LoginError('Logout token names no subject or session.', 'no_subject');
    return { sub, sid };
  }
}

export const newOpaqueId = () => randomBytes(32).toString('base64url');
