// Round 2, builder "replies" (2026-11-26): sensitive-reply approval, moderation and the automatic acknowledgement.
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;
/** A required time that is always given on insert. */
type GivenTime = ColumnType<Date, Date | string, Date | string>;
/** A time that may be empty: read as Date or null. */
type MaybeTime = ColumnType<Date | null, Date | string | null | undefined, Date | string | null>;

export interface ReplyApprovalRequestsTable {
  id: Generated<string>;
  company_id: string;
  social_account_id: string;
  engine_message_id: string;
  kind: 'legal_threat' | 'media' | 'investor' | 'safety' | 'personal_data' | 'refund_compensation';
  text: string;
  written_by: string;
  requested_at: Timestamp;
  status: Generated<'pending' | 'approved' | 'sent' | 'rejected' | 'failed'>;
  required_approvals: number;
  approver_roles: Generated<string[]>;
  category_key: string;
  due_at: GivenTime;
  settled_at: MaybeTime;
  settled_reason: string | null;
}

export interface ReplyApprovalDecisionsTable {
  id: Generated<string>;
  request_id: string;
  company_id: string;
  decided_by: string;
  decision: 'approved' | 'rejected';
  comment: string | null;
  decided_at: Timestamp;
}

export interface InboxModerationActionsTable {
  id: Generated<string>;
  company_id: string;
  social_account_id: string;
  engine_message_id: string;
  action: 'hide' | 'delete' | 'block';
  reason: string | null;
  outcome: 'done' | 'recorded_only' | 'failed';
  outcome_detail: string | null;
  performed_by: string;
  performed_at: Timestamp;
}

export interface InboxAckSettingsTable {
  company_id: string;
  text_en: string;
  text_am: string | null;
  enabled: Generated<boolean>;
  version: Generated<number>;
  set_by: string;
  set_at: Timestamp;
  approved_by: string | null;
  approved_at: MaybeTime;
}

export interface InboxAcknowledgementsTable {
  id: Generated<string>;
  company_id: string;
  social_account_id: string;
  engine_message_id: string;
  received_at: GivenTime;
  language: 'en' | 'am';
  claimed_at: Timestamp;
  acked_at: MaybeTime;
}

export interface RepliesRound2Tables {
  reply_approval_requests: ReplyApprovalRequestsTable;
  reply_approval_decisions: ReplyApprovalDecisionsTable;
  inbox_moderation_actions: InboxModerationActionsTable;
  inbox_ack_settings: InboxAckSettingsTable;
  inbox_acknowledgements: InboxAcknowledgementsTable;
}
