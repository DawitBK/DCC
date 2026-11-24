import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, type Database } from '../src/platform/database/database';
import { TenantDb } from '../src/platform/tenancy/tenant-db';
import { appUrl, ctx } from './helpers';
import { PlanHarness } from './plan-harness';

/**
 * H-06 incident detail: the STRUCTURE for categories, playbooks and recovery contacts. Nothing is shipped; every
 * word below is made up by the test. Two companies of group 1 (A, B) and one of group 2.
 *   exec-A / exec-B   company_executive (incident.read + incident.manage) of A / B
 *   reader-A          company_admin of A (incident.read only)
 *   creator-A         content_creator of A (no incident permission at all)
 *   cto-1 / cto-2     group_cto of group 1 / group 2 (group-level incident.read + incident.manage)
 */
describe('incident categories, playbooks and recovery contacts (H-06)', () => {
  const h = new PlanHarness();
  const { send, json } = h;
  let g1: string;
  let g2: string;
  let A: string;
  let B: string;
  let C2: string;
  let database: Database;
  const ids: Record<string, string> = {};

  const count = async (table: string) =>
    (await h.query(`select count(*)::int as n from ${table}`))[0].n as number;
  const playbook = {
    title: 'Account taken over',
    steps: ['Change the password', 'Tell the owner'],
  };

  beforeAll(async () => {
    await h.start();
    g1 = h.f.groupId;
    g2 = h.f.group2Id;
    A = h.f.companyA;
    B = h.f.companyB;
    C2 = h.f.company2;
    await h.persona('exec-A', [{ role: 'company_executive', companyId: A, groupId: g1 }]);
    await h.persona('exec-B', [{ role: 'company_executive', companyId: B, groupId: g1 }]);
    await h.persona('reader-A', [{ role: 'company_admin', companyId: A, groupId: g1 }]);
    await h.persona('creator-A', [{ role: 'content_creator', companyId: A, groupId: g1 }]);
    await h.persona('cto-1', [{ role: 'group_cto', companyId: null, groupId: g1 }]);
    await h.persona('cto-2', [{ role: 'group_cto', companyId: null, groupId: g2 }]);
    database = createDatabase(appUrl(), 1);
  });
  afterAll(async () => {
    await database.close();
    await h.stop();
  });

  it('ships with nothing: no category, no playbook, no contact, and an incident has none', async () => {
    expect(await count('incident_categories')).toBe(0);
    expect(await count('incident_recovery_contacts')).toBe(0);
    expect(await json(await send('GET', '/api/incident-categories', 'cto-1'))).toEqual([]);
    expect(await json(await send('GET', '/api/incident-contacts', 'cto-1'))).toEqual([]);
    const incident = await json(
      await send('POST', '/api/incidents', 'exec-A', { companyId: A, title: 'Plain incident' }),
    );
    expect(incident).toMatchObject({ categoryId: null, category: null, recoveryContacts: [] });
    ids.plainIncident = incident.id;
  });

  describe('categories', () => {
    it('a company manager creates a company category with a playbook; it is audited', async () => {
      const response = await send('POST', '/api/incident-categories', 'exec-A', {
        companyId: A,
        key: 'account-takeover',
        name: 'Account takeover',
        playbook,
      });
      expect(response.status).toBe(201);
      const category = await json(response);
      expect(category).toEqual({
        id: expect.any(String),
        groupId: g1,
        companyId: A,
        key: 'account-takeover',
        name: 'Account takeover',
        status: 'active',
        playbook,
      });
      ids.catA = category.id;
      const bare = await json(
        await send('POST', '/api/incident-categories', 'exec-A', {
          companyId: A,
          key: 'no-playbook',
          name: 'Without a playbook',
        }),
      );
      expect(bare.playbook).toBeNull();
      ids.catBare = bare.id;
      const audit = await h.query(
        `select company_id, details from audit_events where action = 'incident_category.created' order by id`,
      );
      expect(audit).toHaveLength(2);
      expect(audit.every((r) => r.company_id === A)).toBe(true);
      expect(audit[0].details).toMatchObject({ key: 'account-takeover', hasPlaybook: true });
    });

    it('a group-level holder creates the group default, offered to every company of the group', async () => {
      const response = await send('POST', '/api/incident-categories', 'cto-1', {
        key: 'outage',
        name: 'Platform outage',
        playbook: { title: 'Outage', steps: ['Check the status page'] },
      });
      expect(response.status).toBe(201);
      const category = await json(response);
      expect(category).toMatchObject({ groupId: g1, companyId: null });
      ids.catDefault = category.id;
      // A company-less event carries its group (H-18), so only that group's auditors read it.
      const stamped = await h.query(
        `select group_id from audit_events where action = 'incident_category.created' and target_id = $1`,
        [category.id],
      );
      expect(stamped[0].group_id).toBe(g1);
      // The same key may exist as a company category next to the default; a repeat in the same place is a 409.
      expect(
        (
          await send('POST', '/api/incident-categories', 'exec-A', {
            companyId: A,
            key: 'outage',
            name: 'Our own outage',
          })
        ).status,
      ).toBe(201);
      for (const [body, who] of [
        [{ companyId: A, key: 'outage', name: 'Again' }, 'exec-A'],
        [{ key: 'outage', name: 'Again' }, 'cto-1'],
      ] as const)
        expect((await send('POST', '/api/incident-categories', who, body)).status).toBe(409);
    });

    it('lists what the caller may read: own company plus the group default, never another company or group', async () => {
      const keys = async (who: string, qs = '') =>
        (await json(await send('GET', `/api/incident-categories${qs}`, who)))
          .map(
            (c: any) =>
              `${c.companyId === null ? 'default' : c.companyId === A ? 'A' : 'other'}:${c.key}`,
          )
          .sort();
      expect(await keys('exec-A')).toEqual([
        'A:account-takeover',
        'A:no-playbook',
        'A:outage',
        'default:outage',
      ]);
      expect(await keys('reader-A', `?companyId=${A}`)).toEqual(await keys('exec-A'));
      // Company B sees only the default, and the group's company-level lists stay apart.
      expect(await keys('exec-B')).toEqual(['default:outage']);
      expect(await keys('exec-B', `?companyId=${B}`)).toEqual(['default:outage']);
      // The group-level holder sees all of group 1.
      expect(await keys('cto-1')).toHaveLength(4);
      // Group 2 sees nothing of group 1, with or without a filter.
      expect(await keys('cto-2')).toEqual([]);
      expect(await keys('cto-2', `?companyId=${C2}`)).toEqual([]);
    });

    it('asking for another company or group by id answers 404, never a list', async () => {
      for (const [who, company] of [
        ['exec-B', A],
        ['exec-A', B],
        ['exec-A', C2],
        ['cto-2', A],
        ['cto-1', C2],
      ] as const) {
        expect(
          (await send('GET', `/api/incident-categories?companyId=${company}`, who)).status,
          `${who} categories of ${company}`,
        ).toBe(404);
        expect(
          (await send('GET', `/api/incident-contacts?companyId=${company}`, who)).status,
          `${who} contacts of ${company}`,
        ).toBe(404);
      }
    });

    it('permissions: read needs incident.read, writing needs incident.manage for that scope', async () => {
      expect((await send('GET', '/api/incident-categories', 'creator-A')).status).toBe(403);
      expect((await send('GET', '/api/incident-contacts', 'creator-A')).status).toBe(403);
      expect(
        (
          await send('POST', '/api/incident-categories', 'reader-A', {
            companyId: A,
            key: 'nope',
            name: 'Nope',
          })
        ).status,
      ).toBe(403);
      // A company-level manager cannot write the group default, nor change it.
      expect(
        (await send('POST', '/api/incident-categories', 'exec-A', { key: 'nope', name: 'Nope' }))
          .status,
      ).toBe(403);
      expect(
        (
          await send('PATCH', `/api/incident-categories/${ids.catDefault}`, 'exec-A', {
            name: 'Hijack',
          })
        ).status,
      ).toBe(403);
      // ...nor another company's.
      expect(
        (
          await send('POST', '/api/incident-categories', 'exec-A', {
            companyId: B,
            key: 'nope',
            name: 'Nope',
          })
        ).status,
      ).toBe(404);
      // A group-level holder of group 1 manages the companies of group 1 but not group 2.
      expect(
        (
          await send('POST', '/api/incident-categories', 'cto-1', {
            companyId: C2,
            key: 'nope',
            name: 'Nope',
          })
        ).status,
      ).toBe(404);
      expect(await count('incident_categories')).toBe(4);
    });

    it("another company's or group's person cannot change a category, whatever the id", async () => {
      for (const who of ['exec-B', 'cto-2']) {
        for (const id of [ids.catA, ids.catBare]) {
          expect(
            (await send('PATCH', `/api/incident-categories/${id}`, who, { name: 'Hijacked' }))
              .status,
            `${who} on ${id}`,
          ).toBe(404);
        }
      }
      // group 2 cannot touch the group default of group 1 either
      expect(
        (
          await send('PATCH', `/api/incident-categories/${ids.catDefault}`, 'cto-2', {
            name: 'Taken over',
          })
        ).status,
      ).toBe(404);
      const names = await h.query(`select name from incident_categories where id = $1`, [ids.catA]);
      expect(names[0].name).toBe('Account takeover');
    });

    it('the database itself refuses a forged row: another company, or a company with the wrong group', async () => {
      const tenant = new TenantDb(database);
      const asB = ctx(h.userIds.get('exec-B')!, [], [B]);
      const insert = (groupId: string, companyId: string | null, key: string) =>
        tenant.run(asB, (trx) =>
          trx
            .insertInto('incident_categories')
            .values({
              group_id: groupId,
              company_id: companyId,
              key,
              name: 'Forged',
              created_by: h.userIds.get('exec-B')!,
            })
            .execute(),
        );
      await expect(insert(g1, A, 'forged-1')).rejects.toThrow(); // company A is not B's
      await expect(insert(g2, B, 'forged-2')).rejects.toThrow(); // B's company, the other group
      await expect(insert(g1, null, 'forged-3')).rejects.toThrow(); // the group default needs a group-level role
      const update = await tenant.run(asB, (trx) =>
        trx
          .updateTable('incident_categories')
          .set({ name: 'Forged' })
          .where('id', '=', ids.catA!)
          .returning('id')
          .execute(),
      );
      expect(update).toEqual([]);
      expect(await count('incident_categories')).toBe(4);
    });

    it('validation: key, name, playbook size and plain text', async () => {
      const bad = async (body: Record<string, unknown>, why: string) =>
        expect(
          (await send('POST', '/api/incident-categories', 'exec-A', { companyId: A, ...body }))
            .status,
          why,
        ).toBe(400);
      await bad({ key: 'Bad Key', name: 'Name' }, 'key with capitals and a space');
      await bad({ key: 'a', name: 'Name' }, 'key too short');
      await bad({ key: 'x'.repeat(65), name: 'Name' }, 'key too long');
      await bad({ key: 'good-key', name: 'N' }, 'name too short');
      await bad({ key: 'good-key', name: 'N'.repeat(121) }, 'name too long');
      await bad(
        { key: 'good-key', name: 'Name', playbook: { title: 'T', steps: ['a'] } },
        'title too short',
      );
      await bad(
        { key: 'good-key', name: 'Name', playbook: { title: 'Title', steps: [] } },
        'no steps',
      );
      await bad(
        {
          key: 'good-key',
          name: 'Name',
          playbook: { title: 'Title', steps: Array(31).fill('step') },
        },
        '31 steps',
      );
      await bad(
        { key: 'good-key', name: 'Name', playbook: { title: 'Title', steps: ['x'.repeat(501)] } },
        'a step of 501 characters',
      );
      await bad(
        { key: 'good-key', name: 'Name', playbook: { title: 'Title', steps: ['two\nlines'] } },
        'a step with a line break',
      );
      await bad(
        { key: 'good-key', name: 'Name', playbook: { title: 'Title', steps: ['  '] } },
        'blank step',
      );
      await bad({ key: 'good-key', name: 'Name', playbook: 'text' }, 'playbook not an object');
      expect(
        (
          await send('POST', '/api/incident-categories', 'exec-A', {
            companyId: 'not-a-uuid',
            key: 'good-key',
            name: 'Name',
          })
        ).status,
      ).toBe(400);
      // The limits themselves are allowed: 30 steps of 500 characters, a 200-character title.
      const edge = await send('POST', '/api/incident-categories', 'exec-A', {
        companyId: A,
        key: 'edge-case',
        name: 'Edge',
        playbook: { title: 'T'.repeat(200), steps: Array(30).fill('s'.repeat(500)) },
      });
      expect(edge.status).toBe(201);
      ids.catEdge = (await json(edge)).id;
    });

    it('update: rename, replace and remove the playbook, archive; an empty change is refused; audited', async () => {
      const patch = (id: string, body: unknown, who = 'exec-A') =>
        send('PATCH', `/api/incident-categories/${id}`, who, body);
      const renamed = await json(await patch(ids.catA!, { name: 'Account compromised' }));
      expect(renamed).toMatchObject({ name: 'Account compromised', playbook });
      const replaced = await json(
        await patch(ids.catA!, { playbook: { title: 'New title', steps: ['One'] } }),
      );
      expect(replaced.playbook).toEqual({ title: 'New title', steps: ['One'] });
      const removed = await json(await patch(ids.catA!, { playbook: null }));
      expect(removed.playbook).toBeNull();
      const restored = await json(await patch(ids.catA!, { playbook }));
      expect(restored.playbook).toEqual(playbook);
      expect((await patch(ids.catA!, {})).status).toBe(400);
      expect((await patch(ids.catA!, { status: 'deleted' })).status).toBe(400);
      expect((await patch(ids.catA!, { playbook: { title: 'T', steps: [] } })).status).toBe(400);
      // The group-level holder may change a company's category and the default.
      expect((await patch(ids.catBare!, { name: 'Renamed by the group' }, 'cto-1')).status).toBe(
        200,
      );
      expect(
        (await patch(ids.catDefault!, { name: 'Platform outage (group)' }, 'cto-1')).status,
      ).toBe(200);
      const audit = await h.query(
        `select details from audit_events where action = 'incident_category.updated' order by id`,
      );
      expect(audit.length).toBeGreaterThanOrEqual(6);
      expect(audit[0].details).toMatchObject({
        name: { from: 'Account takeover', to: 'Account compromised' },
        playbook: 'unchanged',
      });
      expect(audit.map((r) => r.details.playbook)).toContain('removed');
      expect(audit.map((r) => r.details.playbook)).toContain('replaced');
    });
  });

  describe('recovery contacts', () => {
    const contact = {
      name: 'Sample Person',
      roleLabel: 'Security contact',
      channel: 'email',
      value: 'sample.person@example.test',
    };

    it('creates, lists in order, updates and archives; users need not be DCC users; audited without the personal data', async () => {
      const first = await send('POST', '/api/incident-contacts', 'exec-A', {
        companyId: A,
        ...contact,
        position: 2,
      });
      expect(first.status).toBe(201);
      ids.contactEmail = (await json(first)).id;
      const phone = await json(
        await send('POST', '/api/incident-contacts', 'exec-A', {
          companyId: A,
          name: 'Phone Person',
          roleLabel: 'Duty officer',
          channel: 'phone',
          value: '+251 11 555 0100',
          position: 1,
        }),
      );
      ids.contactPhone = phone.id;
      const other = await json(
        await send('POST', '/api/incident-contacts', 'cto-1', {
          companyId: A,
          name: 'Chat Person',
          roleLabel: 'Agency',
          channel: 'other',
          value: '@agency-handle',
        }),
      );
      ids.contactOther = other.id;
      const list = await json(
        await send('GET', `/api/incident-contacts?companyId=${A}`, 'reader-A'),
      );
      expect(list.map((c: any) => c.name)).toEqual([
        'Chat Person',
        'Phone Person',
        'Sample Person',
      ]);
      expect(list[2]).toEqual({
        id: ids.contactEmail,
        companyId: A,
        name: 'Sample Person',
        roleLabel: 'Security contact',
        channel: 'email',
        value: 'sample.person@example.test',
        position: 2,
        status: 'active',
      });
      const updated = await json(
        await send('PATCH', `/api/incident-contacts/${ids.contactOther}`, 'exec-A', {
          position: 5,
          roleLabel: 'Agency lead',
        }),
      );
      expect(updated).toMatchObject({
        position: 5,
        roleLabel: 'Agency lead',
        value: '@agency-handle',
      });
      const audit = await h.query(
        `select action, company_id, details from audit_events where action like 'incident_contact.%' order by id`,
      );
      expect(audit.map((r) => r.action)).toEqual([
        'incident_contact.created',
        'incident_contact.created',
        'incident_contact.created',
        'incident_contact.updated',
      ]);
      expect(audit.every((r) => r.company_id === A)).toBe(true);
      const text = JSON.stringify(audit);
      for (const secret of [
        'Sample Person',
        'sample.person@example.test',
        '555 0100',
        '@agency-handle',
      ])
        expect(text).not.toContain(secret);
    });

    it('is visible to the company and its group only, and only the company may change it', async () => {
      // company B and group 2 see none of company A's contacts, in any list
      for (const who of ['exec-B', 'cto-2']) {
        const all = await json(await send('GET', '/api/incident-contacts', who));
        expect(JSON.stringify(all), who).not.toContain('Sample Person');
      }
      expect(await json(await send('GET', '/api/incident-contacts', 'cto-1'))).toHaveLength(3);
      for (const who of ['exec-B', 'cto-2']) {
        expect(
          (
            await send('PATCH', `/api/incident-contacts/${ids.contactEmail}`, who, {
              name: 'Hijack me',
            })
          ).status,
          who,
        ).toBe(404);
        expect(
          (await send('POST', '/api/incident-contacts', who, { companyId: A, ...contact })).status,
          who,
        ).toBe(404);
      }
      expect(
        (
          await send('PATCH', `/api/incident-contacts/${ids.contactEmail}`, 'reader-A', {
            name: 'Hijack me',
          })
        ).status,
      ).toBe(403);
      expect(
        (await send('POST', '/api/incident-contacts', 'reader-A', { companyId: A, ...contact }))
          .status,
      ).toBe(403);
      expect((await send('GET', '/api/incident-contacts', 'creator-A')).status).toBe(403);
      const tenant = new TenantDb(database);
      const asB = ctx(h.userIds.get('exec-B')!, [], [B]);
      expect(
        await tenant.run(asB, (trx) =>
          trx.selectFrom('incident_recovery_contacts').selectAll().execute(),
        ),
      ).toEqual([]);
      await expect(
        tenant.run(asB, (trx) =>
          trx
            .insertInto('incident_recovery_contacts')
            .values({
              company_id: A,
              name: 'Forged',
              role_label: 'Forged',
              channel: 'other',
              value: 'x',
              created_by: h.userIds.get('exec-B')!,
            })
            .execute(),
        ),
      ).rejects.toThrow();
      expect(
        (
          await h.query(`select name from incident_recovery_contacts where id = $1`, [
            ids.contactEmail,
          ])
        )[0].name,
      ).toBe('Sample Person');
    });

    it('validation: each channel needs its own kind of value; limits on names; the company must exist', async () => {
      const bad = async (body: Record<string, unknown>, why: string) =>
        expect(
          (
            await send('POST', '/api/incident-contacts', 'exec-A', {
              companyId: A,
              ...contact,
              ...body,
            })
          ).status,
          why,
        ).toBe(400);
      await bad({ value: 'not an address' }, 'email without @');
      await bad({ channel: 'phone', value: 'call me' }, 'phone with letters');
      await bad({ channel: 'phone', value: '12' }, 'phone too short');
      await bad({ channel: 'fax' }, 'unknown channel');
      await bad({ channel: 'other', value: '' }, 'empty value');
      await bad({ channel: 'other', value: 'x'.repeat(201) }, 'value too long');
      await bad({ name: 'X' }, 'name too short');
      await bad({ name: 'N'.repeat(121) }, 'name too long');
      await bad({ roleLabel: 'R'.repeat(121) }, 'role label too long');
      await bad({ position: -1 }, 'negative position');
      await bad({ position: 1.5 }, 'fractional position');
      expect((await send('POST', '/api/incident-contacts', 'exec-A', { ...contact })).status).toBe(
        400,
      ); // no company
      // a new channel with the old value is checked too
      expect(
        (
          await send('PATCH', `/api/incident-contacts/${ids.contactEmail}`, 'exec-A', {
            channel: 'phone',
          })
        ).status,
      ).toBe(400);
      expect(
        (await send('PATCH', `/api/incident-contacts/${ids.contactEmail}`, 'exec-A', {})).status,
      ).toBe(400);
      expect(
        (
          await send('PATCH', `/api/incident-contacts/${ids.contactEmail}`, 'exec-A', {
            value: 'nonsense',
          })
        ).status,
      ).toBe(400);
      expect(
        (await send('PATCH', '/api/incident-contacts/not-a-uuid', 'exec-A', { name: 'Name' }))
          .status,
      ).toBe(400);
      expect(
        (
          await send(
            'PATCH',
            '/api/incident-contacts/00000000-0000-4000-8000-000000000001',
            'exec-A',
            { name: 'Name' },
          )
        ).status,
      ).toBe(404);
    });

    it('a company holds at most 50 active contacts; archiving makes room', async () => {
      const make = (n: number) =>
        send('POST', '/api/incident-contacts', 'exec-B', {
          companyId: B,
          name: `Person ${n}`,
          roleLabel: 'Role',
          channel: 'other',
          value: `handle-${n}`,
        });
      let last: Response | undefined;
      for (let n = 1; n <= 50; n++) {
        last = await make(n);
        expect(last.status).toBe(201);
      }
      const over = await make(51);
      expect(over.status).toBe(400);
      const first = (
        await json(await send('GET', `/api/incident-contacts?companyId=${B}`, 'exec-B'))
      )[0];
      expect(
        (
          await send('PATCH', `/api/incident-contacts/${first.id}`, 'exec-B', {
            status: 'archived',
          })
        ).status,
      ).toBe(200);
      expect((await make(52)).status).toBe(201);
      // an archived contact cannot be brought back while the company is full
      expect(
        (await send('PATCH', `/api/incident-contacts/${first.id}`, 'exec-B', { status: 'active' }))
          .status,
      ).toBe(400);
    });
  });

  describe('on the incident', () => {
    it('an incident carries its category, the playbook and the company contacts (active ones, in order)', async () => {
      await send('PATCH', `/api/incident-contacts/${ids.contactPhone}`, 'exec-A', {
        status: 'archived',
      });
      const response = await send('POST', '/api/incidents', 'exec-A', {
        companyId: A,
        title: 'Page hijacked',
        categoryId: ids.catA,
      });
      expect(response.status).toBe(201);
      const incident = await json(response);
      ids.incident = incident.id;
      expect(incident.categoryId).toBe(ids.catA);
      expect(incident.category).toMatchObject({ id: ids.catA, key: 'account-takeover', playbook });
      // (active only: the archived phone contact is not in it; ordered by position: Sample 2, Chat 5)
      expect(incident.recoveryContacts.map((c: any) => c.name)).toEqual([
        'Sample Person',
        'Chat Person',
      ]);
      const got = await json(await send('GET', `/api/incidents/${ids.incident}`, 'reader-A'));
      expect(got).toEqual(incident);
      const list = await json(await send('GET', '/api/incidents', 'cto-1'));
      const inList = list.find((i: any) => i.id === ids.incident);
      expect(inList.category.playbook).toEqual(playbook);
      expect(inList.recoveryContacts).toHaveLength(2);
      // another company's incident shows ITS contacts only
      const bIncident = await json(
        await send('POST', '/api/incidents', 'exec-B', {
          companyId: B,
          title: 'B incident',
          categoryId: ids.catDefault,
        }),
      );
      expect(bIncident.category).toMatchObject({ companyId: null, key: 'outage' });
      expect(bIncident.recoveryContacts).toHaveLength(50);
      expect(JSON.stringify(bIncident)).not.toContain('Sample Person');
      expect(JSON.stringify(incident)).not.toContain('Person 1');
    });

    it('the category must be usable by the incident company: own or group default, active', async () => {
      const make = (who: string, companyId: string, categoryId: string) =>
        send('POST', '/api/incidents', who, { companyId, title: 'Test incident', categoryId });
      // company A's category on company B's incident, group 1's on group 2's: refused, same answer as nonexistent
      expect((await make('exec-B', B, ids.catA!)).status).toBe(400);
      expect((await make('exec-B', B, '00000000-0000-4000-8000-000000000001')).status).toBe(400);
      expect(
        (
          await send('POST', '/api/incident-categories', 'cto-2', {
            key: 'g2-cat',
            name: 'Group two',
          })
        ).status,
      ).toBe(201);
      const g2cat = (await json(await send('GET', '/api/incident-categories', 'cto-2')))[0];
      expect((await make('exec-A', A, g2cat.id)).status).toBe(400);
      expect((await make('exec-A', A, ids.catDefault!)).status).toBe(201);
      // archived: refused for a new incident, kept on an old one
      expect(
        (
          await send('PATCH', `/api/incident-categories/${ids.catA}`, 'exec-A', {
            status: 'archived',
          })
        ).status,
      ).toBe(200);
      expect((await make('exec-A', A, ids.catA!)).status).toBe(400);
      const old = await json(await send('GET', `/api/incidents/${ids.incident}`, 'exec-A'));
      expect(old.category).toMatchObject({ id: ids.catA, status: 'archived' });
      expect(
        (
          await send('PATCH', `/api/incidents/${ids.incident}`, 'exec-A', {
            status: 'investigating',
          })
        ).status,
      ).toBe(200);
      expect(
        (await json(await send('GET', `/api/incidents/${ids.incident}`, 'exec-A'))).categoryId,
      ).toBe(ids.catA);
    });

    it('a category can be set, changed and removed on an existing incident, and it is audited', async () => {
      const patch = (body: unknown) =>
        send('PATCH', `/api/incidents/${ids.plainIncident}`, 'exec-A', body);
      const set = await json(await patch({ categoryId: ids.catBare }));
      expect(set.category).toMatchObject({ id: ids.catBare, playbook: null });
      expect((await patch({ categoryId: ids.catDefault })).status).toBe(200);
      expect((await patch({ categoryId: ids.catA })).status).toBe(400); // archived now
      expect((await patch({ categoryId: 'not-a-uuid' })).status).toBe(400);
      const cleared = await json(await patch({ categoryId: null }));
      expect(cleared).toMatchObject({ categoryId: null, category: null });
      // unrelated updates leave it alone
      await patch({ categoryId: ids.catBare });
      expect((await json(await patch({ severity: 'high' }))).categoryId).toBe(ids.catBare);
      const audit = await h.query(
        `select details from audit_events where action = 'incident.updated' and target_id = $1 and details ? 'categoryTo' order by id`,
        [ids.plainIncident],
      );
      expect(audit.map((r) => r.details.categoryTo)).toEqual([
        ids.catBare,
        ids.catDefault,
        null,
        ids.catBare,
      ]);
      expect(audit[1].details.categoryFrom).toBe(ids.catBare);
      // another company's person cannot set a category on this incident
      expect(
        (
          await send('PATCH', `/api/incidents/${ids.plainIncident}`, 'exec-B', {
            categoryId: ids.catDefault,
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await send('PATCH', `/api/incidents/${ids.plainIncident}`, 'reader-A', {
            categoryId: ids.catDefault,
          })
        ).status,
      ).toBe(403);
    });
  });
});
