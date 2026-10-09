import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { claimPairingSession_IO } from '@domain/pairing/operations/pairing-session.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { emitInfoEvent } from '@app/events/event-bus';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  PAIRING_DTO_API_V1['PAIRING_SESSION_CLAIM']['REQUEST'],
  PAIRING_DTO_API_V1['PAIRING_SESSION_CLAIM']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.PAIRING.PAIRING_SESSION_CLAIM,
  method: 'post',
  validate: VALIDATION_POLICY.validators.pairingClaimSession,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    reportIssueBackend({
      namespace: 'PAIRING_SESSION_CLAIM',
      message: `Client claiming pairing session`,
      payload: { user_id: currentUser.id },
      mode: 'info',
    });

    const result = await claimPairingSession_IO({
      token: body.token,
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

    const responsePayload: PAIRING_DTO_API_V1['PAIRING_SESSION_CLAIM']['RESPONSE'] =
      {
        success: true,
        stylist_account_id: result.data.stylist_account_id,
        display_name: result.data.display_name,
        message: 'PAIRING_SESSION_CLAIMED',
      };

    // Schedule fire-and-forget tasks BEFORE respondSuccess so they are queued
    // before the response stream closes (matters on serverless / Vercel lambdas).
    // runAfterResponse: na Vercel waitUntil() trzyma lambda do końca tasku.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED,
        user: currentUser,
        requestBody: { stylist_account_id: result.data.stylist_account_id },
        metadata,
      })
    );

    if (result.data.stylist_user_id) {
      const stylistUserId = result.data.stylist_user_id;
      runAfterResponse(() =>
        recordAuditEvent_IO({
          eventName: APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED,
          user: { id: stylistUserId },
          // GDPR-minimization: NIE logujemy client_user_id (id obcego usera) w audit-trail
          // stylisty (90d retencja). Aktor (klient) i tak utrwalany przez meta.created_by_user_id;
          // parytet z innymi pairing-auditami logujacymi tylko bezpieczne skalary.
          requestBody: { stylist_account_id: result.data.stylist_account_id },
          metadata,
        })
      );

      if (result.data.stylist_email) {
        // Emit domain event — email side-effect lives in event-listeners/.
        // Handler stays free of email concerns; new side-effects (e.g.
        // notifications, analytics) can subscribe without touching this code.
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

    // DECISION (nie usuwaj tego komentarza):
    // 200 OK (NOT 201) — BDX W2.5b. claimPairingSession is idempotent find-or-create:
    // the ClientStylistPair grant is upserted (re-claim of an EXISTING active pair is
    // a count-neutral no-op that only refreshes paired_at; a previously REVOKED pair
    // is reactivated in-place). Re-calling with the same token returns the SAME
    // resource, so the response is not "a new resource was created" → 200, like the
    // sibling onboard-client/onboard-stylist idempotent provisioners. Do NOT flip to 201.
    respondSuccess(
      res,
      responsePayload,
      APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED
    );
  },
});
