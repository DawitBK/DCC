import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  AccountAssignmentDto,
  AssignAccountRequest,
  CreateSocialAccountRequest,
  SetAccountBackupAdminRequest,
  SetAccountStatusRequest,
  SocialAccountDto,
  UpdateSocialAccountRequest,
} from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';
import { TenantDb } from '../../platform/tenancy/tenant-db';

const uniqueViolation = (e: unknown) => (e as { code?: string })?.code === '23505';
const foreignKeyViolation = (e: unknown) => (e as { code?: string })?.code === '23503';

/**
 * H-02: social account registry. Follows the pattern of CompaniesService: every query runs inside
 * TenantDb.run() (RLS is the tenant boundary), authz.can() re-checks the permission for the specific
 * company, and every state change writes an audit event in the same transaction, last.
 */
@Injectable()
export class SocialAccountsService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async list(access: Access): Promise<SocialAccountDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = await companyIdsWithPermission(trx, access, 'account.read');
      const rows = await trx
        .selectFrom('social_accounts')
        .select([
          'id',
          'company_id',
          'brand_id',
          'platform',
          'display_name',
          'handle',
          'public_url',
          'status',
          'owner_user_id',
          'backup_admin_user_id',
        ])
        .where('company_id', 'in', companyIds.length ? companyIds : [NIL])
        .orderBy('display_name')
        .execute();
      return rows.map(toDto);
    });
  }

  async create(access: Access, input: CreateSocialAccountRequest): Promise<SocialAccountDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const company = await trx
          .selectFrom('companies')
          .select(['id', 'group_id'])
          .where('id', '=', input.companyId)
          .executeTakeFirst();
        // RLS already hides a company the caller cannot see; "not found" and "not yours" look identical.
        if (!company) throw new NotFoundException('Company not found.');
        if (!can(access, 'account.manage', { groupId: company.group_id, companyId: company.id }))
          throw new ForbiddenException('You cannot manage accounts of this company.');

        const row = await trx
          .insertInto('social_accounts')
          .values({
            company_id: input.companyId,
            brand_id: input.brandId ?? null,
            platform: input.platform,
            display_name: input.displayName,
            handle: input.handle,
            public_url: input.publicUrl ?? null,
            owner_user_id: input.ownerUserId,
            backup_admin_user_id: input.backupAdminUserId ?? null,
            updated_at: new Date(),
          })
          .returning([
            'id',
            'company_id',
            'brand_id',
            'platform',
            'display_name',
            'handle',
            'public_url',
            'status',
            'owner_user_id',
            'backup_admin_user_id',
          ])
          .executeTakeFirstOrThrow();

        await this.audit.record(trx, {
          action: AuditActions.accountCreated,
          actorUserId: access.userId,
          targetType: 'social_account',
          targetId: row.id,
          companyId: row.company_id,
          details: { platform: row.platform, handle: row.handle, ownerUserId: row.owner_user_id },
        });
        return toDto(row);
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('An account with that platform and handle already exists.');
      if (foreignKeyViolation(error))
        throw new BadRequestException('The brand, owner or backup admin does not exist.');
      throw error;
    }
  }

  async update(
    access: Access,
    accountId: string,
    input: UpdateSocialAccountRequest,
  ): Promise<SocialAccountDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const account = await this.manageable(trx, access, accountId);
        const nextOwner = input.ownerUserId ?? account.owner_user_id;
        const nextBackupAdmin = account.backup_admin_user_id;
        assertOwnerAndBackupAdminDiffer(nextOwner, nextBackupAdmin);

        const row = await trx
          .updateTable('social_accounts')
          .set({
            display_name: input.displayName ?? undefined,
            handle: input.handle ?? undefined,
            public_url: input.publicUrl === undefined ? undefined : input.publicUrl,
            brand_id: input.brandId === undefined ? undefined : input.brandId,
            owner_user_id: input.ownerUserId ?? undefined,
            updated_at: new Date(),
          })
          .where('id', '=', accountId)
          .returning([
            'id',
            'company_id',
            'brand_id',
            'platform',
            'display_name',
            'handle',
            'public_url',
            'status',
            'owner_user_id',
            'backup_admin_user_id',
          ])
          .executeTakeFirstOrThrow();

        await this.audit.record(trx, {
          action: AuditActions.accountUpdated,
          actorUserId: access.userId,
          targetType: 'social_account',
          targetId: row.id,
          companyId: row.company_id,
          details: input,
        });
        return toDto(row);
      });
    } catch (error) {
      if (uniqueViolation(error))
        throw new ConflictException('An account with that platform and handle already exists.');
      if (foreignKeyViolation(error))
        throw new BadRequestException('The brand or owner does not exist.');
      throw error;
    }
  }

  async setStatus(
    access: Access,
    accountId: string,
    input: SetAccountStatusRequest,
  ): Promise<SocialAccountDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const account = await this.manageable(trx, access, accountId);
      const row = await trx
        .updateTable('social_accounts')
        .set({ status: input.status, updated_at: new Date() })
        .where('id', '=', accountId)
        .returning([
          'id',
          'company_id',
          'brand_id',
          'platform',
          'display_name',
          'handle',
          'public_url',
          'status',
          'owner_user_id',
          'backup_admin_user_id',
        ])
        .executeTakeFirstOrThrow();

      await this.audit.record(trx, {
        action: AuditActions.accountStatusChanged,
        actorUserId: access.userId,
        targetType: 'social_account',
        targetId: row.id,
        companyId: row.company_id,
        details: { from: account.status, to: input.status },
      });
      return toDto(row);
    });
  }

  async setBackupAdmin(
    access: Access,
    accountId: string,
    input: SetAccountBackupAdminRequest,
  ): Promise<SocialAccountDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const account = await this.manageable(trx, access, accountId);
      assertOwnerAndBackupAdminDiffer(account.owner_user_id, input.backupAdminUserId);
      try {
        const row = await trx
          .updateTable('social_accounts')
          .set({ backup_admin_user_id: input.backupAdminUserId, updated_at: new Date() })
          .where('id', '=', accountId)
          .returning([
            'id',
            'company_id',
            'brand_id',
            'platform',
            'display_name',
            'handle',
            'public_url',
            'status',
            'owner_user_id',
            'backup_admin_user_id',
          ])
          .executeTakeFirstOrThrow();

        await this.audit.record(trx, {
          action: AuditActions.accountBackupAdminChanged,
          actorUserId: access.userId,
          targetType: 'social_account',
          targetId: row.id,
          companyId: row.company_id,
          details: { backupAdminUserId: input.backupAdminUserId },
        });
        return toDto(row);
      } catch (error) {
        if (foreignKeyViolation(error))
          throw new BadRequestException('The backup admin does not exist.');
        throw error;
      }
    });
  }

  async assign(
    access: Access,
    accountId: string,
    input: AssignAccountRequest,
  ): Promise<AccountAssignmentDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const account = await this.manageable(trx, access, accountId);
        const row = await trx
          .insertInto('account_assignments')
          .values({
            social_account_id: accountId,
            company_id: account.company_id,
            user_id: input.userId,
          })
          .returning(['id', 'social_account_id', 'user_id'])
          .executeTakeFirstOrThrow();

        await this.audit.record(trx, {
          action: AuditActions.accountAssigned,
          actorUserId: access.userId,
          targetType: 'social_account',
          targetId: accountId,
          companyId: account.company_id,
          details: { userId: input.userId },
        });
        return { id: row.id, socialAccountId: row.social_account_id, userId: row.user_id };
      });
    } catch (error) {
      if (uniqueViolation(error)) throw new ConflictException('That person is already assigned.');
      if (foreignKeyViolation(error)) throw new BadRequestException('That person does not exist.');
      throw error;
    }
  }

  async unassign(access: Access, accountId: string, userId: string): Promise<void> {
    await this.tenant.run(ctxOf(access), async (trx) => {
      const account = await this.manageable(trx, access, accountId);
      const result = await trx
        .deleteFrom('account_assignments')
        .where('social_account_id', '=', accountId)
        .where('user_id', '=', userId)
        .executeTakeFirst();
      if (Number(result.numDeletedRows) === 0) throw new NotFoundException('Assignment not found.');

      await this.audit.record(trx, {
        action: AuditActions.accountUnassigned,
        actorUserId: access.userId,
        targetType: 'social_account',
        targetId: accountId,
        companyId: account.company_id,
        details: { userId },
      });
    });
  }

  /** Loads the account under the walls (RLS), 404s if hidden, then re-checks account.manage for its company. */
  private async manageable(
    trx: Parameters<Parameters<TenantDb['run']>[1]>[0],
    access: Access,
    accountId: string,
  ) {
    const account = await trx
      .selectFrom('social_accounts')
      .select(['id', 'company_id', 'status', 'owner_user_id', 'backup_admin_user_id'])
      .where('id', '=', accountId)
      .executeTakeFirst();
    if (!account) throw new NotFoundException('Social account not found.');
    const company = await trx
      .selectFrom('companies')
      .select('group_id')
      .where('id', '=', account.company_id)
      .executeTakeFirstOrThrow();
    if (
      !can(access, 'account.manage', { groupId: company.group_id, companyId: account.company_id })
    )
      throw new ForbiddenException('You cannot manage this account.');
    return account;
  }
}

function assertOwnerAndBackupAdminDiffer(
  ownerUserId: string | null,
  backupAdminUserId: string | null,
): void {
  if (ownerUserId && backupAdminUserId && ownerUserId === backupAdminUserId) {
    throw new BadRequestException('The backup admin must be a different person from the owner.');
  }
}

const toDto = (r: {
  id: string;
  company_id: string;
  brand_id: string | null;
  platform: string;
  display_name: string;
  handle: string;
  public_url: string | null;
  status: string;
  owner_user_id: string | null;
  backup_admin_user_id: string | null;
}): SocialAccountDto => ({
  id: r.id,
  companyId: r.company_id,
  brandId: r.brand_id,
  platform: r.platform as SocialAccountDto['platform'],
  displayName: r.display_name,
  handle: r.handle,
  publicUrl: r.public_url,
  status: r.status as SocialAccountDto['status'],
  ownerUserId: r.owner_user_id,
  backupAdminUserId: r.backup_admin_user_id,
});
