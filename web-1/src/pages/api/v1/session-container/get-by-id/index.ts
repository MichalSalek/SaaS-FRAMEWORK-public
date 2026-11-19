import { defineEndpoint } from '@app/http/define-endpoint';
import { respondOnError } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { respondValidationFailed } from '@app/http/http.responses.utils';
import { getSessionContainerById_IO } from '@domain/session-container/operations/session-container.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { SESSION_CONTAINER_CONTRACTS } from '@kernel/domain/session-container/session-container.contracts';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';

export default defineEndpoint(
  SESSION_CONTAINER_CONTRACTS.SESSION_CONTAINER_GET_BY_ID,
  {
    handle: async ({ input, ctx, res, ok, audit }) => {
      const { currentUser } = requireAuthenticatedContext(ctx);
      res.setHeader('Cache-Control', 'no-store');

      // Missing, empty or repeated session_id stays this literal, not an i18n token.
      const session_id = input.session_id;
      if (!session_id) {
        respondValidationFailed(res, { session_id: 'Required' });
        return;
      }

      const result = await getSessionContainerById_IO({
        session_id,
        client_account_id: currentUser.client_account?.client_account_id,
        stylist_account_id: currentUser.stylist_account?.account_id,
        user_id: currentUser.id,
      });
      if (respondOnError(res, result)) {
        return;
      }

      audit(APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_FETCHED, {
        user: currentUser,
        requestBody: { session_id },
      });
      ok(
        {
          session: {
            ...result.data,
            can_accept:
              currentUser.account_type === AccountTypeValue.STYLIST &&
              result.data.can_accept === true,
          },
        },
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_FETCHED
      );
    },
  }
);
