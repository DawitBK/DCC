import { describe, expect, it } from 'vitest';
import { maskMobile, MobileNumber, SMS_MAX_CHARACTERS } from '@dcc/contracts';
import { readAlertConfig } from './alert-config';
import { composeAlert, escapeTeamsText, plain, teamsCard } from './alert-messages';
import { fakeValue } from '../../../test/fake-values';
const HOOK_PATH = fakeValue('hook');

const FAKE_P = fakeValue('p');
const FAKE_T = fakeValue('t');

const SMTP = {
  DCC_SMTP_HOST: 'smtp.example.test',
  DCC_SMTP_PORT: '587',
  DCC_SMTP_FROM: 'dcc@example.test',
};

describe('alert channel configuration (environment only)', () => {
  it('a channel with no configuration is not configured', () => {
    const config = readAlertConfig({});
    expect(config.teams).toBeNull();
    expect(config.sms).toBeNull();
    expect(config.email).toBeNull();
    expect(config.status).toEqual({
      teams: { configured: false, reason: 'not_set' },
      sms: { configured: false, reason: 'not_set' },
      email: { configured: false, reason: 'not_set' },
    });
  });

  it('empty and blank values count as not set', () => {
    const config = readAlertConfig({
      DCC_TEAMS_WEBHOOK_URL: '   ',
      DCC_SMS_GATEWAY_URL: '',
      DCC_SMTP_HOST: '',
      DCC_SMTP_SECURE: '',
    });
    expect(config.status.teams.reason).toBe('not_set');
    expect(config.status.sms.reason).toBe('not_set');
    expect(config.status.email.reason).toBe('not_set');
  });

  it('reads all three channels when they are complete', () => {
    const config = readAlertConfig({
      NODE_ENV: 'production',
      DCC_TEAMS_WEBHOOK_URL: `https://example.webhook.office.test/webhook/${HOOK_PATH}`,
      DCC_SMS_GATEWAY_URL: 'https://sms.example.test/send',
      DCC_SMS_GATEWAY_TOKEN: FAKE_T,
      ...SMTP,
      DCC_SMTP_USER: 'u',
      DCC_SMTP_PASSWORD: FAKE_P,
    });
    expect(config.teams).toEqual({
      url: `https://example.webhook.office.test/webhook/${HOOK_PATH}`,
    });
    expect(config.sms).toEqual({ url: 'https://sms.example.test/send', token: FAKE_T });
    expect(config.email).toEqual({
      host: 'smtp.example.test',
      port: 587,
      from: 'dcc@example.test',
      secure: 'starttls',
      user: 'u',
      password: FAKE_P,
    });
    expect(Object.values(config.status).every((s) => s.configured && s.reason === 'ok')).toBe(true);
  });

  it('SMS needs both the address and the token; e-mail needs host, port and sender', () => {
    expect(readAlertConfig({ DCC_SMS_GATEWAY_URL: 'https://s.example.test' }).status.sms).toEqual({
      configured: false,
      reason: 'incomplete',
    });
    expect(readAlertConfig({ DCC_SMS_GATEWAY_TOKEN: FAKE_T }).status.sms.reason).toBe('incomplete');
    expect(readAlertConfig({ DCC_SMTP_HOST: 'h', DCC_SMTP_PORT: '25' }).status.email.reason).toBe(
      'incomplete',
    );
    expect(readAlertConfig({ ...SMTP, DCC_SMTP_PORT: 'abc' }).status.email.reason).toBe(
      'incomplete',
    );
    expect(readAlertConfig({ ...SMTP, DCC_SMTP_SECURE: 'ssl' }).status.email.reason).toBe(
      'incomplete',
    );
    expect(readAlertConfig({ ...SMTP, DCC_SMTP_USER: 'u' }).status.email.reason).toBe('incomplete');
    expect(readAlertConfig({ ...SMTP, DCC_SMTP_FROM: 'not an address' }).status.email.reason).toBe(
      'incomplete',
    );
  });

  describe('production refuses an http address', () => {
    const http = {
      DCC_TEAMS_WEBHOOK_URL: 'http://hooks.example.test/x',
      DCC_SMS_GATEWAY_URL: 'http://sms.example.test/send',
      DCC_SMS_GATEWAY_TOKEN: FAKE_T,
    };
    for (const env of [
      { NODE_ENV: 'production' },
      { NODE_ENV: 'development', DCC_ENVIRONMENT: 'production' },
      { NODE_ENV: 'development', DCC_ENVIRONMENT: 'mirror' },
    ])
      it(`in ${JSON.stringify(env)}`, () => {
        const config = readAlertConfig({ ...env, ...http });
        expect(config.teams).toBeNull();
        expect(config.sms).toBeNull();
        expect(config.status.teams.reason).toBe('insecure');
        expect(config.status.sms.reason).toBe('insecure');
      });

    it('even a loopback address is refused in production', () => {
      const config = readAlertConfig({
        NODE_ENV: 'production',
        DCC_TEAMS_WEBHOOK_URL: 'http://127.0.0.1:9999/hook',
      });
      expect(config.status.teams.reason).toBe('insecure');
    });

    it('development and tests accept http only for loopback', () => {
      expect(
        readAlertConfig({ NODE_ENV: 'test', DCC_TEAMS_WEBHOOK_URL: 'http://127.0.0.1:9999/hook' })
          .teams,
      ).not.toBeNull();
      expect(
        readAlertConfig({ NODE_ENV: 'development', DCC_TEAMS_WEBHOOK_URL: 'http://localhost:9/h' })
          .teams,
      ).not.toBeNull();
      expect(
        readAlertConfig({
          NODE_ENV: 'development',
          DCC_TEAMS_WEBHOOK_URL: 'http://hooks.example.test/x',
        }).status.teams.reason,
      ).toBe('insecure');
    });

    it('a value that is not an address at all is incomplete, and other schemes are refused', () => {
      expect(readAlertConfig({ DCC_TEAMS_WEBHOOK_URL: 'not a url' }).status.teams.reason).toBe(
        'incomplete',
      );
      expect(
        readAlertConfig({ DCC_TEAMS_WEBHOOK_URL: 'ftp://x.example.test/h' }).status.teams.reason,
      ).toBe('incomplete');
    });

    it('SMTP "none" with a user name is refused in production (the password would travel in clear text)', () => {
      const withAuth = readAlertConfig({
        NODE_ENV: 'production',
        ...SMTP,
        DCC_SMTP_SECURE: 'none',
        DCC_SMTP_USER: 'u',
        DCC_SMTP_PASSWORD: FAKE_P,
      });
      expect(withAuth.email).toBeNull();
      expect(withAuth.status.email.reason).toBe('insecure');
      expect(
        readAlertConfig({ NODE_ENV: 'production', ...SMTP, DCC_SMTP_SECURE: 'none' }).email,
      ).not.toBeNull();
      expect(
        readAlertConfig({
          NODE_ENV: 'test',
          ...SMTP,
          DCC_SMTP_SECURE: 'none',
          DCC_SMTP_USER: 'u',
          DCC_SMTP_PASSWORD: FAKE_P,
        }).email,
      ).not.toBeNull();
    });
  });

  it('the status never contains a value', () => {
    const secrets = [
      fakeValue('sms-value-123'),
      `hooks.example.test/${HOOK_PATH}`,
      fakeValue('smtp-value-9'),
    ];
    const config = readAlertConfig({
      DCC_TEAMS_WEBHOOK_URL: `https://hooks.example.test/${HOOK_PATH}`,
      DCC_SMS_GATEWAY_URL: 'https://sms.example.test/send',
      DCC_SMS_GATEWAY_TOKEN: secrets[0],
      ...SMTP,
      DCC_SMTP_USER: 'u',
      DCC_SMTP_PASSWORD: secrets[2],
    });
    const text = JSON.stringify(config.status);
    for (const secret of secrets) expect(text).not.toContain(secret);
    expect(text).not.toContain('example.test');
  });
});

describe('mobile numbers', () => {
  it('masks the middle with a fixed pattern', () => {
    expect(maskMobile('+251911234512')).toBe('+251 9** *** 12');
    expect(maskMobile('+14155550123')).toBe('+141 5** *** 23');
    // the same pattern whatever the length
    expect(maskMobile('+442071234567')).toBe('+442 0** *** 67');
    expect(maskMobile('+2519112345678')).toBe('+251 9** *** 78');
  });

  it('accepts international form only: plus sign and 8 to 15 digits', () => {
    expect(MobileNumber.parse('+251911234567')).toBe('+251911234567');
    expect(MobileNumber.parse(' +251 91 123-4567 ')).toBe('+251911234567');
    for (const bad of [
      '0911234567',
      '251911234567',
      '+0911234567',
      '+25191',
      '+2519112345678901',
      '+25191abc4567',
      '',
      '++251911234567',
    ])
      expect(MobileNumber.safeParse(bad).success, bad).toBe(false);
    expect(MobileNumber.safeParse('+12345678').success).toBe(true);
    expect(MobileNumber.safeParse('+123456789012345').success).toBe(true);
  });
});

describe('alert texts', () => {
  const LS = String.fromCharCode(0x2028); // the unicode line separator
  const facts = {
    severity: 'critical' as const,
    title: 'Page hacked',
    companyName: 'Company A',
    link: 'https://dcc.example.test/dcc/incidents/11111111-1111-1111-1111-111111111111',
  };

  it('an SMS is plain text under 300 characters even with a very long title', () => {
    const sms = composeAlert('sms', {
      ...facts,
      title: 'x'.repeat(5_000),
      companyName: 'C'.repeat(500),
    });
    expect(sms.body.length).toBeLessThanOrEqual(SMS_MAX_CHARACTERS);
    expect(sms.body.length).toBeLessThan(300);
    expect(sms.body).toContain('SEV1');
  });

  it('an SMS keeps the link whole when the title is cut', () => {
    const sms = composeAlert('sms', { ...facts, title: 'y'.repeat(1_000) });
    expect(sms.body.endsWith(facts.link)).toBe(true);
    expect(sms.body).toContain('…');
  });

  it('removes line breaks and control characters from what a person typed', () => {
    const nul = String.fromCharCode(0);
    const text = composeAlert('sms', {
      ...facts,
      title: ['Line one', 'Line\ttwo', nul, LS, 'end'].join(' ') + ' \r\n tail',
    });
    expect(text.body).not.toMatch(new RegExp('[' + ['\\r', '\\n', '\\t', nul, LS].join('') + ']'));
    expect(composeAlert('email', { ...facts, title: 'a\r\nBcc: x@y.z' }).subject).not.toMatch(
      /[\r\n]/,
    );
    expect(plain('  a \n\n b  ')).toBe('a b');
  });

  it('an e-mail names the incident, the severity, the company and the link', () => {
    const mail = composeAlert('email', facts);
    expect(mail.subject).toBe('[SEV1] Incident at Company A: Page hacked');
    for (const part of ['Page hacked', 'SEV1', 'Company A', facts.link])
      expect(mail.body).toContain(part);
  });

  it('the Teams card is JSON in the Adaptive Card envelope, with the text escaped and nothing personal', () => {
    const hostile = {
      ...facts,
      title: '*bold* [click](http://evil.test) <b>x</b> `code` "quote" \\ back',
    };
    const { body } = composeAlert('teams', hostile);
    const card = JSON.parse(body);
    expect(card.type).toBe('message');
    expect(card.attachments[0].contentType).toBe('application/vnd.microsoft.card.adaptive');
    const blocks = card.attachments[0].content.body as { text?: string }[];
    const titleBlock = blocks[1]!.text!;
    expect(titleBlock).not.toMatch(/(^|[^\\])[*[\]()<>`]/);
    expect(titleBlock).toContain('\\*bold\\*');
    expect(titleBlock).toContain('\\[click\\]\\(http://evil.test\\)');
    expect(card.attachments[0].content.actions[0]).toMatchObject({
      type: 'Action.OpenUrl',
      url: facts.link,
    });
    expect(escapeTeamsText('a_b')).toBe('a\\_b');
  });

  it('with only a path for a link, the card shows it as text instead of a button', () => {
    const card = teamsCard({ ...facts, link: '/dcc/incidents/abc' });
    expect(card.attachments[0]!.content).not.toHaveProperty('actions');
  });
});
