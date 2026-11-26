import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  makeTlsMaterial,
  startFakeSmtp,
  type FakeSmtp,
  type TlsMaterial,
} from '../../../test/fake-alert-servers';
import { buildMessage, dotStuff, sendMail, SmtpError, type SmtpOptions } from './smtp-client';

// Fake values assembled at run time so a secret scanner never sees a credential-shaped literal.
const FAKE_PASS = ['fake', 'pass', 'one'].join('-');
const FAKE_RIGHT = ['fake', 'right', 'one'].join('-');
const FAKE_WRONG = ['fake', 'wrong', 'one'].join('-');
const FAKE_PW1 = ['fake', 'pw', '1'].join('-');

const FROM = 'dcc@example.test';
const TO = 'person@example.test';
const base = (port: number, extra: Partial<SmtpOptions> = {}): SmtpOptions => ({
  host: '127.0.0.1',
  port,
  secure: 'none',
  user: null,
  password: null,
  from: FROM,
  timeoutMs: 2_000,
  ...extra,
});

describe('SMTP client against a fake SMTP server', () => {
  const servers: FakeSmtp[] = [];
  const start = async (options: Parameters<typeof startFakeSmtp>[0] = {}) => {
    const server = await startFakeSmtp(options);
    servers.push(server);
    return server;
  };
  let tlsMaterial: TlsMaterial | null;

  beforeAll(() => {
    tlsMaterial = makeTlsMaterial();
    if (!tlsMaterial)
      console.warn('openssl is not available on this machine: the TLS tests are skipped.');
  });
  afterAll(async () => {
    await Promise.all(servers.map((s) => s.close()));
  });

  const rejection = async (promise: Promise<unknown>): Promise<SmtpError> => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(SmtpError);
      return error as SmtpError;
    }
    throw new Error('Expected the send to be refused, but it went through.');
  };

  it('runs the whole dialogue in order and delivers the message with CRLF line ends', async () => {
    const smtp = await start();
    await sendMail(base(smtp.port), {
      to: TO,
      subject: '[SEV1] Incident at Company A: Page hacked',
      text: 'Line one\nLine two',
    });
    expect(smtp.commands.map((c) => c.split(' ')[0])).toEqual([
      'EHLO',
      'MAIL',
      'RCPT',
      'DATA',
      'QUIT',
    ]);
    expect(smtp.commands[1]).toBe(`MAIL FROM:<${FROM}>`);
    expect(smtp.commands[2]).toBe(`RCPT TO:<${TO}>`);
    expect(smtp.messages).toHaveLength(1);
    const message = smtp.messages[0]!;
    expect(message.from).toBe(FROM);
    expect(message.to).toEqual([TO]);
    expect(message.raw).toContain('Subject: [SEV1] Incident at Company A: Page hacked\r\n');
    expect(message.raw).toContain(`To: ${TO}\r\n`);
    expect(message.raw).toContain('\r\n\r\nLine one\r\nLine two');
    expect(message.raw).not.toMatch(/[^\r]\n/);
  });

  it('dot-stuffs lines that start with a dot, so a lone dot cannot end the message early', async () => {
    const smtp = await start();
    const text = 'First\n.hidden line\n.\nLast line';
    await sendMail(base(smtp.port), { to: TO, subject: 'Dots', text });
    const message = smtp.messages[0]!;
    expect(message.raw).toContain('\r\n..hidden line\r\n..\r\nLast line');
    // The server removed the stuffing again: what came out is what went in.
    expect(message.data).toContain('First\r\n.hidden line\r\n.\r\nLast line');
    expect(dotStuff('.a\r\n.\r\nb')).toBe('..a\r\n..\r\nb');
  });

  it('encodes a non-ASCII subject and body (Amharic) so they survive', async () => {
    const smtp = await start();
    await sendMail(base(smtp.port), {
      to: TO,
      subject: '[SEV1] ክስተት: ገጽ ተጠልፏል',
      text: 'ሰላም\nክስተት ተመዝግቧል',
    });
    const { raw } = smtp.messages[0]!;
    expect(raw).toMatch(/Subject: =\?UTF-8\?B\?/);
    expect(raw).toContain('Content-Transfer-Encoding: base64');
    const body = raw.split('\r\n\r\n')[1]!.replace(/\r\n/g, '');
    expect(Buffer.from(body, 'base64').toString('utf8')).toBe('ሰላም\r\nክስተት ተመዝግቧል');
    const encoded = [...raw.matchAll(/=\?UTF-8\?B\?([^?]+)\?=/g)].map((m) =>
      Buffer.from(m[1]!, 'base64').toString('utf8'),
    );
    expect(encoded.join('')).toBe('[SEV1] ክስተት: ገጽ ተጠልፏል');
  });

  it('cannot be made to add headers through the subject (no header injection)', async () => {
    const smtp = await start();
    await sendMail(base(smtp.port), {
      to: TO,
      subject: 'Hello\r\nBcc: attacker@example.test',
      text: 'Body',
    });
    const headers = smtp.messages[0]!.raw.split('\r\n\r\n')[0]!;
    expect(headers.split('\r\n').some((line) => line.startsWith('Bcc:'))).toBe(false);
    expect(headers).toContain('Subject: Hello Bcc: attacker@example.test');
  });

  it('refuses an address that is not a plain address without connecting', async () => {
    const smtp = await start();
    for (const to of ['not-an-address', 'a@b.c\r\nRCPT TO:<x@y.z>', 'a b@c.d', '<a@b.c>']) {
      await rejection(sendMail(base(smtp.port), { to, subject: 's', text: 't' }));
    }
    expect(smtp.commands).toEqual([]);
  });

  describe('sign-in', () => {
    it('uses AUTH PLAIN when the server offers it', async () => {
      const smtp = await start({
        auth: ['PLAIN', 'LOGIN'],
        credentials: { user: 'alerts', password: FAKE_PASS },
      });
      await sendMail(base(smtp.port, { user: 'alerts', password: FAKE_PASS }), {
        to: TO,
        subject: 's',
        text: 't',
      });
      expect(smtp.logins).toEqual([{ user: 'alerts', password: FAKE_PASS, mechanism: 'PLAIN' }]);
      expect(smtp.messages).toHaveLength(1);
    });

    it('falls back to AUTH LOGIN when PLAIN is not offered', async () => {
      const smtp = await start({
        auth: ['LOGIN'],
        credentials: { user: 'alerts', password: FAKE_PASS },
      });
      await sendMail(base(smtp.port, { user: 'alerts', password: FAKE_PASS }), {
        to: TO,
        subject: 's',
        text: 't',
      });
      expect(smtp.logins).toEqual([{ user: 'alerts', password: FAKE_PASS, mechanism: 'LOGIN' }]);
    });

    it('rejects a wrong password with the server code, and the password is in no error text', async () => {
      const smtp = await start({
        auth: ['PLAIN'],
        credentials: { user: 'alerts', password: FAKE_RIGHT },
      });
      const error = await rejection(
        sendMail(base(smtp.port, { user: 'alerts', password: FAKE_WRONG }), {
          to: TO,
          subject: 's',
          text: 't',
        }),
      );
      expect(error.code).toBe(535);
      expect(error.message).toContain('535');
      expect(error.message).not.toContain(FAKE_WRONG);
      expect(smtp.messages).toHaveLength(0);
    });

    it('refuses to continue when the server offers no sign-in method we know', async () => {
      const smtp = await start({ auth: [] });
      const error = await rejection(
        sendMail(base(smtp.port, { user: 'alerts', password: FAKE_PW1 }), {
          to: TO,
          subject: 's',
          text: 't',
        }),
      );
      expect(error.message).toContain('sign-in method');
      expect(smtp.commands.some((c) => c.startsWith('MAIL'))).toBe(false);
    });
  });

  describe('refusals (every 4xx and 5xx rejects)', () => {
    const cases: {
      at: 'GREETING' | 'MAIL' | 'RCPT' | 'DATA' | 'END';
      reply: string;
      code: number;
    }[] = [
      { at: 'GREETING', reply: '554 5.3.2 No service here', code: 554 },
      { at: 'MAIL', reply: '550 5.7.1 Sender not allowed', code: 550 },
      { at: 'RCPT', reply: '550 5.1.1 No such user', code: 550 },
      { at: 'RCPT', reply: '451 4.3.0 Try again later', code: 451 },
      { at: 'DATA', reply: '503 5.5.1 Bad sequence', code: 503 },
      { at: 'END', reply: '552 5.3.4 Message too big', code: 552 },
    ];
    for (const c of cases)
      it(`${c.at}: ${c.code}`, async () => {
        const smtp = await start({ refuse: { at: c.at, reply: c.reply } });
        const error = await rejection(
          sendMail(base(smtp.port), { to: TO, subject: 's', text: 't' }),
        );
        expect(error.code === c.code || c.at === 'GREETING').toBe(true);
        expect(error.message).toContain(String(c.code));
        expect(smtp.messages).toHaveLength(0);
      });
  });

  it('gives up when the server does not answer (idle timeout)', async () => {
    const smtp = await start({ silent: true });
    const error = await rejection(
      sendMail(base(smtp.port, { timeoutMs: 250 }), { to: TO, subject: 's', text: 't' }),
    );
    expect(error.message).toMatch(/did not answer|closed/);
  });

  it('reports a refused connection without the address', async () => {
    const smtp = await start();
    const port = smtp.port;
    await smtp.close();
    const error = await rejection(sendMail(base(port), { to: TO, subject: 's', text: 't' }));
    expect(error.message).toContain('refused the connection');
    expect(error.message).not.toContain(String(port));
    expect(error.message).not.toContain('127.0.0.1');
  });

  describe('TLS', () => {
    const needsTls = (name: string, run: (tlsMaterial: TlsMaterial) => Promise<void>) =>
      it(name, async (context) => {
        if (!tlsMaterial) return context.skip();
        await run(tlsMaterial);
      });

    needsTls('STARTTLS: upgrades, says EHLO again and only then signs in', async (material) => {
      const smtp = await start({
        starttls: true,
        tlsMaterial: material,
        auth: ['PLAIN'],
        authOnlyAfterTls: true,
        credentials: { user: 'alerts', password: FAKE_PW1 },
      });
      await sendMail(
        base(smtp.port, {
          secure: 'starttls',
          user: 'alerts',
          password: FAKE_PW1,
          tlsOptions: { ca: material.cert },
        }),
        { to: TO, subject: 's', text: 't' },
      );
      const verbs = smtp.commands.map((c) => c.split(' ')[0]);
      expect(verbs).toEqual(['EHLO', 'STARTTLS', 'EHLO', 'AUTH', 'MAIL', 'RCPT', 'DATA', 'QUIT']);
      expect(smtp.messages).toHaveLength(1);
    });

    needsTls(
      'STARTTLS: a server that does not offer it is not used in clear text',
      async (material) => {
        const smtp = await start({ tlsMaterial: material });
        const error = await rejection(
          sendMail(base(smtp.port, { secure: 'starttls', tlsOptions: { ca: material.cert } }), {
            to: TO,
            subject: 's',
            text: 't',
          }),
        );
        expect(error.message).toContain('STARTTLS');
        expect(smtp.commands.some((c) => c.startsWith('MAIL'))).toBe(false);
      },
    );

    needsTls('implicit TLS (port 465 style)', async (material) => {
      const smtp = await start({ implicitTls: true, tlsMaterial: material });
      await sendMail(base(smtp.port, { secure: 'tls', tlsOptions: { ca: material.cert } }), {
        to: TO,
        subject: 's',
        text: 't',
      });
      expect(smtp.messages).toHaveLength(1);
    });

    needsTls('a certificate we do not trust is refused and nothing is sent', async (material) => {
      const smtp = await start({ starttls: true, tlsMaterial: material });
      const error = await rejection(
        sendMail(base(smtp.port, { secure: 'starttls' }), { to: TO, subject: 's', text: 't' }),
      );
      expect(error.message).toMatch(/certificate/);
      expect(smtp.messages).toHaveLength(0);
    });
  });

  it('buildMessage never emits a bare line feed', () => {
    const text = buildMessage(FROM, { to: TO, subject: 'S', text: 'a\nb\rc' }, new Date(0));
    expect(text).not.toMatch(/[^\r]\n/);
    expect(text).not.toMatch(/\r[^\n]/);
    expect(text).toContain('Date: Thu, 01 Jan 1970 00:00:00 GMT');
  });
});
