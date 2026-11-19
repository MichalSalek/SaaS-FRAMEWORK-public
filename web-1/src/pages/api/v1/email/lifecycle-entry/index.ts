import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { defineEndpoint } from '@app/http/define-endpoint';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { recordLifecycleEntry } from '@domain/email/lifecycle-entry.service';
import { EMAIL_CONTRACTS } from '@kernel/domain/email/email.contracts';

export default defineEndpoint(EMAIL_CONTRACTS.EMAIL_LIFECYCLE_ENTRY, {
  handle: async ({ input, ctx, ok }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const attribution = await recordLifecycleEntry(currentUser.id, input);
    ok({ attribution }, APP_EVENTS.INFO.EMAIL.EMAIL_LIFECYCLE_ENTRY_RECORDED);
  },
});
