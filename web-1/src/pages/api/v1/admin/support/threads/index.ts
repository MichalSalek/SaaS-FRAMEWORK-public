import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetAllThreads_IO } from '@domain/support/operations/support-admin.operations';
import type { SUPPORT_DTO_API_V1 } from '@kernel/models/support/support.dto';
import { isSupportThreadCategoryFilter } from '@kernel/domain/support/support-category.config';
import { isSupportThreadStatusNarrower } from '@kernel/models/type_narrowing';
import { qStr, qInt, qBool } from '@app/http/query-params.utils';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_ALL_THREADS']['REQUEST'],
  SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_ALL_THREADS']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.SUPPORT.SUPPORT_ADMIN_GET_ALL_THREADS,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // Optional filters. An unknown value is dropped (no filter), like every
    // other narrowed query param of the admin lists.
    const statusParam = qStr(req.query, 'status');
    const status = isSupportThreadStatusNarrower(statusParam)
      ? statusParam
      : undefined;
    const categoryParam = qStr(req.query, 'category');
    const category = isSupportThreadCategoryFilter(categoryParam)
      ? categoryParam
      : undefined;
    const awaitingReply = qBool(req.query, 'awaiting_reply') === true;

    const cursor = qStr(req.query, 'cursor') ?? undefined;
    const take = qInt(req.query, 'take') ?? 50;

    const result = await adminGetAllThreads_IO(
      currentUser,
      { status, category, awaitingReply },
      { cursor, take }
    );

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_THREADS_FETCHED
    );
  },
});
