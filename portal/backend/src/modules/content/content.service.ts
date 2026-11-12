import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type {
  ContentItemDto,
  ContentItemWithVersionDto,
  ContentVersionDto,
  CreateContentItemRequest,
  EditContentItemRequest,
  Permission,
} from '@dcc/contracts';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import { companyIdsWithPermission, ctxOf, NIL } from '../shared/tenant-scope';

const foreignKeyViolation = (e: unknown) => (e as { code?: string })?.code === '23503';

type Trx = Parameters<Parameters<TenantDb['run']>[1]>[0];

const ITEM_COLUMNS = [
  'id',
  'company_id',
  'brand_id',
  'created_by',
  'current_version_id',
  'status',
  'created_at',
  'updated_at',
] as const;

const VERSION_COLUMNS = [
  'id',
  'content_item_id',
  'company_id',
  'version_number',
  'body',
  'created_by',
  'created_at',
] as const;

/**
 * H-04 (drafts and versions - the first of 2-3 pull requests for this task). Submit/review/approve
 * and the ApprovalVerifier come later, once Abenezer's A-05 lands or the placeholder rule is built.
 * Every edit is a new, immutable version; nothing here ever updates an existing content_versions row.
 */
@Injectable()
export class ContentService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
  ) {}

  async list(access: Access): Promise<ContentItemDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const companyIds = await companyIdsWithPermission(trx, access, 'content.read');
      const rows = await trx
        .selectFrom('content_items')
        .select(ITEM_COLUMNS)
        .where('company_id', 'in', companyIds.length ? companyIds : [NIL])
        .orderBy('updated_at', 'desc')
        .execute();
      return rows.map(toItemDto);
    });
  }

  async get(access: Access, id: string): Promise<ContentItemDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const item = await this.loadItem(trx, access, id, 'content.read');
      return toItemDto(item);
    });
  }

  async versions(access: Access, id: string): Promise<ContentVersionDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      await this.loadItem(trx, access, id, 'content.read');
      const rows = await trx
        .selectFrom('content_versions')
        .select(VERSION_COLUMNS)
        .where('content_item_id', '=', id)
        .orderBy('version_number', 'desc')
        .execute();
      return Promise.all(rows.map((r) => this.toVersionDto(trx, r)));
    });
  }

  async create(
    access: Access,
    input: CreateContentItemRequest,
  ): Promise<ContentItemWithVersionDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const company = await trx
          .selectFrom('companies')
          .select(['id', 'group_id'])
          .where('id', '=', input.companyId)
          .executeTakeFirst();
        // RLS hides a company the caller cannot see; "not found" and "not yours" look identical.
        if (!company) throw new NotFoundException('Company not found.');
        if (!can(access, 'content.create', { groupId: company.group_id, companyId: company.id }))
          throw new ForbiddenException('You cannot create content for this company.');

        const item = await trx
          .insertInto('content_items')
          .values({
            company_id: input.companyId,
            brand_id: input.brandId ?? null,
            created_by: access.userId,
          })
          .returning(ITEM_COLUMNS)
          .executeTakeFirstOrThrow();

        const version = await this.insertVersion(trx, access, {
          contentItemId: item.id,
          companyId: item.company_id,
          versionNumber: 1,
          body: input.body,
          targetAccountIds: input.targetAccountIds,
        });

        const updated = await trx
          .updateTable('content_items')
          .set({ current_version_id: version.id, updated_at: new Date() })
          .where('id', '=', item.id)
          .returning(ITEM_COLUMNS)
          .executeTakeFirstOrThrow();

        await this.audit.record(trx, {
          action: AuditActions.contentDrafted,
          actorUserId: access.userId,
          targetType: 'content_item',
          targetId: item.id,
          companyId: item.company_id,
          details: { brandId: item.brand_id, targetAccountIds: input.targetAccountIds },
        });

        return { ...toItemDto(updated), currentVersion: await this.toVersionDto(trx, version) };
      });
    } catch (error) {
      if (foreignKeyViolation(error))
        throw new BadRequestException('The brand or one of the target accounts does not exist.');
      throw error;
    }
  }

  async edit(
    access: Access,
    id: string,
    input: EditContentItemRequest,
  ): Promise<ContentItemWithVersionDto> {
    try {
      return await this.tenant.run(ctxOf(access), async (trx) => {
        const item = await this.loadItem(trx, access, id, 'content.create');

        const previous = await trx
          .selectFrom('content_versions')
          .select(['version_number'])
          .where('content_item_id', '=', id)
          .orderBy('version_number', 'desc')
          .executeTakeFirstOrThrow();
        const targetAccountIds =
          input.targetAccountIds ??
          (
            await trx
              .selectFrom('content_version_targets')
              .select('social_account_id')
              .where('content_version_id', '=', item.current_version_id ?? NIL)
              .execute()
          ).map((r) => r.social_account_id);

        const version = await this.insertVersion(trx, access, {
          contentItemId: id,
          companyId: item.company_id,
          versionNumber: previous.version_number + 1,
          body: input.body,
          targetAccountIds,
        });

        // H-04 step 6: a new version needs a new approval. Any decision made against the old version
        // no longer applies, so the item goes back to 'draft' unless it already was one.
        const statusReset = item.status !== 'draft';
        const updated = await trx
          .updateTable('content_items')
          .set({
            current_version_id: version.id,
            status: statusReset ? 'draft' : undefined,
            updated_at: new Date(),
          })
          .where('id', '=', id)
          .returning(ITEM_COLUMNS)
          .executeTakeFirstOrThrow();

        await this.audit.record(trx, {
          action: AuditActions.contentVersionCreated,
          actorUserId: access.userId,
          targetType: 'content_item',
          targetId: id,
          companyId: item.company_id,
          details: { versionNumber: version.version_number, targetAccountIds, statusReset },
        });

        return { ...toItemDto(updated), currentVersion: await this.toVersionDto(trx, version) };
      });
    } catch (error) {
      if (foreignKeyViolation(error))
        throw new BadRequestException('One of the target accounts does not exist.');
      throw error;
    }
  }

  private async insertVersion(
    trx: Trx,
    access: Access,
    v: {
      contentItemId: string;
      companyId: string;
      versionNumber: number;
      body: string;
      targetAccountIds: string[];
    },
  ) {
    const row = await trx
      .insertInto('content_versions')
      .values({
        content_item_id: v.contentItemId,
        company_id: v.companyId,
        version_number: v.versionNumber,
        body: v.body,
        created_by: access.userId,
      })
      .returning(VERSION_COLUMNS)
      .executeTakeFirstOrThrow();
    await trx
      .insertInto('content_version_targets')
      .values(
        v.targetAccountIds.map((socialAccountId) => ({
          content_version_id: row.id,
          company_id: v.companyId,
          social_account_id: socialAccountId,
        })),
      )
      .execute();
    return row;
  }

  private async toVersionDto(
    trx: Trx,
    r: {
      id: string;
      content_item_id: string;
      company_id: string;
      version_number: number;
      body: string;
      created_by: string;
      created_at: Date;
    },
  ): Promise<ContentVersionDto> {
    const targets = await trx
      .selectFrom('content_version_targets')
      .select('social_account_id')
      .where('content_version_id', '=', r.id)
      .execute();
    return {
      id: r.id,
      contentItemId: r.content_item_id,
      companyId: r.company_id,
      versionNumber: r.version_number,
      body: r.body,
      targetAccountIds: targets.map((t) => t.social_account_id),
      createdBy: r.created_by,
      createdAt: r.created_at.toISOString(),
    };
  }

  private async groupIdOf(trx: Trx, companyId: string): Promise<string> {
    const company = await trx
      .selectFrom('companies')
      .select('group_id')
      .where('id', '=', companyId)
      .executeTakeFirstOrThrow();
    return company.group_id;
  }

  /** Loads the item under the walls (RLS), 404s if hidden, then re-checks `permission` for its company. */
  private async loadItem(trx: Trx, access: Access, id: string, permission: Permission) {
    const item = await trx
      .selectFrom('content_items')
      .select(ITEM_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!item) throw new NotFoundException('Content item not found.');
    const groupId = await this.groupIdOf(trx, item.company_id);
    if (!can(access, permission, { groupId, companyId: item.company_id }))
      throw new ForbiddenException('You cannot act on this content item.');
    return item;
  }
}

const toItemDto = (r: {
  id: string;
  company_id: string;
  brand_id: string | null;
  created_by: string;
  current_version_id: string | null;
  status: string;
  created_at: Date;
  updated_at: Date;
}): ContentItemDto => ({
  id: r.id,
  companyId: r.company_id,
  brandId: r.brand_id,
  createdBy: r.created_by,
  currentVersionId: r.current_version_id,
  status: r.status as ContentItemDto['status'],
  createdAt: r.created_at.toISOString(),
  updatedAt: r.updated_at.toISOString(),
});
