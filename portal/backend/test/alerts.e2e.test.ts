import { Logger } from '@nestjs/common';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { AlertsService } from '../src/modules/alerts/alerts.service';
import { SweepService } from '../src/modules/working-hours/sweep.service';
import { TenantDb } from '../src/platform/tenancy/tenant-db';
import { startFakeHttp, startFakeSmtp, type FakeHttp, type FakeSmtp } from './fake-alert-servers';
import { ctx } from './helpers';
import { PlanHarness } from './plan-harness';
import { fakeValue } from './fake-values';

const MINUTE = 60_000;
const TOKEN = fakeValue('sms-gateway-value-7f3a');
const SMTP_USER = 'dcc-alerts';
const SMTP_PASSWORD = fakeValue('smtp-value-9c1e');
const WEBHOOK_SIG = fakeValue('teams-hook-value-55d2');

/** Round 3, RQ-029: SMS, Teams and e-mail alerts for SEV1 and SEV2 incidents, end to end against fake servers. */
describe('alerts for SEV1 and SEV2 incidents (RQ-029)', () => {
  const h = new PlanHarness();
  const { send, json } = h;
  let groupId: string;
  let companyA: string;
  let companyB: string;
  let teams: FakeHttp;
  let sms: FakeHttp;
  let smtp: FakeSmtp;
  let sweep: SweepService;
  let alerts: AlertsService;
  const id = (name: string) => h.userIds.get(name)!;
  const mobileOf: Record<string, string> = {
    cto: '+251911000001',
    sec: '+251911000002',
    gm: '+251911000003',
    owner: '+251911000004',
    mm: '+251911000005',
  };

  // --- channels ---------------------------------------------------------------------------------------
  const channels = (on: { teams?: boolean; sms?: boolean; email?: boolean }) => {
    const set = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    set('DCC_TEAMS_WEBHOOK_URL', on.teams ? `${teams.url}?sig=${WEBHOOK_SIG}` : undefined);
    set('DCC_SMS_GATEWAY_URL', on.sms ? sms.url : undefined);
    set('DCC_SMS_GATEWAY_TOKEN', on.sms ? TOKEN : undefined);
    set('DCC_SMTP_HOST', on.email ? '127.0.0.1' : undefined);
    set('DCC_SMTP_PORT', on.email ? String(smtp.port) : undefined);
    set('DCC_SMTP_FROM', on.email ? 'dcc@example.test' : undefined);
    set('DCC_SMTP_SECURE', on.email ? 'none' : undefined);
    set('DCC_SMTP_USER', on.email ? SMTP_USER : undefined);
    set('DCC_SMTP_PASSWORD', on.email ? SMTP_PASSWORD : undefined);
  };
  const allChannels = () => channels({ teams: true, sms: true, email: true });

  // --- helpers ----------------------------------------------------------------------------------------
  const openIncident = async (severity: string, title = 'Suspicious post', who = 'owner') => {
    const res = await send('POST', '/api/incidents', who, { companyId: companyA, title, severity });
    expect(res.status).toBe(201);
    return (await json(res)) as { id: string };
  };
  const patchIncident = async (incidentId: string, body: unknown, who = 'owner') => {
    const res = await send('PATCH', `/api/incidents/${incidentId}`, who, body);
    expect(res.status).toBe(200);
  };
  const rowsOf = (incidentId: string) =>
    h.query(
      `select id, channel, recipient_user_id, status, attempts, last_error, next_attempt_at, severity, subject, body
         from alert_deliveries where incident_id = $1 order by channel, created_at, id`,
      [incidentId],
    );
  const who = (rows: { channel: string; recipient_user_id: string | null }[], channel: string) =>
    rows
      .filter((r) => r.channel === channel)
      .map((r) => r.recipient_user_id)
      .sort();
  const names = (...people: string[]) => people.map(id).sort();
  const runSweep = (at: Date = new Date(Date.now() + 1_000)) => sweep.runOnce(at);
  const setContact = async (who: string, mobile: string | null, extra: object = {}) =>
    send('PUT', '/api/alerts/contacts', who, { mobile, ...extra });
  const everythingStored = async (): Promise<string> =>
    JSON.stringify([
      await h.query(`select action, details, target_id from audit_events`),
      await h.query(`select summary from notifications`),
      await h.query(`select * from alert_deliveries`),
    ]);

  const logged: string[] = [];
  const spies: (() => void)[] = [];

  beforeAll(async () => {
    await h.start();
    ({ groupId, companyA, companyB } = {
      groupId: h.f.groupId,
      companyA: h.f.companyA,
      companyB: h.f.companyB,
    });
    teams = await startFakeHttp();
    sms = await startFakeHttp();
    smtp = await startFakeSmtp({
      auth: ['PLAIN', 'LOGIN'],
      credentials: { user: SMTP_USER, password: SMTP_PASSWORD },
    });
    sweep = h.app.get(SweepService);
    alerts = h.app.get(AlertsService);

    await h.persona('owner', [{ role: 'company_executive', companyId: companyA, groupId }]);
    await h.persona('exec2', [{ role: 'company_executive', companyId: companyA, groupId }]);
    await h.persona('mm', [{ role: 'company_marketing_manager', companyId: companyA, groupId }]);
    await h.persona('cto', [{ role: 'group_cto', companyId: null, groupId }]);
    await h.persona('sec', [{ role: 'security_admin', companyId: null, groupId }]);
    await h.persona('gm', [{ role: 'group_marketing', companyId: null, groupId }]);
    await h.persona('execB', [{ role: 'company_executive', companyId: companyB, groupId }]);
    await h.persona('foreignCto', [{ role: 'group_cto', companyId: null, groupId: h.f.group2Id }]);
    await h.persona('nobody', []);
    for (const [name, mobile] of Object.entries(mobileOf))
      expect((await setContact(name, mobile)).status).toBe(200);

    for (const level of ['log', 'warn', 'error', 'debug', 'verbose'] as const) {
      const spy = vi
        .spyOn(Logger.prototype, level)
        .mockImplementation((...args: unknown[]) => void logged.push(JSON.stringify(args)));
      spies.push(() => spy.mockRestore());
    }
  });
  afterAll(async () => {
    spies.forEach((restore) => restore());
    channels({});
    await Promise.all([teams.close(), sms.close(), smtp.close()]);
    await h.stop();
  });
  beforeEach(async () => {
    // Nothing left over from an earlier test can be sent by this one.
    await h.query(`update alert_deliveries set status = 'failed' where status = 'pending'`);
    teams.reset();
    sms.reset();
    smtp.reset();
    alerts.transportOptions = {};
    (alerts as unknown as { lastTest: Map<string, number> }).lastTest.clear();
    await h.query(`delete from alert_settings`);
    allChannels();
  });
  afterEach(() => {
    channels({});
  });

  // =====================================================================================================
  describe('who is alerted, and how', () => {
    it('SEV1: Teams once, e-mail to the owner, security, Group marketing and the executives; SMS to those with a number', async () => {
      const inc = await openIncident('critical', 'Official page hacked');
      const rows = await rowsOf(inc.id);
      expect(rows.filter((r) => r.channel === 'teams')).toHaveLength(1);
      expect(who(rows, 'email')).toEqual(names('owner', 'exec2', 'cto', 'sec', 'gm'));
      // exec2 has no number: no SMS for them. Nobody else is added.
      expect(who(rows, 'sms')).toEqual(names('owner', 'cto', 'sec', 'gm'));
      for (const name of ['mm', 'adminA', 'execB', 'foreignCto'])
        expect(rows.some((r) => r.recipient_user_id === id(name))).toBe(false);
      expect(rows.every((r) => r.status === 'pending' && r.severity === 'critical')).toBe(true);
    });

    it('SEV2: security, the Digital Marketing Manager and the executives (not the Group CTO or Group marketing)', async () => {
      const inc = await openIncident('high', 'Suspected bypass');
      const rows = await rowsOf(inc.id);
      expect(who(rows, 'email')).toEqual(names('owner', 'exec2', 'sec', 'mm'));
      expect(who(rows, 'sms')).toEqual(names('owner', 'sec', 'mm'));
      expect(rows.filter((r) => r.channel === 'teams')).toHaveLength(1);
    });

    it('the list is by role: a SEV2 opened by the Group CTO does not alert the Group CTO, a SEV1 does', async () => {
      const sev2 = await rowsOf((await openIncident('high', 'Opened by the CTO', 'cto')).id);
      expect(sev2.some((r) => r.recipient_user_id === id('cto'))).toBe(false);
      const sev1 = await rowsOf((await openIncident('critical', 'Opened by the CTO', 'cto')).id);
      expect(who(sev1, 'email')).toContain(id('cto'));
    });

    it('sends all of it, to the right addresses and numbers, and the sweep run twice sends once', async () => {
      const inc = await openIncident('critical', 'Official page hacked');
      expect(await runSweep()).toEqual([]);
      expect(await runSweep(new Date(Date.now() + 5_000))).toEqual([]);

      expect(teams.requests).toHaveLength(1);
      expect(sms.requests).toHaveLength(4);
      expect(smtp.messages).toHaveLength(5);

      const emails = (
        await h.query(`select email from users where id = any($1)`, [
          names('owner', 'exec2', 'cto', 'sec', 'gm'),
        ])
      ).map((r) => r.email as string);
      expect(smtp.messages.flatMap((m) => m.to).sort()).toEqual(emails.sort());
      expect(smtp.logins.every((l) => l.user === SMTP_USER && l.password === SMTP_PASSWORD)).toBe(
        true,
      );
      expect(smtp.messages[0]!.raw).toContain('Official page hacked');
      expect(smtp.messages[0]!.raw).toContain(
        'Subject: [SEV1] Incident at Company A: Official page hacked',
      );

      expect(sms.requests.map((r) => r.json.to).sort()).toEqual(
        [mobileOf.owner, mobileOf.cto, mobileOf.sec, mobileOf.gm].sort(),
      );
      for (const r of sms.requests) {
        expect(r.headers.authorization).toBe(`Bearer ${TOKEN}`);
        expect(r.json.text.length).toBeLessThan(300);
        expect(r.json.text).toContain('SEV1');
      }
      const card = JSON.stringify(teams.requests[0]!.json);
      expect(card).toContain('Official page hacked');
      expect(card).toContain('Company A');
      // No personal data in the Teams message: no number, no e-mail address.
      expect(card).not.toMatch(/\+251|@example\.test/);

      const rows = await rowsOf(inc.id);
      expect(rows.every((r) => r.status === 'sent' && r.attempts === 1)).toBe(true);
      const trail = await h.query(
        `select details from audit_events where action = 'alert.sent' and target_id = $1`,
        [inc.id],
      );
      expect(trail).toHaveLength(rows.length);
    });

    it('SEV3 and SEV4 send nothing and write nothing', async () => {
      for (const severity of ['medium', 'low']) {
        const inc = await openIncident(severity);
        expect(await rowsOf(inc.id)).toHaveLength(0);
        expect(
          await h.query(`select 1 from alert_incident_dispatches where incident_id = $1`, [inc.id]),
        ).toHaveLength(0);
      }
      await runSweep();
      expect(teams.requests.length + sms.requests.length + smtp.messages.length).toBe(0);
    });

    it('an incident of another company reaches nobody of this one, and the other way round', async () => {
      const res = await send('POST', '/api/incidents', 'execB', {
        companyId: companyB,
        title: 'Company B problem',
        severity: 'critical',
      });
      const inc = (await json(res)) as { id: string };
      const rows = await rowsOf(inc.id);
      expect(who(rows, 'email')).toEqual(names('execB', 'cto', 'sec', 'gm')); // group-level people serve the whole group
      for (const name of ['owner', 'exec2', 'mm'])
        expect(rows.some((r) => r.recipient_user_id === id(name))).toBe(false);
    });
  });

  // =====================================================================================================
  describe('channels that are not set up, switched off, or below the minimum severity', () => {
    it('a channel with no configuration creates no delivery at all', async () => {
      channels({});
      const inc = await openIncident('critical');
      expect(await rowsOf(inc.id)).toHaveLength(0);
      await runSweep();
      expect(teams.requests.length + sms.requests.length + smtp.messages.length).toBe(0);
    });

    it('only the configured channels create deliveries', async () => {
      channels({ teams: true });
      const onlyTeams = await openIncident('critical');
      expect((await rowsOf(onlyTeams.id)).map((r) => r.channel)).toEqual(['teams']);
      channels({ sms: true, email: true });
      const noTeams = await openIncident('critical');
      expect(new Set((await rowsOf(noTeams.id)).map((r) => r.channel))).toEqual(
        new Set(['sms', 'email']),
      );
    });

    it('half a configuration (an SMS address without a token) is not a configuration', async () => {
      channels({ teams: true });
      process.env.DCC_SMS_GATEWAY_URL = sms.url;
      const inc = await openIncident('critical');
      expect((await rowsOf(inc.id)).map((r) => r.channel)).toEqual(['teams']);
      const status = await json(await send('GET', '/api/alerts/status', 'owner'));
      expect(status.sms).toEqual({ configured: false, reason: 'incomplete' });
    });

    it('a channel switched off for the group creates nothing; switching it on again restores it', async () => {
      const put = (body: object, as = 'groupAdmin') =>
        send('PUT', '/api/alerts/settings', as, body);
      expect(
        (
          await put({
            smsEnabled: false,
            teamsEnabled: true,
            emailEnabled: true,
            minSeverity: 'high',
          })
        ).status,
      ).toBe(200);
      const off = await openIncident('critical');
      expect(new Set((await rowsOf(off.id)).map((r) => r.channel))).toEqual(
        new Set(['teams', 'email']),
      );
      await put({
        smsEnabled: true,
        teamsEnabled: false,
        emailEnabled: false,
        minSeverity: 'high',
      });
      const smsOnly = await openIncident('critical');
      expect(new Set((await rowsOf(smsOnly.id)).map((r) => r.channel))).toEqual(new Set(['sms']));
    });

    it('with the minimum at SEV1, a SEV2 incident sends nothing and a SEV1 still does', async () => {
      const res = await send('PUT', '/api/alerts/settings', 'groupAdmin', {
        smsEnabled: true,
        teamsEnabled: true,
        emailEnabled: true,
        minSeverity: 'critical',
      });
      expect(res.status).toBe(200);
      expect(await rowsOf((await openIncident('high')).id)).toHaveLength(0);
      expect((await rowsOf((await openIncident('critical')).id)).length).toBeGreaterThan(0);
    });
  });

  // =====================================================================================================
  describe('severity raised, lowered, or opened by other code', () => {
    it('raising to SEV2 and then to SEV1 alerts each time; lowering and raising again does not repeat', async () => {
      const inc = await openIncident('medium');
      expect(await rowsOf(inc.id)).toHaveLength(0);

      await patchIncident(inc.id, { severity: 'high' });
      const sev2 = await rowsOf(inc.id);
      expect(who(sev2, 'email')).toEqual(names('owner', 'exec2', 'sec', 'mm'));

      await patchIncident(inc.id, { severity: 'critical' });
      const sev1 = (await rowsOf(inc.id)).length - sev2.length;
      expect(sev1).toBeGreaterThan(0);
      expect(who(await rowsOf(inc.id), 'email')).toContain(id('gm'));

      const total = (await rowsOf(inc.id)).length;
      await patchIncident(inc.id, { severity: 'high' });
      await patchIncident(inc.id, { severity: 'critical' });
      await patchIncident(inc.id, { title: 'Renamed' });
      await runSweep();
      expect(await rowsOf(inc.id)).toHaveLength(total);
    });

    it('lowering never alerts for the lower level', async () => {
      const inc = await openIncident('critical');
      const before = (await rowsOf(inc.id)).length;
      await patchIncident(inc.id, { severity: 'high' });
      await runSweep();
      expect(await rowsOf(inc.id)).toHaveLength(before);
    });

    it('an incident opened by code that knows nothing of alerts is caught by the sweep, once', async () => {
      const [row] = await h.query(
        `insert into incidents (company_id, title, severity, opened_by)
         values ($1, 'Suspected bypass post', 'high', $2) returning id`,
        [companyA, id('owner')],
      );
      expect(await rowsOf(row.id)).toHaveLength(0);
      await runSweep();
      const rows = await rowsOf(row.id);
      expect(who(rows, 'email')).toEqual(names('owner', 'exec2', 'sec', 'mm'));
      await runSweep(new Date(Date.now() + 10 * MINUTE));
      expect(await rowsOf(row.id)).toHaveLength(rows.length);
    });

    it('a resolved or closed incident found by the sweep is not announced', async () => {
      const [row] = await h.query(
        `insert into incidents (company_id, title, severity, status, opened_by)
         values ($1, 'Old news', 'critical', 'resolved', $2) returning id`,
        [companyA, id('owner')],
      );
      await runSweep();
      expect(await rowsOf(row.id)).toHaveLength(0);
    });

    it('a channel that was not configured when the incident opened is not sent later (nothing is pending for ever)', async () => {
      channels({});
      const inc = await openIncident('critical');
      allChannels();
      await runSweep();
      expect(await rowsOf(inc.id)).toHaveLength(0);
    });

    it('the outbox is written in the incident transaction: when the incident is rolled back, so are the alerts', async () => {
      const tenant = h.app.get(TenantDb);
      const marker = 'Rolled back incident';
      await expect(
        tenant.run(ctx(id('owner'), [], [companyA]), async (trx) => {
          const incident = await trx
            .insertInto('incidents')
            .values({
              company_id: companyA,
              title: marker,
              severity: 'critical',
              opened_by: id('owner'),
            })
            .returning(['id', 'company_id', 'title', 'severity', 'opened_by'])
            .executeTakeFirstOrThrow();
          const written = await alerts.enqueueForIncident(trx, incident);
          expect(written).toBeGreaterThan(0);
          const inside = await trx
            .selectFrom('alert_deliveries')
            .select('id')
            .where('incident_id', '=', incident.id)
            .execute();
          expect(inside).toHaveLength(written);
          throw new Error('boom');
        }),
      ).rejects.toThrow('boom');
      expect(await h.query(`select 1 from incidents where title = $1`, [marker])).toHaveLength(0);
      expect(
        await h.query(
          `select 1 from alert_deliveries d where not exists (select 1 from incidents i where i.id = d.incident_id)`,
        ),
      ).toHaveLength(0);
    });
  });

  // =====================================================================================================
  describe('delivery: retries, back-off, final failure', () => {
    const teamsOnly = async () => {
      channels({ teams: true });
      const inc = await openIncident('critical', 'Retry case');
      const [row] = await rowsOf(inc.id);
      return { inc, rowId: row.id as string };
    };
    const state = async (rowId: string) =>
      (
        await h.query(
          `select status, attempts, last_error, next_attempt_at from alert_deliveries where id = $1`,
          [rowId],
        )
      )[0];

    for (const code of [500, 404]) {
      it(`HTTP ${code}: five attempts with 1, 2, 4 and 8 minutes between them, then failed for good`, async () => {
        teams.respond(code);
        const { inc, rowId } = await teamsOnly();
        const t0 = Date.now() + 1_000;
        const at = (minutes: number, seconds = 0) =>
          new Date(t0 + minutes * MINUTE + seconds * 1_000);

        await runSweep(at(0));
        let s = await state(rowId);
        expect([s.status, s.attempts]).toEqual(['pending', 1]);
        expect(s.last_error).toContain(`HTTP ${code}`);
        expect(new Date(s.next_attempt_at).getTime()).toBe(at(1).getTime());

        await runSweep(at(0, 59));
        expect(teams.requests).toHaveLength(1); // not yet

        await runSweep(at(1));
        s = await state(rowId);
        expect(s.attempts).toBe(2);
        expect(new Date(s.next_attempt_at).getTime()).toBe(at(3).getTime());
        await runSweep(at(2, 59));
        expect(teams.requests).toHaveLength(2);

        await runSweep(at(3));
        s = await state(rowId);
        expect(s.attempts).toBe(3);
        expect(new Date(s.next_attempt_at).getTime()).toBe(at(7).getTime());

        await runSweep(at(7));
        s = await state(rowId);
        expect(s.attempts).toBe(4);
        expect(new Date(s.next_attempt_at).getTime()).toBe(at(15).getTime());
        expect(s.status).toBe('pending');

        await runSweep(at(15));
        s = await state(rowId);
        expect([s.status, s.attempts]).toEqual(['failed', 5]);
        expect(teams.requests).toHaveLength(5);

        // Never again, however long we wait.
        await runSweep(at(120));
        await runSweep(at(240));
        expect(teams.requests).toHaveLength(5);

        const failed = await h.query(
          `select details from audit_events where action = 'alert.failed' and target_id = $1`,
          [inc.id],
        );
        expect(failed).toHaveLength(1);
        expect(failed[0].details).toMatchObject({ channel: 'teams', attempts: 5 });
        expect(failed[0].details.error).toContain(`HTTP ${code}`);
        expect(
          await h.query(
            `select 1 from audit_events where action = 'alert.sent' and target_id = $1`,
            [inc.id],
          ),
        ).toHaveLength(0);

        // The alert managers are told once: the group administrator, the Group CTO and the security administrator.
        const told = (
          await h.query(
            `select recipient_user_id from notifications where event_type = 'alert.delivery_failed' and target_id = $1`,
            [inc.id],
          )
        ).map((r) => r.recipient_user_id as string);
        expect(told.sort()).toEqual([id('groupAdmin'), id('cto'), id('sec')].sort());
      });
    }

    it('a later attempt that succeeds ends the retries, is audited as sent once, and is never repeated', async () => {
      teams.respond((n) => (n < 3 ? 503 : 200));
      const { inc, rowId } = await teamsOnly();
      const t0 = Date.now() + 1_000;
      await runSweep(new Date(t0));
      await runSweep(new Date(t0 + 1 * MINUTE));
      await runSweep(new Date(t0 + 3 * MINUTE));
      const s = await state(rowId);
      expect([s.status, s.attempts, s.last_error]).toEqual(['sent', 3, null]);
      await runSweep(new Date(t0 + 60 * MINUTE));
      expect(teams.requests).toHaveLength(3);
      expect(
        await h.query(`select 1 from audit_events where action = 'alert.sent' and target_id = $1`, [
          inc.id,
        ]),
      ).toHaveLength(1);
      expect(
        await h.query(
          `select 1 from notifications where event_type = 'alert.delivery_failed' and target_id = $1`,
          [inc.id],
        ),
      ).toHaveLength(0);
    });

    it('a gateway that does not answer in time is a failed attempt with a plain reason', async () => {
      alerts.transportOptions = { httpTimeoutMs: 150 };
      teams.delay(700);
      const { rowId } = await teamsOnly();
      await runSweep();
      const s = await state(rowId);
      expect([s.status, s.attempts]).toEqual(['pending', 1]);
      expect(s.last_error).toBe('No answer within the time allowed.');
    });

    it('one channel failing does not stop the others', async () => {
      teams.respond(500);
      const inc = await openIncident('high', 'Mixed outcome');
      await runSweep();
      const rows = await rowsOf(inc.id);
      expect(rows.filter((r) => r.channel === 'teams').every((r) => r.status === 'pending')).toBe(
        true,
      );
      expect(rows.filter((r) => r.channel !== 'teams').every((r) => r.status === 'sent')).toBe(
        true,
      );
    });

    it('a mail server that refuses the recipient is a failed attempt that names the code', async () => {
      const refusing = await startFakeSmtp({
        refuse: { at: 'RCPT', reply: '550 5.1.1 No such user' },
      });
      try {
        channels({ email: true });
        process.env.DCC_SMTP_PORT = String(refusing.port);
        process.env.DCC_SMTP_USER = '';
        process.env.DCC_SMTP_PASSWORD = '';
        const inc = await openIncident('high', 'Mail refused');
        await runSweep();
        const rows = await rowsOf(inc.id);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.every((r) => r.status === 'pending' && r.attempts === 1)).toBe(true);
        expect(rows[0]!.last_error).toContain('550');
      } finally {
        await refusing.close();
      }
    });

    it('a delivery whose person lost their number is failed at once and the managers are told', async () => {
      channels({ sms: true });
      const inc = await openIncident('high', 'No number any more');
      await h.query(`delete from alert_contacts where user_id = $1`, [id('mm')]);
      await runSweep();
      const rows = await rowsOf(inc.id);
      const mine = rows.find((r) => r.recipient_user_id === id('mm'))!;
      expect([mine.status, mine.attempts]).toEqual(['failed', 1]);
      expect(mine.last_error).toContain('no longer has a mobile number');
      expect(sms.requests.map((r) => r.json.to)).not.toContain(mobileOf.mm);
      // the others went out
      expect(rows.filter((r) => r.status === 'sent').length).toBe(sms.requests.length);
      await h.query(
        `insert into alert_contacts (group_id, user_id, mobile, updated_by) values ($1, $2, $3, $2)`,
        [groupId, id('mm'), mobileOf.mm],
      );
    });

    it('a channel removed from the server after the incident fails its rows at once instead of waiting for ever', async () => {
      channels({ teams: true });
      const inc = await openIncident('critical', 'Config removed');
      channels({});
      await runSweep();
      const [row] = await rowsOf(inc.id);
      expect(row.status).toBe('failed');
      expect(row.last_error).toContain('no longer configured');
    });

    it('two sweeps at the same moment send each delivery once (rows are claimed first)', async () => {
      channels({ teams: true });
      await openIncident('critical', 'Claimed once');
      const at = new Date(Date.now() + 1_000);
      await Promise.all([alerts.sendDue(companyA, at), alerts.sendDue(companyA, at)]);
      expect(teams.requests).toHaveLength(1);
    });
  });

  // =====================================================================================================
  describe('secrets and numbers stay where they belong', () => {
    it('no token, password, webhook secret or phone number is in an audit entry, a notification, a delivery row, an API answer or a log line', async () => {
      teams.respond((n) => (n === 1 ? 500 : 200)); // at least one failure so the error paths are exercised too
      const inc = await openIncident('critical', 'Leak check');
      await runSweep();
      await runSweep(new Date(Date.now() + 2 * MINUTE));
      await send('POST', '/api/alerts/test', 'cto', { channel: 'sms' });

      const apiAnswers = JSON.stringify([
        await json(await send('GET', '/api/alerts/status', 'cto')),
        await json(await send('GET', `/api/alerts/deliveries?incidentId=${inc.id}`, 'groupAdmin')),
        await json(await send('GET', '/api/alerts/deliveries', 'cto')),
        await json(await send('GET', '/api/alerts/settings', 'cto')),
      ]);
      const stored = await everythingStored();
      for (const secret of [TOKEN, SMTP_PASSWORD, WEBHOOK_SIG, SMTP_USER])
        for (const [place, text] of [
          ['stored rows', stored],
          ['API answers', apiAnswers],
          ['log lines', logged.join('\n')],
        ] as const)
          expect(text, `${secret} in ${place}`).not.toContain(secret);
      for (const mobile of Object.values(mobileOf)) {
        const digits = mobile.slice(1);
        for (const [place, text] of [
          ['stored rows', stored],
          ['API answers', apiAnswers],
          ['log lines', logged.join('\n')],
        ] as const)
          expect(text, `${mobile} in ${place}`).not.toContain(digits);
      }
      expect(stored).not.toContain(teams.url);
    });
  });

  // =====================================================================================================
  describe('settings', () => {
    it('start as the defaults, then are saved, audited with before and after, and read back', async () => {
      const before = await send('GET', '/api/alerts/settings', 'groupAdmin');
      expect(before.status).toBe(200);
      expect(await json(before)).toEqual({
        groupId,
        smsEnabled: true,
        teamsEnabled: true,
        emailEnabled: true,
        minSeverity: 'high',
        updatedAt: null,
      });
      const put = await send('PUT', '/api/alerts/settings', 'groupAdmin', {
        smsEnabled: false,
        teamsEnabled: true,
        emailEnabled: true,
        minSeverity: 'critical',
      });
      expect(put.status).toBe(200);
      const after = await json(await send('GET', '/api/alerts/settings', 'cto'));
      expect(after).toMatchObject({ smsEnabled: false, minSeverity: 'critical' });
      expect(after.updatedAt).not.toBeNull();
      const [event] = await h.query(
        `select details, actor_user_id, group_id from audit_events where action = 'alert.settings_set' order by id desc limit 1`,
      );
      expect(event.actor_user_id).toBe(id('groupAdmin'));
      expect(event.group_id).toBe(groupId);
      expect(event.details.from).toEqual({
        sms: true,
        teams: true,
        email: true,
        minSeverity: 'high',
      });
      expect(event.details.to).toEqual({
        sms: false,
        teams: true,
        email: true,
        minSeverity: 'critical',
      });
    });

    it('need alert.manage: the others are refused at the door', async () => {
      const body = {
        smsEnabled: true,
        teamsEnabled: true,
        emailEnabled: true,
        minSeverity: 'high',
      };
      for (const person of ['adminA', 'owner', 'mm', 'gm', 'auditorA', 'nobody']) {
        expect((await send('GET', '/api/alerts/settings', person)).status, `GET ${person}`).toBe(
          403,
        );
        expect(
          (await send('PUT', '/api/alerts/settings', person, body)).status,
          `PUT ${person}`,
        ).toBe(403);
      }
    });

    it('are checked per group: another group cannot read or change them, and its own are separate', async () => {
      const body = {
        smsEnabled: false,
        teamsEnabled: false,
        emailEnabled: false,
        minSeverity: 'critical',
      };
      expect(
        (await send('GET', `/api/alerts/settings?groupId=${groupId}`, 'foreignCto')).status,
      ).toBe(403);
      expect(
        (await send('PUT', `/api/alerts/settings?groupId=${groupId}`, 'foreignCto', body)).status,
      ).toBe(403);
      expect((await send('PUT', '/api/alerts/settings', 'foreignCto', body)).status).toBe(200);
      const mine = await json(await send('GET', '/api/alerts/settings', 'cto'));
      expect(mine).toMatchObject({ smsEnabled: true, minSeverity: 'high' });
      // and the other group's switches do not touch this group's alerts
      const inc = await openIncident('critical');
      expect((await rowsOf(inc.id)).length).toBeGreaterThan(0);
    });

    it('refuse nonsense', async () => {
      for (const body of [
        { smsEnabled: true, teamsEnabled: true, emailEnabled: true, minSeverity: 'low' },
        { smsEnabled: 'yes', teamsEnabled: true, emailEnabled: true, minSeverity: 'high' },
        { smsEnabled: true },
      ])
        expect((await send('PUT', '/api/alerts/settings', 'groupAdmin', body)).status).toBe(400);
    });
  });

  // =====================================================================================================
  describe('contacts', () => {
    it('a person sets their own number, which only they and the alert managers see in full', async () => {
      const put = await setContact('adminA', '+251 91 123 4567');
      expect(put.status).toBe(200);
      expect(await json(put)).toMatchObject({
        contact: { mobile: '+251911234567', own: true, masked: false },
      });

      const mine = await json(await send('GET', '/api/alerts/contacts', 'adminA'));
      expect(mine.canManage).toBe(false);
      // Their own line in full; everyone else's hidden (only the last two digits).
      const own = mine.contacts.find((c: { userId: string }) => c.userId === id('adminA'));
      expect(own).toMatchObject({ mobile: '+251911234567', own: true, masked: false });
      const others = mine.contacts.filter((c: { userId: string }) => c.userId !== id('adminA'));
      expect(others.length).toBeGreaterThan(0);
      expect(
        others.every((c: { masked: boolean; mobile: string }) => c.masked && /\*\*/.test(c.mobile)),
      ).toBe(true);
      expect(JSON.stringify(others)).not.toContain('25191100');

      const seenByExec = await json(await send('GET', '/api/alerts/contacts', 'owner'));
      const writerLine = seenByExec.contacts.find(
        (c: { userId: string }) => c.userId === id('adminA'),
      );
      expect(writerLine).toMatchObject({ mobile: '+251 9** *** 67', masked: true, own: false });
      expect(JSON.stringify(seenByExec)).not.toContain('2519112345');
      const ownLine = seenByExec.contacts.find((c: { userId: string }) => c.userId === id('owner'));
      expect(ownLine.mobile).toBe(mobileOf.owner);

      const seenByManager = await json(await send('GET', '/api/alerts/contacts', 'groupAdmin'));
      expect(seenByManager.canManage).toBe(true);
      expect(
        seenByManager.contacts.find((c: { userId: string }) => c.userId === id('adminA')),
      ).toMatchObject({ mobile: '+251911234567', masked: false });
      const seenByCto = await json(await send('GET', '/api/alerts/contacts', 'cto'));
      expect(seenByCto.contacts.every((c: { masked: boolean }) => !c.masked)).toBe(true);
    });

    it('the stored number is sealed, never plain text, and an old plain row still opens', async () => {
      await setContact('adminA', '+251 91 123 4567');
      const stored = (
        await h.query(`select mobile from alert_contacts where user_id = $1`, [id('adminA')])
      )[0].mobile as string;
      expect(stored).not.toContain('251911234567');
      expect(stored).not.toContain('2519112');
      expect(stored).toMatch(/^v1./);
      // a row written before the number was sealed (plain text) still reads, and is shown as the same number
      await h.query(`update alert_contacts set mobile = $2 where user_id = $1`, [
        id('adminA'),
        '+251911234567',
      ]);
      const plain = await json(await send('GET', '/api/alerts/contacts', 'adminA'));
      expect(
        plain.contacts.find((c: { userId: string }) => c.userId === id('adminA')),
      ).toMatchObject({ mobile: '+251911234567' });
      // saving it again seals it
      await setContact('adminA', '+251911234567');
      const resealed = (
        await h.query(`select mobile from alert_contacts where user_id = $1`, [id('adminA')])
      )[0].mobile as string;
      expect(resealed).not.toContain('251911234567');
    });

    it('only an alert manager sets someone else, and only someone who belongs to the group', async () => {
      expect((await setContact('owner', '+251922000001', { userId: id('adminA') })).status).toBe(
        403,
      );
      expect((await setContact('mm', '+251922000001', { userId: id('adminA') })).status).toBe(403);
      const ok = await setContact('groupAdmin', '+251922000001', { userId: id('exec2') });
      expect(ok.status).toBe(200);
      expect(await json(ok)).toMatchObject({ contact: { own: false, userId: id('exec2') } });
      expect((await setContact('cto', '+251922000002', { userId: id('exec2') })).status).toBe(200);
      const stranger = await setContact('groupAdmin', '+251922000003', {
        userId: id('foreignCto'),
      });
      expect(stranger.status).toBe(404);
      await setContact('groupAdmin', null, { userId: id('exec2') });
    });

    it('refuses numbers that are not in international form', async () => {
      for (const mobile of [
        '0911234567',
        '251911234567',
        '+25191',
        '+2519112345678901',
        'call me',
        '+251-abc',
      ]) {
        const res = await setContact('adminA', mobile);
        expect(res.status, mobile).toBe(400);
      }
      expect((await send('PUT', '/api/alerts/contacts', 'adminA', {})).status).toBe(400);
    });

    it('a number can be removed, and the audit entries never carry it', async () => {
      await setContact('adminA', '+251933444555');
      const gone = await setContact('adminA', null);
      expect(gone.status).toBe(200);
      expect(await json(gone)).toEqual({ contact: null });
      const list = await json(await send('GET', '/api/alerts/contacts', 'groupAdmin'));
      expect(list.contacts.some((c: { userId: string }) => c.userId === id('adminA'))).toBe(false);
      const trail = JSON.stringify(
        await h.query(`select details from audit_events where action = 'alert.contact_set'`),
      );
      expect(trail).not.toMatch(/2519\d{8}/);
      expect(trail).toContain('"cleared":true');
      expect(trail).toContain('"cleared":false');
    });

    it("another group cannot read or set this group's contacts, and nobody without a membership can use them", async () => {
      expect(
        (await send('GET', `/api/alerts/contacts?groupId=${groupId}`, 'foreignCto')).status,
      ).toBe(403);
      expect(
        (await setContact('foreignCto', '+251944000001', { groupId, userId: id('cto') })).status,
      ).toBe(403);
      expect((await setContact('foreignCto', '+251944000001', { groupId })).status).toBe(403);
      const theirs = await json(await send('GET', '/api/alerts/contacts', 'foreignCto'));
      expect(theirs.groupId).toBe(h.f.group2Id);
      expect(theirs.contacts).toEqual([]);
      for (const [method, path] of [
        ['GET', '/api/alerts/contacts'],
        ['GET', '/api/alerts/status'],
      ] as const)
        expect((await send(method, path, 'nobody')).status).toBe(403);
      expect((await setContact('nobody', '+251944000002')).status).toBe(403);
    });

    it("a company-level person cannot change a colleague's number from their own seat", async () => {
      const cto = (
        await h.query(`select mobile from alert_contacts where user_id = $1`, [id('cto')])
      )[0].mobile;
      expect((await setContact('exec2', '+251955000000', { userId: id('cto') })).status).toBe(403);
      expect(
        (await h.query(`select mobile from alert_contacts where user_id = $1`, [id('cto')]))[0]
          .mobile,
      ).toBe(cto);
    });
  });

  // =====================================================================================================
  describe('deliveries and status', () => {
    it('the delivery list is for alert managers, filters by status and incident, and shows no number', async () => {
      teams.respond(500);
      const a = await openIncident('critical', 'List one');
      const b = await openIncident('high', 'List two');
      await runSweep();

      for (const person of ['groupAdmin', 'cto', 'sec']) {
        const res = await send('GET', `/api/alerts/deliveries?incidentId=${a.id}`, person);
        expect(res.status, person).toBe(200);
        const list = await json(res);
        expect(list.length).toBe((await rowsOf(a.id)).length);
        expect(list.every((d: { incidentId: string }) => d.incidentId === a.id)).toBe(true);
        expect(list[0]).toHaveProperty('incidentTitle', 'List one');
      }
      const pending = await json(
        await send('GET', `/api/alerts/deliveries?status=pending&incidentId=${a.id}`, 'cto'),
      );
      expect(pending.map((d: { channel: string }) => d.channel)).toEqual(['teams']);
      expect(pending[0]).toMatchObject({
        attempts: 1,
        lastError: expect.stringContaining('HTTP 500'),
      });
      expect(pending[0].nextAttemptAt).not.toBeNull();
      const sent = await json(
        await send('GET', `/api/alerts/deliveries?status=sent&incidentId=${b.id}`, 'cto'),
      );
      expect(sent.every((d: { status: string }) => d.status === 'sent')).toBe(true);
      const text = JSON.stringify([pending, sent]);
      expect(text).not.toMatch(/\+251/);
      expect(text).not.toContain('"body"');
      expect((await send('GET', '/api/alerts/deliveries?limit=0', 'cto')).status).toBe(400);
      expect((await send('GET', '/api/alerts/deliveries?status=lost', 'cto')).status).toBe(400);
    });

    it('is refused to everyone without alert.manage, and shows another group nothing', async () => {
      for (const person of ['adminA', 'owner', 'mm', 'gm', 'auditorA', 'nobody'])
        expect((await send('GET', '/api/alerts/deliveries', person)).status, person).toBe(403);
      await openIncident('critical');
      const foreign = await json(await send('GET', '/api/alerts/deliveries', 'foreignCto'));
      expect(foreign).toEqual([]);
    });

    it('the status route answers which channels work, as booleans and a reason code, never a value', async () => {
      channels({ teams: true, sms: true });
      const res = await send('GET', '/api/alerts/status', 'adminA');
      expect(res.status).toBe(200);
      const status = await json(res);
      expect(status).toEqual({
        teams: { configured: true, reason: 'ok' },
        sms: { configured: true, reason: 'ok' },
        email: { configured: false, reason: 'not_set' },
      });
      const text = JSON.stringify(status);
      for (const secret of [TOKEN, WEBHOOK_SIG, '127.0.0.1', 'http'])
        expect(text).not.toContain(secret);
    });
  });

  // =====================================================================================================
  describe('test alert', () => {
    it("SMS goes to the caller's own number only and says what happened", async () => {
      const res = await send('POST', '/api/alerts/test', 'cto', { channel: 'sms' });
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({ channel: 'sms', outcome: 'sent' });
      expect(sms.requests).toHaveLength(1);
      expect(sms.requests[0]!.json.to).toBe(mobileOf.cto);
      expect(sms.requests[0]!.json.text).toContain('TEST');
      expect(teams.requests.length + smtp.messages.length).toBe(0);
      const [event] = await h.query(
        `select details, group_id from audit_events where action = 'alert.sent' and target_type = 'alert_test'`,
      );
      expect(event.details).toEqual({ test: true, channel: 'sms' });
      expect(JSON.stringify(event)).not.toContain('2519');
    });

    it("e-mail goes to the caller's account address", async () => {
      const res = await send('POST', '/api/alerts/test', 'adminA', { channel: 'email' });
      expect(await json(res)).toMatchObject({ channel: 'email', outcome: 'sent' });
      const [{ email }] = await h.query(`select email from users where id = $1`, [id('adminA')]);
      expect(smtp.messages).toHaveLength(1);
      expect(smtp.messages[0]!.to).toEqual([email]);
    });

    it('Teams posts to the shared channel and only an alert manager may do it', async () => {
      expect((await send('POST', '/api/alerts/test', 'adminA', { channel: 'teams' })).status).toBe(
        403,
      );
      expect((await send('POST', '/api/alerts/test', 'owner', { channel: 'teams' })).status).toBe(
        403,
      );
      const ok = await send('POST', '/api/alerts/test', 'cto', { channel: 'teams' });
      expect(await json(ok)).toMatchObject({ outcome: 'sent' });
      expect(teams.requests).toHaveLength(1);
    });

    it('says plainly when a channel is not set up, switched off, or the person has no number', async () => {
      channels({ teams: true });
      const notSet = await json(await send('POST', '/api/alerts/test', 'cto', { channel: 'sms' }));
      expect(notSet).toMatchObject({ outcome: 'not_configured' });
      expect(notSet.message).toContain('not set up');
      allChannels();
      const noNumber = await json(
        await send('POST', '/api/alerts/test', 'exec2', { channel: 'sms' }),
      );
      expect(noNumber).toMatchObject({ outcome: 'no_contact' });
      await send('PUT', '/api/alerts/settings', 'groupAdmin', {
        smsEnabled: false,
        teamsEnabled: true,
        emailEnabled: true,
        minSeverity: 'high',
      });
      const off = await json(await send('POST', '/api/alerts/test', 'cto', { channel: 'sms' }));
      expect(off).toMatchObject({ outcome: 'disabled' });
      expect(sms.requests).toHaveLength(0);
    });

    it('reports a failure of the gateway and audits it as failed', async () => {
      sms.respond(502);
      const res = await json(await send('POST', '/api/alerts/test', 'sec', { channel: 'sms' }));
      expect(res.outcome).toBe('failed');
      expect(res.message).toContain('HTTP 502');
      expect(res.message).not.toContain(TOKEN);
      expect(
        await h.query(
          `select 1 from audit_events where action = 'alert.failed' and target_type = 'alert_test'`,
        ),
      ).toHaveLength(1);
    });

    it('a second test on the same channel within half a minute is refused (it costs a real message)', async () => {
      expect((await send('POST', '/api/alerts/test', 'mm', { channel: 'sms' })).status).toBe(200);
      const again = await send('POST', '/api/alerts/test', 'mm', { channel: 'sms' });
      expect(again.status).toBe(429);
      expect(sms.requests).toHaveLength(1);
      // another channel or another person is not held up
      expect((await send('POST', '/api/alerts/test', 'mm', { channel: 'email' })).status).toBe(200);
      expect((await send('POST', '/api/alerts/test', 'sec', { channel: 'sms' })).status).toBe(200);
    });

    it('nobody without a membership can send one, and nonsense is refused', async () => {
      expect((await send('POST', '/api/alerts/test', 'nobody', { channel: 'email' })).status).toBe(
        403,
      );
      expect((await send('POST', '/api/alerts/test', 'cto', { channel: 'pigeon' })).status).toBe(
        400,
      );
      expect(
        (await send('POST', `/api/alerts/test`, 'foreignCto', { channel: 'sms', groupId })).status,
      ).toBe(403);
    });
  });
});
