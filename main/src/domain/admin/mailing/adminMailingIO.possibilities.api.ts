// main/src/domain/admin/mailing/adminMailingIO.possibilities.api.ts
// IO functions for the admin mailing tools: template preview and the email
// pipeline (last sweep, dry-run queue, offer codes). Moved out of the health
// module, where they had landed by accident (S122).

import { defineEndpoint, defineQuery } from '../../../application/http/io';
import { ENDPOINTS } from '../../../application/http/http.endpoints';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

// Admin email-template preview: GET with templateId + locale query string.
export const adminGetEmailPreview_IO = defineQuery<
  ADMIN_DTO_API_V1['ADMIN_GET_EMAIL_PREVIEW']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_EMAIL_PREVIEW']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_EMAIL_PREVIEW']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_EMAIL_PREVIEW,
  queryFields: req => ({ templateId: req.templateId, locale: req.locale }),
});

// Admin email pipeline: dry run of the lifecycle sweep, last sweep, offer codes.
export const adminGetEmailPipeline_IO = defineEndpoint<
  ADMIN_DTO_API_V1['ADMIN_GET_EMAIL_PIPELINE']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_EMAIL_PIPELINE']['RESPONSE'],
  ADMIN_DTO_API_V1['ADMIN_GET_EMAIL_PIPELINE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ADMIN_GET_EMAIL_PIPELINE,
  mode: 'get',
});
