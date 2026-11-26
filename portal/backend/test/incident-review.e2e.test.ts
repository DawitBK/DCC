import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SweepService } from '../src/modules/working-hours/sweep.service';
import { DEFAULT_CALENDAR } from '../src/modules/shared/working-time';
import { reviewDueAt, reviewReminderAt } from '../src/modules/incidents/incident-review.service';
import { appUrl } from './helpers';
import { PlanHarness } from './plan-harness';

/** Round 2, D2-23: every SEV1 and SEV2 incident needs a recorded post-incident review before it can be closed. */
describe('post-incident review (D2-23)', () => {
  const h = new PlanHarness();
  const { send, json } = h;
  let groupId: string;
  let companyA: string;
  let companyB: string;
  const ids = (name: string) => h.userIds.get(name)!;

  const review = (overrides: Record<string, unknown> = {}) => ({
    cause: 'A stale admin credential was reused.',
    impact: 'One post was visible for twelve minutes.',
    response: 'The account was frozen and the credential rotated.',
    correctiveActions: 'Rotate every admin credential of the page.',
    preventiveMeasures: 'Two-factor sign-in for every admin.',
    participants: ['Security Administrator', 'Digital Marketing Manager'],
    heldAt: new Date(Date.now() - 60_000).toISOString(),
    ...overrides,
  });
  const open = async (severity: string, title = 'Incident', who = 'exec') => {
    const res = await send('POST', '/api/incidents', who, {
      companyId: companyA,
      title,
      severity,
    });
    expect(res.status).toBe(201);
    const created = (await json(res)) as { id: string };
    // Opened two days ago, so that a review held an hour ago is a believable review.
    await h.query(`update incidents set opened_at = now() - interval '2 days' where id = $1`, [
      created.id,
    ]);
    return created;
  };
  const patch = (id: string, body: unknown, who = 'exec') =>
    send('PATCH', `/api/incidents/${id}`, who, body);
  const putReview = (id: string, body: unknown, who = 'exec') =>
    send('PUT', `/api/incidents/${id}/review`, who, body);
  const get = async (id: string, who = 'exec') =>
    json(await send('GET', `/api/incidents/${id}`, who));
  const notified = async (eventType: string, targetId: string): Promise<string[]> =>
    (
      await h.query(
        `select recipient_user_id from notifications where event_type = $1 and target_id = $2`,
        [eventType, targetId],
      )
    ).map((r) => r.recipient_user_id as string);

  beforeAll(async () => {
    await h.start();
    ({ groupId, companyA, companyB } = {
      groupId: h.f.groupId,
      companyA: h.f.companyA,
      companyB: h.f.companyB,
    });
    // incident.manage: company_executive (company), group_cto (group). incident.read only: company_admin.
    await h.persona('exec', [{ role: 'company_executive', companyId: companyA, groupId }]);
    await h.persona('exec2', [{ role: 'company_executive', companyId: companyA, groupId }]);
    await h.persona('cto', [{ role: 'group_cto', companyId: null, groupId }]);
    await h.persona('gm', [{ role: 'group_marketing', companyId: null, groupId }]);
    await h.persona('execB', [{ role: 'company_executive', companyId: companyB, groupId }]);
    await h.persona('foreignCto', [{ role: 'group_cto', companyId: null, groupId: h.f.group2Id }]);
    await h.persona('writer', [{ role: 'content_creator', companyId: companyA, groupId }]);
  });
  afterAll(async () => {
    await h.stop();
  });

  describe('closing', () => {
    it('a SEV1 or SEV2 incident cannot be closed without a review: 409 that says what is missing', async () => {
      for (const severity of ['critical', 'high']) {
        const inc = await open(severity);
        const res = await patch(inc.id, { status: 'closed' });
        expect(res.status).toBe(409);
        const message = (await json(res)).message as string;
        expect(message).toContain('post-incident review');
        expect(message).toContain('cause');
        expect(message).toContain('preventive measures');
        expect((await get(inc.id)).status).toBe('open');
      }
    });

    it('a SEV3 or SEV4 incident closes without a review', async () => {
      for (const severity of ['medium', 'low']) {
        const inc = await open(severity);
        const res = await patch(inc.id, { status: 'closed' });
        expect(res.status).toBe(200);
        expect(await json(res)).toMatchObject({ status: 'closed', reviewRequired: false });
      }
    });

    it('with the review recorded, a SEV1 closes; it is audited as incident.closed and the others are told', async () => {
      const inc = await open('critical', 'Hacked page');
      expect((await putReview(inc.id, review())).status).toBe(200);
      const closed = await patch(inc.id, { status: 'resolved' });
      expect(closed.status).toBe(200);
      const res = await patch(inc.id, { status: 'closed' });
      expect(res.status).toBe(200);
      expect(await json(res)).toMatchObject({
        status: 'closed',
        reviewRequired: true,
        reviewOverdue: false,
        review: { cause: 'A stale admin credential was reused.' },
      });
      const trail = await h.query(
        `select details from audit_events where action = 'incident.closed' and target_id = $1`,
        [inc.id],
      );
      expect(trail).toHaveLength(1);
      expect(trail[0].details).toMatchObject({ from: 'resolved', to: 'closed' });
      expect(trail[0].details.reviewId).toBeTruthy();
      const told = await notified('incident.closed', inc.id);
      expect(told).toEqual(expect.arrayContaining([ids('exec2'), ids('cto')]));
      expect(told).not.toContain(ids('exec')); // the person who closed it
    });

    it('lowering the severity does not remove the need for a review', async () => {
      const inc = await open('critical');
      const res = await patch(inc.id, { severity: 'low', status: 'closed' });
      expect(res.status).toBe(409);
      expect(await patch(inc.id, { severity: 'low' })).toHaveProperty('status', 200);
      const after = await get(inc.id);
      expect(after).toMatchObject({ severity: 'low', reviewRequired: true });
      expect((await patch(inc.id, { status: 'closed' })).status).toBe(409);
      expect((await putReview(inc.id, review())).status).toBe(200);
      expect((await patch(inc.id, { status: 'closed' })).status).toBe(200);
    });

    it('raising a SEV3 to SEV1 in the same request as closing it also needs the review', async () => {
      const inc = await open('medium');
      expect((await patch(inc.id, { severity: 'critical', status: 'closed' })).status).toBe(409);
    });

    it('the database marks an incident that is high or critical, whoever inserts it, and never clears the mark', async () => {
      const [row] = await h.query(
        `insert into incidents (company_id, title, severity, opened_by) values ($1, 'Detector', 'high', $2) returning id, review_required`,
        [companyA, ids('exec')],
      );
      expect(row.review_required).toBe(true);
      await h.query(`update incidents set severity = 'low' where id = $1`, [row.id]);
      const [after] = await h.query(`select review_required from incidents where id = $1`, [
        row.id,
      ]);
      expect(after.review_required).toBe(true);
      const [minor] = await h.query(
        `insert into incidents (company_id, title, severity, opened_by) values ($1, 'Minor', 'low', $2) returning review_required`,
        [companyA, ids('exec')],
      );
      expect(minor.review_required).toBe(false);
    });

    it('a closed incident can be reopened and closed again without a second review', async () => {
      const inc = await open('high');
      await putReview(inc.id, review());
      await patch(inc.id, { status: 'closed' });
      expect((await patch(inc.id, { status: 'investigating' })).status).toBe(200);
      expect((await patch(inc.id, { status: 'closed' })).status).toBe(200);
    });
  });

  describe('recording', () => {
    it('needs incident.manage for the incident: readers, writers and other companies are refused', async () => {
      const inc = await open('critical');
      expect((await putReview(inc.id, review(), 'adminA')).status).toBe(403); // incident.read only
      expect((await putReview(inc.id, review(), 'writer')).status).toBe(403);
      expect((await putReview(inc.id, review(), 'execB')).status).toBe(404);
      expect((await putReview(inc.id, review(), 'foreignCto')).status).toBe(404);
      expect((await putReview(inc.id, review(), 'gm')).status).toBe(403); // no incident.manage
      expect(
        await h.query(`select 1 from incident_reviews where incident_id = $1`, [inc.id]),
      ).toHaveLength(0);
      // The group-level CTO may.
      expect((await putReview(inc.id, review(), 'cto')).status).toBe(200);
    });

    it('another company cannot read the review either', async () => {
      const inc = await open('critical');
      await putReview(inc.id, review());
      expect((await send('GET', `/api/incidents/${inc.id}`, 'execB')).status).toBe(404);
      expect((await send('GET', `/api/incidents/${inc.id}`, 'foreignCto')).status).toBe(404);
      const list = await json(await send('GET', '/api/incidents', 'execB'));
      expect(list.map((i: { id: string }) => i.id)).not.toContain(inc.id);
      const rows = await h.owner(async (db) =>
        db.query(`select count(*)::int as n from incident_reviews where company_id = $1`, [
          companyB,
        ]),
      );
      expect(rows.rows[0].n).toBe(0);
    });

    it('stores cause, impact, response, actions, measures, participants and the time it was held; shows who recorded it', async () => {
      const inc = await open('high');
      const heldAt = new Date(Date.now() - 3_600_000).toISOString();
      const res = await putReview(inc.id, review({ heldAt }));
      expect(res.status).toBe(200);
      const body = await json(res);
      expect(body).toMatchObject({
        incidentId: inc.id,
        cause: 'A stale admin credential was reused.',
        impact: 'One post was visible for twelve minutes.',
        response: 'The account was frozen and the credential rotated.',
        correctiveActions: 'Rotate every admin credential of the page.',
        preventiveMeasures: 'Two-factor sign-in for every admin.',
        participants: ['Security Administrator', 'Digital Marketing Manager'],
        heldAt,
        recordedBy: ids('exec'),
      });
      expect(body.recordedByName).toBe('exec');
      const fetched = await get(inc.id);
      expect(fetched.review).toMatchObject({ id: body.id, heldAt });
      const trail = await h.query(
        `select details from audit_events where action = 'incident.review_recorded' and target_id = $1`,
        [inc.id],
      );
      expect(trail).toHaveLength(1);
      expect(trail[0].details).toMatchObject({ corrected: false, participants: 2 });
      // The text of the review is not copied into the audit trail.
      expect(JSON.stringify(trail[0].details)).not.toContain('stale admin credential');
    });

    it('can be corrected before closing (one review per incident), and not after', async () => {
      const inc = await open('critical');
      const first = await json(await putReview(inc.id, review()));
      const second = await json(
        await putReview(inc.id, review({ cause: 'The cause was a phishing mail.' }), 'cto'),
      );
      expect(second.id).toBe(first.id);
      expect(second.cause).toBe('The cause was a phishing mail.');
      expect(second.recordedBy).toBe(ids('exec')); // who first recorded it stays
      expect(
        await h.query(`select 1 from incident_reviews where incident_id = $1`, [inc.id]),
      ).toHaveLength(1);
      const trail = await h.query(
        `select details from audit_events where action = 'incident.review_recorded' and target_id = $1 order by id`,
        [inc.id],
      );
      expect(trail.map((t) => t.details.corrected)).toEqual([false, true]);
      await patch(inc.id, { status: 'closed' });
      const late = await putReview(inc.id, review());
      expect(late.status).toBe(409);
    });

    it('refuses empty text, no participants, a missing time, and times that cannot be true', async () => {
      const inc = await open('critical');
      for (const bad of [
        review({ cause: '' }),
        review({ impact: '  ' }),
        review({ response: 'x' }),
        review({ correctiveActions: undefined }),
        review({ preventiveMeasures: '' }),
        review({ participants: [] }),
        review({ participants: [''] }),
        review({ heldAt: undefined }),
        review({ heldAt: 'yesterday' }),
      ])
        expect((await putReview(inc.id, bad)).status).toBe(400);
      const future = await putReview(
        inc.id,
        review({ heldAt: new Date(Date.now() + 3_600_000).toISOString() }),
      );
      expect(future.status).toBe(409);
      const beforeOpened = await putReview(
        inc.id,
        review({ heldAt: new Date(Date.now() - 3 * 86_400_000).toISOString() }),
      );
      expect(beforeOpened.status).toBe(409);
      expect(
        await h.query(`select 1 from incident_reviews where incident_id = $1`, [inc.id]),
      ).toHaveLength(0);
    });

    it('an unknown incident is a 404', async () => {
      const res = await putReview('22222222-2222-4222-8222-222222222222', review());
      expect(res.status).toBe(404);
    });
  });

  describe('the review fields of the incident', () => {
    it('the clock starts when the incident is first resolved, and reopening never restarts it', async () => {
      const inc = await open('critical');
      const fresh = await get(inc.id);
      expect(fresh).toMatchObject({
        reviewRequired: true,
        reviewDueAt: null,
        reviewOverdue: false,
      });

      const resolved = await json(await patch(inc.id, { status: 'resolved' }));
      expect(resolved.reviewDueAt).toBeTruthy();
      const [{ first_resolved_at }] = await h.query(
        `select first_resolved_at from incidents where id = $1`,
        [inc.id],
      );
      expect(resolved.reviewDueAt).toBe(
        reviewDueAt(first_resolved_at as Date, DEFAULT_CALENDAR).toISOString(),
      );

      await patch(inc.id, { status: 'investigating' });
      const reopened = await get(inc.id);
      expect(reopened.resolvedAt).toBeNull();
      expect(reopened.reviewDueAt).toBe(resolved.reviewDueAt); // still counting from the first time
      await patch(inc.id, { status: 'resolved' });
      const again = await get(inc.id);
      expect(again.reviewDueAt).toBe(resolved.reviewDueAt);
      const [after] = await h.query(`select first_resolved_at from incidents where id = $1`, [
        inc.id,
      ]);
      expect((after.first_resolved_at as Date).getTime()).toBe(
        (first_resolved_at as Date).getTime(),
      );
    });

    it('resolved and then closed keeps the time it was resolved', async () => {
      const inc = await open('low');
      const resolved = await json(await patch(inc.id, { status: 'resolved' }));
      const closed = await json(await patch(inc.id, { status: 'closed' }));
      expect(closed.resolvedAt).toBe(resolved.resolvedAt);
    });

    it('is overdue after the due time until the review is recorded; SEV3 never is', async () => {
      const inc = await open('critical');
      await patch(inc.id, { status: 'resolved' });
      await h.query(
        `update incidents set first_resolved_at = now() - interval '30 days' where id = $1`,
        [inc.id],
      );
      const late = await get(inc.id);
      expect(late).toMatchObject({ reviewRequired: true, reviewOverdue: true });
      // Closing stays blocked while overdue.
      expect((await patch(inc.id, { status: 'closed' })).status).toBe(409);
      const listed = (await json(await send('GET', '/api/incidents', 'exec'))).find(
        (i: { id: string }) => i.id === inc.id,
      );
      expect(listed.reviewOverdue).toBe(true);
      await putReview(inc.id, review());
      expect(await get(inc.id)).toMatchObject({
        reviewOverdue: false,
        review: { id: expect.any(String) },
      });

      const minor = await open('medium');
      await patch(minor.id, { status: 'resolved' });
      await h.query(
        `update incidents set first_resolved_at = now() - interval '30 days' where id = $1`,
        [minor.id],
      );
      expect(await get(minor.id)).toMatchObject({
        reviewRequired: false,
        reviewDueAt: null,
        reviewOverdue: false,
        review: null,
      });
    });

    it('uses the company calendar: a holiday moves the due time', async () => {
      const inc = await open('high');
      await patch(inc.id, { status: 'resolved' });
      const resolvedAt = new Date('2026-03-04T07:00:00Z');
      await h.query(`update incidents set first_resolved_at = $2 where id = $1`, [
        inc.id,
        resolvedAt,
      ]);
      expect((await get(inc.id)).reviewDueAt).toBe('2026-03-10T14:30:00.000Z');
      await h.query(
        `insert into company_working_hours (company_id, holidays, updated_by) values ($1, '{2026-03-09}', $2)
         on conflict (company_id) do update set holidays = excluded.holidays`,
        [companyA, ids('exec')],
      );
      expect((await get(inc.id)).reviewDueAt).toBe('2026-03-11T14:30:00.000Z');
      await h.query(`delete from company_working_hours where company_id = $1`, [companyA]);
    });
  });

  describe('the sweep', () => {
    const FIRST_RESOLVED = new Date('2026-03-04T07:00:00Z'); // Wednesday 10:00 local
    const due = reviewDueAt(FIRST_RESOLVED, DEFAULT_CALENDAR);
    const reminder = reviewReminderAt(FIRST_RESOLVED, DEFAULT_CALENDAR);
    const minute = 60_000;
    let sweep: SweepService;

    const resolvedIncident = async (severity: string, title: string) => {
      const inc = await open(severity, title);
      await patch(inc.id, { status: 'resolved' });
      await h.query(`update incidents set first_resolved_at = $2 where id = $1`, [
        inc.id,
        FIRST_RESOLVED,
      ]);
      return inc;
    };
    const levels = async (id: string) =>
      (
        await h.query(
          `select level from escalation_events where kind = 'incident_review' and target_id = $1 order by level`,
          [id],
        )
      ).map((r) => r.level as number);

    beforeAll(() => {
      sweep = h.app.get(SweepService);
    });

    it('does nothing before the reminder time', async () => {
      const inc = await resolvedIncident('critical', 'Sweep early');
      expect(await sweep.runOnce(new Date(reminder.getTime() - minute))).toEqual([]);
      expect(await levels(inc.id)).toEqual([]);
      expect(await notified('incident.review_due', inc.id)).toEqual([]);
    });

    it('one business day before the due time it reminds the incident managers, once however often it runs', async () => {
      const inc = await resolvedIncident('high', 'Sweep reminder');
      expect(await sweep.runOnce(reminder)).toEqual([]);
      expect(await sweep.runOnce(new Date(reminder.getTime() + 5 * minute))).toEqual([]);
      const told = await notified('incident.review_due', inc.id);
      // incident.manage holders: company executives of the company, group CTO and security administrators.
      expect(told).toEqual(expect.arrayContaining([ids('exec'), ids('exec2'), ids('cto')]));
      expect(new Set(told).size).toBe(told.length);
      expect(told).not.toContain(ids('gm')); // not an incident manager
      expect(told).not.toContain(ids('execB')); // another company
      expect(told).not.toContain(ids('foreignCto'));
      expect(await levels(inc.id)).toEqual([1]);
      expect(await notified('incident.review_overdue', inc.id)).toEqual([]);
    });

    it('when overdue it tells the managers and the escalation roles, once; the reminder is not sent again', async () => {
      const inc = await resolvedIncident('critical', 'Sweep overdue');
      await sweep.runOnce(reminder);
      const dueBefore = (await notified('incident.review_due', inc.id)).length;
      expect(await sweep.runOnce(new Date(due.getTime() - minute))).toEqual([]);
      expect(await notified('incident.review_overdue', inc.id)).toEqual([]);

      await sweep.runOnce(new Date(due.getTime() + minute));
      await sweep.runOnce(new Date(due.getTime() + 60 * minute));
      const overdue = await notified('incident.review_overdue', inc.id);
      expect(overdue).toEqual(
        expect.arrayContaining([ids('exec'), ids('exec2'), ids('cto'), ids('gm')]),
      );
      expect(new Set(overdue).size).toBe(overdue.length);
      expect(overdue).not.toContain(ids('execB'));
      expect(await notified('incident.review_due', inc.id)).toHaveLength(dueBefore);
      expect(await levels(inc.id)).toEqual([1, 2]);
      // Closing stays blocked while it is overdue.
      expect((await patch(inc.id, { status: 'closed' })).status).toBe(409);
    });

    it('a sweep that first wakes up after the due time sends the overdue notice only', async () => {
      const inc = await resolvedIncident('critical', 'Sweep late');
      await sweep.runOnce(new Date(due.getTime() + minute));
      expect(await notified('incident.review_due', inc.id)).toEqual([]);
      expect((await notified('incident.review_overdue', inc.id)).length).toBeGreaterThan(0);
      expect(await levels(inc.id)).toEqual([1, 2]);
    });

    it('stops when the review is recorded, and ignores SEV3 and SEV4, unresolved and closed incidents', async () => {
      const done = await resolvedIncident('critical', 'Sweep reviewed');
      await putReview(done.id, review());
      const minor = await resolvedIncident('medium', 'Sweep minor');
      const unresolved = await open('critical', 'Sweep unresolved');
      await sweep.runOnce(new Date(due.getTime() + minute));
      for (const inc of [done, minor, unresolved]) {
        expect(await levels(inc.id)).toEqual([]);
        expect(await notified('incident.review_overdue', inc.id)).toEqual([]);
      }
    });

    it('a holiday moves the reminder and the overdue notice', async () => {
      const inc = await resolvedIncident('critical', 'Sweep holiday');
      await h.query(
        `insert into company_working_hours (company_id, holidays, updated_by) values ($1, '{2026-03-09}', $2)
         on conflict (company_id) do update set holidays = excluded.holidays`,
        [companyA, ids('exec')],
      );
      // Without the holiday this moment is already overdue; with it, due is still a day away.
      await sweep.runOnce(new Date(due.getTime() + minute));
      expect(await notified('incident.review_overdue', inc.id)).toEqual([]);
      expect(await levels(inc.id)).toEqual([1]);
      const movedDue = new Date('2026-03-11T14:30:00Z');
      await sweep.runOnce(new Date(movedDue.getTime() + minute));
      expect((await notified('incident.review_overdue', inc.id)).length).toBeGreaterThan(0);
      await h.query(`delete from company_working_hours where company_id = $1`, [companyA]);
    });

    it('the sweep only ever notifies: it closes nothing and records no review', async () => {
      const inc = await resolvedIncident('critical', 'Sweep passive');
      await sweep.runOnce(new Date(due.getTime() + 10 * 24 * 60 * minute));
      const [row] = await h.query(`select status from incidents where id = $1`, [inc.id]);
      expect(row.status).toBe('resolved');
      expect(
        await h.query(`select 1 from incident_reviews where incident_id = $1`, [inc.id]),
      ).toHaveLength(0);
    });

    it('escalation rows of one company are invisible to another', async () => {
      const inc = await resolvedIncident('critical', 'Sweep isolation');
      await sweep.runOnce(new Date(due.getTime() + minute));
      const db = new pg.Client({ connectionString: appUrl() });
      await db.connect();
      let rows: number | null;
      try {
        await db.query('begin');
        await db.query(`select set_config('app.user_id', $1, true)`, [ids('execB')]);
        await db.query(`select set_config('app.company_ids', $1, true)`, [companyB]);
        await db.query(`select set_config('app.group_ids', '', true)`);
        rows = (await db.query(`select 1 from escalation_events where target_id = $1`, [inc.id]))
          .rowCount;
        await db.query('rollback');
      } finally {
        await db.end();
      }
      expect(rows).toBe(0);
    });
  });
  describe('row-level security of the new tables (attack tests)', () => {
    /** Runs `fn` as the application role, inside company B only, the way a request of a company B person runs. */
    const asCompanyB = async <T>(fn: (db: pg.Client) => Promise<T>): Promise<T> => {
      const db = new pg.Client({ connectionString: appUrl() });
      await db.connect();
      try {
        await db.query('begin');
        await db.query(`select set_config('app.user_id', $1, true)`, [ids('execB')]);
        await db.query(`select set_config('app.company_ids', $1, true)`, [companyB]);
        await db.query(`select set_config('app.group_ids', '', true)`);
        return await fn(db);
      } finally {
        await db.query('rollback').catch(() => undefined);
        await db.end();
      }
    };

    it("company B sees none of company A's reviews or lift confirmations", async () => {
      const inc = await open('critical', 'Isolation');
      await putReview(inc.id, review());
      await h.query(
        `insert into freeze_lift_confirmations (company_id, freeze_id, side, confirmed_by)
         values ($1, gen_random_uuid(), 'security', $2)`,
        [companyA, ids('cto')],
      );
      const seen = await asCompanyB(async (db) => ({
        reviews: (await db.query(`select 1 from incident_reviews`)).rowCount,
        confirmations: (await db.query(`select 1 from freeze_lift_confirmations`)).rowCount,
      }));
      expect(seen).toEqual({ reviews: 0, confirmations: 0 });
    });

    it('company B cannot write a review or a confirmation for company A, nor change or delete company A rows', async () => {
      const inc = await open('critical', 'Isolation writes');
      const written = await putReview(inc.id, review());
      expect(written.status).toBe(200);
      await expect(
        asCompanyB((db) =>
          db.query(
            `insert into incident_reviews (company_id, incident_id, cause, impact, response, corrective_actions, preventive_measures, participants, held_at, recorded_by, updated_by, updated_at)
             values ($1, $2, 'xxx', 'xxx', 'xxx', 'xxx', 'xxx', '{a b}', now(), $3, $3, now())`,
            [companyA, inc.id, ids('execB')],
          ),
        ),
      ).rejects.toThrow();
      await expect(
        asCompanyB((db) =>
          db.query(
            `insert into freeze_lift_confirmations (company_id, freeze_id, side, confirmed_by)
             values ($1, gen_random_uuid(), 'communications', $2)`,
            [companyA, ids('execB')],
          ),
        ),
      ).rejects.toThrow();
      const touched = await asCompanyB(async (db) => ({
        reviews: (await db.query(`update incident_reviews set cause = 'hijacked'`)).rowCount,
        confirmations: (await db.query(`update freeze_lift_confirmations set withdrawn_at = now()`))
          .rowCount,
      }));
      expect(touched).toEqual({ reviews: 0, confirmations: 0 });
      await expect(asCompanyB((db) => db.query(`delete from incident_reviews`))).rejects.toThrow(); // no DELETE grant
      const [row] = await h.query(`select cause from incident_reviews where incident_id = $1`, [
        inc.id,
      ]);
      expect(row.cause).toBe('A stale admin credential was reused.');
    });
  });
});
