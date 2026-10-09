import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { adminSendLog_IO } from '@domain/admin/operations/admin-logs.operations';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
export default defineHandler<
  ADMIN_DTO_API_V1['SEND_LOG']['REQUEST'],
  ADMIN_DTO_API_V1['SEND_LOG']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ADMIN.SEND_LOG,
  method: 'post',
  validate: VALIDATION_POLICY.validators.adminSendLog,
  handle: async (body, _ctx, _metadata, res) => {
    const result = await adminSendLog_IO({ body });

    // result.error is `never` — this operation cannot fail
    // but guard ensures respondCreated only runs on success
    if (!result.success) {
      return;
    }

    respondSuccess(res, undefined, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
