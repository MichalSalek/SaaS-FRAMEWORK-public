import { DB_CLIENT } from '@app/db/db.client';
import { getFeatureFlags } from '@app/feature-flags/feature-flags.cache';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { respondNotFound } from '@app/http/http.responses.utils';
import { defineEndpoint } from '@app/http/define-endpoint';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { openContact_IO } from '@domain/messaging/operations/messaging-contact.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { MESSAGING_CONTRACTS } from '@kernel/domain/messaging/messaging.contracts';

export default defineEndpoint(MESSAGING_CONTRACTS.MESSAGING_OPEN, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const enabled =
      (await getFeatureFlags()).get(
        FEATURE_FLAG_KEYS.PROFILE_MESSAGING_ENABLED
      ) ?? false;
    if (!enabled) {
      const existing = await DB_CLIENT.use.clientStylistPair.findUnique({
        where: {
          client_user_id_stylist_account_id: {
            client_user_id: currentUser.id,
            stylist_account_id: input.stylist_account_id,
          },
        },
        select: { status: true },
      });
      if (
        !existing ||
        !['CONTACT', 'PENDING', 'ACTIVE'].includes(existing.status)
      ) {
        return respondNotFound(
          res,
          APP_EVENTS.INFO.APPLICATION.NOT_FOUND,
          undefined
        );
      }
    }
    const result = await openContact_IO({
      currentUser,
      stylistAccountId: input.stylist_account_id,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    audit(APP_EVENTS.INFO.MESSAGING.MESSAGING_OPENED, {
      user: currentUser,
      requestBody: input,
      responseBody: result.data,
    });
    ok(result.data, APP_EVENTS.INFO.MESSAGING.MESSAGING_OPENED);
  },
});
