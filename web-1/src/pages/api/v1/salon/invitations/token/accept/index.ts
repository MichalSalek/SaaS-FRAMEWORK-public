import { enforceImpersonationGate_IO } from '@app/auth/admin-impersonation.utils';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireSalonStaffEnabled } from '@app/feature-flags/feature-flags.guard';
import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { getCurrentUser_IO } from '@domain/user/operations/user-session.operations';
import { acceptSalonInvitationToken_IO } from '@domain/salon-staff/salon-invitation-token.service';
import { emitInfoEvent } from '@app/events/event-bus';
import { SALON_STAFF_CONTRACTS } from '@kernel/domain/salon-staff/salon-staff.contracts';

export default defineEndpoint(SALON_STAFF_CONTRACTS.SALON_STAFF_ACCEPT_TOKEN, {
  handle: async ({ input, req, res, ok }) => {
    if (!(await requireSalonStaffEnabled(res))) {
      return;
    }
    const resolution = req.headers.authorization
      ? await getCurrentUser_IO({ req, res })
      : undefined;
    // A presented token that could not be CHECKED is not an anonymous caller: accepting without
    // her identity would skip the impersonation gate and the e-mail match. Answer 503, keep the token.
    if (resolution?.status === 'UNAVAILABLE') {
      mapErrorToResponse(res, {
        type: 'AUTH_UNAVAILABLE',
        stage: resolution.stage,
      });
      return;
    }
    const session =
      resolution?.status === 'AUTHENTICATED' ? resolution.output : undefined;
    if (session) {
      const gate = await enforceImpersonationGate_IO({
        req,
        command: APP_EVENTS.COMMANDS.SALON_STAFF.SALON_STAFF_ACCEPT_TOKEN,
        currentUserId: session.currentUser.id,
        sessionToken: session.session.token,
      });
      if (!gate.success) {
        mapErrorToResponse(res, gate.error);
        return;
      }
    }
    const result = await acceptSalonInvitationToken_IO({
      token: input.token,
      ...(input.response && { response: input.response }),
      ...(session?.currentUser && { currentEmail: session.currentUser.email }),
    });
    if (!result.success) {
      mapErrorToResponse(res, result.error);
      return;
    }
    const consent = result.data;
    if (
      consent.status === 'ACCEPTED' &&
      'salon_account_id' in consent &&
      consent.salon_account_id &&
      consent.accepted_user_id
    ) {
      emitInfoEvent(
        APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_ACCEPTED,
        {
          salonAccountId: consent.salon_account_id,
          memberUserId: consent.accepted_user_id,
        }
      );
    }
    const {
      salon_account_id: _salonAccountId,
      accepted_user_id: _acceptedUserId,
      ...publicConsent
    } = 'salon_account_id' in consent
      ? consent
      : { ...consent, salon_account_id: null, accepted_user_id: null };
    ok(
      {
        ...publicConsent,
        requires_stylist_account:
          'requires_stylist_account' in consent
            ? consent.requires_stylist_account
            : false,
      },
      consent.status === 'ACCEPTED'
        ? APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_ACCEPTED
        : APP_EVENTS.INFO.SALON_STAFF.SALON_STAFF_INVITATION_DECLINED
    );
  },
});
