import { z } from 'zod';
import { MAX_INBOX_REPLY_LENGTH } from './api';

/**
 * Round 2, builder "replies" (2026-11-26): approval of sensitive replies (E-08), moderation of comments (E-14) and the
 * automatic acknowledgement outside working hours (E-13). Types and schemas of this area live here so parallel work
 * never edits the same lines of a shared file.
 */

// ---------------------------------------------------------------------------------------------------
// Sensitive replies, approved before they are sent (E-08, RQ-032)

/** Why a reply is sensitive. The kind decides which approval rule applies (see `REPLY_KIND_CATEGORY_KEY`). */
export const SENSITIVE_REPLY_KINDS = [
  'legal_threat',
  'media',
  'investor',
  'safety',
  'personal_data',
  'refund_compensation',
] as const;
export type SensitiveReplyKind = (typeof SENSITIVE_REPLY_KINDS)[number];

/**
 * ASSUMPTION (Round 2, recorded in the build report): the approval category whose policy a kind follows. A company that
 * has no category with that key, or no policy for it, needs one approver (or its default policy).
 */
export const REPLY_KIND_CATEGORY_KEY: Record<SensitiveReplyKind, string> = {
  legal_threat: 'legal',
  personal_data: 'legal',
  refund_compensation: 'financial',
  investor: 'financial',
  media: 'crisis',
  safety: 'crisis',
};

/** ASSUMPTION: a reply waiting for approval has 4 working hours (ladder 50%, 100%, 150%, 200%). */
export const REPLY_APPROVAL_LIMIT_MINUTES = 240;

export const REPLY_APPROVAL_STATUSES = ['pending', 'approved', 'sent', 'rejected', 'failed'] as const;
export type ReplyApprovalStatus = (typeof REPLY_APPROVAL_STATUSES)[number];

export const MAX_REPLY_APPROVAL_COMMENT_LENGTH = 1000;

/** Asks for approval of a sensitive reply. Nothing is sent until enough different approvers agree. */
export const RequestReplyApprovalRequest = z.object({
  socialAccountId: z.uuid(),
  engineMessageId: z.string().trim().min(1).max(200),
  text: z.string().trim().min(1).max(MAX_INBOX_REPLY_LENGTH),
  kind: z.enum(SENSITIVE_REPLY_KINDS),
});
export type RequestReplyApprovalRequest = z.infer<typeof RequestReplyApprovalRequest>;

export const ApproveReplyRequest = z.object({
  comment: z.string().trim().max(MAX_REPLY_APPROVAL_COMMENT_LENGTH).optional(),
});
export type ApproveReplyRequest = z.infer<typeof ApproveReplyRequest>;

/** A rejection always says why: the writer is told. */
export const RejectReplyRequest = z.object({
  reason: z.string().trim().min(5).max(MAX_REPLY_APPROVAL_COMMENT_LENGTH),
});
export type RejectReplyRequest = z.infer<typeof RejectReplyRequest>;

export const ReplyApprovalQuery = z.object({
  companyId: z.uuid().optional(),
  status: z.enum(REPLY_APPROVAL_STATUSES).optional(),
  /** `true`: only the requests this person may decide now (pending, not their own, not already approved by them). */
  forMe: z.enum(['true', 'false']).optional(),
});
export type ReplyApprovalQuery = z.infer<typeof ReplyApprovalQuery>;

export interface ReplyApprovalDecisionDto {
  decidedBy: string;
  decidedByName: string | null;
  decision: 'approved' | 'rejected';
  comment: string | null;
  decidedAt: string;
}

export interface ReplyApprovalDto {
  id: string;
  companyId: string;
  socialAccountId: string;
  engineMessageId: string;
  kind: SensitiveReplyKind;
  text: string;
  writtenBy: string;
  writtenByName: string | null;
  status: ReplyApprovalStatus;
  requestedAt: string;
  requiredApprovals: number;
  approvals: number;
  /** Roles named by the company's policy for this kind; empty = anyone who may approve content. */
  approverRoles: string[];
  /** The approval category the kind was mapped to, when the company has one. */
  categoryKey: string;
  /** Four working hours after the request, by the company's calendar. */
  dueAt: string;
  /** The escalation level reached so far (0 to 4); informational. */
  escalationLevel: number;
  settledAt: string | null;
  /** Why it was rejected or why the engine refused. */
  settledReason: string | null;
  decisions: ReplyApprovalDecisionDto[];
  /** True when the caller may approve or reject it now. */
  canDecide: boolean;
  /** The message being answered, read live from the engine for the approver; null when the engine cannot show it. */
  messageAuthor: string | null;
  messageText: string | null;
}

// ---------------------------------------------------------------------------------------------------
// Moderation of comments (E-14, RQ-033)

export const MODERATION_ACTIONS = ['hide', 'delete', 'block'] as const;
export type ModerationAction = (typeof MODERATION_ACTIONS)[number];

export const MODERATION_OUTCOMES = ['done', 'recorded_only', 'failed'] as const;
export type ModerationOutcome = (typeof MODERATION_OUTCOMES)[number];

export const MAX_MODERATION_REASON_LENGTH = 500;

const target = {
  socialAccountId: z.uuid(),
  engineMessageId: z.string().trim().min(1).max(200),
};

/** Hiding needs no reason (it can be undone in the network). */
export const HideMessageRequest = z.object({
  ...target,
  reason: z.string().trim().max(MAX_MODERATION_REASON_LENGTH).optional(),
});
export type HideMessageRequest = z.infer<typeof HideMessageRequest>;

/** Deleting a comment or blocking a user cannot be undone: a written reason is required. */
export const RemoveMessageRequest = z.object({
  ...target,
  reason: z.string().trim().min(5).max(MAX_MODERATION_REASON_LENGTH),
});
export type RemoveMessageRequest = z.infer<typeof RemoveMessageRequest>;

export const ModerationQuery = z.object({ companyId: z.uuid().optional() });
export type ModerationQuery = z.infer<typeof ModerationQuery>;

export interface ModerationActionDto {
  id: string;
  companyId: string;
  socialAccountId: string;
  engineMessageId: string;
  action: ModerationAction;
  reason: string | null;
  outcome: ModerationOutcome;
  /** Plain words for the person: what really happened in the network. */
  outcomeNote: string;
  performedBy: string;
  performedByName: string | null;
  performedAt: string;
}

// ---------------------------------------------------------------------------------------------------
// Automatic acknowledgement outside working hours (E-13, RQ-033)

export const MAX_ACK_TEXT_LENGTH = 500;

export const SetAckSettingsRequest = z.object({
  companyId: z.uuid(),
  /** Sent to everyone whose message has no Ethiopic letters. */
  textEn: z.string().trim().min(1).max(MAX_ACK_TEXT_LENGTH),
  /** Sent when the message contains Ethiopic letters (U+1200 to U+137F). */
  textAm: z.string().trim().min(1).max(MAX_ACK_TEXT_LENGTH).nullable(),
  /** Switching it off does not touch the approval. */
  enabled: z.boolean(),
});
export type SetAckSettingsRequest = z.infer<typeof SetAckSettingsRequest>;

/** The approver names the version of the text they read, so an edit made in between is never approved by accident. */
export const ApproveAckRequest = z.object({
  companyId: z.uuid(),
  version: z.number().int().min(1),
});
export type ApproveAckRequest = z.infer<typeof ApproveAckRequest>;

export interface AckSettingsDto {
  companyId: string;
  textEn: string | null;
  textAm: string | null;
  enabled: boolean;
  /** Increases with every edit of a text. */
  version: number;
  setBy: string | null;
  setByName: string | null;
  setAt: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: string | null;
  /** True only when an approved text exists, it is switched on, and nobody has edited it since. */
  active: boolean;
  /** True when the caller may approve it now (holds content.approve and did not write it). */
  canApprove: boolean;
}
