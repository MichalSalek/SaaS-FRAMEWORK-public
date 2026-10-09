import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
export default defineHandler<
  USER_DTO_API_V1['USER_CHECK_RECOVERY']['REQUEST'],
  USER_DTO_API_V1['USER_CHECK_RECOVERY']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.USER.USER_CHECK_RECOVERY,
  method: 'post',
  validate: VALIDATION_POLICY.validators.userCheckRecovery,
  handle: async (_body, _ctx, _metadata, res) => {
    // DECISION (nie usuwaj tego komentarza):
    // ADRR Model A (§13.1) — anty-enumeration. Recovery jest POST-login: stan konta
    // (recovery_available / deleted_at / days_left) czyta się z `currentUser`
    // (SafeCurrentUser) po zalogowaniu, NIE z tego publicznego endpointu. Ten endpoint
    // NIE wykonuje już per-email lookupu (checkRecoveryAvailability) — zwraca UNIFORM
    // response dla DOWOLNEGO emaila (istniejącego, usuniętego, nieistniejącego), więc
    // atakujący nie może wykryć czy konto istnieje / jest soft-deleted / ile dni zostało.
    // Kształt RESPONSE zachowany (recovery_available:false) dla kompatybilności klienta
    // do czasu gdy frontend (F1) zdeprecjonuje hook i przejdzie w pełni na currentUser.
    const uniformPayload: USER_DTO_API_V1['USER_CHECK_RECOVERY']['RESPONSE'] = {
      recovery_available: false,
      deleted_at: null,
      days_left: null,
    };
    respondSuccess(res, uniformPayload, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
