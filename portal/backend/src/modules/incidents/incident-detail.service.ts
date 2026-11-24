import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  isValidContactValue,
  MAX_RECOVERY_CONTACTS_PER_COMPANY,
  type CreateIncidentCategoryRequest,
  type CreateIncidentContactRequest,
  type IncidentCategoryDto,
  type IncidentContactDto,
  type UpdateIncidentCategoryRequest,
  type UpdateIncidentContactRequest,
} from '@dcc/contracts';
import { sql, type Transaction } from 'kysely';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, scopesWith, type Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';

type Trx = Transaction<DB>;

const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

const CATEGORY_COLUMNS = [
  'id',
  'group_id',
  'company_id',
  'key',
  'name',
  'status',
  'playbook_title',
  'playbook_steps',
] as const;
const CONTACT_COLUMNS = [
  'id',
  'company_id',
  'name',
  'role_label',
  'channel',
  'value',
  'position',
  'status',
] as const;

type CategoryRow = {
  id: string;
  group_id: string;
  company_id: string | null;
  key: string;
  name: string;
  status: string;
  playbook_title: string | null;
  playbook_steps: string[];
};
type ContactRow = {
  id: string;
  company_id: string;
  name: string;
  role_label: string;
  channel: string;
  value: string;
  position: number;
  status: string;
};

export const toCategoryDto = (r: CategoryRow): IncidentCategoryDto => ({
  id: r.id,
  groupId: r.group_id,
  companyId: r.company_id,
  key: r.key,
  name: r.name,
  status: r.status as IncidentCategoryDto['status'],
  playbook: r.playbook_title ? { title: r.playbook_title, steps: r.playbook_steps } : null,
});

export const toContactDto = (r: ContactRow): IncidentContactDto => ({
  id: r.id,
  companyId: r.company_id,
  name: r.name,
  roleLabel: r.role_label,
  channel: r.channel as IncidentContactDto['channel'],
  value: r.value,
  position: r.position,
  status: r.status as IncidentContactDto['status'],
});

/**
 * H-06 incident detail: per-company (and group-default) incident categories with an optional playbook, and
 * recovery contacts per company. STRUCTURE ONLY: everything starts empty and every word of it is entered by the
 * Group (docs/api/incidents.md, decision D-27). Follows the usual pattern: TenantDb.run, authz.can re-checked
 * for the company, an audit event in the same transaction. Reading needs `incident.read`, writing `incident.manage`.
 */
@Injectable()
export class IncidentDetailService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------- categories

  /**
   * With `companyId`: the company's own categories and its group's defaults. Without: every category in the
   * caller's `incident.read` scope. A company the caller cannot see answers 404.
   */
  async listCategories(access: Access, companyId?: string): Promise<IncidentCategoryDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const scope = scopesWith(access, 'incident.read');
      let query = trx.selectFrom('incident_categories').select(CATEGORY_COLUMNS);
      if (companyId) {
        const company = await this.loadCompany(trx, companyId);
        if (!can(access, 'incident.read', { groupId: company.group_id, companyId }))
          throw new ForbiddenException('You cannot read incidents for this company.');
        query = query.where((eb) =>
          eb.or([
            eb('company_id', '=', companyId),
            eb.and([eb('company_id', 'is', null), eb('group_id', '=', company.group_id)]),
          ]),
        );
      } else {
        const companyIds = await companyIdsWithPermission(trx, access, 'incident.read');
        const groups = companyIds.length
          ? (
              await trx
                .selectFrom('companies')
                .select('group_id')
                .where('id', 'in', companyIds)
                .execute()
            ).map((g) => g.group_id)
          : [];
        const groupIds = [...new Set([...scope.groupIds, ...groups])];
        query = query.where((eb) =>
          eb.or([
            eb('company_id', 'in', companyIds.length ? companyIds : [NIL]),
            eb.and([
              eb('company_id', 'is', null),
              eb('group_id', 'in', groupIds.length ? groupIds : [NIL]),
            ]),
          ]),
        );
      }
      const rows = await query.orderBy('name').orderBy('id').execute();
      return rows.map(toCategoryDto);
    });
  }

  async createCategory(
    access: Access,
    input: CreateIncidentCategoryRequest,
  ): Promise<IncidentCategoryDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        let groupId: string;
        if (input.companyId) {
          const company = await this.loadCompany(trx, input.companyId);
          if (!can(access, 'incident.manage', { groupId: company.group_id, companyId: company.id }))
            throw new ForbiddenException('You cannot manage incidents for this company.');
          groupId = company.group_id;
        } else {
          // The caller's own group, never a group id from the request (same as the content categories).
          const own = scopesWith(access, 'incident.manage').groupIds[0];
          if (!own)
            throw new ForbiddenException(
              "Only a group-level role can change the group's default categories.",
            );
          groupId = own;
        }
        const row = await trx
          .insertInto('incident_categories')
          .values({
            group_id: groupId,
            company_id: input.companyId ?? null,
            key: input.key,
            name: input.name,
            playbook_title: input.playbook?.title ?? null,
            playbook_steps: input.playbook?.steps ?? [],
            created_by: access.userId,
          })
          .returning(CATEGORY_COLUMNS)
          .executeTakeFirstOrThrow();
        await this.audit.record(trx, {
          action: AuditActions.incidentCategoryCreated,
          actorUserId: access.userId,
          targetType: 'incident_category',
          targetId: row.id,
          companyId: row.company_id,
          groupId: row.group_id,
          details: { key: row.key, name: row.name, hasPlaybook: row.playbook_title !== null },
        });
        return toCategoryDto(row);
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('A category with that key already exists here.');
      throw error;
    }
  }

  async updateCategory(
    access: Access,
    id: string,
    input: UpdateIncidentCategoryRequest,
  ): Promise<IncidentCategoryDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const current = await trx
        .selectFrom('incident_categories')
        .select(CATEGORY_COLUMNS)
        .where('id', '=', id)
        .executeTakeFirst();
      if (!current) throw new NotFoundException('Category not found.');
      const scope = current.company_id
        ? { groupId: current.group_id, companyId: current.company_id }
        : { groupId: current.group_id };
      if (!can(access, 'incident.manage', scope))
        throw new ForbiddenException('You cannot manage this category.');

      const playbook = input.playbook;
      const row = await trx
        .updateTable('incident_categories')
        .set({
          name: input.name ?? current.name,
          status: input.status ?? current.status,
          ...(playbook === undefined
            ? {}
            : playbook === null
              ? { playbook_title: null, playbook_steps: sql<string[]>`'{}'::text[]` }
              : { playbook_title: playbook.title, playbook_steps: playbook.steps }),
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returning(CATEGORY_COLUMNS)
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        action: AuditActions.incidentCategoryUpdated,
        actorUserId: access.userId,
        targetType: 'incident_category',
        targetId: id,
        companyId: current.company_id,
        groupId: current.group_id,
        details: {
          name: { from: current.name, to: row.name },
          status: { from: current.status, to: row.status },
          playbook:
            playbook === undefined ? 'unchanged' : playbook === null ? 'removed' : 'replaced',
        },
      });
      return toCategoryDto(row);
    });
  }

  /**
   * An incident's category must be one its company may use: the company's own or its group's default, and
   * active. Anything else (another company's, an archived one, one the caller cannot see) is the same 400, so
   * it does not reveal that a hidden category exists.
   */
  async assertUsableCategory(
    trx: Trx,
    categoryId: string,
    company: { id: string; group_id: string },
  ): Promise<void> {
    const row = await trx
      .selectFrom('incident_categories')
      .select(['id', 'company_id', 'group_id', 'status'])
      .where('id', '=', categoryId)
      .executeTakeFirst();
    const usable =
      row !== undefined &&
      row.status === 'active' &&
      (row.company_id === company.id ||
        (row.company_id === null && row.group_id === company.group_id));
    if (!usable) throw new BadRequestException('That category is not available for this company.');
  }

  // ------------------------------------------------------------------ contacts

  async listContacts(access: Access, companyId?: string): Promise<IncidentContactDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      let query = trx.selectFrom('incident_recovery_contacts').select(CONTACT_COLUMNS);
      if (companyId) {
        const company = await this.loadCompany(trx, companyId);
        if (!can(access, 'incident.read', { groupId: company.group_id, companyId }))
          throw new ForbiddenException('You cannot read incidents for this company.');
        query = query.where('company_id', '=', companyId);
      } else {
        const companyIds = await companyIdsWithPermission(trx, access, 'incident.read');
        query = query.where('company_id', 'in', companyIds.length ? companyIds : [NIL]);
      }
      const rows = await query.orderBy('position').orderBy('name').orderBy('id').execute();
      return rows.map(toContactDto);
    });
  }

  async createContact(
    access: Access,
    input: CreateIncidentContactRequest,
  ): Promise<IncidentContactDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const company = await this.loadCompany(trx, input.companyId);
      if (!can(access, 'incident.manage', { groupId: company.group_id, companyId: company.id }))
        throw new ForbiddenException('You cannot manage incidents for this company.');
      const count = await trx
        .selectFrom('incident_recovery_contacts')
        .select((eb) => eb.fn.countAll().as('n'))
        .where('company_id', '=', company.id)
        .where('status', '=', 'active')
        .executeTakeFirstOrThrow();
      if (Number(count.n) >= MAX_RECOVERY_CONTACTS_PER_COMPANY)
        throw new BadRequestException(
          `A company can hold at most ${MAX_RECOVERY_CONTACTS_PER_COMPANY} active recovery contacts. Archive one first.`,
        );
      const row = await trx
        .insertInto('incident_recovery_contacts')
        .values({
          company_id: company.id,
          name: input.name,
          role_label: input.roleLabel,
          channel: input.channel,
          value: input.value,
          position: input.position ?? 0,
          created_by: access.userId,
        })
        .returning(CONTACT_COLUMNS)
        .executeTakeFirstOrThrow();
      // Names, addresses and numbers are personal data: the audit event records who and what kind, not the contact.
      await this.audit.record(trx, {
        action: AuditActions.incidentContactCreated,
        actorUserId: access.userId,
        targetType: 'incident_contact',
        targetId: row.id,
        companyId: row.company_id,
        details: { roleLabel: row.role_label, channel: row.channel },
      });
      return toContactDto(row);
    });
  }

  async updateContact(
    access: Access,
    id: string,
    input: UpdateIncidentContactRequest,
  ): Promise<IncidentContactDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const current = await trx
        .selectFrom('incident_recovery_contacts')
        .select(CONTACT_COLUMNS)
        .where('id', '=', id)
        .executeTakeFirst();
      if (!current) throw new NotFoundException('Contact not found.');
      const company = await this.loadCompany(trx, current.company_id);
      if (!can(access, 'incident.manage', { groupId: company.group_id, companyId: company.id }))
        throw new ForbiddenException('You cannot manage incidents for this company.');

      const channel = input.channel ?? (current.channel as IncidentContactDto['channel']);
      const value = input.value ?? current.value;
      // A new channel with the old value (or the reverse) must still be a value of that kind.
      if (
        (input.channel !== undefined || input.value !== undefined) &&
        !isValidContactValue(channel, value)
      )
        throw new BadRequestException('The value does not look like that kind of contact.');
      if (input.status === 'active' && current.status !== 'active') {
        const count = await trx
          .selectFrom('incident_recovery_contacts')
          .select((eb) => eb.fn.countAll().as('n'))
          .where('company_id', '=', company.id)
          .where('status', '=', 'active')
          .executeTakeFirstOrThrow();
        if (Number(count.n) >= MAX_RECOVERY_CONTACTS_PER_COMPANY)
          throw new BadRequestException(
            `A company can hold at most ${MAX_RECOVERY_CONTACTS_PER_COMPANY} active recovery contacts.`,
          );
      }
      const row = await trx
        .updateTable('incident_recovery_contacts')
        .set({
          name: input.name ?? current.name,
          role_label: input.roleLabel ?? current.role_label,
          channel,
          value,
          position: input.position ?? current.position,
          status: input.status ?? current.status,
          updated_at: new Date(),
        })
        .where('id', '=', id)
        .returning(CONTACT_COLUMNS)
        .executeTakeFirstOrThrow();
      await this.audit.record(trx, {
        action: AuditActions.incidentContactUpdated,
        actorUserId: access.userId,
        targetType: 'incident_contact',
        targetId: id,
        companyId: current.company_id,
        details: {
          changed: (
            ['name', 'roleLabel', 'channel', 'value', 'position', 'status'] as const
          ).filter((k) => input[k] !== undefined),
          status: { from: current.status, to: row.status },
        },
      });
      return toContactDto(row);
    });
  }

  // ------------------------------------------------- the incident's own detail

  /** The categories and the active contacts that go into the incident responses, for several incidents at once. */
  async detailFor(
    trx: Trx,
    incidents: Array<{ company_id: string; category_id: string | null }>,
  ): Promise<{
    category: (id: string | null) => IncidentCategoryDto | null;
    contacts: (companyId: string) => IncidentContactDto[];
  }> {
    const categoryIds = [
      ...new Set(incidents.flatMap((i) => (i.category_id ? [i.category_id] : []))),
    ];
    const companyIds = [...new Set(incidents.map((i) => i.company_id))];
    const categories = categoryIds.length
      ? await trx
          .selectFrom('incident_categories')
          .select(CATEGORY_COLUMNS)
          .where('id', 'in', categoryIds)
          .execute()
      : [];
    const contacts = companyIds.length
      ? await trx
          .selectFrom('incident_recovery_contacts')
          .select(CONTACT_COLUMNS)
          .where('company_id', 'in', companyIds)
          .where('status', '=', 'active')
          .orderBy('position')
          .orderBy('name')
          .orderBy('id')
          .execute()
      : [];
    const byId = new Map(categories.map((c) => [c.id, toCategoryDto(c)]));
    return {
      category: (id) => (id ? (byId.get(id) ?? null) : null),
      contacts: (companyId) => contacts.filter((c) => c.company_id === companyId).map(toContactDto),
    };
  }

  /** Loads the company under the walls (RLS): "not found" and "not yours" look the same. */
  private async loadCompany(trx: Trx, companyId: string) {
    const company = await trx
      .selectFrom('companies')
      .select(['id', 'group_id'])
      .where('id', '=', companyId)
      .executeTakeFirst();
    if (!company) throw new NotFoundException('Company not found.');
    return company;
  }
}
