import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import tls from 'node:tls';

/**
 * Fake servers for the alert channels (Round 3): a local HTTP server that plays the SMS gateway and the Teams
 * webhook, and a local SMTP server. They record exactly what they receive, so a test can say what went over the wire.
 */

/** Ports that fetch() refuses to call (the Fetch standard's "bad ports"); see test/helpers.ts. */
const BLOCKED = new Set([
  1719, 1720, 1723, 2049, 3659, 4045, 4190, 5060, 5061, 6000, 6566, 6665, 6666, 6667, 6668, 6669,
  6679, 6697, 10080,
]);

async function listenOnGoodPort(
  server: http.Server | net.Server,
  host = '127.0.0.1',
): Promise<number> {
  for (let tries = 0; tries < 20; tries++) {
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, host, () => {
        server.off('error', reject);
        resolve((server.address() as net.AddressInfo).port);
      });
    });
    if (!BLOCKED.has(port)) return port;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  throw new Error('No usable free port.');
}

export interface RecordedRequest {
  method: string;
  url: string;
  headers: http.IncomingHttpHeaders;
  body: string;
  json: any;
}

export interface FakeHttp {
  url: string;
  requests: RecordedRequest[];
  /** What to answer next: a status code, or a function of the request number (1 = first). Default 200. */
  respond: (status: number | ((n: number) => number)) => void;
  /** Wait this long before answering (to provoke a timeout). 0 = answer at once. */
  delay: (ms: number) => void;
  reset: () => void;
  close: () => Promise<void>;
}

export async function startFakeHttp(): Promise<FakeHttp> {
  const requests: RecordedRequest[] = [];
  let status: number | ((n: number) => number) = 200;
  let delayMs = 0;
  const sockets = new Set<net.Socket>();
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      let json: unknown = null;
      try {
        json = JSON.parse(body);
      } catch {
        /* not JSON */
      }
      requests.push({
        method: req.method ?? '',
        url: req.url ?? '',
        headers: req.headers,
        body,
        json,
      });
      const code = typeof status === 'function' ? status(requests.length) : status;
      setTimeout(() => {
        if (res.destroyed) return;
        res.statusCode = code;
        res.end('ok');
      }, delayMs);
    });
  });
  server.on('connection', (s) => {
    sockets.add(s);
    s.on('close', () => sockets.delete(s));
  });
  const port = await listenOnGoodPort(server);
  return {
    url: `http://127.0.0.1:${port}/hook`,
    requests,
    respond: (s) => {
      status = s;
    },
    delay: (ms) => {
      delayMs = ms;
    },
    reset: () => {
      requests.length = 0;
      status = 200;
      delayMs = 0;
    },
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------------------------------
// SMTP

export interface FakeSmtpOptions {
  /** Offer STARTTLS (needs `tlsMaterial`). */
  starttls?: boolean;
  /** Implicit TLS from the first byte (needs `tlsMaterial`). */
  implicitTls?: boolean;
  tlsMaterial?: { key: string; cert: string };
  /** AUTH mechanisms to advertise. */
  auth?: ('PLAIN' | 'LOGIN')[];
  /** Only accept AUTH after STARTTLS (as real servers do). */
  authOnlyAfterTls?: boolean;
  credentials?: { user: string; password: string };
  /** Refuse at this step with this reply line, for example `{ at: 'RCPT', reply: '550 No such user' }`. */
  refuse?: { at: 'GREETING' | 'MAIL' | 'RCPT' | 'DATA' | 'END'; reply: string };
  /** Never answer after the greeting (to provoke a timeout). */
  silent?: boolean;
}

export interface SmtpMessage {
  from: string;
  to: string[];
  /** The text between DATA and the end marker, with the dot-stuffing removed. */
  data: string;
  /** The same text exactly as it went over the wire. */
  raw: string;
}

export interface FakeSmtp {
  port: number;
  /** Every command line received, in order (AUTH payloads are replaced by `<hidden>`). */
  commands: string[];
  messages: SmtpMessage[];
  /** Credentials presented (decoded). */
  logins: { user: string; password: string; mechanism: string }[];
  reset: () => void;
  close: () => Promise<void>;
}

export async function startFakeSmtp(options: FakeSmtpOptions = {}): Promise<FakeSmtp> {
  const commands: string[] = [];
  const messages: SmtpMessage[] = [];
  const logins: FakeSmtp['logins'] = [];
  const sockets = new Set<net.Socket>();

  const handle = (initial: net.Socket, secured: boolean) => {
    let socket: net.Socket = initial;
    let isTls = secured;
    let buffer = '';
    let mode: 'command' | 'data' | 'auth-user' | 'auth-pass' = 'command';
    let from = '';
    let to: string[] = [];
    let loginUser = '';
    const send = (line: string) => socket.write(`${line}\r\n`);

    const onData = (chunk: Buffer | string) => {
      buffer += chunk.toString('utf8');
      for (;;) {
        if (mode === 'data') {
          const end = buffer.indexOf('\r\n.\r\n');
          if (end < 0) return;
          const raw = buffer.slice(0, end);
          buffer = buffer.slice(end + 5);
          mode = 'command';
          if (options.refuse?.at === 'END') {
            send(options.refuse.reply);
            continue;
          }
          messages.push({
            from,
            to,
            raw,
            data: raw.replace(/(^|\r\n)\.\./g, '$1.'),
          });
          send('250 2.0.0 Accepted');
          continue;
        }
        const at = buffer.indexOf('\r\n');
        if (at < 0) return;
        const line = buffer.slice(0, at);
        buffer = buffer.slice(at + 2);
        if (mode === 'auth-user') {
          commands.push('<hidden>');
          loginUser = Buffer.from(line, 'base64').toString('utf8');
          mode = 'auth-pass';
          send(`334 ${Buffer.from('Password:').toString('base64')}`);
          continue;
        }
        if (mode === 'auth-pass') {
          commands.push('<hidden>');
          const password = Buffer.from(line, 'base64').toString('utf8');
          logins.push({ user: loginUser, password, mechanism: 'LOGIN' });
          mode = 'command';
          const ok =
            !options.credentials ||
            (options.credentials.user === loginUser && options.credentials.password === password);
          send(ok ? '235 2.7.0 Authenticated' : '535 5.7.8 Authentication failed');
          continue;
        }
        const upper = line.toUpperCase();
        if (upper.startsWith('AUTH ')) commands.push('AUTH <hidden>');
        else commands.push(line);

        if (upper.startsWith('EHLO') || upper.startsWith('HELO')) {
          const caps = ['250-fake.smtp.test', '250-8BITMIME'];
          if (options.starttls && !isTls) caps.push('250-STARTTLS');
          const auth = options.auth ?? [];
          if (auth.length && (!options.authOnlyAfterTls || isTls))
            caps.push(`250-AUTH ${auth.join(' ')}`);
          caps.push('250 SIZE 1000000');
          for (const c of caps) send(c);
        } else if (upper === 'STARTTLS') {
          send('220 2.0.0 Ready to start TLS');
          const secure = new tls.TLSSocket(socket, { isServer: true, ...options.tlsMaterial });
          socket.off('data', onData);
          socket = secure;
          isTls = true;
          buffer = '';
          secure.on('data', onData);
          secure.on('error', () => undefined);
        } else if (upper.startsWith('AUTH PLAIN')) {
          const payload = Buffer.from(line.slice(11).trim(), 'base64').toString('utf8').split('\0');
          const user = payload[1] ?? '';
          const password = payload[2] ?? '';
          logins.push({ user, password, mechanism: 'PLAIN' });
          const ok =
            !options.credentials ||
            (options.credentials.user === user && options.credentials.password === password);
          send(ok ? '235 2.7.0 Authenticated' : '535 5.7.8 Authentication failed');
        } else if (upper === 'AUTH LOGIN') {
          mode = 'auth-user';
          send(`334 ${Buffer.from('Username:').toString('base64')}`);
        } else if (upper.startsWith('MAIL FROM:')) {
          if (options.refuse?.at === 'MAIL') send(options.refuse.reply);
          else {
            from = line.slice(10).replace(/[<>]/g, '').trim();
            to = [];
            send('250 2.1.0 Sender ok');
          }
        } else if (upper.startsWith('RCPT TO:')) {
          if (options.refuse?.at === 'RCPT') send(options.refuse.reply);
          else {
            to.push(line.slice(8).replace(/[<>]/g, '').trim());
            send('250 2.1.5 Recipient ok');
          }
        } else if (upper === 'DATA') {
          if (options.refuse?.at === 'DATA') send(options.refuse.reply);
          else {
            mode = 'data';
            send('354 End data with <CR><LF>.<CR><LF>');
          }
        } else if (upper === 'QUIT') {
          send('221 2.0.0 Bye');
          socket.end();
        } else send('502 5.5.2 Command not recognised');
      }
    };
    socket.on('data', onData);
    socket.on('error', () => undefined);
    if (options.refuse?.at === 'GREETING') {
      send(options.refuse.reply);
      socket.end();
    } else send('220 fake.smtp.test ESMTP ready');
    if (options.silent) {
      socket.off('data', onData);
    }
  };

  const server: net.Server = options.implicitTls
    ? tls.createServer({ ...options.tlsMaterial }, (s) => {
        sockets.add(s);
        s.on('close', () => sockets.delete(s));
        handle(s, true);
      })
    : net.createServer((s) => {
        sockets.add(s);
        s.on('close', () => sockets.delete(s));
        handle(s, false);
      });
  server.on('tlsClientError', () => undefined);
  const port = await listenOnGoodPort(server);
  return {
    port,
    commands,
    messages,
    logins,
    reset: () => {
      commands.length = 0;
      messages.length = 0;
      logins.length = 0;
    },
    close: () =>
      new Promise((resolve) => {
        for (const s of sockets) s.destroy();
        server.close(() => resolve());
      }),
  };
}

// ---------------------------------------------------------------------------------------------------
// A throw-away certificate for 127.0.0.1, made with the `openssl` program (nothing is committed).

export interface TlsMaterial {
  key: string;
  cert: string;
}

/** null when `openssl` is not on this machine: the TLS tests then say so and skip. */
export function makeTlsMaterial(): TlsMaterial | null {
  const dir = mkdtempSync(join(tmpdir(), 'dcc-alert-tls-'));
  try {
    execFileSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        join(dir, 'k.pem'),
        '-out',
        join(dir, 'c.pem'),
        '-days',
        '2',
        '-subj',
        '/CN=localhost',
        '-addext',
        'subjectAltName=IP:127.0.0.1,DNS:localhost',
      ],
      { stdio: 'ignore' },
    );
    return {
      key: readFileSync(join(dir, 'k.pem'), 'utf8'),
      cert: readFileSync(join(dir, 'c.pem'), 'utf8'),
    };
  } catch {
    return null;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
