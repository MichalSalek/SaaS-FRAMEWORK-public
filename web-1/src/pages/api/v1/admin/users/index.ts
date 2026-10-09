import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import {
  isAccountStatusNarrower,
  isAccountTypeNarrower,
  isPaymentStatusNarrower,
  isPricingPlanNarrower,
  isAdminUsersSortByFieldNarrower,
  isSortOrderNarrower,
} from '@kernel/models/type_narrowing';
import { isAdminUsersAttentionFilter } from '@kernel/domain/admin/admin-attention.config';
import { adminGetUsersPaginated_IO } from '@domain/admin/operations/admin-user-search.operations';
import {
  parseQueryParams,
  pStr,
  pNum,
  pBool,
  pNarrowed,
} from '@app/http/parse-query-params';
import { requireAuthenticatedContext } from '@domain/user/user.types';

type RequestParams = ADMIN_DTO_API_V1['ADMIN_GET_USERS_PAGINATED']['REQUEST'];

const USERS_QUERY_SCHEMA = {
  cursor: pStr,
  take: pNum,
  search: pStr,
  role: pNarrowed(isAccountTypeNarrower),
  onboarding_pending: pBool,
  attention: pNarrowed(isAdminUsersAttentionFilter),
  is_active: pBool,
  account_status: pNarrowed(isAccountStatusNarrower),
  payment_status: pNarrowed(isPaymentStatusNarrower),
  pricing_plan: pNarrowed(isPricingPlanNarrower),
  sort_by: pNarrowed(isAdminUsersSortByFieldNarrower),
  sort_order: pNarrowed(isSortOrderNarrower),
} satisfies Record<keyof RequestParams, unknown>;

export default defineHandler<
  ADMIN_DTO_API_V1['ADMIN_GET_USERS_PAGINATED']['REQUEST'],
  ADMIN_DTO_API_V1['ADMIN_GET_USERS_PAGINATED']['RESPONSE']
>({
  eventName: APP_EVENTS.QUERIES.ADMIN.ADMIN_GET_USERS_PAGINATED,
  method: 'get',
  validate: () => ({ __isValid: true }),
  handle: async (_body, ctx, _metadata, res, req) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const params = parseQueryParams<RequestParams>(
      req.query,
      USERS_QUERY_SCHEMA
    );

    const result = await adminGetUsersPaginated_IO({
      currentUser,
      params,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    respondSuccess(
      res,
      result.data,
      APP_EVENTS.INFO.ADMIN.ADMIN_USERS_PAGINATED_FETCHED
    );
  },
});
