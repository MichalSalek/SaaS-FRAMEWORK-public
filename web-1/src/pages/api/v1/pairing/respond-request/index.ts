import { getEffectivePricingPlan } from '@kernel/domain/pricing/effective-plan';
import { redactAuditPayload } from '@app/event-log/event-log-io.wrapper';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { defineEndpoint } from '@app/http/define-endpoint';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { emitInfoEvent } from '@app/events/event-bus';
import { markNotificationsReadByKeyPrefix_IO } from '@domain/notifications/operations/notification-write.operations';
import { notificationDedupPrefix } from '@domain/notifications/notification-dedup';
import { NotificationTypeValue } from '@kernel/models/notifications/notifications.dto';
import { requireStylistAccount } from '@domain/_shared/guards/account-guards';
import { respondPairRequest_IO } from '@domain/pairing/operations/pair-request.operations';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

// The stylist accepts (PENDING to ACTIVE, under the plan caps) or declines.
export default defineEndpoint(PAIRING_CONTRACTS.PAIR_REQUEST_RESPOND, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const accountCheck = requireStylistAccount(currentUser);
    if (!accountCheck.success) {
      return mapErrorToResponse(res, accountCheck.error);
    }

    const result = await respondPairRequest_IO({
      stylist_account_id: accountCheck.data.account_id,
      stylist_user_id: currentUser.id,
      stylist_pricing_plan: getEffectivePricingPlan(accountCheck.data),
      pair_id: input.pair_id,
      action: input.action,
    });
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    const auditEvent =
      result.data.status === 'ACTIVE'
        ? APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_ACCEPTED
        : APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_DECLINED;
    audit(auditEvent, {
      user: currentUser,
      requestBody: redactAuditPayload(input, ['pair_id']),
    });

    // Answering the request closes the stylist's own row without a visit to
    // the list. An ACCEPT also tells the client. Both are best-effort.
    runAfterResponse(() =>
      markNotificationsReadByKeyPrefix_IO({
        userId: currentUser.id,
        keyPrefix: notificationDedupPrefix(
          NotificationTypeValue.PAIR_REQUEST_RECEIVED,
          input.pair_id
        ),
      }).then(() => undefined)
    );
    if (result.data.status === 'ACTIVE') {
      emitInfoEvent(APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_ACCEPTED, {
        pairId: input.pair_id,
        clientUserId: result.data.client_user_id,
        stylistAccountId: accountCheck.data.account_id,
        stylistUserId: currentUser.id,
      });
    }

    ok({ success: true, status: result.data.status }, auditEvent);
  },
});
