// main/src/domain/admin/health/adminHealthIO.possibilities.api.ts
// IO functions for admin system health & diagnostics (frontend client): health
// check, runtime metrics, backend debug-mode switch.
//
// FDX FAZA 2 (W2.2/W2.3): domena `admin` zmigrowana na unified promise-first
// front-door (`defineEndpoint`). Każdy `_IO` zwraca teraz `Promise<Res>` — hooki
// wołają go bezpośrednio (bez `toPromise` przy call-site). Nazwy `_IO` zachowane.
// Patrz DECISION w `application/http/io.ts`.

import { defineEndpoint } from '../../../application/http/io';
import { ENDPOINTS } from '../../../application/http/http.endpoints';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

export const adminTickDebugSwitch_IO = defineEndpoint<
  ADMIN_DTO_API_V1['SWITCH_BACKEND_DEBUG_MODE']['REQUEST'],
  ADMIN_DTO_API_V1['SWITCH_BACKEND_DEBUG_MODE']['RESPONSE'],
  ADMIN_DTO_API_V1['SWITCH_BACKEND_DEBUG_MODE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.SWITCH_BACKEND_DEBUG_MODE,
  mode: 'post',
});

export const adminGetHealth_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_HEALTH']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_HEALTH']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_HEALTH']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_HEALTH,
  mode: 'get',
});

export const adminGetMetrics_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_GET_METRICS']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_METRICS']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_METRICS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_METRICS,
  mode: 'get',
});
