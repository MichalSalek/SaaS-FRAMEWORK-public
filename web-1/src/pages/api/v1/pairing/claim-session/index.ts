import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { claimPairingSession_IO } from '@domain/pairing/operations/pairing-session.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { emitInfoEvent } from '@app/events/event-bus';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

export default defineEndpoint(PAIRING_CONTRACTS.PAIRING_SESSION_CLAIM, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    reportIssueBackend({
      namespace: 'PAIRING_SESSION_CLAIM',
      message: `Client claiming pairing session`,
      payload: { user_id: currentUser.id },
      mode: 'info',
    });

    const result = await claimPairingSession_IO({
      token: input.token,
      client_user_id: currentUser.id,
    });

    if (!result.success) {
      reportIssueBackend({
        namespace: 'PAIRING_SESSION_CLAIM',
        message: `Claim failed: ${result.error.type}`,
        payload: { user_id: currentUser.id },
        mode: 'warn',
      });
      return mapErrorToResponse(res, result.error);
    }

    reportIssueBackend({
      namespace: 'PAIRING_SESSION_CLAIM',
      message: `Pairing session claimed successfully`,
      payload: {
        user_id: currentUser.id,
        stylist_account_id: result.data.stylist_account_id,
      },
      mode: 'info',
    });

    audit(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED, {
      user: currentUser,
      requestBody: { stylist_account_id: result.data.stylist_account_id },
    });

    if (result.data.stylist_user_id) {
      const stylistUserId = result.data.stylist_user_id;
      // The stylist's audit row keeps the account id only. The actor is already
      // stored as meta.created_by_user_id. A client id in that row would be another
      // person's identifier kept for the event-log retention window.
      audit(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED, {
        user: { id: stylistUserId },
        requestBody: { stylist_account_id: result.data.stylist_account_id },
      });

      if (result.data.stylist_email) {
        emitInfoEvent(APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED, {
          stylistAccountId: result.data.stylist_account_id,
          stylistUserId,
          stylistEmail: result.data.stylist_email,
          stylistName: result.data.stylist_name,
          clientUserId: currentUser.id,
          clientName: currentUser.name || null,
          claimedAt: result.data.paired_at,
        });
      }
    }

    // DECISION: 200 OK, not 201. claimPairingSession is an idempotent find-or-create: re-claiming an
    // EXISTING active pair is a count-neutral no-op that only refreshes paired_at, and a REVOKED pair is
    // reactivated in place, so re-calling returns the SAME resource. Same as the onboard-client /
    // onboard-stylist provisioners. Do NOT flip to 201.
    ok(
      {
        success: true,
        stylist_account_id: result.data.stylist_account_id,
        display_name: result.data.display_name,
        message: 'PAIRING_SESSION_CLAIMED',
      },
      APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED
    );
  },
});
