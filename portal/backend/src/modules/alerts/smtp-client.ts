import { randomUUID } from 'node:crypto';
import net from 'node:net';
import tls from 'node:tls';

/**
 * A small SMTP client on node:net and node:tls (Round 3: no new dependency). One message per connection:
 * greeting, EHLO, STARTTLS (when asked for; never silently skipped), AUTH PLAIN or LOGIN, MAIL FROM, RCPT TO,
 * DATA with dot-stuffing and CRLF line ends, QUIT. Any 4xx or 5xx answer rejects with a message that names the step and
 * the server's code, never what we sent: the password is never part of any error, log line or message.
 */

export interface SmtpSettings {
  host: string;
  port: number;
  secure: 'starttls' | 'tls' | 'none';
  user: string | null;
  password: string | null;
  from: string;
}

export interface SmtpOptions extends SmtpSettings {
  /** Idle time allowed on the connection. Default 10 seconds. */
  timeoutMs?: number;
  /** Extra TLS options (tests give their own certificate authority). Certificates are always checked. */
  tlsOptions?: tls.ConnectionOptions;
  /** The name we give in EHLO. */
  clientName?: string;
}

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
}

export class SmtpError extends Error {
  constructor(
    message: string,
    readonly code?: number,
  ) {
    super(message);
    this.name = 'SmtpError';
  }
}

interface Reply {
  code: number;
  lines: string[];
}

const ADDRESS = /^[^\s<>"',;]+@[^\s<>"',;]+$/;

/** A network error without the address (the message of a socket error carries host and port). */
const connectionProblem = (error: Error): string => {
  const code = (error as NodeJS.ErrnoException).code;
  if (code === 'ECONNREFUSED') return 'The mail server refused the connection.';
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN') return 'The mail server address was not found.';
  if (code === 'ETIMEDOUT') return 'The connection to the mail server timed out.';
  if (code === 'ECONNRESET') return 'The mail server dropped the connection.';
  if (
    code === 'DEPTH_ZERO_SELF_SIGNED_CERT' ||
    code === 'SELF_SIGNED_CERT_IN_CHAIN' ||
    code === 'UNABLE_TO_VERIFY_LEAF_SIGNATURE' ||
    code === 'CERT_HAS_EXPIRED' ||
    code === 'ERR_TLS_CERT_ALTNAME_INVALID'
  )
    return "The mail server's certificate was not accepted.";
  return `The connection to the mail server failed${code ? ` (${code})` : ''}.`;
};

/** Reads the server's answers (one or several lines, `250-more` then `250 last`) from one socket. */
class Dialogue {
  private buffer = '';
  private lines: string[] = [];
  private readonly ready: Reply[] = [];
  private waiting: { resolve: (r: Reply) => void; reject: (e: Error) => void } | null = null;
  private failure: Error | null = null;

  constructor(readonly socket: net.Socket) {
    socket.setEncoding('utf8');
    socket.on('data', this.onData);
    socket.on('error', this.onError);
    socket.on('close', this.onClose);
    socket.on('timeout', this.onTimeout);
  }

  private onData = (chunk: string) => {
    this.buffer += chunk;
    let at: number;
    while ((at = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, at).replace(/\r$/, '');
      this.buffer = this.buffer.slice(at + 1);
      this.lines.push(line);
      const match = /^(\d{3})([ -]?)/.exec(line);
      if (!match) {
        this.fail(new SmtpError('The mail server sent an answer that is not SMTP.'));
        return;
      }
      if (match[2] !== '-') {
        const reply = { code: Number(match[1]), lines: this.lines };
        this.lines = [];
        if (this.waiting) {
          const w = this.waiting;
          this.waiting = null;
          w.resolve(reply);
        } else this.ready.push(reply);
      }
    }
  };
  private onError = (error: Error) => this.fail(new SmtpError(connectionProblem(error)));
  private onClose = () => this.fail(new SmtpError('The mail server closed the connection.'));
  private onTimeout = () => {
    this.fail(new SmtpError('The mail server did not answer in time.'));
    this.socket.destroy();
  };

  private fail(error: Error) {
    if (this.failure) return;
    this.failure = error;
    if (this.waiting) {
      const w = this.waiting;
      this.waiting = null;
      w.reject(error);
    }
  }

  /** Stops listening (before the connection is upgraded to TLS). Returns what was read but not yet used. */
  detach(): string {
    this.socket.off('data', this.onData);
    this.socket.off('error', this.onError);
    this.socket.off('close', this.onClose);
    this.socket.off('timeout', this.onTimeout);
    return this.buffer;
  }

  read(): Promise<Reply> {
    const next = this.ready.shift();
    if (next) return Promise.resolve(next);
    if (this.failure) return Promise.reject(this.failure);
    return new Promise((resolve, reject) => {
      this.waiting = { resolve, reject };
    });
  }

  write(text: string) {
    this.socket.write(text);
  }
}

const expectReply = (reply: Reply, ok: readonly number[], step: string): Reply => {
  if (ok.includes(reply.code)) return reply;
  const text = reply.lines
    .map((l) => l.slice(4))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 120);
  throw new SmtpError(
    `The mail server refused ${step} (${reply.code}${text ? `: ${text}` : ''}).`,
    reply.code,
  );
};

/** Headers must never be split by user text. */
const oneLine = (text: string): string => text.replace(/[\r\n]+/g, ' ').trim();

const isAscii = (text: string): boolean => /^[\x20-\x7e]*$/.test(text);

/** RFC 2047 encoded words, each at most 45 bytes of text so a word stays under 76 characters. */
const encodeHeader = (text: string): string => {
  const value = oneLine(text);
  if (isAscii(value)) return value;
  const words: string[] = [];
  let current = '';
  for (const char of value) {
    if (Buffer.byteLength(current + char) > 45) {
      words.push(current);
      current = '';
    }
    current += char;
  }
  if (current) words.push(current);
  return words.map((w) => `=?UTF-8?B?${Buffer.from(w, 'utf8').toString('base64')}?=`).join('\r\n ');
};

/** Lines that begin with a dot gain a second dot, so the server does not take them for the end of the message. */
export const dotStuff = (data: string): string => data.replace(/(^|\r\n)\./g, '$1..');

/** The complete message as it goes after DATA (without the final `.` line). */
export function buildMessage(from: string, message: MailMessage, now: Date = new Date()): string {
  const domain = from.split('@')[1] ?? 'localhost';
  const text = message.text.replace(/\r\n|\r|\n/g, '\r\n');
  const ascii = isAscii(text.replace(/\r\n/g, ''));
  const body = ascii
    ? text
    : (
        Buffer.from(text, 'utf8')
          .toString('base64')
          .match(/.{1,76}/g) ?? []
      ).join('\r\n');
  const headers = [
    `From: ${from}`,
    `To: ${message.to}`,
    `Subject: ${encodeHeader(message.subject)}`,
    `Date: ${now.toUTCString()}`,
    `Message-ID: <${randomUUID()}@${domain}>`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    `Content-Transfer-Encoding: ${ascii ? '7bit' : 'base64'}`,
  ];
  return `${headers.join('\r\n')}\r\n\r\n${body}`;
}

function connect(options: SmtpOptions, timeoutMs: number): Promise<net.Socket> {
  return new Promise((resolve, reject) => {
    const implicit = options.secure === 'tls';
    const socket = implicit
      ? tls.connect({
          host: options.host,
          port: options.port,
          servername: net.isIP(options.host) ? undefined : options.host,
          ...options.tlsOptions,
        })
      : net.connect({ host: options.host, port: options.port });
    const failed = (error: Error) => reject(new SmtpError(connectionProblem(error)));
    socket.once('error', failed);
    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new SmtpError('The mail server did not answer in time.'));
    });
    socket.once(implicit ? 'secureConnect' : 'connect', () => {
      socket.off('error', failed);
      resolve(socket);
    });
  });
}

/** Sends one message. Resolves when the server accepted it; rejects with an SmtpError otherwise. */
export async function sendMail(options: SmtpOptions, message: MailMessage): Promise<void> {
  if (!ADDRESS.test(message.to)) throw new SmtpError('The recipient address is not valid.');
  if (!ADDRESS.test(options.from)) throw new SmtpError('The sender address is not valid.');
  const timeoutMs = options.timeoutMs ?? 10_000;
  const name = options.clientName?.replace(/[^A-Za-z0-9.\-[\]:]/g, '') || 'dcc.local';

  let socket = await connect(options, timeoutMs);
  let dialogue = new Dialogue(socket);
  try {
    expectReply(await dialogue.read(), [220], 'the connection');
    const hello = async () => {
      dialogue.write(`EHLO ${name}\r\n`);
      return expectReply(await dialogue.read(), [250], 'the greeting (EHLO)').lines.map((l) =>
        l.slice(4).toUpperCase(),
      );
    };
    let capabilities = await hello();

    if (options.secure === 'starttls') {
      if (!capabilities.includes('STARTTLS'))
        throw new SmtpError('The mail server does not offer STARTTLS, so nothing was sent.');
      dialogue.write('STARTTLS\r\n');
      expectReply(await dialogue.read(), [220], 'STARTTLS');
      if (dialogue.detach() !== '')
        throw new SmtpError('The mail server sent unexpected data during STARTTLS.');
      const upgraded = tls.connect({
        socket,
        servername: net.isIP(options.host) ? undefined : options.host,
        ...options.tlsOptions,
      });
      await new Promise<void>((resolve, reject) => {
        upgraded.once('secureConnect', resolve);
        upgraded.once('error', (e) => reject(new SmtpError(connectionProblem(e))));
      });
      upgraded.setTimeout(timeoutMs);
      socket = upgraded;
      dialogue = new Dialogue(socket);
      capabilities = await hello();
    }

    if (options.user !== null && options.password !== null) {
      const methods = capabilities
        .filter((l) => l.startsWith('AUTH ') || l.startsWith('AUTH='))
        .flatMap((l) => l.slice(5).split(/\s+/));
      if (methods.includes('PLAIN')) {
        const token = Buffer.from(`\0${options.user}\0${options.password}`, 'utf8').toString(
          'base64',
        );
        dialogue.write(`AUTH PLAIN ${token}\r\n`);
        expectReply(await dialogue.read(), [235], 'the sign-in (AUTH PLAIN)');
      } else if (methods.includes('LOGIN')) {
        dialogue.write('AUTH LOGIN\r\n');
        expectReply(await dialogue.read(), [334], 'the sign-in (AUTH LOGIN)');
        dialogue.write(`${Buffer.from(options.user, 'utf8').toString('base64')}\r\n`);
        expectReply(await dialogue.read(), [334], 'the sign-in (user name)');
        dialogue.write(`${Buffer.from(options.password, 'utf8').toString('base64')}\r\n`);
        expectReply(await dialogue.read(), [235], 'the sign-in (AUTH LOGIN)');
      } else
        throw new SmtpError(
          'The mail server offers no sign-in method we support (PLAIN or LOGIN).',
        );
    }

    dialogue.write(`MAIL FROM:<${options.from}>\r\n`);
    expectReply(await dialogue.read(), [250], 'the sender (MAIL FROM)');
    dialogue.write(`RCPT TO:<${message.to}>\r\n`);
    expectReply(await dialogue.read(), [250, 251], 'the recipient (RCPT TO)');
    dialogue.write('DATA\r\n');
    expectReply(await dialogue.read(), [354], 'the message (DATA)');
    dialogue.write(`${dotStuff(buildMessage(options.from, message))}\r\n.\r\n`);
    expectReply(await dialogue.read(), [250], 'the message text');

    dialogue.write('QUIT\r\n');
    await dialogue.read().catch(() => undefined);
  } finally {
    socket.destroy();
  }
}
