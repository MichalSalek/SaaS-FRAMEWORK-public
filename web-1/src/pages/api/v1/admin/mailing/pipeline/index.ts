import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetEmailPipeline_IO } from '@domain/email/operations/email-pipeline.query';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_GET_EMAIL_PIPELINE']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_EMAIL_PIPELINE']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_GET_EMAIL_PIPELINE,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res) => {
    // RBAC already limits this to MASTER_ADMIN (event in no role set, admin
    // wildcard); the operation checks the admin permission again.
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const result = await adminGetEmailPipeline_IO({ currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(res, result.data);
  },
});
