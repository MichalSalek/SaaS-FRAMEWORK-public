import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { EMAIL_DTO_API_V1 } from '@kernel/models/email/email.dto';
import { getEmailHistory_IO } from '@domain/email/operations/email-query.operations';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { qStr, qInt } from '@app/http/query-params.utils';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  EMAIL_DTO_API_V1['EMAIL_GET_HISTORY']['REQUEST'],
  EMAIL_DTO_API_V1['EMAIL_GET_HISTORY']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.EMAIL.EMAIL_GET_HISTORY,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // Default: use currentUser's own ID (prevents IDOR)
    let targetUserId = currentUser.id;

    // Admin override: optional ?userId= query param to view any user's history
    const queryUserId = req.query.userId;
    if (queryUserId != null && typeof queryUserId === 'string') {
      const adminCheck = requireAdminPermission(currentUser);
      if (!adminCheck.success) {
        return mapErrorToResponse(res, adminCheck.error);
      }
      targetUserId = queryUserId;
    }

    const cursor = qStr(req.query, 'cursor') ?? undefined;
    const take = qInt(req.query, 'take') ?? 50;

    const result = await getEmailHistory_IO(targetUserId, { cursor, take });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.EMAIL.EMAIL_HISTORY_FETCHED
    );
  },
});
