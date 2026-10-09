// main/src/domain/admin/logs/adminLogsIO.possibilities.api.ts
// IO functions for admin logs & observability (frontend client): Event-Log viewer,
// audit trail, reports, AI-crawler analytics.
//
// FDX FAZA 2 (W2.2/W2.3): domena `admin` zmigrowana na unified promise-first
// front-door (`defineEndpoint` / `defineQuery`). Każdy `_IO` zwraca teraz
// `Promise<Res>` — hooki wołają go bezpośrednio (bez `toPromise` przy call-site).
// Nazwy `_IO` zachowane. Patrz DECISION w `application/http/io.ts`.

import { defineEndpoint, defineQuery } from '../../../application/http/io';
import { ENDPOINTS } from '../../../application/http/http.endpoints';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

export const adminGetAuditTrail_IO = defineQuery<
  ADMIN_DTO_API_V1['ADMIN_GET_AUDIT_TRAIL']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_AUDIT_TRAIL']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_AUDIT_TRAIL']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_AUDIT_TRAIL,
  queryFields: req => ({
    page: req.page,
    limit: req.limit,
    event_name: req.event_name,
  }),
});

export const adminGetReports_IO = defineQuery<
  ADMIN_DTO_API_V1['ADMIN_GET_REPORTS']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_REPORTS']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_REPORTS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_REPORTS,
  queryFields: req => ({ period: req.period }),
});

// FDX FAZA 2 (W2.4): `getLogs_IO` (admin Event-Log viewer) przeniesione tu z
// `error-debugger/errorHandlerIO` — to ADMIN_DTO query, siostra
// `adminGetAuditTrail_IO`. errorHandlerIO siedział w cyklu importów
// (io.ts → http.possibilities.api → errorHandler → errorHandlerIO → io.ts);
// eager `defineQuery` tam wywoływał TDZ. adminIO jest poza cyklem.
export const getLogs_IO = defineQuery<
  ADMIN_DTO_API_V1['GET_LOGS']['REQUEST'],
  ADMIN_DTO_API_V1['GET_LOGS']['RESPONSE'],
  ADMIN_DTO_API_V1['GET_LOGS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.GET_LOGS,
  queryFields: req => ({
    environment: req.environment,
    application: req.application,
    type: req.type,
    search: req.search,
    date_from: req.date_from,
    date_to: req.date_to,
    hide_startup_noise: req.hide_startup_noise,
    cursor: req.cursor,
    take: req.take,
  }),
});

export const adminGetLogDetails_IO = defineQuery<
  ADMIN_DTO_API_V1['ADMIN_GET_LOG_DETAILS']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_LOG_DETAILS']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_LOG_DETAILS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_LOG_DETAILS,
  queryFields: req => ({ id: req.id }),
});

// Agregacja po odcisku palca błędu — te same wymiary zawężenia co `getLogs_IO`,
// inny kształt odpowiedzi (jeden wiersz na klasę błędu, nie na wystąpienie).
export const adminGetLogGroups_IO = defineQuery<
  ADMIN_DTO_API_V1['ADMIN_GET_LOG_GROUPS']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_LOG_GROUPS']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_LOG_GROUPS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_LOG_GROUPS,
  queryFields: req => ({
    environment: req.environment,
    application: req.application,
    type: req.type,
    attention: req.attention,
  }),
});

export const adminSetLogIssueStatus_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_SET_LOG_ISSUE_STATUS']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_SET_LOG_ISSUE_STATUS']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_SET_LOG_ISSUE_STATUS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_SET_LOG_ISSUE_STATUS,
  mode: 'post',
});

export const adminGetAiCrawlerStats_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_AI_CRAWLER_STATS']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_AI_CRAWLER_STATS']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_AI_CRAWLER_STATS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_AI_CRAWLER_STATS,
  mode: 'get',
});

export const adminGetAiCrawlerList_IO = defineQuery<
  ADMIN_DTO_API_V1['ADMIN_AI_CRAWLER_LIST']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_AI_CRAWLER_LIST']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_AI_CRAWLER_LIST']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_AI_CRAWLER_LIST,
  queryFields: req => ({
    page: req.page,
    page_size: req.page_size,
    bot_category: req.bot_category ?? undefined,
    bot_name: req.bot_name ?? undefined,
    path: req.path ?? undefined,
    from_date: req.from_date ?? undefined,
    to_date: req.to_date ?? undefined,
  }),
});
