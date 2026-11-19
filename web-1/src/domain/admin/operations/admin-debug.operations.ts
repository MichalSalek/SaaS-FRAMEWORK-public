import { writeRawEventLog_IO } from '@app/event-log/event-log.client';
import { debuggerStates } from '@app/debugger/debugger.state';
import { DB_CLIENT } from '@app/db/db.client';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { OperationResult } from '@kernel/application/result.types';
import { success } from '@kernel/application/result.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import { invalidateRuntimeConfigCache } from '@domain/admin/operations/admin-runtime-config.operations';
import type { RuntimeConfigKey } from '@kernel/domain/admin/runtime-config.config';

const VERBOSE_KEY: RuntimeConfigKey = 'VERBOSE_LOG_MODE';

type DebugModeResult = {
  event: ADMIN_DTO_API_V1['SWITCH_BACKEND_DEBUG_MODE']['RESPONSE']['event'];
};

export const adminSwitchBackendDebugMode_IO = async ({
  body,
  currentUser,
}: {
  body: ADMIN_DTO_API_V1['SWITCH_BACKEND_DEBUG_MODE']['REQUEST'];
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
}): Promise<
  OperationResult<DebugModeResult, AdminInsufficientPermissionsError>
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }
  let event: ADMIN_DTO_API_V1['SWITCH_BACKEND_DEBUG_MODE']['RESPONSE']['event'];

  // DECISION: a SETTER, not a toggle. The body is validated (`enabled` required) and the state
  // becomes exactly what was asked, so a retry or double click cannot undo itself and a stray
  // body cannot flip process-wide logging.
  if (body.debug_db === true) {
    debuggerStates.isEnabledDBLeaksDebugger = body.enabled;
    event = body.enabled
      ? APP_EVENTS.INFO.ADMIN.DEBUG_DB_MODE_ENABLED
      : APP_EVENTS.INFO.ADMIN.DEBUG_DB_MODE_DISABLED;
  } else {
    debuggerStates.isEnabledDebugMode = body.enabled;
    event = body.enabled
      ? APP_EVENTS.INFO.ADMIN.DEBUG_MODE_ENABLED
      : APP_EVENTS.INFO.ADMIN.DEBUG_MODE_DISABLED;

    try {
      await DB_CLIENT.use.runtimeConfig.updateMany({
        where: { key: VERBOSE_KEY },
        data: {
          value: String(debuggerStates.isEnabledDebugMode),
          updated_by_user_id: currentUser.id,
        },
      });
      // The public projection (`getPublicRuntimeConfig_IO`) reads this key through a cache with
      // a 5-minute TTL, and this module is its second writer. Without invalidation the admin
      // panel showed the new value while `/api/v1/runtime-config` kept the old one, even across
      // the next toggle. Drift between instances is accepted (TTL); invalidation in THIS process
      // is required.
      invalidateRuntimeConfigCache(VERBOSE_KEY);
    } catch {
      // Non-critical — in-memory state is authoritative during this process lifetime
    }
  }

  await writeRawEventLog_IO({
    eventName: event,
    eventLogType: EventLogTypeValue.ADMIN,
    meta: {
      created_by_user_id: currentUser.id,
    },
    eventPayloadToStringify: {
      new_state: body.enabled,
      debug_db: body.debug_db ?? false,
    },
  });

  return success({ event });
};
