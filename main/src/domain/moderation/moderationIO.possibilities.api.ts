// main/src/domain/moderation/moderationIO.possibilities.api.ts
// IO functions for content moderation (frontend client).
// Promise-first front door (`defineEndpoint` /
// `defineQuery`). Every `_IO` returns `Promise<Res>` and hooks call it directly (no `toPromise`
// at the call site). The `_IO` names are kept. See the DECISION in `application/http/io.ts`.

import { contractEndpoint, defineEndpoint } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import type { MODERATION_DTO_API_V1 } from '@kernel/models/moderation/moderation.dto';

const C = ADMIN_CONTRACTS;

export const reportGalleryRecord_IO = defineEndpoint<
  MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['REQUEST'],
  MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['RESPONSE'],
  MODERATION_DTO_API_V1['REPORT_GALLERY_RECORD']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.REPORT_GALLERY_RECORD,
  mode: 'post',
});

// ── Admin: Get Content Reports (GET with query params) ──

export const adminGetContentReports_IO = contractEndpoint(
  C.ADMIN_GET_CONTENT_REPORTS
);
export const adminResolveReport_IO = contractEndpoint(C.ADMIN_RESOLVE_REPORT);
export const adminApplyStrike_IO = contractEndpoint(C.ADMIN_APPLY_STRIKE);
