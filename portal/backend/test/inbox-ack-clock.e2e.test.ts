import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SweepService } from '../src/modules/working-hours/sweep.service';
import { startHarness, type Harness } from './replies-harness';

/**
 * Round 2 integration: an automatic acknowledgement (E-13) makes the engine report the message as replied, but it is
 * never the first response, so the response clock of the inbox (E-05, E-06) must keep running and escalate.
 * The two features were built apart; this is the test that they agree.
 */
describe('an acknowledged message is still unanswered for the response clock', () => {
  let h: Harness;

  const sunday = (() => {
    const d = new Date();
    d.setUTCHours(12, 0, 0, 0);
    d.setUTCDate(d.getUTCDate() + 2);
    while (d.getUTCDay() !== 0) d.setUTCDate(d.getUTCDate() + 1);
    return d;
  })();
  const at = (days: number, hours: number, minutes = 0) => {
    const d = new Date(sunday);
    d.setUTCDate(d.getUTCDate() + days);
    d.setUTCHours(hours, minutes, 0, 0);
    return d;
  };

  beforeAll(async () => {
    h = await startHarness();
  });
  afterAll(async () => {
    await h.stop();
  });

  it('the sweep still creates the row and escalates a message the engine says is replied only because of the acknowledgement', async () => {
    const put = await h.send('PUT', '/api/inbox/acknowledgement', 'mgrA', {
      companyId: h.f.companyA,
      textEn: 'Thank you. We answer during working hours.',
      textAm: 'አመሰግናለሁ። ቡድናችን በሥራ ሰዓት ይመልሳል።',
      enabled: true,
    });
    expect(put.status).toBeLessThan(300);
    const version = (await h.json(put)).version;
    const approved = await h.send('POST', '/api/inbox/acknowledgement/approve', 'execA', {
      companyId: h.f.companyA,
      version,
    });
    expect(approved.status).toBeLessThan(300);

    h.addMessage('clock-ack-1', { receivedAt: at(0, 12) }); // Sunday 15:00 local: outside working hours
    const sweeps = h.app.get(SweepService);

    // Monday 10:00 local: the acknowledgement goes out. The fake engine now reports the message as replied.
    expect(await sweeps.runOnce(at(1, 7))).toEqual([]);
    expect(h.fake.replies.filter((r) => r.engineMessageId === 'clock-ack-1')).toHaveLength(1);
    expect(h.fake.inboxMessages.find((m) => m.engineMessageId === 'clock-ack-1')?.replied).toBe(
      true,
    );

    // Monday 17:00 local: the clock started at 08:30 Monday (a night or Sunday arrival starts at the next opening),
    // 510 working minutes have passed, more than 200% of the normal 240-minute target.
    expect(await sweeps.runOnce(at(1, 14))).toEqual([]);
    const items = await h.query(
      `select id, first_response_at from inbox_items where engine_message_id = 'clock-ack-1'`,
    );
    expect(items).toHaveLength(1);
    expect(items[0].first_response_at).toBeNull();
    const levels = await h.query(
      `select level from escalation_events where kind = 'inbox' and target_id = $1 order by level`,
      [items[0].id],
    );
    expect(levels.map((l) => l.level)).toEqual([1, 2, 3]);
  });

  it('a message the engine reports as replied with no acknowledgement behind it is still left alone', async () => {
    h.addMessage('clock-plain-replied', { receivedAt: at(0, 12), replied: true });
    expect(await h.app.get(SweepService).runOnce(at(1, 14))).toEqual([]);
    expect(
      await h.query(`select id from inbox_items where engine_message_id = 'clock-plain-replied'`),
    ).toHaveLength(0);
  });
});
