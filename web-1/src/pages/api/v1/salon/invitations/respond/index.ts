import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { respondSuccess } from '@app/http/http.responses.utils';
import { requireSalonStaffEnabled } from '@app/feature-flags/feature-flags.guard';
import { runAfterResponse } from '@app/runtime/run-after-response';
import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import type { SALON_STAFF_DTO_API_V1 } from '@kernel/models/salon-staff/salon-staff.dto';
import { respondToStaffInvitation_IO } from '@domain/salon-staff/operations/salon-staff-invitation.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';

// Invitee side (2026-09-25): ACCEPT = consent to be listed by name and photo in
// that salon's team, DECLINE = membership removed. Ownership is proven inside the
// operation (user_id = session user in the write predicate), never by the body.
export default defineHandler<
  SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['REQUEST'],
  SALON_STAFF_DTO_API_V1['SALON_STAFF_RESPOND_INVITATION']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.SALON_STAFF.SALON_STAFF_RESPOND_INVITATION,
  method: 'post',
  validate: VALIDATION_POLICY.validators.salonStaffRespondInvitation,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    if (!(await requireSalonStaffEnabled(res))) {
      return;
    }

    const result = await respondToStaffInvitation_IO({
      userId: currentUser.id,
      staffMemberId: body.staff_member_id,
      response: body.response,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const infoEvent =
      result.data.status === 'ACCEPTED'
        ? APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_ACCEPTED
        : APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_DECLINED;

    const { applied, ...response } = result.data;
    // Audit payload: the membership id and the answer only (no PII). Written only
    // for a request that changed state: a replay or a DECLINE of someone else's id
    // is a no-op and must not read as "she declined" in the trail (s34 review).
    if (applied) {
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: infoEvent,
          user: currentUser,
          requestBody: redactAuditPayload(body, [
            'staff_member_id',
            'response',
          ]),
          metadata,
        })
      );
    }

    respondSuccess(res, response, infoEvent);
  },
});
