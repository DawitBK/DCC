// Round 3 (2026-11-26), removal: delete or correct a published post, with a written reason (RQ-026; sheet C1-15, C2 column I, F-14).
// Types and schemas of this area live here, so parallel work never edits the same lines.
import { z } from 'zod';
import type { ContentItemDto, PublicationDto } from './api';
import { ROLES, type Role } from './roles';
import type { PublicationStatus } from './platforms';

/**
 * The status of a publication that was removed. (`PUBLICATION_STATUSES` in platforms.ts does not carry it: that file is
 * shared, so the extended list lives here. The database check allows it.)
 */
export const PUBLICATION_REMOVED = 'removed' as const;

/** Every status a publication record can have, `removed` included. */
export const PUBLICATION_RECORD_STATUSES = [
  'pending',
  'scheduled',
  'published',
  'failed',
  'cancelled',
  PUBLICATION_REMOVED,
] as const satisfies readonly (PublicationStatus | typeof PUBLICATION_REMOVED)[];
export type PublicationRecordStatus = (typeof PUBLICATION_RECORD_STATUSES)[number];

/** A written reason is always required, and it is kept with the record. */
export const MIN_REMOVAL_REASON_LENGTH = 10;
export const MAX_REMOVAL_REASON_LENGTH = 1000;

/** `removeRoles` as the policy API carries it. Empty = the approver roles of the policy plus the company and group administrators. */
export const RemoveRolesField = z.array(z.enum(ROLES)).max(ROLES.length);

/**
 * Who may remove or correct a post of a category when its policy names nobody: the roles that approve that category's
 * content, plus the two administrator roles ("authorised admin", sheet C2 column I).
 */
export const ALWAYS_MAY_REMOVE_ROLES = [
  'company_admin',
  'group_admin',
] as const satisfies readonly Role[];

/** What the policy API now also carries (the request side is `removeRoles` on `SetApprovalPolicyRequest`). */
export interface ApprovalPolicyRemoveFields {
  /** What was stored; empty means "the default" (see `ALWAYS_MAY_REMOVE_ROLES`). */
  removeRoles: Role[];
}

/** Remove a published post. The incident is optional: the removal is then part of that incident's record. */
export const RemovePublicationRequest = z.object({
  reason: z.string().trim().min(MIN_REMOVAL_REASON_LENGTH).max(MAX_REMOVAL_REASON_LENGTH),
  incidentId: z.uuid().optional(),
});
export type RemovePublicationRequest = z.infer<typeof RemovePublicationRequest>;

/** Correct a published post: a new draft is made from it and goes through the normal approval. */
export const CorrectPublicationRequest = z.object({
  reason: z.string().trim().min(MIN_REMOVAL_REASON_LENGTH).max(MAX_REMOVAL_REASON_LENGTH),
  /** Take the original down first (the caller must be allowed to remove; if that fails no draft is made). */
  removeOriginal: z.boolean(),
  /** Used only when `removeOriginal` is true: the removal is then recorded against this incident. */
  incidentId: z.uuid().optional(),
});
export type CorrectPublicationRequest = z.infer<typeof CorrectPublicationRequest>;

/** What a publication carries about being removed, and the link to the corrections made of it. */
export interface PublicationRemovalFields {
  removedBy: string | null;
  removedAt: string | null;
  removalReason: string | null;
  /** The incident the removal was recorded against, when there is one. */
  removalIncidentId: string | null;
  /** The content items made as corrections of this publication (newest first). */
  correctionContentItemIds: string[];
  /** The roles that may remove or correct this post (the rule of its category); empty on a record that cannot be removed. */
  removeRoles: Role[];
  /** Whether the caller may remove it now (it is published, and the caller holds one of those roles). */
  canRemove: boolean;
  /** Whether the caller may correct it now (it is published or already removed, and the caller holds one of those roles). */
  canCorrect: boolean;
}

/** A publication as the API sends it since the removal work: the old fields, `removed` as a possible status, and the removal facts. */
export type PublicationRecordDto = Omit<PublicationDto, 'status'> & {
  status: PublicationRecordStatus;
} & PublicationRemovalFields;

/** On a content item: the published post it corrects, when it is a correction. */
export interface ContentItemCorrectionFields {
  correctsPublicationId: string | null;
}
export type ContentItemWithCorrectionDto = ContentItemDto & ContentItemCorrectionFields;

/** What the correction route answers: the new draft, and the publication as it is now (removed when `removeOriginal` was true). */
export interface CorrectionResultDto {
  contentItem: ContentItemWithCorrectionDto;
  publication: PublicationRecordDto;
  originalRemoved: boolean;
}
