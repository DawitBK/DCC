import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  InboxAssigneeDto,
  InboxLanguage,
  InboxResponderDto,
  InboxResponderKind,
  SetInboxRespondersRequest,
} from '@dcc/contracts';
import type { Transaction } from 'kysely';
import type { DB } from '../../platform/database/schema';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { ctxOf } from '../shared/tenant-scope';
import { InboxClockService } from './inbox-clock.service';

/**
 * Round 3, responders (sheet E-15, B-37): who answers the inbox of a company, as a primary or a backup responder, and in
 * which language(s). The list belongs to one company and is replaced as a whole by a holder of `inbox.manage`; every
 * person on it must hold `inbox.reply` for the company (checked on write, and again whenever the router reads it:
 * a responder who lost the permission is shown as such and ignored).
 */
@Injectable()
export class InboxRespondersService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    private readonly clock: InboxClockService,
  ) {}

  /** The responders of a company the caller may read the inbox of. An unknown company and another company look the same. */
  async list(access: Access, companyId: string): Promise<InboxResponderDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const company = await trx
        .selectFrom('companies')
        .select(['id', 'group_id'])
        .where('id', '=', companyId)
        .executeTakeFirst();
      if (!company || !can(access, 'inbox.read', { groupId: company.group_id, companyId }))
        throw new NotFoundException('Company not found.');
      return this.read(trx, companyId);
    });
  }

  /**
   * The people who may be put on the list: whoever holds `inbox.reply` for the company. A manager who cannot reply
   * themselves (the company administrator) needs this, because the assignee list asks for `inbox.reply`.
   */
  async candidates(access: Access, companyId: string): Promise<InboxAssigneeDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const company = await trx
        .selectFrom('companies')
        .select(['id', 'group_id'])
        .where('id', '=', companyId)
        .executeTakeFirst();
      // An unknown company and another company look the same.
      if (!company || !can(access, 'inbox.manage', { groupId: company.group_id, companyId }))
        throw new NotFoundException('Company not found.');
      const ids = await this.clock.replyHolders(trx, companyId);
      if (ids.length === 0) return [];
      const users = await trx
        .selectFrom('users')
        .select(['id', 'display_name'])
        .where('id', 'in', ids)
        .orderBy('display_name')
        .execute();
      return users.map((u) => ({ userId: u.id, displayName: u.display_name }));
    });
  }

  /** Replaces the list of one company. Needs `inbox.manage` for it. Audited with the list before and after. */
  async set(access: Access, input: SetInboxRespondersRequest): Promise<InboxResponderDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const company = await trx
        .selectFrom('companies')
        .select(['id', 'group_id'])
        .where('id', '=', input.companyId)
        .executeTakeFirst();
      if (!company) throw new NotFoundException('Company not found.');
      if (!can(access, 'inbox.manage', { groupId: company.group_id, companyId: company.id }))
        throw new ForbiddenException('You cannot change the responders of this company.');

      const holders = new Set(await this.clock.replyHolders(trx, company.id));
      const refused = input.responders.filter((r) => !holders.has(r.userId));
      if (refused.length > 0)
        throw new BadRequestException(
          'Every responder must be someone who can reply for this company. Remove the people who cannot.',
        );

      const before = await this.read(trx, company.id);
      const now = new Date();
      // Lock the company's current rows so two managers saving at once do not interleave.
      await trx
        .selectFrom('inbox_responders')
        .select('user_id')
        .where('company_id', '=', company.id)
        .forUpdate()
        .execute();
      await trx.deleteFrom('inbox_responders').where('company_id', '=', company.id).execute();
      if (input.responders.length > 0)
        await trx
          .insertInto('inbox_responders')
          .values(
            input.responders.map((r) => ({
              company_id: company.id,
              user_id: r.userId,
              kind: r.kind,
              languages: r.languages,
              updated_by: access.userId,
              updated_at: now,
            })),
          )
          .execute();
      const after = await this.read(trx, company.id);
      const brief = (list: InboxResponderDto[]) =>
        list.map((r) => ({ userId: r.userId, kind: r.kind, languages: r.languages }));
      // The audit event is written last: it takes a lock that serialises audit writers.
      await this.audit.record(trx, {
        action: AuditActions.inboxResponderSet,
        actorUserId: access.userId,
        targetType: 'company',
        targetId: company.id,
        companyId: company.id,
        details: { from: brief(before), to: brief(after) },
      });
      return after;
    });
  }

  private async read(trx: Transaction<DB>, companyId: string): Promise<InboxResponderDto[]> {
    const rows = await trx
      .selectFrom('inbox_responders as r')
      .innerJoin('users as u', 'u.id', 'r.user_id')
      .select(['r.user_id', 'u.display_name', 'r.kind', 'r.languages', 'r.updated_at'])
      .where('r.company_id', '=', companyId)
      .orderBy('r.kind')
      .orderBy('u.display_name')
      .orderBy('r.user_id')
      .execute();
    const holders = new Set(await this.clock.replyHolders(trx, companyId));
    return rows.map((r) => ({
      userId: r.user_id,
      displayName: r.display_name,
      kind: r.kind as InboxResponderKind,
      languages: r.languages as InboxLanguage[],
      canReply: holders.has(r.user_id),
      updatedAt: r.updated_at.toISOString(),
    }));
  }
}
