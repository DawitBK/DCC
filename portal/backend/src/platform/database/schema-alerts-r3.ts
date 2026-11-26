// Round 3 (2026-11-26): the tables of the alerts area (SMS, Teams and e-mail alerts for SEV1 and SEV2 incidents).
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface AlertSettingsTable {
  group_id: string;
  sms_enabled: boolean;
  teams_enabled: boolean;
  email_enabled: boolean;
  min_severity: 'critical' | 'high';
  updated_by: string;
  updated_at: Timestamp;
}

export interface AlertContactsTable {
  id: Generated<string>;
  group_id: string;
  user_id: string;
  mobile: string;
  updated_by: string;
  updated_at: Timestamp;
}

export interface AlertDeliveriesTable {
  id: Generated<string>;
  company_id: string;
  group_id: string;
  incident_id: string;
  channel: 'sms' | 'teams' | 'email';
  recipient_user_id: string | null;
  severity: 'critical' | 'high';
  subject: string;
  body: string;
  status: Generated<'pending' | 'sent' | 'failed'>;
  attempts: Generated<number>;
  last_error: string | null;
  next_attempt_at: Generated<Date> | Date;
  sent_at: Date | null;
  created_at: Generated<Date>;
  updated_at: Generated<Date> | Date;
}

export interface AlertIncidentDispatchesTable {
  id: Generated<string>;
  company_id: string;
  incident_id: string;
  severity_rank: number;
  created_at: Generated<Date>;
}

export interface AlertsRound3Tables {
  alert_settings: AlertSettingsTable;
  alert_contacts: AlertContactsTable;
  alert_deliveries: AlertDeliveriesTable;
  alert_incident_dispatches: AlertIncidentDispatchesTable;
}
