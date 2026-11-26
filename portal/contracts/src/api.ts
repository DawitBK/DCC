import { z } from 'zod';
import { ROLES, type Role } from './roles';
import { ROLE_PERMISSIONS, type Permission } from './permissions';
import {
  APPROVAL_DECISIONS,
  APPROVAL_REQUEST_STATUSES,
  COMPANY_STATUSES,
  CONTENT_CATEGORY_STATUSES,
  CONTENT_ITEM_STATUSES,
  INCIDENT_CATEGORY_STATUSES,
  INCIDENT_CONTACT_CHANNELS,
  INCIDENT_CONTACT_STATUSES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  NOTIFICATION_EVENT_TYPES,
  PUBLICATION_STATUSES,
  SOCIAL_ACCOUNT_STATUSES,
  SOCIAL_PLATFORMS,
} from './platforms';

const slug = z
  .string()
  .min(2)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lower-case letters, digits and single dashes only');

export const CreateCompanyRequest = z.object({
  name: z.string().trim().min(2).max(120),
  slug,
});
export type CreateCompanyRequest = z.infer<typeof CreateCompanyRequest>;

/** Rename a company, or change its status. Suspended and archived companies cannot publish. */
export const UpdateCompanyRequest = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    status: z.enum(COMPANY_STATUSES).optional(),
  })
  .refine((v) => v.name !== undefined || v.status !== undefined, {
    message: 'Give a new name, a new status, or both.',
  });
export type UpdateCompanyRequest = z.infer<typeof UpdateCompanyRequest>;

export const UpdateBrandRequest = z.object({ name: z.string().trim().min(2).max(120) });
export type UpdateBrandRequest = z.infer<typeof UpdateBrandRequest>;

export const CreateBrandRequest = z.object({
  name: z.string().trim().min(2).max(120),
  slug,
});
export type CreateBrandRequest = z.infer<typeof CreateBrandRequest>;

export const GrantMembershipRequest = z
  .object({
    // The person, by ONE of these. `email` is how a new person gets their first role: until they hold a
    // role no administrator can see them in the people list, so nobody knows their id. They must have
    // signed in to DCC once (that is what creates them here).
    userId: z.uuid().optional(),
    email: z.email().max(254).optional(),
    role: z.enum(ROLES),
    // Omitted = a group-level grant, in the caller's own group (H-03: mirrors how CompaniesService.create
    // derives its group - never trusted as an arbitrary group id). Present = a company-level grant; the
    // company is loaded under the walls before anything is written, same as every other module.
    companyId: z.uuid().optional(),
  })
  .refine((v) => (v.userId === undefined) !== (v.email === undefined), {
    message: 'Give the person by userId or by email: exactly one of them.',
    path: ['userId'],
  });
export type GrantMembershipRequest = z.infer<typeof GrantMembershipRequest>;

const displayName = z.string().trim().min(2).max(160);
const handle = z.string().trim().min(1).max(100);
const publicUrl = z.url().max(300);

/** An account must have an owner; the backup admin (if set) must be a different person (H-02 step 5). */
export const CreateSocialAccountRequest = z
  .object({
    // Checked against the caller's own scope in the service (the company row is loaded under RLS,
    // then re-checked with authz.can) before anything is inserted - there is no existing account yet
    // to load it from.
    companyId: z.uuid(),
    platform: z.enum(SOCIAL_PLATFORMS),
    displayName,
    handle,
    publicUrl: publicUrl.optional(),
    brandId: z.uuid().optional(),
    ownerUserId: z.uuid(),
    backupAdminUserId: z.uuid().optional(),
  })
  .refine((v) => v.backupAdminUserId === undefined || v.backupAdminUserId !== v.ownerUserId, {
    message: 'The backup admin must be a different person from the owner.',
    path: ['backupAdminUserId'],
  });
export type CreateSocialAccountRequest = z.infer<typeof CreateSocialAccountRequest>;

export const UpdateSocialAccountRequest = z.object({
  displayName: displayName.optional(),
  handle: handle.optional(),
  publicUrl: publicUrl.nullable().optional(),
  brandId: z.uuid().nullable().optional(),
  ownerUserId: z.uuid().optional(),
});
export type UpdateSocialAccountRequest = z.infer<typeof UpdateSocialAccountRequest>;

export const SetAccountBackupAdminRequest = z.object({
  backupAdminUserId: z.uuid(),
});
export type SetAccountBackupAdminRequest = z.infer<typeof SetAccountBackupAdminRequest>;

export const SetAccountStatusRequest = z.object({
  status: z.enum(SOCIAL_ACCOUNT_STATUSES),
});
export type SetAccountStatusRequest = z.infer<typeof SetAccountStatusRequest>;

export const AssignAccountRequest = z.object({
  userId: z.uuid(),
});
export type AssignAccountRequest = z.infer<typeof AssignAccountRequest>;

/** H-06, first cut: register, escalate, track, resolve - optionally tied to one social account. */
export const CreateIncidentRequest = z.object({
  companyId: z.uuid(),
  socialAccountId: z.uuid().optional(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().max(5_000).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  categoryId: z.uuid().optional(),
});
export type CreateIncidentRequest = z.infer<typeof CreateIncidentRequest>;

export const UpdateIncidentRequest = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  description: z.string().trim().max(5_000).optional(),
  severity: z.enum(INCIDENT_SEVERITIES).optional(),
  status: z.enum(INCIDENT_STATUSES).optional(),
  /** null = remove the category. */
  categoryId: z.uuid().nullable().optional(),
});
export type UpdateIncidentRequest = z.infer<typeof UpdateIncidentRequest>;

/** Limits of the incident detail (H-06). The text itself is entered by the Group; nothing is shipped. */
export const MAX_PLAYBOOK_STEPS = 30;
export const MAX_RECOVERY_CONTACTS_PER_COMPANY = 50;

const lineText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    // eslint-disable-next-line no-control-regex
    .refine((v) => !/[\u0000-\u001f\u007f]/.test(v), 'plain text on one line');

/** A playbook is a title and an ordered list of plain-text steps, one line each. */
export const IncidentPlaybook = z.object({
  title: lineText(200).pipe(z.string().min(2)),
  steps: z.array(lineText(500)).min(1).max(MAX_PLAYBOOK_STEPS),
});
export type IncidentPlaybook = z.infer<typeof IncidentPlaybook>;

/** companyId absent = the group's default category (needs incident.manage at group level). */
export const CreateIncidentCategoryRequest = z.object({
  companyId: z.uuid().optional(),
  key: slug,
  name: z.string().trim().min(2).max(120),
  playbook: IncidentPlaybook.optional(),
});
export type CreateIncidentCategoryRequest = z.infer<typeof CreateIncidentCategoryRequest>;

export const UpdateIncidentCategoryRequest = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    status: z.enum(INCIDENT_CATEGORY_STATUSES).optional(),
    /** null = remove the playbook. */
    playbook: IncidentPlaybook.nullable().optional(),
  })
  .refine((v) => v.name !== undefined || v.status !== undefined || v.playbook !== undefined, {
    message: 'Give a new name, a new status, a playbook (or null to remove it), or a combination.',
  });
export type UpdateIncidentCategoryRequest = z.infer<typeof UpdateIncidentCategoryRequest>;

const contactValue = (channel: (typeof INCIDENT_CONTACT_CHANNELS)[number], value: string) => {
  if (channel === 'email') return z.email().max(200).safeParse(value).success;
  if (channel === 'phone') return /^\+?[0-9][0-9 ()-]{3,38}[0-9]$/.test(value);
  return value.length >= 1 && value.length <= 200 && !/[\u0000-\u001f\u007f]/.test(value); // eslint-disable-line no-control-regex
};

const ContactFields = z.object({
  name: lineText(120).pipe(z.string().min(2)),
  roleLabel: lineText(120).pipe(z.string().min(2)),
  channel: z.enum(INCIDENT_CONTACT_CHANNELS),
  value: z.string().trim().min(1).max(200),
  position: z.number().int().min(0).max(1000).optional(),
});

/** A person to call when something goes wrong. Needs no DCC account. */
export const CreateIncidentContactRequest = ContactFields.extend({ companyId: z.uuid() }).refine(
  (v) => contactValue(v.channel, v.value),
  { message: 'The value does not look like that kind of contact.', path: ['value'] },
);
export type CreateIncidentContactRequest = z.infer<typeof CreateIncidentContactRequest>;

export const UpdateIncidentContactRequest = ContactFields.partial()
  .extend({ status: z.enum(INCIDENT_CONTACT_STATUSES).optional() })
  .refine((v) => Object.values(v).some((x) => x !== undefined), {
    message: 'Give at least one field to change.',
  })
  .refine(
    (v) => v.channel === undefined || v.value === undefined || contactValue(v.channel, v.value),
    {
      message: 'The value does not look like that kind of contact.',
      path: ['value'],
    },
  );
export type UpdateIncidentContactRequest = z.infer<typeof UpdateIncidentContactRequest>;

export { contactValue as isValidContactValue };

const contentBody = z.string().trim().min(1).max(10_000);

/** Pictures and videos attached to a post. The file itself is uploaded first (POST /api/media), then named here by id. */
export const MEDIA_KINDS = ['image', 'video'] as const;
export type MediaKind = (typeof MEDIA_KINDS)[number];
export const MAX_MEDIA_PER_POST = 10;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
/** The only file types accepted, by what the file really is (checked on the server, not by its name). */
export const MEDIA_TYPES: Record<string, MediaKind> = {
  'image/jpeg': 'image',
  'image/png': 'image',
  'image/webp': 'image',
  'image/gif': 'image',
  'video/mp4': 'video',
  'video/quicktime': 'video',
  'video/webm': 'video',
};
const mediaIds = z.array(z.uuid()).max(MAX_MEDIA_PER_POST);

export interface ContentMediaDto {
  id: string;
  companyId: string;
  kind: MediaKind;
  fileName: string;
  mimeType: string;
  sizeBytes: number;
  /** Path under the API, for <img>/<video>: `/api/media/<id>/file`. Needs the session cookie. */
  url: string;
  uploadedBy: string;
  createdAt: string;
}

/** Act as one of the roles you hold (null = all of them together). */
export const SetActingRoleRequest = z.object({ role: z.enum(ROLES).nullable() });
export type SetActingRoleRequest = z.infer<typeof SetActingRoleRequest>;

/** H-04: a draft always has a body and at least one target account. */
export const CreateContentItemRequest = z.object({
  companyId: z.uuid(),
  brandId: z.uuid().optional(),
  body: contentBody,
  targetAccountIds: z.array(z.uuid()).min(1),
  /** Uploaded pictures or videos, in the order they should appear. */
  mediaIds: mediaIds.optional(),
  /** The kind of content (H-09). It decides which approval policy applies. Optional: no category = the company's default policy. */
  categoryId: z.uuid().optional(),
});
export type CreateContentItemRequest = z.infer<typeof CreateContentItemRequest>;

/** Every edit makes a new version (H-04 step 2). Omitting targetAccountIds keeps the previous version's targets. */
export const EditContentItemRequest = z.object({
  body: contentBody,
  targetAccountIds: z.array(z.uuid()).min(1).optional(),
  /** Omitted = keep the previous version's media; an empty list removes them. */
  mediaIds: mediaIds.optional(),
});
export type EditContentItemRequest = z.infer<typeof EditContentItemRequest>;

const approvalComment = z.string().trim().min(1).max(2_000);

/** "Review" is a comment, not a decision (proposal 9.1: a distinct step from "approve"). */
export const ReviewContentRequest = z.object({ comment: approvalComment });
export type ReviewContentRequest = z.infer<typeof ReviewContentRequest>;

export const DecideApprovalRequest = z.object({ comment: approvalComment.optional() });
export type DecideApprovalRequest = z.infer<typeof DecideApprovalRequest>;

/** H-05: publish the current, approved version to one of its approved target accounts. */
/** With `scheduledAt` the engine holds the post until that time; without it the post goes out now. */
export const PublishContentRequest = z.object({
  socialAccountId: z.uuid(),
  scheduledAt: z.iso.datetime({ offset: true }).optional(),
});

/** Publications in a time window (the calendar). Both ends are optional. */
export const PublicationsQuery = z.object({
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
});
export type PublicationsQuery = z.infer<typeof PublicationsQuery>;

export const InboxQuery = z.object({
  companyId: z.uuid().optional(),
  from: z.iso.datetime({ offset: true }).optional(),
  to: z.iso.datetime({ offset: true }).optional(),
  /** H-14: only the messages assigned to this person. */
  assignedTo: z.uuid().optional(),
  /** H-14: only messages with no assignee (`true`) or only assigned ones (`false`). */
  unassigned: z.enum(['true', 'false']).optional(),
  /** H-14: only overdue messages (`true`) or only those not overdue (`false`), against the company's response target. */
  overdue: z.enum(['true', 'false']).optional(),
});
export type InboxQuery = z.infer<typeof InboxQuery>;

export const MAX_INBOX_REPLY_LENGTH = 2000;
export const ReplyInboxRequest = z.object({
  socialAccountId: z.uuid(),
  engineMessageId: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(MAX_INBOX_REPLY_LENGTH),
});
export type ReplyInboxRequest = z.infer<typeof ReplyInboxRequest>;
export type PublishContentRequest = z.infer<typeof PublishContentRequest>;

/**
 * H-17: a person with content.publish settles a stuck publish key that reconciliation could not (ambiguous or no
 * match). `published` names the engine post that is this publication; `not_published` declares that nothing was
 * sent (the server refuses it while the engine still holds a matching post). The reason is kept in the audit trail.
 */
export const SettleStuckKeyRequest = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('published'),
    engineOperationId: z.string().trim().min(1).max(200),
    reason: z.string().trim().min(1).max(500),
  }),
  z.object({
    outcome: z.literal('not_published'),
    reason: z.string().trim().min(1).max(500),
  }),
]);
export type SettleStuckKeyRequest = z.infer<typeof SettleStuckKeyRequest>;

/** Omitting socialAccountId freezes the whole company; otherwise freezes just that one account. */
export const CreateFreezeRequest = z.object({
  companyId: z.uuid(),
  socialAccountId: z.uuid().optional(),
  reason: z.string().trim().min(1).max(500).optional(),
});
export type CreateFreezeRequest = z.infer<typeof CreateFreezeRequest>;

/** Link a registered account to a channel of the operational engine; null unlinks it. */
export const LinkEngineChannelRequest = z.object({
  engineChannelId: z.string().trim().min(1).max(200).nullable(),
});
export type LinkEngineChannelRequest = z.infer<typeof LinkEngineChannelRequest>;

/** What is behind DCC for publishing. `verification` is 'verified' only after a test against a live engine. */
export interface EngineStatusDto {
  provider: string;
  verification: 'verified' | 'unverified';
  canPublish: boolean;
  inbox: boolean;
  /** Where an engine administrator connects networks (the engine's own web address); null when there is none. */
  consoleUrl: string | null;
  notes: string[];
}

/** A channel held by the operational engine (a connected page or profile). */
export interface EngineChannelDto {
  engineChannelId: string;
  name: string;
  /** null = a network DCC does not govern. */
  platform: (typeof SOCIAL_PLATFORMS)[number] | null;
  disabled: boolean;
  /** The registered account it is linked to, when the caller can see that account. */
  linkedAccountId: string | null;
}

/** Roles whose holders may approve content (they hold `content.approve`). A policy may narrow approval to some of them. */
export const APPROVER_ROLES = ROLES.filter((r) => ROLE_PERMISSIONS[r].includes('content.approve'));

export const CreateContentCategoryRequest = z.object({
  key: slug,
  name: z.string().trim().min(2).max(120),
});
export type CreateContentCategoryRequest = z.infer<typeof CreateContentCategoryRequest>;

export const UpdateContentCategoryRequest = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    status: z.enum(CONTENT_CATEGORY_STATUSES).optional(),
  })
  .refine((v) => v.name !== undefined || v.status !== undefined, {
    message: 'Give a new name, a new status, or both.',
  });
export type UpdateContentCategoryRequest = z.infer<typeof UpdateContentCategoryRequest>;

export const MAX_REQUIRED_APPROVALS = 5;

/** Create or replace one company's approval policy for a category (categoryId null or absent = the company's default). */
export const SetApprovalPolicyRequest = z.object({
  companyId: z.uuid(),
  categoryId: z.uuid().nullable().optional(),
  requiredApprovals: z.number().int().min(1).max(MAX_REQUIRED_APPROVALS),
  /** Empty = any role that may approve. */
  approverRoles: z.array(z.enum(ROLES)).max(ROLES.length).default([]),
  /** Round 2: the time limit in hours (null = no limit); omitted keeps what the policy has. */
  timeLimitHours: z.number().int().min(1).max(720).nullable().optional(),
  /** Round 2: how the limit counts, office hours or round the clock; omitted keeps what the policy has. */
  clock: z.enum(['working', 'continuous']).optional(),
  /** Round 3: the roles that may remove or correct a published post of this category; empty = the approver roles plus the administrators; omitted keeps what the policy has. */
  removeRoles: z.array(z.enum(ROLES)).max(ROLES.length).optional(),
});
export type SetApprovalPolicyRequest = z.infer<typeof SetApprovalPolicyRequest>;

export interface ContentCategoryDto {
  id: string;
  groupId: string;
  key: string;
  name: string;
  status: (typeof CONTENT_CATEGORY_STATUSES)[number];
}

export interface ApprovalPolicyDto {
  id: string;
  companyId: string;
  /** null = the company's default policy. */
  categoryId: string | null;
  requiredApprovals: number;
  approverRoles: Role[];
  updatedBy: string;
  updatedAt: string;
}

/** H-10. Only what DCC really knows; `notMonitored` names what it does not. */
export interface SecurityPostureDto {
  generatedAt: string;
  twoFactorSignIn: { enforced: boolean; note: string };
  sensitiveActions: { signInAgainAfterMinutes: number };
  auditTrail: { chainOk: boolean; events: number; firstBrokenId: string | null };
  newAdministrators: {
    days: number;
    items: { userId: string | null; role: string; companyId: string | null; grantedAt: string }[];
  };
  accounts: {
    total: number;
    withoutOwner: number;
    withoutBackupAdmin: number;
    notConnectedToEngine: number;
    needsAttention: number;
    disconnected: number;
  };
  publishingFreezes: number;
  openIncidents: { low: number; medium: number; high: number; critical: number };
  notMonitored: string[];
}

export interface CompanyDto {
  id: string;
  groupId: string;
  name: string;
  slug: string;
  status: (typeof COMPANY_STATUSES)[number];
}

export interface BrandDto {
  id: string;
  companyId: string;
  name: string;
  slug: string;
}

export interface SocialAccountDto {
  id: string;
  companyId: string;
  brandId: string | null;
  platform: (typeof SOCIAL_PLATFORMS)[number];
  displayName: string;
  handle: string;
  publicUrl: string | null;
  status: (typeof SOCIAL_ACCOUNT_STATUSES)[number];
  ownerUserId: string | null;
  backupAdminUserId: string | null;
  /** The operational engine's channel this account is linked to; null = not connected, cannot be published to. */
  engineChannelId: string | null;
}

export interface AccountAssignmentDto {
  id: string;
  socialAccountId: string;
  userId: string;
}

export interface IncidentCategoryDto {
  id: string;
  groupId: string;
  /** null = the group's default category, offered to every company of the group. */
  companyId: string | null;
  key: string;
  name: string;
  status: (typeof INCIDENT_CATEGORY_STATUSES)[number];
  /** null = no playbook (the default). */
  playbook: IncidentPlaybook | null;
}

export interface IncidentContactDto {
  id: string;
  companyId: string;
  name: string;
  roleLabel: string;
  channel: (typeof INCIDENT_CONTACT_CHANNELS)[number];
  value: string;
  position: number;
  status: (typeof INCIDENT_CONTACT_STATUSES)[number];
}

export interface IncidentDto {
  id: string;
  companyId: string;
  socialAccountId: string | null;
  title: string;
  description: string | null;
  severity: (typeof INCIDENT_SEVERITIES)[number];
  status: (typeof INCIDENT_STATUSES)[number];
  openedBy: string;
  openedAt: string;
  resolvedAt: string | null;
  /** H-06 detail. null when the incident has no category. */
  categoryId: string | null;
  /** The category with its playbook as it is now (not a copy taken at the time). */
  category: IncidentCategoryDto | null;
  /** The company's active recovery contacts, in order. Empty until the company enters them. */
  recoveryContacts: IncidentContactDto[];
}

export interface ContentVersionDto {
  id: string;
  contentItemId: string;
  companyId: string;
  versionNumber: number;
  body: string;
  targetAccountIds: string[];
  media: ContentMediaDto[];
  createdBy: string;
  createdAt: string;
}

/** What the content list shows of the current version, so a library needs no request per item. */
export interface ContentItemPreviewDto {
  versionNumber: number;
  /** The first 240 characters of the text (the whole text is on the version). */
  excerpt: string;
  targetAccountIds: string[];
  mediaCount: number;
}

export interface ContentItemDto {
  id: string;
  companyId: string;
  brandId: string | null;
  createdBy: string;
  currentVersionId: string | null;
  status: (typeof CONTENT_ITEM_STATUSES)[number];
  categoryId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Sent by the list (`GET /content-items`) only; null when the item has no version yet. */
  preview?: ContentItemPreviewDto | null;
}

/** What create/edit return: the item plus the version that call just produced, so the caller does not
 * need a second round trip to see what it wrote. */
export interface ContentItemWithVersionDto extends ContentItemDto {
  currentVersion: ContentVersionDto;
}

export interface ApprovalDecisionDto {
  id: string;
  decidedBy: string;
  decision: (typeof APPROVAL_DECISIONS)[number];
  comment: string | null;
  decidedAt: string;
}

export interface ApprovalRequestDto {
  id: string;
  contentVersionId: string;
  companyId: string;
  requestedBy: string;
  requestedAt: string;
  status: (typeof APPROVAL_REQUEST_STATUSES)[number];
  /** The rule this request was opened under (H-09): how many different people must approve ... */
  requiredApprovals: number;
  /** ... how many have so far ... */
  approvals: number;
  /** ... and which roles may decide. Empty = any role that may approve. */
  approverRoles: Role[];
  decisions: ApprovalDecisionDto[];
}

/** One row of the reviewers' queue: enough to link to the content item, without the decision history. */
export interface ApprovalQueueItemDto {
  id: string;
  contentItemId: string;
  contentVersionId: string;
  companyId: string;
  requestedBy: string;
  requestedAt: string;
  status: (typeof APPROVAL_REQUEST_STATUSES)[number];
  requiredApprovals: number;
  approvals: number;
}

/** What "check with the engine" found for the scheduled and unresolved publications the caller may publish for. */
export interface ReconcileResultDto {
  checked: number;
  published: number;
  failed: number;
  stillWaiting: number;
  /** H-17: stuck scheduled publications found as a queued engine post and recorded as `scheduled`. */
  scheduled?: number;
  unresolvedKeys: Array<{
    key: string;
    state: 'in_progress' | 'unknown';
    publicationId?: string;
    reason: 'ambiguous_match' | 'no_match' | 'engine_waiting' | 'not_resolved';
    /** H-17: for `ambiguous_match`, the engine posts to choose from when settling the key by hand. */
    candidateEngineOperationIds?: string[];
  }>;
}

/** H-17: what settling a stuck key by hand did. `publication` is the DCC record now holding the outcome, when there is one. */
export interface SettleStuckKeyResultDto {
  key: string;
  outcome: 'published' | 'scheduled' | 'not_published';
  publication: PublicationDto | null;
}

export interface BypassCheckResultDto {
  checked: number;
  suspected: number;
  incidentsCreated: number;
  incidentsUpdated: number;
}

/** A comment or direct message on a connected account. DCC does not store it; it is read from the engine. */
export interface InboxMessageDto {
  engineMessageId: string;
  socialAccountId: string;
  companyId: string;
  kind: 'comment' | 'direct_message';
  authorName: string;
  text: string;
  receivedAt: string;
  replied: boolean;
  /**
   * H-14 tracking. Always sent by the API; optional here only so existing code that builds this type keeps compiling.
   * `assignedTo` is a user id (null = nobody). `firstResponseAt` is known only for a reply sent through DCC: a message
   * the engine reports as replied with no time of ours has `replied: true` and `firstResponseAt: null`.
   */
  assignedTo?: string | null;
  assignedToName?: string | null;
  assignedAt?: string | null;
  firstResponseAt?: string | null;
  /** Seconds from receipt to the first reply sent through DCC; null when there was none or its time is unknown. */
  responseSeconds?: number | null;
  /** receivedAt plus the company's response target; null when the company has no target. */
  dueAt?: string | null;
  /** True when the target is set and was missed (replied late, or not replied and the time has passed). Never true without a target. */
  overdue?: boolean;
}

/** H-14: assign one message to a person who may reply for its company, or clear the assignment with `assigneeUserId: null`. */
export const AssignInboxMessageRequest = z.object({
  socialAccountId: z.uuid(),
  engineMessageId: z.string().trim().min(1).max(200),
  assigneeUserId: z.uuid().nullable(),
});
export type AssignInboxMessageRequest = z.infer<typeof AssignInboxMessageRequest>;

export interface InboxAssignmentDto {
  socialAccountId: string;
  engineMessageId: string;
  assignedTo: string | null;
  assignedToName: string | null;
  assignedAt: string | null;
}

/** A person a message of the company can be assigned to (holds inbox.reply for it). */
export interface InboxAssigneeDto {
  userId: string;
  displayName: string;
}

/** H-14: a company's response-time target in minutes. `null` = no target (there is no default). */
export const MAX_RESPONSE_TARGET_MINUTES = 43_200;
export const SetInboxSettingsRequest = z.object({
  companyId: z.uuid(),
  responseTargetMinutes: z.number().int().min(1).max(MAX_RESPONSE_TARGET_MINUTES).nullable(),
});
export type SetInboxSettingsRequest = z.infer<typeof SetInboxSettingsRequest>;

export interface InboxSettingsDto {
  companyId: string;
  responseTargetMinutes: number | null;
  updatedAt: string | null;
}

export interface PublicationDto {
  id: string;
  companyId: string;
  contentItemId: string;
  contentVersionId: string;
  socialAccountId: string;
  requestedBy: string;
  approvedBy: string | null;
  engineOperationId: string | null;
  externalPostUrl: string | null;
  status: (typeof PUBLICATION_STATUSES)[number];
  error: string | null;
  /** Set when the post was handed to the engine for a later time. */
  scheduledAt: string | null;
  requestedAt: string;
  completedAt: string | null;
}

/**
 * Internal operations counts only - NOT the engagement/reach/follower analytics the proposal
 * describes, which depend on the operational engine (not connected yet). Named "operations
 * overview" rather than "analytics" on purpose, so it is never mistaken for that.
 */
export interface OperationsOverviewDto {
  companyId: string;
  companyName: string;
  socialAccounts: { total: number; byStatus: Record<string, number> };
  contentItems: { total: number; byStatus: Record<string, number> };
  publications: { total: number; byStatus: Record<string, number> };
  /** Counts of incidents by status; null for a company where the caller does not hold `incident.read`. */
  incidents: { total: number; byStatus: Record<string, number> } | null;
}

export const AnalyticsQuery = z
  .object({
    days: z.coerce.number().int().min(1).max(90).default(30),
    socialAccountId: z.uuid().optional(),
    publicationId: z.uuid().optional(),
  })
  .refine((query) => !(query.socialAccountId && query.publicationId), {
    message: 'Choose a social account or a publication, not both.',
  });
export type AnalyticsQuery = z.infer<typeof AnalyticsQuery>;

export interface AnalyticsPointDto {
  date: string;
  value: number | null;
}

export interface AnalyticsSeriesDto {
  label: string;
  points: AnalyticsPointDto[];
}

/**
 * 'ok': readings. 'empty': the engine answered with nothing (no support, no permission or no activity:
 * never show it as zero). 'missing': the engine marked the published post as gone. 'unavailable': the
 * engine could not answer for this account (`reason` says why in a few words); the other accounts still answer.
 */
export interface AnalyticsResultDto {
  status: 'ok' | 'empty' | 'missing' | 'unavailable';
  windowDays: number;
  series: AnalyticsSeriesDto[];
  reason?: string;
}

export interface AnalyticsReportDto {
  companyId: string;
  socialAccountId: string;
  displayName: string;
  platform: (typeof SOCIAL_PLATFORMS)[number];
  publicationId: string | null;
  result: AnalyticsResultDto;
}

/** One account whose registry entry is incomplete or not healthy (proposal objective 1: owner and backup admin on every account). */
export interface RegistryGapDto {
  socialAccountId: string;
  companyId: string;
  platform: (typeof SOCIAL_PLATFORMS)[number];
  displayName: string;
  handle: string;
  status: string;
  /** Which required details are empty. `engine_channel` = not connected to the operational engine yet. */
  missing: ('owner' | 'backup_admin' | 'engine_channel')[];
}

/**
 * The home-screen numbers. A section is `null` (not 0) when the caller holds no permission to see it,
 * so the UI can hide it instead of showing a misleading zero. `publishedLast7Days` is a rolling window.
 */
export interface DashboardDto {
  accounts: { total: number; active: number; needsAttention: number } | null;
  pendingApprovals: number | null;
  publishedLast7Days: number | null;
  openIncidents: number | null;
  unreadNotifications: number;
}

export interface FreezeDto {
  id: string;
  companyId: string;
  /** null = the whole company is frozen. */
  socialAccountId: string | null;
  frozenBy: string;
  reason: string | null;
  frozenAt: string;
}

export interface UnreadCountDto {
  unread: number;
}

export interface MarkedReadDto {
  marked: number;
}

/**
 * In-app only (Q4, not yet decided - see portal/backend/QUESTIONS/QUESTIONS.md). Recipients are
 * everyone who held the relevant permission in the company at the moment of the event (a broadcast,
 * same model as the placeholder approval rule), not a named assignee - there is no assignee concept
 * yet. One row per recipient, so read/unread is personal.
 */
export interface NotificationDto {
  id: string;
  companyId: string;
  eventType: (typeof NOTIFICATION_EVENT_TYPES)[number];
  targetType: string;
  targetId: string;
  summary: string;
  readAt: string | null;
  createdAt: string;
}

export interface MembershipDto {
  role: Role;
  /** null = group-level (applies to every company of the group). */
  companyId: string | null;
  groupId: string;
}

/** Like MembershipDto, but carries the row id so it can be revoked (H-03). */
export interface MembershipRecordDto {
  id: string;
  role: Role;
  companyId: string | null;
  groupId: string;
  source: 'dcc' | 'idp';
}

export interface UserDto {
  id: string;
  email: string;
  displayName: string;
  status: 'active' | 'disabled';
  memberships: MembershipRecordDto[];
}

/** What the web app learns about the signed-in person. No tokens, ever. */
export interface MeResponse {
  user: { id: string; email: string; displayName: string };
  /** The memberships in force right now (only the acting role's, when one is chosen). */
  memberships: MembershipDto[];
  /** Union of permissions, for UI visibility only. The API re-checks every request. */
  permissions: Permission[];
  /** Every role this person holds. More than one: the web app offers a choice of which to act as. */
  roles: Role[];
  /** The role chosen for this session; null = all roles together. */
  actingRole: Role | null;
}

export interface ApiError {
  statusCode: number;
  error: string;
  message: string;
  requestId?: string;
  /**
   * A short machine-readable reason, present only where the web app must react in a specific way.
   * Today there is one: `reauth_required` (401 on a sensitive action: send the person to
   * `/api/auth/login?reauth=1&returnTo=<current path>` and let them repeat the action afterwards).
   */
  code?: string;
}

/** `ApiError.code` of the 401 a sensitive action answers when the person's sign-in is too old. */
export const REAUTH_REQUIRED_CODE = 'reauth_required';

// ---------------------------------------------------------------------------
// Governance, security and insight (audit screen, security center, incidents, dashboard)
// ---------------------------------------------------------------------------

/**
 * One row of `GET /api/audit`, as the API sends it: the stored columns, in snake_case. Nothing here is
 * ever changed after it is written. `details` is a small free-form object that differs by action.
 */
export interface AuditEventDto {
  /** The event number, a counting integer sent as text. A higher number is a newer event. */
  id: string;
  occurred_at: string;
  /** null = the system itself, or a sign-in attempt that failed before a person was known. */
  actor_user_id: string | null;
  /** `<area>.<what_happened>`, for example `content.approved`. */
  action: string;
  target_type: string | null;
  target_id: string | null;
  company_id: string | null;
  /** The request id of the call that caused the event: the same id an error box shows. */
  correlation_id: string | null;
  details: Record<string, unknown>;
}

/** `GET /api/audit/verify`: what walking the hash chain found. */
export interface AuditVerifyResultDto {
  ok: boolean;
  checked: number;
  /** The first event whose hash does not follow from the one before it; null when the chain is intact. */
  firstBrokenId: string | null;
}

/** Security administration: how many sessions ending a person's DCC sessions closed (`POST /users/:id/end-sessions`). */
export interface EndSessionsResultDto {
  ended: number;
}

// ---- Working hours (Round 2 base, 2026-11-26) ----
const localDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const SetWorkingHoursRequest = z
  .object({
    companyId: z.uuid(),
    /** 0 = Sunday ... 6 = Saturday. */
    workDays: z.array(z.number().int().min(0).max(6)).min(1).max(7),
    /** Minutes after local midnight: 08:30 = 510. */
    startMinute: z.number().int().min(0).max(1438),
    /** Exclusive end: 17:30 = 1050. */
    endMinute: z.number().int().min(1).max(1440),
    utcOffsetMinutes: z.number().int().min(-720).max(840),
    holidays: z.array(localDate).max(80),
  })
  .refine((v) => v.endMinute > v.startMinute, { message: 'The day must end after it starts.' });
export type SetWorkingHoursRequest = z.infer<typeof SetWorkingHoursRequest>;

export interface WorkingHoursDto {
  companyId: string;
  workDays: number[];
  startMinute: number;
  endMinute: number;
  utcOffsetMinutes: number;
  holidays: string[];
  /** false = nobody has set it: this is the default calendar (Monday to Saturday 08:30 to 17:30, UTC+3). */
  custom: boolean;
  updatedAt: string | null;
}
