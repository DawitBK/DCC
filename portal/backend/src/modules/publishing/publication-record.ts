import type { PublicationRecordDto } from '@dcc/contracts';

/** The columns of a publication the API sends (Round 3 added the removal facts). */
export const PUBLICATION_COLUMNS = [
  'id',
  'company_id',
  'content_item_id',
  'content_version_id',
  'social_account_id',
  'requested_by',
  'approved_by',
  'engine_operation_id',
  'external_post_url',
  'status',
  'error',
  'scheduled_at',
  'requested_at',
  'completed_at',
  'removed_by',
  'removed_at',
  'removal_reason',
  'removal_incident_id',
] as const;

export type PublicationRow = {
  id: string;
  company_id: string;
  content_item_id: string;
  content_version_id: string;
  social_account_id: string;
  requested_by: string;
  approved_by: string | null;
  engine_operation_id: string | null;
  external_post_url: string | null;
  status: string;
  error: string | null;
  scheduled_at: Date | null;
  requested_at: Date;
  completed_at: Date | null;
  removed_by: string | null;
  removed_at: Date | null;
  removal_reason: string | null;
  removal_incident_id: string | null;
};

/**
 * The record as the API sends it. The facts that depend on who is asking (`removeRoles`, `canRemove`, `canCorrect`) and on other
 * tables (`correctionContentItemIds`) are filled by `PublicationRemovalService.enrich`; a response that skips that carries the
 * safe defaults (nobody may remove, no corrections known).
 */
export const toPublicationDto = (r: PublicationRow): PublicationRecordDto => ({
  id: r.id,
  companyId: r.company_id,
  contentItemId: r.content_item_id,
  contentVersionId: r.content_version_id,
  socialAccountId: r.social_account_id,
  requestedBy: r.requested_by,
  approvedBy: r.approved_by,
  engineOperationId: r.engine_operation_id,
  externalPostUrl: r.external_post_url,
  status: r.status as PublicationRecordDto['status'],
  error: r.error,
  scheduledAt: r.scheduled_at ? r.scheduled_at.toISOString() : null,
  requestedAt: r.requested_at.toISOString(),
  completedAt: r.completed_at ? r.completed_at.toISOString() : null,
  removedBy: r.removed_by,
  removedAt: r.removed_at ? r.removed_at.toISOString() : null,
  removalReason: r.removal_reason,
  removalIncidentId: r.removal_incident_id,
  correctionContentItemIds: [],
  removeRoles: [],
  canRemove: false,
  canCorrect: false,
});
