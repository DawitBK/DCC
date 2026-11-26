import type { AlertChannel, AlertChannelStatusDto, AlertStatusDto } from '@dcc/contracts';

/**
 * Alert channel configuration (Round 3, RQ-029). EVERYTHING here comes from environment variables: no address,
 * token or password is ever stored in the database or the repository, and none is ever logged, audited or returned
 * by the API (the status route answers booleans and a fixed reason code only).
 *
 * A channel with no configuration is NOT CONFIGURED: it creates no delivery, and the screen says so.
 *
 *   Teams   DCC_TEAMS_WEBHOOK_URL         a Teams incoming-webhook address (Workflows "when a webhook request is received").
 *                                         DCC posts one Adaptive Card message: `{"type":"message","attachments":[{
 *                                         "contentType":"application/vnd.microsoft.card.adaptive","content":{...}}]}`.
 *
 *   SMS     DCC_SMS_GATEWAY_URL           an HTTPS address that accepts   POST  with  Content-Type: application/json
 *           DCC_SMS_GATEWAY_TOKEN         and  Authorization: Bearer <token>  and the body
 *                                             { "to": "+251911234567", "text": "..." }
 *                                         `to` is the number in international form, `text` is plain text under 300
 *                                         characters. Any 2xx answer means "accepted"; anything else (or no answer within
 *                                         10 seconds) is a failure and is retried. IT points this at the SMS provider's
 *                                         API or at a small relay that translates this body into the provider's call.
 *
 *   E-mail  DCC_SMTP_HOST, DCC_SMTP_PORT, DCC_SMTP_FROM          required
 *           DCC_SMTP_USER, DCC_SMTP_PASSWORD                      optional pair (AUTH PLAIN or LOGIN)
 *           DCC_SMTP_SECURE = starttls | tls | none               default starttls (tls = implicit TLS, usually port 465)
 *
 * In production (NODE_ENV=production, or DCC_ENVIRONMENT production or mirror) an `http://` gateway or webhook is
 * refused, and so is `DCC_SMTP_SECURE=none` together with a user name and password (the password would travel in
 * clear text). `http://127.0.0.1` and `http://localhost` stay allowed in development and in tests.
 */

export interface TeamsConfig {
  url: string;
}
export interface SmsConfig {
  url: string;
  token: string;
}
export interface EmailConfig {
  host: string;
  port: number;
  from: string;
  secure: 'starttls' | 'tls' | 'none';
  user: string | null;
  password: string | null;
}

export interface AlertConfig {
  teams: TeamsConfig | null;
  sms: SmsConfig | null;
  email: EmailConfig | null;
  status: AlertStatusDto;
}

type Env = Record<string, string | undefined>;

const isProductionLike = (env: Env): boolean =>
  env.NODE_ENV === 'production' ||
  env.DCC_ENVIRONMENT === 'production' ||
  env.DCC_ENVIRONMENT === 'mirror';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);

type UrlCheck = 'ok' | 'incomplete' | 'insecure';

/** https always; http only for a loopback address, and never in production. */
const checkUrl = (value: string, env: Env): UrlCheck => {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'incomplete';
  }
  if (url.protocol === 'https:') return 'ok';
  if (url.protocol === 'http:' && !isProductionLike(env) && LOOPBACK.has(url.hostname)) return 'ok';
  return url.protocol === 'http:' ? 'insecure' : 'incomplete';
};

const off = (reason: AlertChannelStatusDto['reason']): AlertChannelStatusDto => ({
  configured: false,
  reason,
});
const on: AlertChannelStatusDto = { configured: true, reason: 'ok' };
const clean = (value: string | undefined): string => (value ?? '').trim();

export function readAlertConfig(env: Env = process.env): AlertConfig {
  // Teams
  let teams: TeamsConfig | null = null;
  let teamsStatus = off('not_set');
  const teamsUrl = clean(env.DCC_TEAMS_WEBHOOK_URL);
  if (teamsUrl) {
    const check = checkUrl(teamsUrl, env);
    if (check === 'ok') {
      teams = { url: teamsUrl };
      teamsStatus = on;
    } else teamsStatus = off(check);
  }

  // SMS
  let sms: SmsConfig | null = null;
  let smsStatus = off('not_set');
  const smsUrl = clean(env.DCC_SMS_GATEWAY_URL);
  const smsToken = clean(env.DCC_SMS_GATEWAY_TOKEN);
  if (smsUrl || smsToken) {
    if (!smsUrl || !smsToken) smsStatus = off('incomplete');
    else {
      const check = checkUrl(smsUrl, env);
      if (check === 'ok') {
        sms = { url: smsUrl, token: smsToken };
        smsStatus = on;
      } else smsStatus = off(check);
    }
  }

  // E-mail
  let email: EmailConfig | null = null;
  let emailStatus = off('not_set');
  const host = clean(env.DCC_SMTP_HOST);
  const from = clean(env.DCC_SMTP_FROM);
  const portText = clean(env.DCC_SMTP_PORT);
  const user = clean(env.DCC_SMTP_USER);
  const password = env.DCC_SMTP_PASSWORD ?? '';
  const secureText = clean(env.DCC_SMTP_SECURE).toLowerCase() || 'starttls';
  if (host || from || portText || user || password) {
    const port = Number(portText);
    const secure = (['starttls', 'tls', 'none'] as const).find((s) => s === secureText);
    const portOk = Number.isInteger(port) && port > 0 && port < 65536;
    const authHalf = (user === '') !== (password === '');
    if (!host || !from || !portOk || !secure || authHalf || !/^[^\s<>@]+@[^\s<>@]+$/.test(from))
      emailStatus = off('incomplete');
    else if (secure === 'none' && user !== '' && isProductionLike(env))
      emailStatus = off('insecure');
    else {
      email = {
        host,
        port,
        from,
        secure,
        user: user || null,
        password: user ? password : null,
      };
      emailStatus = on;
    }
  }

  return { teams, sms, email, status: { teams: teamsStatus, sms: smsStatus, email: emailStatus } };
}

export const isChannelConfigured = (config: AlertConfig, channel: AlertChannel): boolean =>
  config[channel] !== null;
