import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetEmailPreview_IO } from '@app/email-handler/email-preview.operation';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_GET_EMAIL_PREVIEW, {
  handle: async ({ input, ctx, res, ok }) => {
    requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const result = await adminGetEmailPreview_IO({
      body: {
        templateId: input.templateId ?? '',
        locale: input.locale ?? '',
      },
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
