import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { revokePairingAccess_IO } from '@domain/pairing/operations/pairing-access.operations';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

export default defineEndpoint(PAIRING_CONTRACTS.PAIRING_ACCESS_REVOKE, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);

    // Active role decides scope, not stylist_account presence.
    // Dual-role users (CLIENT with legacy stylist_account) must revoke only
    // as a CLIENT. Same gate as get-my-pairs and issue-session.
    const isStylistRole = currentUser.role_id === SystemRoleId.STYLIST_ROLE;
    const stylistAccountId = currentUser.stylist_account?.account_id;
    const targetUserId =
      typeof input.target_user_id === 'string' &&
      input.target_user_id.length > 0
        ? input.target_user_id
        : undefined;
    const targetAccountId =
      typeof input.target_account_id === 'string' &&
      input.target_account_id.length > 0
        ? input.target_account_id
        : undefined;

    const result = await revokePairingAccess_IO({
      current_user_id: currentUser.id,
      ...(isStylistRole &&
        stylistAccountId && {
          current_stylist_account_id: stylistAccountId,
        }),
      ...(targetUserId !== undefined && { target_user_id: targetUserId }),
      ...(targetAccountId !== undefined && {
        target_account_id: targetAccountId,
      }),
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.PAIRING.PAIRING_ACCESS_REVOKED, {
      user: currentUser,
      requestBody: {
        ...(targetUserId !== undefined && { target_user_id: targetUserId }),
        ...(targetAccountId !== undefined && {
          target_account_id: targetAccountId,
        }),
      },
    });

    ok({ success: true }, APP_EVENTS.INFO.PAIRING.PAIRING_ACCESS_REVOKED);
  },
});
