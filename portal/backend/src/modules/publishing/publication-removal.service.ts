import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { OperationalEngine } from '@dcc/engine-client';
import {
  APPROVER_ROLES,
  ROLES,
  ROLE_LABELS,
  ROLE_PERMISSIONS,
  type CorrectionResultDto,
  type CorrectPublicationRequest,
  type PublicationRecordDto,
  type RemovePublicationRequest,
  type Role,
} from '@dcc/contracts';
import type { Transaction } from 'kysely';
import { AuditActions, AuditService } from '../../platform/audit/audit.service';
import { can, type Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import {
  ApprovalPolicyService,
  effectiveRemoveRoles,
} from '../approval-policy/approval-policy.service';
import { ContentService } from '../content/content.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ctxOf } from '../shared/tenant-scope';
import { OPERATIONAL_ENGINE } from './operational-engine.provider';
import { PUBLICATION_COLUMNS, toPublicationDto, type PublicationRow } from './publication-record';

type Trx = Transaction<DB>;

/** What a removal needs to know about the publication, found inside the transaction that checks the caller. */
type Loaded = {
  publication: PublicationRow;
  groupId: string;
  companyStatus: string;
  categoryId: string | null;
  itemCreatedBy: string;
  removeRoles: Role[];
  approverRoles: Role[];
  /** The caller got in through the platform owner's exemption alone (no listed role). */
  ownerExemption: boolean;
};

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text;

/** Does the caller hold one of `roles` for this company: a role of the company itself, or a group-level role of its group? */
export function holdsRoleFor(
  access: Pick<Access, 'memberships'>,
  scope: { groupId: string; companyId: string },
  roles: readonly string[],
): boolean {
  return access.memberships.some(
    (m) =>
      (m.companyId === scope.companyId || (m.companyId === null && m.groupId === scope.groupId)) &&
      roles.includes(m.role),
  );
}

/**
 * Round 3 (RQ-026; sheet C1-15, C2 column I, F-14): take a published post down, or correct it, with a written reason.
 *  - the route permission `publication.remove` is only the coarse door: the service then checks that the caller holds one of the
 *    `remove_roles` of the post's category for THAT company (the platform owner is exempt, and it is audited);
 *  - removal asks the engine to delete the post (the same `deletePost` the cancel of a scheduled post uses); when the engine does
 *    not confirm, nothing changes in DCC and the attempt is audited; the record, its history and its audit trail are never erased;
 *  - a freeze does not block a removal (pulling a wrong post during a crisis is wanted), the company must be active;
 *  - a correction is a NEW draft copied from the published version, which goes through the normal approval (the caller wrote it, so
 *    the caller can never approve it).
 */
@Injectable()
export class PublicationRemovalService {
  constructor(
    private readonly tenant: TenantDb,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly policies: ApprovalPolicyService,
    private readonly content: ContentService,
    @Inject(OPERATIONAL_ENGINE) private readonly engine: OperationalEngine,
  ) {}

  /** Remove a published post. */
  async remove(
    access: Access,
    id: string,
    input: RemovePublicationRequest,
  ): Promise<PublicationRecordDto> {
    const updated = await this.performRemoval(access, id, input.reason, input.incidentId ?? null);
    return this.tenant.run(ctxOf(access), async (trx) => {
      const [dto] = await this.enrich(trx, access, [toPublicationDto(updated)]);
      return dto!;
    });
  }

  /** Correct a published post: a new draft, with the original removed first when asked. */
  async correct(
    access: Access,
    id: string,
    input: CorrectPublicationRequest,
  ): Promise<CorrectionResultDto> {
    // Everything that can be refused is refused before anything is changed.
    const before = await this.tenant.run(ctxOf(access), async (trx) => {
      const loaded = await this.load(trx, access, id);
      if (loaded.publication.status !== 'published' && loaded.publication.status !== 'removed')
        throw new ConflictException(
          `Only a published or removed post can be corrected; this one is ${loaded.publication.status}.`,
        );
      if (input.removeOriginal && loaded.publication.status !== 'published')
        throw new ConflictException(
          'This post is already removed: correct it without removing the original.',
        );
      if (input.removeOriginal)
        await this.assertOpenIncident(trx, loaded, input.incidentId ?? null);
      return loaded.publication.status;
    });

    // Remove first. If the engine does not confirm, this throws and no draft is made.
    if (input.removeOriginal)
      await this.performRemoval(access, id, input.reason, input.incidentId ?? null);

    return this.tenant.run(ctxOf(access), async (trx) => {
      // The permission is checked again next to the writes (the removal above may have taken a while).
      const loaded = await this.load(trx, access, id);
      const draft = await this.content.createCorrectionDraft(
        trx,
        access,
        {
          publicationId: loaded.publication.id,
          contentItemId: loaded.publication.content_item_id,
          contentVersionId: loaded.publication.content_version_id,
        },
        input.reason,
        { removedOriginal: input.removeOriginal },
      );
      // The people who will have to approve the corrected post are told it is coming (not the person who wrote it).
      const approvers = loaded.approverRoles.length > 0 ? loaded.approverRoles : APPROVER_ROLES;
      await this.notifications.notifyRoles(trx, {
        companyId: loaded.publication.company_id,
        roles: approvers,
        eventType: 'publication.correction_requested',
        targetType: 'content_item',
        targetId: draft.id,
        summary: `A correction of a published post was drafted and will need approval: ${clip(input.reason, 140)}`,
        excludeUserIds: [access.userId],
      });
      await this.audit.record(trx, {
        action: AuditActions.publicationCorrectionRequested,
        actorUserId: access.userId,
        targetType: 'publication',
        targetId: loaded.publication.id,
        companyId: loaded.publication.company_id,
        details: {
          reason: input.reason,
          removeOriginal: input.removeOriginal,
          originalStatusBefore: before,
          originalRemoved: loaded.publication.status === 'removed',
          correctionContentItemId: draft.id,
          contentItemId: loaded.publication.content_item_id,
          ...(loaded.ownerExemption && { platformOwnerExemption: true }),
        },
      });
      const [publication] = await this.enrich(trx, access, [toPublicationDto(loaded.publication)]);
      return {
        contentItem: draft,
        publication: publication!,
        originalRemoved: input.removeOriginal,
      };
    });
  }

  /**
   * Fills what depends on the caller and on other tables: the roles that may remove or correct each post, whether the caller is one
   * of them, and the content items made as corrections of it. Runs inside the caller's transaction.
   */
  async enrich(
    trx: Trx,
    access: Access,
    rows: PublicationRecordDto[],
  ): Promise<PublicationRecordDto[]> {
    if (rows.length === 0) return rows;
    const itemIds = [...new Set(rows.map((r) => r.contentItemId))];
    const items = await trx
      .selectFrom('content_items')
      .select(['id', 'category_id'])
      .where('id', 'in', itemIds)
      .execute();
    const categoryOf = new Map(items.map((i) => [i.id, i.category_id]));
    const companyIds = [...new Set(rows.map((r) => r.companyId))];
    const companies = await trx
      .selectFrom('companies')
      .select(['id', 'group_id'])
      .where('id', 'in', companyIds)
      .execute();
    const groupOf = new Map(companies.map((c) => [c.id, c.group_id]));
    const corrections = await trx
      .selectFrom('content_items')
      .select(['id', 'corrects_publication_id'])
      .where(
        'corrects_publication_id',
        'in',
        rows.map((r) => r.id),
      )
      .orderBy('created_at', 'desc')
      .execute();

    const rolesCache = new Map<string, Role[]>();
    const rolesFor = async (companyId: string, categoryId: string | null) => {
      const key = `${companyId}:${categoryId ?? ''}`;
      let roles = rolesCache.get(key);
      if (!roles) {
        roles = effectiveRemoveRoles(
          await this.policies.effectivePolicy(trx, companyId, categoryId),
        );
        rolesCache.set(key, roles);
      }
      return roles;
    };

    const out: PublicationRecordDto[] = [];
    for (const row of rows) {
      const settled = row.status === 'published' || row.status === 'removed';
      const roles = settled
        ? await rolesFor(row.companyId, categoryOf.get(row.contentItemId) ?? null)
        : [];
      const groupId = groupOf.get(row.companyId);
      const mayAct =
        settled &&
        groupId !== undefined &&
        can(access, 'publication.remove', { groupId, companyId: row.companyId }) &&
        (access.isPlatformOwner === true ||
          holdsRoleFor(access, { groupId, companyId: row.companyId }, roles));
      out.push({
        ...row,
        correctionContentItemIds: corrections
          .filter((c) => c.corrects_publication_id === row.id)
          .map((c) => c.id),
        removeRoles: roles,
        canRemove: mayAct && row.status === 'published',
        canCorrect: mayAct,
      });
    }
    return out;
  }

  // ---------------------------------------------------------------------------------------------

  /**
   * The removal itself, shared by the remove route and by a correction with `removeOriginal`: check, ask the engine, record.
   * The engine is asked between two transactions (never while one is open); the second one re-checks everything and only
   * changes a record that is still `published`.
   */
  private async performRemoval(
    access: Access,
    id: string,
    reason: string,
    incidentId: string | null,
  ): Promise<PublicationRow> {
    const target = await this.tenant.run(ctxOf(access), async (trx) => {
      const loaded = await this.load(trx, access, id);
      this.assertRemovable(loaded);
      await this.assertOpenIncident(trx, loaded, incidentId);
      return loaded;
    });
    const engineOperationId = target.publication.engine_operation_id!;

    try {
      await this.engine.deletePost(engineOperationId);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown engine error.';
      // Nothing changes in DCC, and the attempt is on record: somebody will ask who tried to pull this post and what happened.
      await this.tenant.run(ctxOf(access), async (trx) => {
        await this.audit.record(trx, {
          action: AuditActions.publicationRemoved,
          actorUserId: access.userId,
          targetType: 'publication',
          targetId: id,
          companyId: target.publication.company_id,
          details: {
            event: 'engine_refused',
            removed: false,
            reason,
            incidentId,
            engineOperationId,
            error: clip(message, 300),
            ...(target.ownerExemption && { platformOwnerExemption: true }),
          },
        });
      });
      throw new BadGatewayException(
        `The engine did not confirm the removal (${clip(message, 200)}). The post is still recorded as published: check the engine and try again.`,
      );
    }

    return this.tenant.run(ctxOf(access), async (trx) => {
      const loaded = await this.load(trx, access, id);
      this.assertRemovable(loaded);
      await this.assertOpenIncident(trx, loaded, incidentId);
      const now = new Date();
      const row = await trx
        .updateTable('publications')
        .set({
          status: 'removed',
          removed_by: access.userId,
          removed_at: now,
          removal_reason: reason,
          removal_incident_id: incidentId,
        })
        .where('id', '=', id)
        .where('status', '=', 'published')
        .returning(PUBLICATION_COLUMNS)
        .executeTakeFirst();
      // Somebody else removed it between the two transactions: the engine post was already gone, so nothing is lost.
      if (!row) throw new ConflictException('This post was removed by someone else a moment ago.');

      // The item stops claiming to be published once no channel still shows its current version.
      const stillOut = await trx
        .selectFrom('publications')
        .select('id')
        .where('content_version_id', '=', row.content_version_id)
        .where('status', 'in', ['published', 'scheduled', 'pending'])
        .executeTakeFirst();
      if (!stillOut)
        await trx
          .updateTable('content_items')
          .set({ status: 'archived', updated_at: now })
          .where('id', '=', row.content_item_id)
          .where('current_version_id', '=', row.content_version_id)
          .where('status', '=', 'published')
          .execute();

      const told = await this.notifyRemoval(trx, access, loaded, row, reason, incidentId);

      await this.audit.record(trx, {
        action: AuditActions.publicationRemoved,
        actorUserId: access.userId,
        targetType: 'publication',
        targetId: id,
        companyId: row.company_id,
        details: {
          event: 'removed',
          removed: true,
          reason,
          incidentId,
          contentItemId: row.content_item_id,
          engineOperationId,
          notified: told.length,
          ...(loaded.ownerExemption && { platformOwnerExemption: true }),
        },
      });
      return row;
    });
  }

  /** The writer(s), the approvers of that content and, when an incident is linked, the people who manage incidents. */
  private async notifyRemoval(
    trx: Trx,
    access: Access,
    loaded: Loaded,
    row: PublicationRow,
    reason: string,
    incidentId: string | null,
  ): Promise<string[]> {
    const authors = (
      await trx
        .selectFrom('content_versions')
        .select('created_by')
        .distinct()
        .where('content_item_id', '=', row.content_item_id)
        .execute()
    ).map((a) => a.created_by);
    const approvers = (
      await trx
        .selectFrom('approval_decisions as d')
        .innerJoin('approval_requests as r', 'r.id', 'd.approval_request_id')
        .select('d.decided_by')
        .distinct()
        .where('r.content_version_id', '=', row.content_version_id)
        .where('d.decision', '=', 'approved')
        .execute()
    ).map((a) => a.decided_by);
    const base = {
      companyId: row.company_id,
      eventType: 'publication.removed' as const,
      targetType: 'publication',
      targetId: row.id,
      summary: `A published post was removed: ${clip(reason, 140)}`,
    };
    const told = new Set<string>();
    for (const userId of new Set([
      loaded.itemCreatedBy,
      row.requested_by,
      ...authors,
      ...approvers,
    ])) {
      if (userId === access.userId) continue;
      await this.notifications.notifyUser(trx, { ...base, recipientUserId: userId });
      told.add(userId);
    }
    if (incidentId) {
      const managers = ROLES.filter((r) => ROLE_PERMISSIONS[r].includes('incident.manage'));
      const extra = await this.notifications.notifyRoles(trx, {
        ...base,
        roles: managers,
        excludeUserIds: [access.userId, ...told],
      });
      for (const userId of extra) told.add(userId);
    }
    return [...told];
  }

  private assertRemovable(loaded: Loaded): void {
    const { publication } = loaded;
    if (publication.status !== 'published')
      throw new ConflictException(
        publication.status === 'removed'
          ? 'This post was already removed.'
          : `Only a published post can be removed; this one is ${publication.status}.`,
      );
    if (loaded.companyStatus !== 'active')
      throw new ForbiddenException(`The company is ${loaded.companyStatus}.`);
    if (!publication.engine_operation_id)
      throw new ConflictException(
        'This record has no post at the engine, so there is nothing to remove.',
      );
  }

  /** The incident, when one is named: it must belong to the same company and not be closed. */
  private async assertOpenIncident(
    trx: Trx,
    loaded: Loaded,
    incidentId: string | null,
  ): Promise<void> {
    if (!incidentId) return;
    const incident = await trx
      .selectFrom('incidents')
      .select(['id', 'status'])
      .where('id', '=', incidentId)
      .where('company_id', '=', loaded.publication.company_id)
      .executeTakeFirst();
    if (!incident) throw new BadRequestException('That incident does not exist for this company.');
    if (incident.status === 'closed')
      throw new BadRequestException('That incident is closed: link an open one, or none.');
  }

  /**
   * Loads the publication under the walls (RLS: another company's record is a 404, never a 403) and checks the caller: the
   * route permission for THIS company, then one of the category's `remove_roles` (the platform owner is exempt).
   */
  private async load(trx: Trx, access: Access, id: string): Promise<Loaded> {
    const publication = await trx
      .selectFrom('publications')
      .select(PUBLICATION_COLUMNS)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!publication) throw new NotFoundException('Publication not found.');
    const company = await trx
      .selectFrom('companies')
      .select(['group_id', 'status'])
      .where('id', '=', publication.company_id)
      .executeTakeFirstOrThrow();
    const scope = { groupId: company.group_id, companyId: publication.company_id };
    if (!can(access, 'publication.remove', scope))
      throw new ForbiddenException('You cannot remove or correct posts of this company.');
    const item = await trx
      .selectFrom('content_items')
      .select(['category_id', 'created_by'])
      .where('id', '=', publication.content_item_id)
      .where('company_id', '=', publication.company_id)
      .executeTakeFirstOrThrow();
    const policy = await this.policies.effectivePolicy(
      trx,
      publication.company_id,
      item.category_id,
    );
    const removeRoles = effectiveRemoveRoles(policy);
    const holds = holdsRoleFor(access, scope, removeRoles);
    if (!holds && access.isPlatformOwner !== true)
      throw new ForbiddenException(
        `Posts of this category can only be removed or corrected by: ${removeRoles
          .map((r) => ROLE_LABELS[r] ?? r)
          .join(', ')}.`,
      );
    return {
      publication,
      groupId: company.group_id,
      companyStatus: company.status,
      categoryId: item.category_id,
      itemCreatedBy: item.created_by,
      removeRoles,
      approverRoles: policy.approverRoles as Role[],
      ownerExemption: !holds,
    };
  }
}
