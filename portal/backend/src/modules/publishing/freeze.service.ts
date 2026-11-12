import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { FreezeCheck } from '@dcc/engine-client';
import type { CreateFreezeRequest, FreezeDto } from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, scopesWith, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { NotificationsService } from '../notifications/notifications.service';

const NIL = '00000000-0000-0000-0000-000000000000';
const SYSTEM_USER_ID = NIL;
const ctxOf = (a: Access) => ({ userId: a.userId, groupIds: a.groupIds, companyIds: a.companyIds });
const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';

const FREEZE_COLUMNS = [
  'id',
  'company_id',
  'social_account_id',
  'frozen_by',
  'reason',
  'frozen_at',
] as const;

/**
 * H-05 (FR-15): the emergency freeze switch, per company or per account. isFrozen() is the
 * FreezeCheck interface GovernedEngine calls before it will ever publish anything - it runs as a
 * company-scoped system check (same reasoning as ContentApprovalVerifier: no policy it touches
 * reads app.user_id). freeze/unfreeze/list are the HTTP-facing side, run with the real caller's
 * access. Honest framing (per the onboarding task): this stops publishing THROUGH DCC, not people
 * posting directly on the network.
 */
@Injectable()
export class FreezeService implements FreezeCheck {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  async isFrozen(scope: { companyId: string; channelId: string }): Promise<boolean> {
    return this.tenant.run(
      { userId: SYSTEM_USER_ID, groupIds: [], companyIds: [scope.companyId] },
      async (trx) => {
        const row = await trx
          .selectFrom('publishing_freezes')
          .select('id')
          .where('company_id', '=', scope.companyId)
          .where((eb) =>
            eb.or([
              eb('social_account_id', 'is', null),
              eb.exists(
                eb
                  .selectFrom('social_accounts')
                  .select('social_accounts.id')
                  .whereRef('social_accounts.id', '=', 'publishing_freezes.social_account_id')
                  .where('social_accounts.engine_channel_id', '=', scope.channelId),
              ),
            ]),
          )
          .executeTakeFirst();
        return row !== undefined;
      },
    );
  }

  async freeze(access: Access, input: CreateFreezeRequest): Promise<FreezeDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const company = await trx
          .selectFrom('companies')
          .select(['id', 'group_id'])
          .where('id', '=', input.companyId)
          .executeTakeFirst();
        if (!company) throw new NotFoundException('Company not found.');
        if (!can(access, 'publishing.freeze', { groupId: company.group_id, companyId: company.id }))
          throw new ForbiddenException('You cannot freeze publishing for this company.');

        if (input.socialAccountId) {
          const account = await trx
            .selectFrom('social_accounts')
            .select('id')
            .where('id', '=', input.socialAccountId)
            .where('company_id', '=', input.companyId)
            .executeTakeFirst();
          if (!account) throw new NotFoundException('Social account not found.');
        }

        const row = await trx
          .insertInto('publishing_freezes')
          .values({
            company_id: input.companyId,
            social_account_id: input.socialAccountId ?? null,
            frozen_by: access.userId,
            reason: input.reason ?? null,
          })
          .returning(FREEZE_COLUMNS)
          .executeTakeFirstOrThrow();

        await this.audit.record(trx, {
          action: AuditActions.publishingFrozen,
          actorUserId: access.userId,
          targetType: 'publishing_freeze',
          targetId: row.id,
          companyId: input.companyId,
          details: { socialAccountId: input.socialAccountId ?? null, reason: input.reason ?? null },
        });

        await this.notifications.notifyHolders(trx, {
          companyId: input.companyId,
          groupId: company.group_id,
          permission: 'content.publish',
          eventType: 'publishing.frozen',
          targetType: 'publishing_freeze',
          targetId: row.id,
          summary: input.socialAccountId
            ? 'Publishing was frozen for one account.'
            : 'Publishing was frozen for the whole company.',
          excludeUserId: access.userId,
        });

        return toFreezeDto(row);
      });
    } catch (error) {
      if (uniqueViolation(error)) throw new ConflictException('This scope is already frozen.');
      throw error;
    }
  }

  async unfreeze(access: Access, freezeId: string): Promise<void> {
    await this.tenant.run(ctxOf(access), async (trx) => {
      const freeze = await trx
        .selectFrom('publishing_freezes')
        .select(['id', 'company_id', 'social_account_id'])
        .where('id', '=', freezeId)
        .executeTakeFirst();
      if (!freeze) throw new NotFoundException('Freeze not found.');
      const company = await trx
        .selectFrom('companies')
        .select('group_id')
        .where('id', '=', freeze.company_id)
        .executeTakeFirstOrThrow();
      if (
        !can(access, 'publishing.freeze', {
          groupId: company.group_id,
          companyId: freeze.company_id,
        })
      )
        throw new ForbiddenException('You cannot unfreeze publishing for this company.');

      await trx.deleteFrom('publishing_freezes').where('id', '=', freezeId).execute();

      await this.audit.record(trx, {
        action: AuditActions.publishingUnfrozen,
        actorUserId: access.userId,
        targetType: 'publishing_freeze',
        targetId: freezeId,
        companyId: freeze.company_id,
        details: { socialAccountId: freeze.social_account_id },
      });
    });
  }

  async list(access: Access): Promise<FreezeDto[]> {
    const scope = scopesWith(access, 'publishing.freeze');
    return this.tenant.run(ctxOf(access), async (trx) => {
      const groupCompanies = scope.groupIds.length
        ? (
            await trx
              .selectFrom('companies')
              .select('id')
              .where('group_id', 'in', scope.groupIds)
              .execute()
          ).map((c) => c.id)
        : [];
      const companyIds = [...new Set([...scope.companyIds, ...groupCompanies])];
      const rows = await trx
        .selectFrom('publishing_freezes')
        .select(FREEZE_COLUMNS)
        .where('company_id', 'in', companyIds.length ? companyIds : [NIL])
        .orderBy('frozen_at', 'desc')
        .execute();
      return rows.map(toFreezeDto);
    });
  }
}

const toFreezeDto = (r: {
  id: string;
  company_id: string;
  social_account_id: string | null;
  frozen_by: string;
  reason: string | null;
  frozen_at: Date;
}): FreezeDto => ({
  id: r.id,
  companyId: r.company_id,
  socialAccountId: r.social_account_id,
  frozenBy: r.frozen_by,
  reason: r.reason,
  frozenAt: r.frozen_at.toISOString(),
});
