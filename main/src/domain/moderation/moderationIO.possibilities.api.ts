// main/src/domain/moderation/moderationIO.possibilities.api.ts
// IO functions for content moderation (frontend client).
// FDX FAZA 2 (W2.2): zmigrowane na unified promise-first front-door (`defineEndpoint` /
// `defineQuery`). Każdy `_IO` zwraca teraz `Promise<Res>` — hooki wołają go bezpośrednio
// (bez `toPromise` przy call-site). Nazwy `_IO` zachowane. Patrz DECISION w `application/http/io.ts`.

import { defineEndpoint, defineQuery } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import type { MODERATION_DTO_API_V1 } from '@kernel/models/moderation/moderation.dto';

export const reportGalleryRecord_IO = defineEndpoint<
  MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['REQUEST'],
  MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['RESPONSE'],
  MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.REPORT_GALLERY_RECORD,
  mode: 'post',
});

// ── Admin: Get Content Reports (GET with query params) ──

export const adminGetContentReports_IO = defineQuery<
  MODERATION_DTO_API_V1['ADMIN_GET_CONTENT_REPORTS']['REQUEST'],
  MODERATION_DTO_API_V1['ADMIN_GET_CONTENT_REPORTS']['RESPONSE'],
  MODERATION_DTO_API_V1['ADMIN_GET_CONTENT_REPORTS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_CONTENT_REPORTS,
  queryFields: req => ({
    status: req.status,
    page: req.page,
    limit: req.limit,
  }),
});

// ── Admin: Resolve Report (POST) ──

export const adminResolveReport_IO = defineEndpoint<
  MODERATION_DTO_API_V1['ADMIN_RESOLVE_REPORT']['REQUEST'],
  MODERATION_DTO_API_V1['ADMIN_RESOLVE_REPORT']['RESPONSE'],
  MODERATION_DTO_API_V1['ADMIN_RESOLVE_REPORT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_RESOLVE_REPORT,
  mode: 'post',
});

// ── Admin: Apply Strike (POST) ──

export const adminApplyStrike_IO = defineEndpoint<
  MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['REQUEST'],
  MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['RESPONSE'],
  MODERATION_DTO_API_V1['ADMIN_APPLY_STRIKE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_APPLY_STRIKE,
  mode: 'post',
});
