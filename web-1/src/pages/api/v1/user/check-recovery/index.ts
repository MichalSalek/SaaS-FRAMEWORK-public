import { defineEndpoint } from '@app/http/define-endpoint';
import { USER_CONTRACTS } from '@kernel/domain/user/user.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondSuccess } from '@app/http/http.responses.utils';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
export default defineEndpoint(USER_CONTRACTS.USER_CHECK_RECOVERY, {
  handle: async ({ res }) => {
    // DECISION: anti-enumeration (Model A, DOMAIN_SSOT §13.1). Recovery is POST-login: account state
    // (recovery_available / deleted_at / days_left) is read from `currentUser` (SafeCurrentUser) after login,
    // not from this public endpoint. It does no per-email lookup (checkRecoveryAvailability was removed) and
    // returns a UNIFORM response for ANY e-mail (existing, deleted, nonexistent), so an attacker cannot tell
    // whether an account exists, is soft-deleted or how many days are left. The RESPONSE shape
    // (recovery_available:false) is kept for client compatibility until the frontend drops the hook.
    const uniformPayload: USER_DTO_API_V1['USER_CHECK_RECOVERY']['RESPONSE'] = {
      recovery_available: false,
      deleted_at: null,
      days_left: null,
    };
    respondSuccess(res, uniformPayload, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
