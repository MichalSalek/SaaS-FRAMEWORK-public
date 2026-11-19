import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { defineEndpoint } from '@app/http/define-endpoint';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { getLifecycleActions } from '@domain/email/lifecycle-actions.query';
import { EMAIL_CONTRACTS } from '@kernel/domain/email/email.contracts';

export default defineEndpoint(EMAIL_CONTRACTS.EMAIL_LIFECYCLE_ACTIONS, {
  handle: async ({ input, ctx, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    ok(
      await getLifecycleActions(currentUser.id, input.cursor),
      APP_EVENTS.INFO.EMAIL.EMAIL_LIFECYCLE_ACTIONS_FETCHED
    );
  },
});
