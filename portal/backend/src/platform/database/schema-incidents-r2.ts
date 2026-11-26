// Round 2 (2026-11-26): the tables of this area (post-incident review, two-person freeze lift).
import type { ColumnType, Generated } from 'kysely';

type Timestamp = ColumnType<Date, Date | string, Date | string>;

export interface IncidentReviewsTable {
  id: Generated<string>;
  company_id: string;
  incident_id: string;
  cause: string;
  impact: string;
  response: string;
  corrective_actions: string;
  preventive_measures: string;
  participants: string[];
  held_at: Timestamp;
  recorded_by: string;
  recorded_at: Generated<Date>;
  updated_by: string;
  updated_at: Timestamp;
}

export interface FreezeLiftConfirmationsTable {
  id: Generated<string>;
  company_id: string;
  freeze_id: string;
  side: 'security' | 'communications';
  confirmed_by: string;
  note: string | null;
  confirmed_at: Generated<Date>;
  withdrawn_at: Date | null;
}

export interface IncidentsRound2Tables {
  incident_reviews: IncidentReviewsTable;
  freeze_lift_confirmations: FreezeLiftConfirmationsTable;
}
