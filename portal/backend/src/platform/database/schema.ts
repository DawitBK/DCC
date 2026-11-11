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
}

export interface AuthTransactionsTable {
  state_hash: string;
  nonce: string;
  code_verifier: string;
  return_to: Generated<string>;
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
}

export interface DB {
  groups: GroupsTable;
  companies: CompaniesTable;
  brands: BrandsTable;
  users: UsersTable;
  memberships: MembershipsTable;
  social_accounts: SocialAccountsTable;
  account_assignments: AccountAssignmentsTable;
  incidents: IncidentsTable;
  sessions: SessionsTable;
  auth_transactions: AuthTransactionsTable;
  audit_events: AuditEventsTable;
}
