import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetEmailPreview_IO } from '@app/email-handler/email-preview.operation';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { qStr } from '@app/http/query-params.utils';

export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_GET_EMAIL_PREVIEW']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_EMAIL_PREVIEW']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_GET_EMAIL_PREVIEW,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    // RBAC middleware already gates this to MASTER_ADMIN (event not in any role
    // set → admin wildcard); this asserts an authenticated context defensively.
    requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const body: ADMIN_DTO_API_V1['ADMIN_GET_EMAIL_PREVIEW']['REQUEST'] = {
      templateId: qStr(req.query, 'templateId') ?? '',
      locale: qStr(req.query, 'locale') ?? '',
    };

    const result = await adminGetEmailPreview_IO({ body });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data);
  },
});
