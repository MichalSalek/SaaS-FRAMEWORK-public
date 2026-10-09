// FDX FAZA 2 (W2.2/W2.3): zmigrowane na unified promise-first front-door
// (`defineQuery`). `getEventLogs_IO` zwraca teraz `Promise<Res>` — hook woła go
// bezpośrednio (bez `toPromise` przy call-site). Nazwa `_IO` zachowana.

import { defineQuery } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';

import type { EVENT_LOG_DTO_API_V1 } from '@kernel/models/event-log/event_log.dto';

export const getEventLogs_IO = defineQuery<
  EVENT_LOG_DTO_API_V1['EVENT_LOG_GET_ALL']['REQUEST'],
  EVENT_LOG_DTO_API_V1['EVENT_LOG_GET_ALL']['RESPONSE'],
  EVENT_LOG_DTO_API_V1['EVENT_LOG_GET_ALL']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.EVENT_LOG_GET_ALL,
  queryFields: req => ({
    type: req.type,
    cursor: req.cursor,
    take: req.take,
  }),
});
