import type { AlertChannel } from '@dcc/contracts';
import type { AlertConfig, EmailConfig, SmsConfig, TeamsConfig } from './alert-config';
import { sendMail, SmtpError, type SmtpOptions } from './smtp-client';

/** What went wrong with a send, in words that are safe to store and show: never an address, a token or a password. */
export class AlertSendError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AlertSendError';
  }
}

export interface OutgoingAlert {
  subject: string;
  /** The text; for Teams it is the card, as JSON text (see `composeAlert`). */
  body: string;
}

const HTTP_TIMEOUT_MS = 10_000;

export interface TransportOptions {
  httpTimeoutMs?: number;
  smtp?: Pick<SmtpOptions, 'timeoutMs' | 'tlsOptions' | 'clientName'>;
}

/** A failed fetch without the address in it (the URL of a Teams webhook is itself a secret). */
const networkProblem = (error: unknown): string => {
  const name = (error as Error | undefined)?.name;
  if (name === 'TimeoutError' || name === 'AbortError') return 'No answer within the time allowed.';
  const code = ((error as { cause?: { code?: string } })?.cause?.code ?? '').toString();
  return code ? `The service could not be reached (${code}).` : 'The service could not be reached.';
};

async function postJson(
  url: string,
  payload: unknown,
  headers: Record<string, string>,
  timeoutMs: number,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: 'POST',
      redirect: 'error',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new AlertSendError(networkProblem(error));
  }
  // Drain the body so the connection is released; its text is not kept (a service may echo what it received).
  await response.arrayBuffer().catch(() => undefined);
  if (!response.ok)
    throw new AlertSendError(`The service answered with an error (HTTP ${response.status}).`);
}

export const sendTeams = (
  config: TeamsConfig,
  alert: OutgoingAlert,
  options: TransportOptions = {},
): Promise<void> => {
  let card: unknown;
  try {
    card = JSON.parse(alert.body);
  } catch {
    return Promise.reject(new AlertSendError('The Teams message is not valid.'));
  }
  return postJson(config.url, card, {}, options.httpTimeoutMs ?? HTTP_TIMEOUT_MS);
};

/** POST { to, text } with a bearer token: the gateway contract documented in alert-config.ts. */
export const sendSms = (
  config: SmsConfig,
  to: string,
  alert: OutgoingAlert,
  options: TransportOptions = {},
): Promise<void> =>
  postJson(
    config.url,
    { to, text: alert.body },
    { authorization: `Bearer ${config.token}` },
    options.httpTimeoutMs ?? HTTP_TIMEOUT_MS,
  );

export async function sendEmail(
  config: EmailConfig,
  to: string,
  alert: OutgoingAlert,
  options: TransportOptions = {},
): Promise<void> {
  try {
    await sendMail(
      { ...config, ...options.smtp, clientName: options.smtp?.clientName ?? 'dcc.local' },
      { to, subject: alert.subject, text: alert.body },
    );
  } catch (error) {
    if (error instanceof SmtpError) throw new AlertSendError(error.message);
    throw new AlertSendError('The mail could not be sent.');
  }
}

/** One entry point per channel; `target` is the number (sms) or the address (email), unused for Teams. */
export async function deliver(
  config: AlertConfig,
  channel: AlertChannel,
  target: string | null,
  alert: OutgoingAlert,
  options: TransportOptions = {},
): Promise<void> {
  if (channel === 'teams') {
    if (!config.teams) throw new AlertSendError('Teams is not configured.');
    return sendTeams(config.teams, alert, options);
  }
  if (channel === 'sms') {
    if (!config.sms) throw new AlertSendError('SMS is not configured.');
    if (!target) throw new AlertSendError('The person has no mobile number.');
    return sendSms(config.sms, target, alert, options);
  }
  if (!config.email) throw new AlertSendError('E-mail is not configured.');
  if (!target) throw new AlertSendError('The person has no e-mail address.');
  return sendEmail(config.email, target, alert, options);
}
