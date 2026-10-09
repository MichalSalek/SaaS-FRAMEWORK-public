// main/src/domain/admin/attention/adminAttentionIO.possibilities.api.ts
// IO function for admin attention counts (badge "czeka na Ciebie" w sidebarze
// panelu admina): otwarte wątki supportu czekające na odpowiedź + pending
// zgłoszenia moderacyjne.

import { defineEndpoint } from '../../../application/http/io';
import { ENDPOINTS } from '../../../application/http/http.endpoints';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

export const adminGetAttentionCounts_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_GET_ATTENTION_COUNTS']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_ATTENTION_COUNTS']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_ATTENTION_COUNTS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_ATTENTION_COUNTS,
  mode: 'get',
});
