// Salon staff errors (kernel `SalonStaffError`).
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { SalonStaffError } from '@kernel/domain/salon-staff/salon-staff-errors.types';
import {
  respondBadRequest,
  respondNotFound,
  respondStaffAlreadyExists,
} from '../http.responses.utils';
import type { ErrorResponderMap, OwnErrors } from './error-map.types';
import { respondPlanLimit } from './shared.responders';

export const salonStaffErrorMap = {
  SALON_STAFF_NOT_FOUND: (res, error) =>
    respondNotFound(res, APP_EVENTS.INFO.APPLICATION.NOT_FOUND, {
      staffId: error.staffId,
    }),

  // SECURITY: do not echo the email back; it prevents account enumeration via invite probing.
  SALON_STAFF_ALREADY_EXISTS: res => respondStaffAlreadyExists(res, undefined),

  SALON_STAFF_LIMIT_REACHED: respondPlanLimit,

  SALON_STAFF_SELF_INVITE: res =>
    // 400: the salon owner tried to enroll her OWN account as staff (meaningless and burns a paid
    // quota slot). @@unique([stylist_account_id, user_id]) cannot catch it (account id vs user id);
    // rejected in the operation. SECURITY: no accountId echoed (like SALON_STAFF_ALREADY_EXISTS).
    respondBadRequest(
      res,
      APP_EVENTS.INFO.SALON_STAFF.CANNOT_INVITE_STAFF,
      undefined
    ),
} satisfies ErrorResponderMap<OwnErrors<SalonStaffError>>;
