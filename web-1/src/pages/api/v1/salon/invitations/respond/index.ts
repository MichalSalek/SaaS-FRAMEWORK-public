import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireSalonStaffEnabled } from '@app/feature-flags/feature-flags.guard';
import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { respondToStaffInvitation_IO } from '@domain/salon-staff/operations/salon-staff-invitation.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { emitInfoEvent } from '@app/events/event-bus';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { markNotificationsReadByKeyPrefix_IO } from '@domain/notifications/operations/notification-write.operations';
import { notificationDedupPrefix } from '@domain/notifications/notification-dedup';
import { NotificationTypeValue } from '@kernel/models/notifications/notifications.dto';
import { SALON_STAFF_CONTRACTS } from '@kernel/domain/salon-staff/salon-staff.contracts';

// Invitee side: ACCEPT = consent to be listed by name and photo in
// that salon's team, DECLINE = membership removed. Ownership is proven inside the
// operation (user_id = session user in the write predicate), never by the body.
export default defineEndpoint(
  SALON_STAFF_CONTRACTS.SALON_STAFF_RESPOND_INVITATION,
  {
    handle: async ({ input, ctx, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);

      if (!(await requireSalonStaffEnabled(res))) {
        return;
      }

      const result = await respondToStaffInvitation_IO({
        userId: currentUser.id,
        staffMemberId: input.staff_member_id,
        response: input.response,
      });
      if (!result.success) {
        return mapErrorToResponse(res, result.error);
      }

      const infoEvent =
        result.data.status === 'ACCEPTED'
          ? APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_ACCEPTED
          : APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_DECLINED;

      const { applied, salon_account_id, ...response } = result.data;
      runAfterResponse(() =>
        markNotificationsReadByKeyPrefix_IO({
          userId: currentUser.id,
          keyPrefix: notificationDedupPrefix(
            NotificationTypeValue.SALON_INVITATION_RECEIVED,
            input.staff_member_id
          ),
        }).then(() => undefined)
      );
      if (applied && result.data.status === 'ACCEPTED' && salon_account_id) {
        emitInfoEvent(
          APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_ACCEPTED,
          {
            salonAccountId: salon_account_id,
            memberUserId: currentUser.id,
          }
        );
      }
      if (applied) {
        audit(infoEvent, {
          user: currentUser,
          requestBody: redactAuditPayload(input, [
            'staff_member_id',
            'response',
          ]),
        });
      }

      ok(response, infoEvent);
    },
  }
);
