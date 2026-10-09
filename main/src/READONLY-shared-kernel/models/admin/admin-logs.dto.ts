import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { EventLogType } from '../db_models.generated.dto';
import type { EventLogRecord } from '../db_models.manual.dto';
import type {
  LogApplication,
  LogEnvironment,
  LogIssueDisplayStatus,
  LogIssueStatusValue,
} from '../../domain/admin/log-triage.config';
import type { SendLogType } from '../../domain/admin/send-log.config';

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

// --- Logs API ---

/**
 * Stream filters are applied in the database, then the page walks `id DESC`
 * with a cursor. `take` defaults to LOG_STREAM_DEFAULT_TAKE and is capped at
 * LOG_STREAM_MAX_TAKE. Dates are `YYYY-MM-DD`, inclusive UTC day bounds.
 */
type GetLogsRequest = {
  environment?: LogEnvironment | undefined;
  application?: LogApplication | undefined;
  type?: SendLogType | undefined;
  /** ILIKE on message OR namespace (metacharacters escaped server-side). */
  search?: string | undefined;
  date_from?: string | undefined;
  date_to?: string | undefined;
  /** Drop rows whose namespace is in STARTUP_NOISE_NAMESPACES. */
  hide_startup_noise?: boolean | undefined;
  /** Return rows with id strictly less than this (the previous page's last id). */
  cursor?: number | undefined;
  take?: number | undefined;
};

/** Zagregowana klasa błędu — jeden wiersz na odcisk palca, nie na wystąpienie. */
export type LogIssueGroup = {
  /** md5(application|type|namespace|znormalizowana wiadomość) — patrz LOG_FINGERPRINT_SQL. */
  fingerprint: string;
  application: string;
  type: string;
  namespace: string;
  /** Reprezentatywna wiadomość z grupy (najświeższe wystąpienie). */
  sample_message: string;
  /** Id najświeższego wystąpienia — otwiera drawer szczegółów tej grupy. */
  sample_id: string;
  count: number;
  first_seen: string;
  last_seen: string;
  /** Status widoczny w UI: zapisany albo pochodny `regressed`. */
  status: LogIssueDisplayStatus;
  note: string | null;
  /** Kiedy admin nadał status (null dla grup nieoznaczonych). */
  status_updated_at: string | null;
};

type GetLogGroupsRequest = {
  environment?: LogEnvironment | undefined;
  application?: LogApplication | undefined;
  type?: SendLogType | undefined;
  /**
   * true = exactly the groups counted by the menu badge `log_issues_open`.
   * The server then IGNORES environment/application/type, forces
   * LOG_ATTENTION_SCOPE (type, environment, time window) and keeps only groups
   * whose display status is in LOG_ISSUE_ATTENTION_STATUSES, filtering before
   * the row limit, so `totalGroups` equals the badge.
   */
  attention?: boolean | undefined;
};

type GetLogGroupsResponse = {
  groups: LogIssueGroup[];
  /** Liczba grup po zawężeniu (może przekraczać długość `groups` przy limicie). */
  totalGroups: number;
};

type SetLogIssueStatusRequest = {
  fingerprint: string;
  status: LogIssueStatusValue;
  note?: string | undefined;
};

type SetLogIssueStatusResponse = {
  fingerprint: string;
  status: LogIssueStatusValue;
};

type GetLogsResponse = {
  records: EventLogRecordFromDB[];
  /** Id of the last row on this page when another page exists; else null. */
  nextCursor: number | null;
  totalCount: number;
  oldestRecordDate: string | null;
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

type GetLogDetailsRequest = {
  id: number;
};

type GetLogDetailsResponse = {
  record: EventLogRecordFromDB;
  /** Other events on the same chain, oldest first. Empty for the '0' sentinel. */
  chain: EventLogRecordFromDB[];
  group: LogDetailsGroup | null;
  /** Newest occurrences of the same fingerprint (includes this record when it is among them). */
  recent: EventLogRecordFromDB[];
};

type SendLogRequest = Omit<
  EventLogRecord,
  'id' | 'created_at' | 'client_url' | 'application' | 'event_log_chain_id'
> & {
  /**
   * Page the browser was actually on when the report was built
   * (`window.location.href`). Optional so older clients still ingest;
   * the server falls back to the request Referer.
   */
  client_url?: string | undefined;
};

type GetAuditTrailRequest = {
  page?: number;
  limit?: number;
  event_name?: string;
};

type GetAuditTrailResponse = {
  entries: AuditTrailEntry[];
  total: number;
  page: number;
  limit: number;
};

export type AdminLogsDtoApi = {
  /** Grupuje logi po odcisku palca błędu (te same błędy w jeden wiersz) wraz ze statusem triage'u. */
  ADMIN_GET_LOG_GROUPS: {
    REQUEST: GetLogGroupsRequest;
    RESPONSE: GetLogGroupsResponse;
    RESPONSE_ERROR: DetailedErrorPayload<GetLogGroupsRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GetLogGroupsRequest,
      GetLogGroupsResponse,
      DetailedErrorPayload<GetLogGroupsRequest>
    >;
  };

  /** Nadaje grupie błędów status triage'u (znany / naprawiony / ignorowany) z opcjonalną notatką. */
  ADMIN_SET_LOG_ISSUE_STATUS: {
    REQUEST: SetLogIssueStatusRequest;
    RESPONSE: SetLogIssueStatusResponse;
    RESPONSE_ERROR: DetailedErrorPayload<SetLogIssueStatusRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SetLogIssueStatusRequest,
      SetLogIssueStatusResponse,
      DetailedErrorPayload<SetLogIssueStatusRequest>
    >;
  };

  /** Jeden wpis plus łańcuch żądania, grupa odcisku palca i ostatnie wystąpienia. */
  ADMIN_GET_LOG_DETAILS: {
    REQUEST: GetLogDetailsRequest;
    RESPONSE: GetLogDetailsResponse;
    RESPONSE_ERROR: DetailedErrorPayload<GetLogDetailsRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GetLogDetailsRequest,
      GetLogDetailsResponse,
      DetailedErrorPayload<GetLogDetailsRequest>
    >;
  };

  /** Pobiera rejestr logów zdarzeń (filtry i kursor po stronie serwera) wraz z licznikiem i datą najstarszego. */
  GET_LOGS: {
    REQUEST: GetLogsRequest;
    RESPONSE: GetLogsResponse;
    RESPONSE_ERROR: DetailedErrorPayload<GetLogsRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GetLogsRequest,
      GetLogsResponse,
      DetailedErrorPayload<GetLogsRequest>
    >;
  };

  /** Zapisuje pojedynczy wpis logu zdarzenia. */
  SEND_LOG: {
    REQUEST: SendLogRequest;
    RESPONSE: undefined;
    RESPONSE_ERROR: DetailedErrorPayload<SendLogRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      SendLogRequest,
      undefined,
      DetailedErrorPayload<SendLogRequest>
    >;
  };

  /** Pobiera stronicowany dziennik akcji admina (audit trail), opcjonalnie filtrowany po nazwie zdarzenia. */
  ADMIN_GET_AUDIT_TRAIL: {
    REQUEST: GetAuditTrailRequest;
    RESPONSE: GetAuditTrailResponse;
    RESPONSE_ERROR: DetailedErrorPayload<GetAuditTrailRequest>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      GetAuditTrailRequest,
      GetAuditTrailResponse,
      DetailedErrorPayload<GetAuditTrailRequest>
    >;
  };

  /** Pobiera stronicowaną oś czasu zdarzeń wskazanego użytkownika, opcjonalnie filtrowaną po typie zdarzenia. */
  ADMIN_GET_USER_TIMELINE: {
    REQUEST: {
      user_id: string;
      page?: number;
      limit?: number;
      event_type?: EventLogType;
    };
    RESPONSE: {
      entries: UserTimelineEntry[];
      total: number;
      page: number;
      limit: number;
    };
    RESPONSE_ERROR: DetailedErrorPayload<{
      user_id: string;
      page: string;
      limit: string;
      event_type: string;
    }>;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      {
        user_id: string;
        page?: number;
        limit?: number;
        event_type?: EventLogType;
      },
      {
        entries: UserTimelineEntry[];
        total: number;
        page: number;
        limit: number;
      },
      DetailedErrorPayload<{
        user_id: string;
        page: string;
        limit: string;
        event_type: string;
      }>
    >;
  };
};
