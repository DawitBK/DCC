// Round 3 (2026-11-26): the tables of the routing area (responders per company and language).
import type { ColumnType } from 'kysely';

type Timestamp = ColumnType<Date, Date | string | undefined, Date | string>;

export interface InboxRespondersTable {
  company_id: string;
  user_id: string;
  kind: 'primary' | 'backup';
  languages: Array<'en' | 'am'>;
  updated_by: string;
  updated_at: Timestamp;
}

export interface RoutingRound3Tables {
  inbox_responders: InboxRespondersTable;
}
