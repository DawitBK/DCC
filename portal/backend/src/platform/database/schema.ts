import type { AlertsRound3Tables } from './schema-alerts-r3';
import type { RemovalRound3Tables } from './schema-removal-r3';
import type { RoutingRound3Tables } from './schema-routing-r3';
import type { ApprovalsRound2Tables } from './schema-approvals-r2';
import type { IncidentsRound2Tables } from './schema-incidents-r2';
import type { InboxRound2Tables } from './schema-inbox-r2';
import type { RepliesRound2Tables } from './schema-replies-r2';
import type { ColumnType, Generated } from 'kysely';

/**
 * Hand-written Kysely types for the platform tables. The SQL migrations are the source of truth:
 * when a migration changes a table, update the matching interface here in the same pull request.
 */
type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface GroupsTable {
  id: Generated<string>;
  name: string;
  slug: string;
  created_at: Generated<Date>;
}

export interface CompaniesTable {
  id: Generated<string>;
  group_id: string;
  name: string;
  slug: string;
  status: Generated<'active' | 'suspended' | 'archived'>;
  created_at: Generated<Date>;
  updated_at: Timestamp;
}

export interface BrandsTable {
  id: Generated<string>;
  company_id: string;
  name: string;
  slug: string;
  status: Generated<'active' | 'archived'>;
  created_at: Generated<Date>;
}

export interface UsersTable {
  id: Generated<string>;
  idp_subject: string;
  email: string;
  display_name: Generated<string>;
  status: Generated<'active' | 'disabled'>;
  last_login_at: Date | null;
  created_at: Generated<Date>;
}

export interface MembershipsTable {
  id: Generated<string>;
  user_id: string;
  group_id: string;
  company_id: string | null;
  role: string;
  source: Generated<'dcc' | 'idp'>;
  created_by: string | null;
  created_at: Generated<Date>;
}

export interface SocialAccountsTable {
  id: Generated<string>;
  company_id: string;
  brand_id: string | null;
  platform: string;
  display_name: string;
  handle: string;
  public_url: string | null;
  status: Generated<string>;
  owner_user_id: string | null;
  backup_admin_user_id: string | null;
  engine_channel_id: string | null;
  created_at: Generated<Date>;
  updated_at: Timestamp;
}

export interface AccountAssignmentsTable {
  id: Generated<string>;
  social_account_id: string;
  company_id: string;
  user_id: string;
  created_at: Generated<Date>;
}

export interface SessionsTable {
  id_hash: string;
  user_id: string;
  created_at: Generated<Date>;
  last_seen_at: Generated<Date>;
  expires_at: Date;
  id_token_enc: string | null;
  idp_sid: string | null;
  ip: string | null;
  user_agent: string | null;
  /** When the person last proved who they are at the SSO (`auth_time`). Null = not known. */
  authenticated_at: Generated<Date | null>;
  /** The role the person chose to act as; null = all their roles. */
  acting_role: string | null;
}

export interface AuthTransactionsTable {
  state_hash: string;
  nonce: string;
  code_verifier: string;
  return_to: Generated<string>;
  reauth: Generated<boolean>;
  expires_at: Date;
  created_at: Generated<Date>;
}

export interface AuditEventsTable {
  id: Generated<string>;
  occurred_at: Date;
  actor_user_id: string | null;
  actor_subject: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  company_id: string | null;
  /** The group a company-less event belongs to (null = unknown: only the platform owner reads those). */
  group_id: string | null;
  correlation_id: string | null;
  ip: string | null;
  details: Record<string, unknown>;
  prev_hash: string;
  hash: string;
}

export interface IncidentsTable {
  id: Generated<string>;
  company_id: string;
  social_account_id: string | null;
  title: string;
  description: string | null;
  severity: Generated<'low' | 'medium' | 'high' | 'critical'>;
  status: Generated<'open' | 'investigating' | 'resolved' | 'closed'>;
  opened_by: string;
  opened_at: Generated<Date>;
  resolved_at: Date | null;
  category_id: string | null;
  review_required: Generated<boolean>;
  first_resolved_at: Date | null;
}

export interface IncidentCategoriesTable {
  id: Generated<string>;
  group_id: string;
  company_id: string | null;
  key: string;
  name: string;
  status: Generated<'active' | 'archived'>;
  playbook_title: string | null;
  playbook_steps: Generated<string[]>;
  created_by: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface IncidentRecoveryContactsTable {
  id: Generated<string>;
  company_id: string;
  name: string;
  role_label: string;
  channel: 'email' | 'phone' | 'other';
  value: string;
  position: Generated<number>;
  status: Generated<'active' | 'archived'>;
  created_by: string;
  created_at: Generated<Date>;
  updated_at: Generated<Date>;
}

export interface ContentItemsTable {
  id: Generated<string>;
  company_id: string;
  brand_id: string | null;
  created_by: string;
  current_version_id: string | null;
  category_id: string | null;
  status: Generated<
    'draft' | 'in_review' | 'approved' | 'rejected' | 'published' | 'archived' | 'expired'
  >;
  created_at: Generated<Date>;
  updated_at: Timestamp;
}

export interface ContentVersionsTable {
  id: Generated<string>;
  content_item_id: string;
  company_id: string;
  version_number: number;
  body: string;
  created_by: string;
  created_at: Generated<Date>;
}

export interface ContentMediaTable {
  id: Generated<string>;
  company_id: string;
  uploaded_by: string;
  kind: 'image' | 'video';
  file_name: string;
  mime_type: string;
  size_bytes: number | string;
  storage_key: string;
  created_at: Generated<Date>;
}

export interface ContentVersionMediaTable {
  content_version_id: string;
  media_id: string;
  company_id: string;
  position: number;
}

export interface ContentVersionTargetsTable {
  id: Generated<string>;
  content_version_id: string;
  company_id: string;
  social_account_id: string;
}

export interface ApprovalRequestsTable {
  id: Generated<string>;
  content_version_id: string;
  company_id: string;
  requested_by: string;
  requested_at: Generated<Date>;
  status: Generated<'pending' | 'approved' | 'rejected' | 'expired'>;
  required_approvals: Generated<number>;
  approver_roles: Generated<string[]>;
  // Round 2: the time limit and its clock (copied from the policy at submission), validity, emergency record.
  time_limit_hours: number | null;
  clock: Generated<'working' | 'continuous'>;
  escalation_level: Generated<number>;
  approved_at: Date | null;
  valid_until: Date | null;
  expired_at: Date | null;
  emergency: Generated<boolean>;
  emergency_by: string | null;
  emergency_reason: string | null;
  emergency_at: Date | null;
  emergency_confirmed_by: string | null;
  emergency_confirmed_at: Date | null;
}

export interface ContentCategoriesTable {
  id: Generated<string>;
  group_id: string;
  key: string;
  name: string;
  status: Generated<'active' | 'archived'>;
  created_at: Generated<Date>;
}

export interface ApprovalPoliciesTable {
  id: Generated<string>;
  company_id: string;
  category_id: string | null;
  required_approvals: number;
  approver_roles: string[];
  time_limit_hours: number | null;
  clock: Generated<'working' | 'continuous'>;
  updated_by: string;
  updated_at: Timestamp;
}

export interface ApprovalDecisionsTable {
  id: Generated<string>;
  approval_request_id: string;
  company_id: string;
  decided_by: string;
  decision: 'commented' | 'approved' | 'rejected';
  comment: string | null;
  decided_at: Generated<Date>;
}

export interface PublicationsTable {
  id: Generated<string>;
  company_id: string;
  content_item_id: string;
  content_version_id: string;
  social_account_id: string;
  requested_by: string;
  approved_by: string | null;
  idempotency_key: string;
  engine_operation_id: string | null;
  external_post_url: string | null;
  status: Generated<'pending' | 'scheduled' | 'published' | 'failed' | 'cancelled'>;
  error: string | null;
  scheduled_at: Date | null;
  requested_at: Generated<Date>;
  completed_at: Date | null;
}

export interface IdempotencyKeysTable {
  key: string;
  state: 'in_progress' | 'done' | 'unknown';
  result: Record<string, unknown> | null;
  created_at: Generated<Date>;
  updated_at: Timestamp;
}

export interface PublishingFreezesTable {
  id: Generated<string>;
  company_id: string;
  social_account_id: string | null;
  frozen_by: string;
  reason: string | null;
  frozen_at: Generated<Date>;
  incident_id: string | null;
  two_person: Generated<boolean>;
}

export interface InboxItemsTable {
  id: Generated<string>;
  company_id: string;
  social_account_id: string;
  engine_message_id: string;
  received_at: Date;
  assigned_to: string | null;
  assigned_by: string | null;
  assigned_at: Date | null;
  first_response_at: Date | null;
  first_response_by: string | null;
  priority: Generated<'urgent' | 'normal' | 'low'>;
  priority_set_by: string | null;
  priority_set_at: Date | null;
  reassignment_count: Generated<number>;
  first_assigned_at: Date | null;
  needs_manager: Generated<boolean>;
  needs_manager_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Timestamp;
}

export interface InboxSettingsTable {
  company_id: string;
  response_target_minutes: number | null;
  urgent_target_minutes: Generated<number>;
  normal_target_minutes: Generated<number>;
  low_target_minutes: Generated<number>;
  urgent_round_the_clock: Generated<boolean>;
  updated_by: string;
  updated_at: Timestamp;
}

export interface CompanyWorkingHoursTable {
  company_id: string;
  work_days: number[];
  start_minute: number;
  end_minute: number;
  utc_offset_minutes: number;
  holidays: Date[];
  updated_by: string;
  updated_at: Timestamp;
}

export interface EscalationEventsTable {
  id: Generated<string>;
  company_id: string;
  kind: 'inbox' | 'approval' | 'reply_approval' | 'incident_review' | 'emergency_followup';
  target_id: string;
  level: number;
  created_at: Generated<Date>;
}

export interface NotificationsTable {
  id: Generated<string>;
  company_id: string;
  recipient_user_id: string;
  event_type:
    | 'content.submitted'
    | 'content.approved'
    | 'content.rejected'
    | 'publishing.frozen'
    | 'incident.opened'
    | 'inbox.assigned'
    | 'inbox.escalated'
    | 'inbox.reply_requested'
    | 'inbox.reply_decided'
    | 'approval.reminder'
    | 'approval.escalated'
    | 'approval.expired'
    | 'approval.emergency'
    | 'approval.followup_due'
    | 'incident.freeze_lift_requested'
    | 'incident.freeze_lifted'
    | 'incident.review_due'
    | 'incident.review_overdue'
    | 'incident.closed'
    | 'publication.removed'
    | 'publication.correction_requested'
    | 'alert.delivery_failed';
  target_type: string;
  target_id: string;
  summary: string;
  read_at: Date | null;
  created_at: Generated<Date>;
}

export interface DB
  extends
    InboxRound2Tables,
    ApprovalsRound2Tables,
    IncidentsRound2Tables,
    RepliesRound2Tables,
    RemovalRound3Tables,
    AlertsRound3Tables,
    RoutingRound3Tables {
  groups: GroupsTable;
  companies: CompaniesTable;
  brands: BrandsTable;
  users: UsersTable;
  memberships: MembershipsTable;
  social_accounts: SocialAccountsTable;
  account_assignments: AccountAssignmentsTable;
  incidents: IncidentsTable;
  incident_categories: IncidentCategoriesTable;
  incident_recovery_contacts: IncidentRecoveryContactsTable;
  sessions: SessionsTable;
  auth_transactions: AuthTransactionsTable;
  audit_events: AuditEventsTable;
  content_items: ContentItemsTable;
  content_versions: ContentVersionsTable;
  content_version_targets: ContentVersionTargetsTable;
  content_media: ContentMediaTable;
  content_version_media: ContentVersionMediaTable;
  approval_requests: ApprovalRequestsTable;
  approval_decisions: ApprovalDecisionsTable;
  content_categories: ContentCategoriesTable;
  approval_policies: ApprovalPoliciesTable;
  publications: PublicationsTable;
  idempotency_keys: IdempotencyKeysTable;
  publishing_freezes: PublishingFreezesTable;
  notifications: NotificationsTable;
  inbox_items: InboxItemsTable;
  inbox_settings: InboxSettingsTable;
  company_working_hours: CompanyWorkingHoursTable;
  escalation_events: EscalationEventsTable;
}
