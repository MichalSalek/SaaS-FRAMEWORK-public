import type { LogIssueDisplayStatus } from '../../domain/admin/log-triage.config';
import type { EventLogType } from '../db_models.generated.dto';
import type { EventLogRecord } from '../db_models.manual.dto';

// Row shape returned by the admin log queries. `user_id` is part of the
// record (null when the request was anonymous or the writer had no session).
export type EventLogRecordFromDB = EventLogRecord;

// Re-export EventLogRecord from db_models for convenience
export type { EventLogRecord } from '../db_models.manual.dto';

// --- Audit Trail ---

export type AuditTrailEntry = {
  id: string;
  created_at: string;
  event_name: string;
  admin_user_id: string | null;
  admin_email: string | null;
  admin_name: string | null;
  target_info: string | null;
  details: string;
  namespace: string;
};

// --- User Timeline ---

export type UserTimelineEntry = {
  id: string;
  created_at: string;
  event_name: string;
  event_type: EventLogType;
  description_pl: string;
  namespace: string;
  details: Record<string, unknown> | null;
};

/** Aggregated error class: one row per fingerprint, not per occurrence. */
export type LogIssueGroup = {
  /** md5(application|type|namespace|normalised message), see LOG_FINGERPRINT_SQL. */
  fingerprint: string;
  application: string;
  type: string;
  namespace: string;
  /** Representative message of the group (latest occurrence). */
  sample_message: string;
  /** Id of the latest occurrence; opens the details drawer of this group. */
  sample_id: string;
  count: number;
  first_seen: string;
  last_seen: string;
  /** Status widoczny w UI: zapisany albo pochodny `regressed`. */
  status: LogIssueDisplayStatus;
  note: string | null;
  /** When the admin set the status (null for unmarked groups). */
  status_updated_at: string | null;
};

/** One fingerprint's triage row, attached to a single log's detail view. */
export type LogDetailsGroup = {
  fingerprint: string;
  status: LogIssueDisplayStatus;
  note: string | null;
  count: number;
  first_seen: string;
  last_seen: string;
};
