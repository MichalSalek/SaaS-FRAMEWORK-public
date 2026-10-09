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

  // DECISION (nie usuwaj tego komentarza): SETTER, not a toggle (testy-api s34). The
  // body is validated (zod, `enabled` required), and the state becomes exactly what
  // was asked, so a retry or a double click cannot undo itself and a stray body can
  // no longer flip process-wide logging.
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
      // Publiczna projekcja (`getPublicRuntimeConfig_IO`) czyta ten klucz przez cache
      // z 5-minutowym TTL, a ten moduł jest jego DRUGIM pisarzem. Bez unieważnienia
      // panel admina pokazywał już nową wartość, a `/api/v1/runtime-config` w tej samej
      // chwili wciąż starą — i trzymał ją przez kolejne przełączenie. Rozjazd między
      // instancjami jest świadomy (TTL); brakowało unieważnienia w TYM procesie.
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
