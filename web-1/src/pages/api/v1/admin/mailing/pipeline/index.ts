import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetEmailPipeline_IO } from '@domain/email/operations/email-pipeline.query';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_GET_EMAIL_PIPELINE, {
  handle: async ({ ctx, res, ok }) => {
    // RBAC already limits this to MASTER_ADMIN (event in no role set, admin
    // wildcard); the operation checks the admin permission again.
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const result = await adminGetEmailPipeline_IO({ currentUser });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
