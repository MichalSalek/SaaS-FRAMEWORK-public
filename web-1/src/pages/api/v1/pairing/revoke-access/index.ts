import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondSuccess } from '@app/http/http.responses.utils';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { revokePairingAccess_IO } from '@domain/pairing/operations/pairing-access.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
export default defineHandler<
  PAIRING_DTO_API_V1['PAIRING_ACCESS_REVOKE']['REQUEST'],
  PAIRING_DTO_API_V1['PAIRING_ACCESS_REVOKE']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.PAIRING.PAIRING_ACCESS_REVOKE,
  method: 'post',
  validate: VALIDATION_POLICY.validators.pairingRevokeAccess,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    // Active role decides scope, not stylist_account presence.
    // Dual-role users (CLIENT with legacy stylist_account) must revoke only
    // as a CLIENT — mirrors get-my-pairs/issue-session role gating.
    const isStylistRole = currentUser.role_id === SystemRoleId.STYLIST_ROLE;
    const stylistAccountId = currentUser.stylist_account?.account_id;

    const result = await revokePairingAccess_IO({
      current_user_id: currentUser.id,
      ...(isStylistRole &&
        stylistAccountId && {
          current_stylist_account_id: stylistAccountId,
        }),
      ...(body.target_user_id && { target_user_id: body.target_user_id }),
      ...(body.target_account_id && {
        target_account_id: body.target_account_id,
      }),
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Schedule fire-and-forget BEFORE respond so it survives serverless freeze.
    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.PAIRING.PAIRING_ACCESS_REVOKED,
        user: currentUser,
        requestBody: {
          ...(body.target_user_id && { target_user_id: body.target_user_id }),
          ...(body.target_account_id && {
            target_account_id: body.target_account_id,
          }),
        },
        metadata,
      })
    );

    respondSuccess(
      res,
      { success: true },
      APP_EVENTS.INFO.PAIRING.PAIRING_ACCESS_REVOKED
    );
  },
});
