import { Injectable, NotFoundException } from '@nestjs/common';
import {
  ROLES,
  ROLE_PERMISSIONS,
  type MarkedReadDto,
  type NotificationDto,
  type UnreadCountDto,
} from '@dcc/contracts';
import type { Permission } from '@dcc/contracts';
import type { Transaction } from 'kysely';
import { TenantDb } from '../../platform/tenancy/tenant-db';
import type { Access } from '../../platform/authz/authz';
import type { DB } from '../../platform/database/schema';
import { ctxOf } from '../shared/tenant-scope';

type Trx = Transaction<DB>;

const NOTIFICATION_COLUMNS = [
  'id',
  'company_id',
  'event_type',
  'target_type',
  'target_id',
  'summary',
  'read_at',
  'created_at',
] as const;

/**
 * H-06, in-app only (Hirko's first-cut answer to Q4 - portal/backend/QUESTIONS/QUESTIONS.md, not
 * yet decided by Dawit). Called by other modules from WITHIN their own TenantDb.run transaction, the
 * same way they call AuditService - never opens its own transaction for a write.
 */
@Injectable()
export class NotificationsService {
  constructor(private readonly tenant: TenantDb) {}

  /** Broadcasts to every user who currently holds `permission` in this company, under the group's
   * group-level roles too. Excludes `excludeUserId` (normally the actor) so nobody is told about
   * their own action. */
  async notifyHolders(
    trx: Trx,
    params: {
      companyId: string;
      groupId: string;
      permission: Permission;
      eventType: NotificationDto['eventType'];
      targetType: string;
      targetId: string;
      summary: string;
      excludeUserId?: string;
    },
  ): Promise<void> {
    const roles = ROLES.filter((r) => ROLE_PERMISSIONS[r].includes(params.permission));
    if (roles.length === 0) return;
    const recipients = await trx
      .selectFrom('memberships')
      .select('user_id')
      .distinct()
      .where('role', 'in', roles)
      .where((eb) =>
        eb.or([
          eb('company_id', '=', params.companyId),
          eb.and([eb('company_id', 'is', null), eb('group_id', '=', params.groupId)]),
        ]),
      )
      .execute();
    const recipientIds = recipients
      .map((r) => r.user_id)
      .filter((id) => id !== params.excludeUserId);
    await this.insertMany(trx, recipientIds, params);
  }

  /** Notifies exactly one person (e.g. the content's creator, once a decision is made on it). */
  async notifyUser(
    trx: Trx,
    params: {
      companyId: string;
      recipientUserId: string;
      eventType: NotificationDto['eventType'];
      targetType: string;
      targetId: string;
      summary: string;
    },
  ): Promise<void> {
    await this.insertMany(trx, [params.recipientUserId], params);
  }

  private async insertMany(
    trx: Trx,
    recipientIds: string[],
    params: {
      companyId: string;
      eventType: NotificationDto['eventType'];
      targetType: string;
      targetId: string;
      summary: string;
    },
  ): Promise<void> {
    if (recipientIds.length === 0) return;
    await trx
      .insertInto('notifications')
      .values(
        recipientIds.map((recipientUserId) => ({
          company_id: params.companyId,
          recipient_user_id: recipientUserId,
          event_type: params.eventType,
          target_type: params.targetType,
          target_id: params.targetId,
          summary: params.summary,
        })),
      )
      .execute();
  }

  /** The caller's own inbox, newest first. */
  async list(access: Access, unreadOnly: boolean): Promise<NotificationDto[]> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      let query = trx
        .selectFrom('notifications')
        .select(NOTIFICATION_COLUMNS)
        .orderBy('created_at', 'desc')
        .limit(200);
      if (unreadOnly) query = query.where('read_at', 'is', null);
      const rows = await query.execute();
      return rows.map(toDto);
    });
  }

  async unreadCount(access: Access): Promise<UnreadCountDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const row = await trx
        .selectFrom('notifications')
        .select((eb) => eb.fn.countAll().as('count'))
        .where('read_at', 'is', null)
        .executeTakeFirstOrThrow();
      return { unread: Number(row.count) };
    });
  }

  /** Marks every unread notification of the caller read; returns how many changed. */
  async markAllRead(access: Access): Promise<MarkedReadDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const rows = await trx
        .updateTable('notifications')
        .set({ read_at: new Date() })
        .where('read_at', 'is', null)
        .returning('id')
        .execute();
      return { marked: rows.length };
    });
  }

  async markRead(access: Access, id: string): Promise<NotificationDto> {
    return this.tenant.run(ctxOf(access), async (trx) => {
      const row = await trx
        .updateTable('notifications')
        .set({ read_at: new Date() })
        .where('id', '=', id)
        .returning(NOTIFICATION_COLUMNS)
        .executeTakeFirst();
      // RLS makes someone else's notification invisible to this update, same as every other module.
      if (!row) throw new NotFoundException('Notification not found.');
      return toDto(row);
    });
  }
}

const toDto = (r: {
  id: string;
  company_id: string;
  event_type: string;
  target_type: string;
  target_id: string;
  summary: string;
  read_at: Date | null;
  created_at: Date;
}): NotificationDto => ({
  id: r.id,
  companyId: r.company_id,
  eventType: r.event_type as NotificationDto['eventType'],
  targetType: r.target_type,
  targetId: r.target_id,
  summary: r.summary,
  readAt: r.read_at ? r.read_at.toISOString() : null,
  createdAt: r.created_at.toISOString(),
});
