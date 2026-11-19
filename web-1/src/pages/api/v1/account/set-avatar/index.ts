import { defineEndpoint } from '@app/http/define-endpoint';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';

// /api/v1/account/set-avatar
// One command for both directions: a non-empty `avatar_url` sets the photo,
// `null` clears the column and falls back to OAuth `user.image`, then initials.
// The profile cover stays generative and this command does not touch it. (owner)
import {
  recordAuditEvent_IO,
  redactAuditPayload,
} from '@app/event-log/event-log-io.wrapper';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { respondSuccess } from '@app/http/http.responses.utils';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { accountSetAvatar_IO } from '@domain/account/operations/account-avatar.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

export default defineEndpoint(ACCOUNT_CONTRACTS.ACCOUNT_SET_AVATAR, {
  handle: async ({ input: body, ctx, meta: metadata, res }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    // SECURITY: account_id z sesji (requireStylistAccount), NIGDY z body —
    // inaczej dowolna stylistka podmieniałaby avatar cudzego profilu.
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await accountSetAvatar_IO({
      account_id: accountCheck.data.account_id,
      avatar_url: body.avatar_url,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    // Dwa osobne fakty w osi czasu konta: użytkowniczka widzi „zapisano zdjęcie"
    // i „zdjęcie usunięte" jako różne zdarzenia, a audyt musi odróżnić nadpisanie
    // od powrotu do fallbacku.
    const infoEvent =
      body.avatar_url === null
        ? APP_EVENTS.INFO.ACCOUNT.AVATAR_CLEARED
        : APP_EVENTS.INFO.ACCOUNT.AVATAR_SET;

    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: infoEvent,
        user: currentUser,
        requestBody: redactAuditPayload(body, ['avatar_url']),
        responseBody: { account_id: result.data.account_id },
        metadata,
      })
    );

    respondSuccess(res, result.data, infoEvent);
  },
});
