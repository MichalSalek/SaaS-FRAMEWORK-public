import { defineHandler } from '@app/http/define-handler';

// /api/v1/account/set-avatar
// Zdjęcie profilowe stylistki — JEDEN command na oba kierunki: `avatar_url`
// niepuste ustawia zdjęcie, `null` czyści kolumnę i oddaje profil łańcuchowi
// fallbacku (OAuth `user.image` → inicjały). Okładka profilu zostaje generatywna
// (decyzja ownera 2026-09-09) i nie ma tu żadnego udziału.
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
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

export default defineHandler<
  ACCOUNT_DTO_API_V1['ACCOUNT_SET_AVATAR']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_SET_AVATAR']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.ACCOUNT.ACCOUNT_SET_AVATAR,
  method: 'post',
  validate: VALIDATION_POLICY.validators.accountSetAvatar,
  handle: async (body, ctx, metadata, res) => {
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
