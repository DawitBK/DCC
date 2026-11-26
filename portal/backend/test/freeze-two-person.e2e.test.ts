import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { PlanHarness } from './plan-harness';

/**
 * Round 2, D2-17 and D2-18: a freeze tied to a SEV1 or SEV2 incident (critical or high) is lifted only by two
 * confirmations from two different people, one holding security.manage (security_admin, group_cto: group-level
 * roles) and one holding publishing.lift_comms (company_executive, group_marketing). Any other freeze keeps the
 * one-person unfreeze.
 */
describe('two-person freeze lift (D2-17, D2-18)', () => {
  const h = new PlanHarness();
  const { send, json } = h;
  let groupId: string;
  let group2Id: string;
  let companyA: string;
  let companyB: string;
  const ids = (name: string) => h.userIds.get(name)!;

  const incident = async (severity: string, company = companyA, title = 'Test incident') => {
    const who = company === companyA ? 'comms1' : 'execB';
    const res = await send('POST', '/api/incidents', who, { companyId: company, title, severity });
    expect(res.status).toBe(201);
    return (await json(res)) as { id: string };
  };
  const freeze = (who: string, body: Record<string, unknown> = {}) =>
    send('POST', '/api/publishing-freezes', who, { companyId: companyA, ...body });
  const confirm = (
    who: string,
    freezeId: string,
    side: 'security' | 'communications',
    note?: string,
  ) =>
    send(
      'POST',
      `/api/publishing-freezes/${freezeId}/lift-confirmations/${side}`,
      who,
      note ? { note } : {},
    );
  const withdraw = (who: string, freezeId: string, side: 'security' | 'communications') =>
    send('DELETE', `/api/publishing-freezes/${freezeId}/lift-confirmations/${side}`, who);
  const unfreeze = (who: string, freezeId: string) =>
    send('DELETE', `/api/publishing-freezes/${freezeId}`, who);
  const freezeCount = async () =>
    Number((await h.query(`select count(*) as n from publishing_freezes`))[0].n);
  const notified = async (eventType: string, targetId: string): Promise<string[]> =>
    (
      await h.query(
        `select recipient_user_id from notifications where event_type = $1 and target_id = $2`,
        [eventType, targetId],
      )
    ).map((r) => r.recipient_user_id as string);
  const audits = async (action: string, targetId: string) =>
    h.query(`select details from audit_events where action = $1 and target_id = $2 order by id`, [
      action,
      targetId,
    ]);

  beforeAll(async () => {
    await h.start();
    ({ groupId, group2Id, companyA, companyB } = {
      groupId: h.f.groupId,
      group2Id: h.f.group2Id,
      companyA: h.f.companyA,
      companyB: h.f.companyB,
    });
    // Security side: group-level roles.
    await h.persona('sec1', [{ role: 'security_admin', companyId: null, groupId }]);
    await h.persona('sec2', [{ role: 'security_admin', companyId: null, groupId }]);
    await h.persona('cto', [{ role: 'group_cto', companyId: null, groupId }]);
    // Communications side: the company's executive, and group marketing (group-level).
    await h.persona('comms1', [{ role: 'company_executive', companyId: companyA, groupId }]);
    await h.persona('comms2', [{ role: 'company_executive', companyId: companyA, groupId }]);
    await h.persona('gm', [{ role: 'group_marketing', companyId: null, groupId }]);
    // One person who holds BOTH permissions (two roles).
    await h.persona('both', [
      { role: 'security_admin', companyId: null, groupId },
      { role: 'company_executive', companyId: companyA, groupId },
    ]);
    // Attackers: another company of the same group, another group.
    await h.persona('execB', [{ role: 'company_executive', companyId: companyB, groupId }]);
    await h.persona('foreignSec', [{ role: 'security_admin', companyId: null, groupId: group2Id }]);
    await h.persona('foreignGm', [{ role: 'group_marketing', companyId: null, groupId: group2Id }]);
    await h.persona('writer', [{ role: 'content_creator', companyId: companyA, groupId }]);
  });
  afterAll(async () => {
    await h.stop();
  });
  beforeEach(async () => {
    await h.query(`delete from publishing_freezes`);
  });

  it('a freeze tied to a SEV1 incident is a two-person freeze; tied to SEV3 or SEV4, or to nothing, it is not', async () => {
    const sev1 = await incident('critical');
    const created = await json(
      await freeze('adminA', { incidentId: sev1.id, reason: 'Hacked page' }),
    );
    expect(created).toMatchObject({
      incidentId: sev1.id,
      incidentSeverity: 'critical',
      twoPersonLift: true,
      liftConfirmations: [],
      liftMissing: ['security', 'communications'],
    });
    await h.query(`delete from publishing_freezes`);

    for (const severity of ['medium', 'low']) {
      const minor = await incident(severity);
      const f = await json(await freeze('adminA', { incidentId: minor.id }));
      expect(f).toMatchObject({ twoPersonLift: false, liftMissing: [] });
      await h.query(`delete from publishing_freezes`);
    }
    const plain = await json(await freeze('adminA'));
    expect(plain).toMatchObject({ incidentId: null, twoPersonLift: false, liftMissing: [] });
  });

  it('SEV2 (high) is a two-person freeze too', async () => {
    const sev2 = await incident('high');
    const f = await json(await freeze('adminA', { incidentId: sev2.id }));
    expect(f.twoPersonLift).toBe(true);
  });

  it('a freeze without an incident, or tied to a SEV3, still lifts with the old one-person route', async () => {
    const plain = await json(await freeze('adminA'));
    expect((await unfreeze('adminA', plain.id)).status).toBe(204);
    const sev3 = await incident('medium');
    const tied = await json(await freeze('adminA', { incidentId: sev3.id }));
    expect((await unfreeze('adminA', tied.id)).status).toBe(204);
    expect(await freezeCount()).toBe(0);
  });

  it('the old unfreeze route refuses a two-person freeze and names what is missing', async () => {
    const sev1 = await incident('critical');
    const f = await json(await freeze('adminA', { incidentId: sev1.id }));
    const refused = await unfreeze('adminA', f.id);
    expect(refused.status).toBe(409);
    const message = (await json(refused)).message as string;
    expect(message).toContain('two confirmations');
    expect(message).toContain('security side');
    expect(message).toContain('communications side');
    expect(await freezeCount()).toBe(1);

    expect((await confirm('sec1', f.id, 'security')).status).toBe(200);
    const again = (await json(await unfreeze('adminA', f.id))).message as string;
    expect(again).toContain('communications side');
    expect(again).not.toContain('security side');
    expect(await freezeCount()).toBe(1);
  });

  it('both sides, two different people: the first notifies the other side, the second lifts and notifies everyone concerned', async () => {
    const sev1 = await incident('critical', companyA, 'Page hacked');
    const f = await json(await freeze('adminA', { incidentId: sev1.id }));

    const first = await confirm('sec1', f.id, 'security', 'Credentials rotated, safe to resume');
    expect(first.status).toBe(200);
    const firstBody = await json(first);
    expect(firstBody.lifted).toBe(false);
    expect(firstBody.freeze.liftMissing).toEqual(['communications']);
    expect(firstBody.freeze.liftConfirmations[0]).toMatchObject({
      side: 'security',
      confirmedBy: ids('sec1'),
      note: 'Credentials rotated, safe to resume',
    });
    // The communications side is told, the security side (and the confirmer) is not.
    const requested = await notified('incident.freeze_lift_requested', f.id);
    expect(requested).toEqual(expect.arrayContaining([ids('comms1'), ids('comms2'), ids('gm')]));
    expect(requested).not.toContain(ids('sec1'));
    expect(requested).not.toContain(ids('sec2'));
    expect(await freezeCount()).toBe(1);

    const second = await confirm('comms1', f.id, 'communications');
    expect(second.status).toBe(200);
    expect(await json(second)).toMatchObject({ lifted: true, freeze: null });
    expect(await freezeCount()).toBe(0);

    const lifted = await notified('incident.freeze_lifted', f.id);
    expect(lifted).toEqual(
      expect.arrayContaining([ids('sec1'), ids('sec2'), ids('gm'), ids('comms2')]),
    );
    expect(lifted).not.toContain(ids('comms1')); // the actor
    expect(new Set(lifted).size).toBe(lifted.length); // nobody is told twice

    const confirmations = await audits('publishing.freeze_lift_confirmed', f.id);
    expect(confirmations.map((r) => r.details.side)).toEqual(['security', 'communications']);
    expect(confirmations[1].details.lifted).toBe(true);
    const unfrozen = await audits('publishing.unfrozen', f.id);
    expect(unfrozen).toHaveLength(1);
    expect(unfrozen[0].details.confirmedBy).toEqual([ids('sec1'), ids('comms1')]);
  });

  it('the order does not matter: communications first, then security (a group-level CTO)', async () => {
    const sev2 = await incident('high');
    const f = await json(await freeze('adminA', { incidentId: sev2.id }));
    expect((await confirm('gm', f.id, 'communications')).status).toBe(200);
    const notifiedSecurity = await notified('incident.freeze_lift_requested', f.id);
    expect(notifiedSecurity).toEqual(expect.arrayContaining([ids('sec1'), ids('cto')]));
    expect(await json(await confirm('cto', f.id, 'security'))).toMatchObject({ lifted: true });
    expect(await freezeCount()).toBe(0);
  });

  it('one person who holds both permissions can give only one of the two confirmations', async () => {
    const sev1 = await incident('critical');
    const f = await json(await freeze('adminA', { incidentId: sev1.id }));
    expect((await confirm('both', f.id, 'security')).status).toBe(200);
    const second = await confirm('both', f.id, 'communications');
    expect(second.status).toBe(409);
    expect((await json(second)).message).toContain('different person');
    expect(await freezeCount()).toBe(1);
    // ... and the same side again, by the same person, is refused too.
    expect((await confirm('both', f.id, 'security')).status).toBe(409);
    // A second, different person on the other side finishes it.
    expect(await json(await confirm('comms1', f.id, 'communications'))).toMatchObject({
      lifted: true,
    });
    expect(await freezeCount()).toBe(0);
  });

  it('a side that has already confirmed cannot be confirmed again by someone else', async () => {
    const sev1 = await incident('critical');
    const f = await json(await freeze('adminA', { incidentId: sev1.id }));
    expect((await confirm('sec1', f.id, 'security')).status).toBe(200);
    const again = await confirm('sec2', f.id, 'security');
    expect(again.status).toBe(409);
    expect(await freezeCount()).toBe(1);
  });

  it('a confirmation can be withdrawn by its giver, only by the giver, and then the side is open again', async () => {
    const sev1 = await incident('critical');
    const f = await json(await freeze('adminA', { incidentId: sev1.id }));
    expect((await confirm('sec1', f.id, 'security')).status).toBe(200);

    // Someone else on the same side cannot withdraw it; nor can the other side.
    expect((await withdraw('sec2', f.id, 'security')).status).toBe(403);
    expect((await withdraw('comms1', f.id, 'security')).status).toBe(403);
    expect((await withdraw('comms1', f.id, 'communications')).status).toBe(404); // nothing to withdraw

    const withdrawn = await withdraw('sec1', f.id, 'security');
    expect(withdrawn.status).toBe(200);
    expect(await json(withdrawn)).toMatchObject({
      liftConfirmations: [],
      liftMissing: ['security', 'communications'],
    });
    // The confirmation stays on record, marked withdrawn.
    const rows = await h.query(
      `select side, withdrawn_at from freeze_lift_confirmations where freeze_id = $1`,
      [f.id],
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].withdrawn_at).not.toBeNull();
    const trail = await audits('publishing.freeze_lift_confirmed', f.id);
    expect(trail.map((r) => r.details.event)).toEqual(['confirmed', 'withdrawn']);

    // The comms side alone is no longer enough; a different security person can now confirm.
    expect((await confirm('comms1', f.id, 'communications')).status).toBe(200);
    expect(await freezeCount()).toBe(1);
    expect(await json(await confirm('sec2', f.id, 'security'))).toMatchObject({ lifted: true });
    expect(await freezeCount()).toBe(0);
  });

  it('after a withdrawal the same person may confirm again, on the other side or the same one', async () => {
    const sev1 = await incident('critical');
    const f = await json(await freeze('adminA', { incidentId: sev1.id }));
    expect((await confirm('both', f.id, 'security')).status).toBe(200);
    expect((await withdraw('both', f.id, 'security')).status).toBe(200);
    expect((await confirm('both', f.id, 'communications')).status).toBe(200);
    expect(await json(await confirm('sec1', f.id, 'security'))).toMatchObject({ lifted: true });
  });

  it('a freeze tied to a minor incident that becomes SEV1 later needs two people', async () => {
    const minor = await incident('medium');
    const f = await json(await freeze('adminA', { incidentId: minor.id }));
    expect(f.twoPersonLift).toBe(false);
    const raised = await send('PATCH', `/api/incidents/${minor.id}`, 'comms1', {
      severity: 'critical',
    });
    expect(raised.status).toBe(200);
    expect((await unfreeze('adminA', f.id)).status).toBe(409);
    expect((await confirm('sec1', f.id, 'security')).status).toBe(200);
  });

  it('lowering the severity of a SEV1 incident does not turn its freeze back into a one-person one', async () => {
    const sev1 = await incident('critical');
    const f = await json(await freeze('adminA', { incidentId: sev1.id }));
    expect(
      (await send('PATCH', `/api/incidents/${sev1.id}`, 'comms1', { severity: 'low' })).status,
    ).toBe(200);
    expect((await unfreeze('adminA', f.id)).status).toBe(409);
    expect(await freezeCount()).toBe(1);
  });

  it('confirming a freeze that needs only one person is refused and points to the normal unfreeze', async () => {
    const plain = await json(await freeze('adminA'));
    const refused = await confirm('sec1', plain.id, 'security');
    expect(refused.status).toBe(409);
    expect((await json(refused)).message).toContain('normal unfreeze');
  });

  it('each side has its own permission: the wrong side is refused, and so is a person with neither', async () => {
    const sev1 = await incident('critical');
    const f = await json(await freeze('adminA', { incidentId: sev1.id }));
    expect((await confirm('comms1', f.id, 'security')).status).toBe(403); // holds lift_comms only
    expect((await confirm('sec1', f.id, 'communications')).status).toBe(403); // holds security.manage only
    expect((await confirm('writer', f.id, 'security')).status).toBe(403);
    expect((await confirm('writer', f.id, 'communications')).status).toBe(403);
    expect((await confirm('adminA', f.id, 'security')).status).toBe(403);
    expect((await withdraw('writer', f.id, 'security')).status).toBe(403);
    expect(
      await h.query(`select 1 from freeze_lift_confirmations where freeze_id = $1`, [f.id]),
    ).toHaveLength(0);
    expect(await freezeCount()).toBe(1);
  });

  it('the communications side sees the freeze through its own list; the freeze list stays for people who may freeze', async () => {
    const sev1 = await incident('critical');
    const f = await json(await freeze('adminA', { incidentId: sev1.id }));
    const asGm = await send('GET', '/api/publishing-freezes/for-communications', 'gm');
    expect(asGm.status).toBe(200);
    expect((await json(asGm)).map((x: { id: string }) => x.id)).toEqual([f.id]);
    expect((await send('GET', '/api/publishing-freezes', 'gm')).status).toBe(403);
    // The security side lists it the normal way.
    const asSec = await json(await send('GET', '/api/publishing-freezes', 'sec1'));
    expect(asSec.map((x: { id: string }) => x.id)).toEqual([f.id]);
    expect(asSec[0]).toMatchObject({ incidentTitle: 'Test incident', twoPersonLift: true });
    // A person with neither permission cannot list through the communications route.
    expect((await send('GET', '/api/publishing-freezes/for-communications', 'sec1')).status).toBe(
      403,
    );
  });

  it('another company or another group cannot see, confirm, withdraw or tie to this', async () => {
    const sev1 = await incident('critical');
    const f = await json(await freeze('adminA', { incidentId: sev1.id }));
    expect((await confirm('sec1', f.id, 'security')).status).toBe(200);

    // Company B's executive holds lift_comms for B only: the freeze of A does not exist for them.
    expect((await confirm('execB', f.id, 'communications')).status).toBe(404);
    expect((await withdraw('execB', f.id, 'communications')).status).toBe(404);
    expect(
      await json(await send('GET', '/api/publishing-freezes/for-communications', 'execB')),
    ).toEqual([]);
    // Another group's security and marketing people: same.
    expect((await confirm('foreignSec', f.id, 'security')).status).toBe(404);
    expect((await confirm('foreignGm', f.id, 'communications')).status).toBe(404);
    expect((await withdraw('foreignSec', f.id, 'security')).status).toBe(404);
    expect(await json(await send('GET', '/api/publishing-freezes', 'foreignSec'))).toEqual([]);
    expect(
      await json(await send('GET', '/api/publishing-freezes/for-communications', 'foreignGm')),
    ).toEqual([]);

    // Nothing changed.
    const rows = await h.query(
      `select side, withdrawn_at from freeze_lift_confirmations where freeze_id = $1`,
      [f.id],
    );
    expect(rows).toEqual([{ side: 'security', withdrawn_at: null }]);
    expect(await freezeCount()).toBe(1);
  });

  it('an incident of another company cannot be tied to a freeze, and an unknown one is not found', async () => {
    const otherCompanyIncident = await incident('critical', companyB);
    // Company A's freeze cannot point at company B's incident (404: it does not exist in company A).
    expect((await freeze('adminA', { incidentId: otherCompanyIncident.id })).status).toBe(404);
    expect(
      (await freeze('adminA', { incidentId: '11111111-1111-4111-8111-111111111111' })).status,
    ).toBe(404);
    // The database refuses it as well, whatever the code does.
    await expect(
      h.query(
        `insert into publishing_freezes (company_id, frozen_by, incident_id) values ($1, $2, $3)`,
        [companyA, ids('adminA'), otherCompanyIncident.id],
      ),
    ).rejects.toThrow();
    expect(await freezeCount()).toBe(0);
  });

  it('tying needs the right to read the incident, and a closed incident cannot be tied', async () => {
    const sev1 = await incident('critical');
    // group_admin may freeze but holds no incident.read.
    const refused = await send('POST', '/api/publishing-freezes', 'groupAdmin', {
      companyId: companyA,
      incidentId: sev1.id,
    });
    expect(refused.status).toBe(403);
    const minor = await incident('low');
    await send('PATCH', `/api/incidents/${minor.id}`, 'comms1', { status: 'closed' });
    const closed = await freeze('adminA', { incidentId: minor.id });
    expect(closed.status).toBe(409);
    expect(await freezeCount()).toBe(0);
  });

  it('freezing for the group of another company still needs publishing.freeze there', async () => {
    const res = await send('POST', '/api/publishing-freezes', 'execB', { companyId: companyA });
    expect(res.status).toBe(404);
  });

  it('a lifted freeze can be frozen again, and the second freeze starts without any confirmation', async () => {
    const sev1 = await incident('critical');
    const first = await json(await freeze('adminA', { incidentId: sev1.id }));
    await confirm('sec1', first.id, 'security');
    await confirm('comms1', first.id, 'communications');
    expect(await freezeCount()).toBe(0);
    const second = await json(await freeze('adminA', { incidentId: sev1.id }));
    expect(second.id).not.toBe(first.id);
    expect(second.liftConfirmations).toEqual([]);
    expect(second.liftMissing).toEqual(['security', 'communications']);
  });
});
