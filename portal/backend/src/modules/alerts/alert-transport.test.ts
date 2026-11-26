import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { startFakeHttp, type FakeHttp } from '../../../test/fake-alert-servers';
import { deliver, AlertSendError } from './alert-transport';
import { composeAlert } from './alert-messages';
import { readAlertConfig } from './alert-config';

// A fake value assembled at run time so a secret scanner never sees a credential-shaped literal.
const FAKE_TOKEN = ['fake', 'gateway', 'value'].join('-');
const FAKE_SIG = ['fake', 'signature', 'value'].join('-');

const facts = {
  severity: 'high' as const,
  title: 'Suspicious post',
  companyName: 'Company A',
  link: 'https://dcc.example.test/incidents/1',
};

describe('SMS and Teams over HTTP against local fake servers', () => {
  let sms: FakeHttp;
  let teams: FakeHttp;
  const config = () =>
    readAlertConfig({
      NODE_ENV: 'test',
      DCC_SMS_GATEWAY_URL: sms.url,
      DCC_SMS_GATEWAY_TOKEN: FAKE_TOKEN,
      DCC_TEAMS_WEBHOOK_URL: `${teams.url}?sig=${FAKE_SIG}`,
    });

  beforeAll(async () => {
    sms = await startFakeHttp();
    teams = await startFakeHttp();
  });
  afterAll(async () => {
    await sms.close();
    await teams.close();
  });
  beforeEach(() => {
    sms.reset();
    teams.reset();
  });

  const failure = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error) {
      expect(error).toBeInstanceOf(AlertSendError);
      return error as AlertSendError;
    }
    throw new Error('Expected a failure.');
  };

  it('SMS: POST JSON { to, text } with the bearer token', async () => {
    const alert = composeAlert('sms', facts);
    await deliver(config(), 'sms', '+251911234567', alert);
    expect(sms.requests).toHaveLength(1);
    const request = sms.requests[0]!;
    expect(request.method).toBe('POST');
    expect(request.headers['content-type']).toContain('application/json');
    expect(request.headers.authorization).toBe(`Bearer ${FAKE_TOKEN}`);
    expect(request.json).toEqual({ to: '+251911234567', text: alert.body });
    expect(request.json.text.length).toBeLessThan(300);
  });

  it('Teams: POST of the card, nothing else', async () => {
    const alert = composeAlert('teams', facts);
    await deliver(config(), 'teams', null, alert);
    expect(teams.requests).toHaveLength(1);
    expect(teams.requests[0]!.url).toContain(`sig=${FAKE_SIG}`);
    expect(teams.requests[0]!.headers.authorization).toBeUndefined();
    expect(teams.requests[0]!.json.type).toBe('message');
    expect(JSON.stringify(teams.requests[0]!.json)).toContain('Suspicious post');
  });

  for (const status of [400, 401, 404, 429, 500, 503])
    it(`an HTTP ${status} answer is a failure that names the status and no secret`, async () => {
      sms.respond(status);
      teams.respond(status);
      const a = await failure(
        deliver(config(), 'sms', '+251911234567', composeAlert('sms', facts)),
      );
      const b = await failure(deliver(config(), 'teams', null, composeAlert('teams', facts)));
      for (const error of [a, b]) {
        expect(error.message).toContain(`HTTP ${status}`);
        expect(error.message).not.toContain(['fake', 'gateway', 'value'].join('-'));
        expect(error.message).not.toContain('very-secret-signature');
        expect(error.message).not.toContain('127.0.0.1');
      }
    });

  it('a redirect is not followed (the token would go to another address)', async () => {
    sms.respond(302);
    const error = await failure(
      deliver(config(), 'sms', '+251911234567', composeAlert('sms', facts)),
    );
    expect(error.message).not.toContain(['fake', 'gateway', 'value'].join('-'));
  });

  it('no answer within the time allowed is a failure', async () => {
    sms.delay(400);
    const error = await failure(
      deliver(config(), 'sms', '+251911234567', composeAlert('sms', facts), { httpTimeoutMs: 100 }),
    );
    expect(error.message).toBe('No answer within the time allowed.');
  });

  it('a server that is down is a failure without its address', async () => {
    const dead = await startFakeHttp();
    const url = dead.url;
    await dead.close();
    const error = await failure(
      deliver(
        readAlertConfig({
          NODE_ENV: 'test',
          DCC_SMS_GATEWAY_URL: url,
          DCC_SMS_GATEWAY_TOKEN: 't',
        }),
        'sms',
        '+251911234567',
        composeAlert('sms', facts),
      ),
    );
    expect(error.message).toContain('could not be reached');
    expect(error.message).not.toContain(url);
  });

  it('a channel that is not configured fails at once and a person without a number is refused', async () => {
    const empty = readAlertConfig({});
    await failure(deliver(empty, 'teams', null, composeAlert('teams', facts)));
    await failure(deliver(empty, 'sms', '+251911234567', composeAlert('sms', facts)));
    await failure(deliver(empty, 'email', 'a@b.test', composeAlert('email', facts)));
    await failure(deliver(config(), 'sms', null, composeAlert('sms', facts)));
    expect(sms.requests).toHaveLength(0);
  });
});
