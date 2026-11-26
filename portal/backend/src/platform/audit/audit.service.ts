import { Inject, Injectable } from '@nestjs/common';
import { sql, type Transaction } from 'kysely';
import { DATABASE, type Database } from '../database/database';
import type { DB } from '../database/schema';
import { currentRequest } from '../observability/request-context';

export interface AuditEventInput {
  action: string;
  actorUserId?: string | null;
  actorSubject?: string | null;
  targetType?: string;
  targetId?: string;
  companyId?: string | null;
  /**
   * For an event with no company: the group it belongs to. Leave it out when the actor holds roles in exactly one
   * group (the database then uses that group); give it whenever the target's group is known, because a
   * group-level auditor reads company-less events of THEIR group only (docs/security/AUDIT.md).
   */
  groupId?: string | null;
  details?: Record<string, unknown>;
  ip?: string | null;
}

/**
 * Action names are `<area>.<what_happened>` and are part of the contract with auditors: do not rename
 * them casually. Never put tokens, secrets or personal data beyond what the action needs in `details`.
 */
export const AuditActions = {
  authLogin: 'auth.login',
  authLoginFailed: 'auth.login_failed',
  authLogout: 'auth.logout',
  authActingRoleChanged: 'auth.acting_role_changed',
  authBackchannelLogout: 'auth.backchannel_logout',
  accessDenied: 'security.access_denied',
  adminBootstrapGranted: 'access.group_admin_granted_by_idp',
  adminBootstrapRevoked: 'access.group_admin_revoked_by_idp',
  companyCreated: 'company.created',
  brandCreated: 'brand.created',
  companyUpdated: 'company.updated',
  brandUpdated: 'brand.updated',
  membershipGranted: 'access.membership_granted',
  membershipRevoked: 'access.membership_revoked',
  securitySessionsEnded: 'security.sessions_ended',
  contentDrafted: 'content.drafted',
  contentVersionCreated: 'content.version_created',
  contentSubmitted: 'content.submitted',
  contentReviewed: 'content.reviewed',
  contentApproved: 'content.approved',
  contentRejected: 'content.rejected',
  mediaUploaded: 'media.uploaded',
  publicationPublished: 'publication.published',
  publicationScheduled: 'publication.scheduled',
  publicationCancelled: 'publication.cancelled',
  inboxReplyRequested: 'inbox.reply_requested',
  inboxReplySent: 'inbox.reply_sent',
  inboxReplyFailed: 'inbox.reply_failed',
  inboxAssigned: 'inbox.assigned',
  inboxUnassigned: 'inbox.unassigned',
  inboxTargetSet: 'inbox.response_target_set',
  publicationFailed: 'publication.failed',
  publicationOutcomeUnknown: 'publication.outcome_unknown',
  publishingFrozen: 'publishing.frozen',
  publishingUnfrozen: 'publishing.unfrozen',
  accountCreated: 'account.created',
  accountUpdated: 'account.updated',
  accountStatusChanged: 'account.status_changed',
  accountBackupAdminChanged: 'account.backup_admin_changed',
  accountAssigned: 'account.assigned',
  accountUnassigned: 'account.unassigned',
  accountEngineLinked: 'account.engine_linked',
  accountEngineUnlinked: 'account.engine_unlinked',
  auditExported: 'audit.exported',
  idempotencyKeysPruned: 'maintenance.idempotency_keys_pruned',
  contentCategoryCreated: 'content_category.created',
  contentCategoryUpdated: 'content_category.updated',
  approvalPolicySet: 'approval_policy.set',
  approvalPolicyRemoved: 'approval_policy.removed',
  incidentOpened: 'incident.opened',
  incidentUpdated: 'incident.updated',
  incidentCategoryCreated: 'incident_category.created',
  incidentCategoryUpdated: 'incident_category.updated',
  incidentContactCreated: 'incident_contact.created',
  incidentContactUpdated: 'incident_contact.updated',
  // Round 2 (2026-11-26)
  workingHoursSet: 'working_hours.set',
  inboxEscalated: 'inbox.escalated',
  inboxPrioritySet: 'inbox.priority_set',
  inboxModerated: 'inbox.moderated',
  inboxAckSettingsSet: 'inbox.ack_settings_set',
  inboxAckSent: 'inbox.ack_sent',
  replyApprovalRequested: 'inbox.reply_approval_requested',
  replyApprovalDecided: 'inbox.reply_approval_decided',
  approvalReminded: 'approval.reminded',
  approvalEscalated: 'approval.escalated',
  approvalExpired: 'approval.expired',
  approvalEmergency: 'approval.emergency',
  approvalEmergencyConfirmed: 'approval.emergency_confirmed',
  contentCategoryChanged: 'content.category_changed',
  freezeLiftConfirmed: 'publishing.freeze_lift_confirmed',
  incidentReviewRecorded: 'incident.review_recorded',
  incidentClosed: 'incident.closed',
  // Round 3 (2026-11-26)
  publicationRemoved: 'publication.removed',
  publicationCorrectionRequested: 'publication.correction_requested',
  alertSent: 'alert.sent',
  alertFailed: 'alert.failed',
  alertContactSet: 'alert.contact_set',
  alertSettingsSet: 'alert.settings_set',
  inboxResponderSet: 'inbox.responder_set',
  inboxAutoAssigned: 'inbox.auto_assigned',
} as const;

@Injectable()
export class AuditService {
  constructor(@Inject(DATABASE) private readonly database: Database) {}

  /**
   * Record inside the caller's transaction (preferred: the event commits or rolls back with the action
   * it describes). Call it LAST in the transaction: it takes a lock that serialises audit writers.
   */
  async record(trx: Transaction<DB>, event: AuditEventInput): Promise<void> {
    await this.append(trx, event);
  }

  /** Record in its own transaction (login, logout, denied access: events with no business transaction). */
  async recordStandalone(event: AuditEventInput): Promise<void> {
    await this.database.db.transaction().execute((trx) => this.append(trx, event));
  }

  async verifyChain(): Promise<{ ok: boolean; checked: number; firstBrokenId: string | null }> {
    const { rows } = await sql<{
      ok: boolean;
      checked: string;
      first_broken_id: string | null;
    }>`select * from audit_verify()`.execute(this.database.db);
    const r = rows[0]!;
    return { ok: r.ok, checked: Number(r.checked), firstBrokenId: r.first_broken_id };
  }

  private async append(trx: Transaction<DB>, e: AuditEventInput): Promise<void> {
    const ctx = currentRequest();
    await sql`select audit_append(
      ${e.actorUserId ?? null}::uuid, ${e.actorSubject ?? null}, ${e.action},
      ${e.targetType ?? null}, ${e.targetId ?? null}, ${e.companyId ?? null}::uuid,
      ${ctx?.requestId ?? null}, ${e.ip ?? ctx?.ip ?? null}, ${JSON.stringify(e.details ?? {})}::jsonb, ${e.groupId ?? null}::uuid)`.execute(
      trx,
    );
  }
}
