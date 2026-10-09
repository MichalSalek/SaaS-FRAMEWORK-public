import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { revokePairingSession_IO } from '@domain/pairing/operations/pairing-revoke.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE']['REQUEST'],
  PAIRING_DTO_API_V1['PAIRING_SESSION_REVOKE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.PAIRING.PAIRING_SESSION_REVOKE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.pairingRevokeSession,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await revokePairingSession_IO({
      token: body.token,
      stylist_account_id: accountCheck.data.account_id,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // DECISION (nie usuwaj tego komentarza):
    // Audit log MUSI zawierać tylko prefix tokenu (8 znaków + '...'), nigdy
    // pełnego tokena. EventLog ma 90d retention — pełny token w event_payload
    // = persistent credential leak (atakujący z dostępem do DB może użyć
    // tokenu by zamontować ponownie pairing session, mimo że została zrewokowana).
    // 8-znakowy prefix wystarcza do correlation z innymi zdarzeniami audytowymi.
    const tokenPrefix =
      typeof body.token === 'string' && body.token.length > 0
        ? `${body.token.slice(0, 8)}...`
        : null;

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_REVOKED,
        user: currentUser,
        requestBody: { tokenPrefix },
        metadata,
      })
    );

    respondSuccess(
      res,
      { success: true },
      APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_REVOKED
    );
  },
});
