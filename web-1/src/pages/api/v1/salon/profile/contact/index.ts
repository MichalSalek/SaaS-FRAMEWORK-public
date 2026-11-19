import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { requireClientAccount } from '@domain/_shared/guards/account-guards';
import { contactSalonStylist_IO } from '@domain/pairing/salon-contact.operations';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { sendMessagingNotification } from '@domain/messaging/messaging-notification.service';
import { StylistClientMessageSenderValue } from '@kernel/models/db_models.generated.dto';
import { SALON_PROFILE_CONTRACTS } from '@kernel/domain/salon-profile/salon-profile.contracts';

export default defineEndpoint(SALON_PROFILE_CONTRACTS.SALON_PROFILE_CONTACT, {
  handle: async ({ input, ctx, res, ok, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const account = requireClientAccount(currentUser);
    if (!account.success) {
      return mapErrorToResponse(res, account.error);
    }
    const result = await contactSalonStylist_IO(
      currentUser,
      input.stylist_account_id,
      input.content
    );
    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }
    const { pairId, sent } = result.data;
    audit(APP_EVENTS.INFO.MESSAGING.MESSAGING_MESSAGE_SENT, {
      user: { id: currentUser.id },
      requestBody: { pair_id: pairId },
    });
    if (sent.notifyRecipientUserId) {
      const recipientUserId = sent.notifyRecipientUserId;
      runAfterResponse(() =>
        sendMessagingNotification({
          recipientUserId,
          senderName: currentUser.name?.trim() || currentUser.email,
          senderSide: StylistClientMessageSenderValue.CLIENT,
          pairId,
        })
      );
    }
    ok({ pair_id: pairId }, APP_EVENTS.INFO.MESSAGING.MESSAGING_MESSAGE_SENT);
  },
});
