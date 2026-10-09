import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import type { EMAIL_DTO_API_V1 } from '@kernel/models/email/email.dto';
import { getEmailSchedule_IO } from '@domain/email/operations/email-query.operations';
export default defineHandler<
  EMAIL_DTO_API_V1['EMAIL_GET_SCHEDULE']['REQUEST'],
  EMAIL_DTO_API_V1['EMAIL_GET_SCHEDULE']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.EMAIL.EMAIL_GET_SCHEDULE,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, _ctx, _metadata, res) => {
    const result = await getEmailSchedule_IO();
    // result.error is `never` — this operation cannot fail
    if (!result.success) {
      return;
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.EMAIL.EMAIL_SCHEDULE_FETCHED
    );
  },
});
