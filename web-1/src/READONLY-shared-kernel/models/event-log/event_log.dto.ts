import type { IOClientFunctionReqResErr } from '../../application/http/http.client.types';
import type { DetailedErrorPayload } from '../../application/http/http.types';
import type { EventLog, EventLogType } from '../db_models.generated.dto';

// DECISION (nie usuwaj tego komentarza):
// Ekran „Aktywność" celowo serwuje MINIMALNĄ 4-polową projekcję rekordu logu
// zdarzeń (PII-minimization). `getEventLogsByUser_IO` SELECT-uje wyłącznie te
// 4 kolumny; pozostałe pola pełnego modelu `EventLog` (event_payload, client_ip,
// user_agent, created_by_user_id, language, location) NIGDY nie opuszczają
// backendu na tym user-side endpoincie. Kontrakt wire MUSI odbijać tę projekcję —
// wcześniejsze `records: EventLog[]` obiecywało klientowi 6 pól, których serwer
// nie wysyła (fałszywy kontrakt). Rozszerzenie projekcji (np. o `event_payload`
// pod „payload chips") = decyzja produktowo-prywatnościowa właściciela, nie
// milcząca zmiana typu: wtedy dopisz pole TU + do SELECT w getEventLogsByUser_IO.
export type UserActivityLogRecord = Pick<
  EventLog,
  'event_log_id' | 'event' | 'event_type' | 'created_at'
>;

export type EVENT_LOG_DTO_API_V1 = {
  /** Zwraca stronicowaną listę rekordów logu zdarzeń (cursor, take) filtrowaną po typie zdarzenia. */
  EVENT_LOG_GET_ALL: {
    REQUEST: { type: EventLogType; cursor?: string; take?: number };
    RESPONSE: {
      records: UserActivityLogRecord[];
      nextCursor: string | null;
    };
    RESPONSE_ERROR: DetailedErrorPayload<
      EVENT_LOG_DTO_API_V1['EVENT_LOG_GET_ALL']['REQUEST']
    >;
    IO_CLIENT_FUNCTION: IOClientFunctionReqResErr<
      EVENT_LOG_DTO_API_V1['EVENT_LOG_GET_ALL']['REQUEST'],
      EVENT_LOG_DTO_API_V1['EVENT_LOG_GET_ALL']['RESPONSE'],
      EVENT_LOG_DTO_API_V1['EVENT_LOG_GET_ALL']['RESPONSE_ERROR']
    >;
  };
};
