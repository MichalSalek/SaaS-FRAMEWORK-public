import { defineEndpoint } from '@app/http/define-endpoint';
import { ADMIN_CONTRACTS } from '@kernel/domain/admin/admin.contracts';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { adminSendLog_IO } from '@domain/admin/operations/admin-logs.operations';
export default defineEndpoint(ADMIN_CONTRACTS.SEND_LOG, {
  handle: async ({ input: body, ctx, ok }) => {
    // DECISION: the log is attributed to the session's user, never to a client-supplied
    // user_id; an anonymous report is stored with user_id null. A body field would let
    // anyone attribute a log line to any user (access inventory).
    const result = await adminSendLog_IO({
      body,
      sessionUserId: ctx.currentUser?.id ?? null,
    });

    // result.error is `never` — this operation cannot fail
    // but guard ensures respondCreated only runs on success
    if (!result.success) {
      return;
    }

    ok(undefined, APP_EVENTS.INFO.APPLICATION.SUCCESS);
  },
});
