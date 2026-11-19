import { getFeatureFlags } from '@app/feature-flags/feature-flags.cache';
import { FEATURE_FLAG_KEYS } from '@kernel/domain/feature-flags/feature-flags.config';
import { respondNotFound } from '@app/http/http.responses.utils';
import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { SESSION_CONTAINER_CONTRACTS } from '@kernel/domain/session-container/session-container.contracts';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { acceptSessionContainer_IO } from '@domain/session-container/operations/session-container.operations';
import { kickSessionActivityOutbox } from '@domain/session-container/session-activity.outbox';

export default defineEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_ACCEPT,
  {
    handle: async ({ input, ctx, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      const account = requireStylistAccount(currentUser);
      if (respondOnError(res, account)) {
        return;
      }
      if (!(
        (await getFeatureFlags()).get(
          FEATURE_FLAG_KEYS.SESSION_ACCEPTANCE_ENABLED
        ) ?? false
      )) {
        return respondNotFound(
          res,
          APP_EVENTS.INFO.APPLICATION.NOT_FOUND,
          undefined
        );
      }
      const result = await acceptSessionContainer_IO({
        session_id: input.session_id,
        stylist_account_id: account.data.account_id,
        user_id: currentUser.id,
      });
      if (respondOnError(res, result)) {
        return;
      }
      kickSessionActivityOutbox(input.session_id);
      audit(APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_ACCEPTED, {
        user: currentUser,
        requestBody: input,
      });
      ok(
        { session: result.data },
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_ACCEPTED
      );
    },
  }
);
