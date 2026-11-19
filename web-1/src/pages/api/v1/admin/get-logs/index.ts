import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { adminGetLogs_IO } from '@domain/admin/operations/admin-logs.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { isUtcCalendarDay } from '@kernel/domain/admin/admin-users-url.config';

// AppLogRecord.id is a 4-byte Int. A larger integer reached Prisma and failed
// its validation (500). Out of range means no cursor, like any other unusable value.
const PG_INT4_MAX = 2_147_483_647;

const calendarDay = (value: string | undefined): string | undefined =>
  value !== undefined && isUtcCalendarDay(value) ? value : undefined;

export default defineEndpoint(ADMIN_CONTRACTS.GET_LOGS, {
  handle: async ({ input, ctx, res, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    res.setHeader('Cache-Control', 'no-store');

    const searchRaw = input.search?.trim() ?? '';
    const search = searchRaw.length > 0 ? searchRaw.slice(0, 200) : undefined;
    const dateFrom = calendarDay(input.date_from);
    const dateTo = calendarDay(input.date_to);
    const cursor =
      Number.isInteger(input.cursor) &&
      input.cursor > 0 &&
      input.cursor <= PG_INT4_MAX
        ? input.cursor
        : undefined;

    const result = await adminGetLogs_IO({
      body: {
        ...(input.environment !== undefined && {
          environment: input.environment,
        }),
        ...(input.application !== undefined && {
          application: input.application,
        }),
        ...(input.type !== undefined && { type: input.type }),
        ...(search !== undefined && { search }),
        ...(dateFrom !== undefined && { date_from: dateFrom }),
        ...(dateTo !== undefined && { date_to: dateTo }),
        ...(input.hide_startup_noise !== undefined && {
          hide_startup_noise: input.hide_startup_noise,
        }),
        ...(cursor !== undefined && { cursor }),
        take: input.take,
      },
      currentUser,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    ok(result.data, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
