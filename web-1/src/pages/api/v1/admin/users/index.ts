import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { isUtcCalendarDay } from '@kernel/domain/admin/admin-users-url.config';
import { adminGetUsersPaginated_IO } from '@domain/admin/operations/admin-user-search.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

export default defineEndpoint(ADMIN_CONTRACTS.ADMIN_GET_USERS_PAGINATED, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const createdFrom =
      input.created_from !== undefined && isUtcCalendarDay(input.created_from)
        ? input.created_from
        : undefined;

    const result = await adminGetUsersPaginated_IO({
      currentUser,
      params: {
        ...(input.cursor !== undefined && { cursor: input.cursor }),
        take: input.take,
        ...(input.search !== undefined && { search: input.search }),
        ...(input.role !== undefined && { role: input.role }),
        ...(input.onboarding_pending !== undefined && {
          onboarding_pending: input.onboarding_pending,
        }),
        ...(input.attention !== undefined && { attention: input.attention }),
        ...(createdFrom !== undefined && { created_from: createdFrom }),
        ...(input.is_active !== undefined && { is_active: input.is_active }),
        ...(input.account_status !== undefined && {
          account_status: input.account_status,
        }),
        ...(input.payment_status !== undefined && {
          payment_status: input.payment_status,
        }),
        ...(input.pricing_plan !== undefined && {
          pricing_plan: input.pricing_plan,
        }),
        ...(input.sort_by !== undefined && { sort_by: input.sort_by }),
        ...(input.sort_order !== undefined && { sort_order: input.sort_order }),
      },
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.ADMIN.ADMIN_USERS_PAGINATED_FETCHED);
  },
});
