import { defineEndpoint } from '@app/http/define-endpoint';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { sendMessage_IO } from '@domain/messaging/operations/messaging-write.operations';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import { sendMessagingNotification } from '@domain/messaging/messaging-notification.service';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import { emitInfoEvent } from '@app/events/event-bus';
import { StylistClientMessageSenderValue } from '@kernel/models/messaging/messaging.dto';
import { MESSAGING_CONTRACTS } from '@kernel/domain/messaging/messaging.contracts';

export default defineEndpoint(MESSAGING_CONTRACTS.MESSAGING_SEND, {
  handle: async ({ input, ctx, res, created, audit }) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await sendMessage_IO({
      currentUser,
      pairId: input.pair_id,
      content: input.content,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    audit(APP_EVENTS.INFO.MESSAGING.MESSAGING_MESSAGE_SENT, {
      user: { id: currentUser.id },
      requestBody: { pair_id: input.pair_id },
    });

    // Email to the other side (throttled in the operation, null on a burst).
    const recipientUserId = result.data.notifyRecipientUserId;
    if (recipientUserId != null) {
      // Sender name follows this pair's side (senderSide from the operation):
      // STYLIST uses the business name; CLIENT uses the personal name. A user who
      // is both, writing as CLIENT, does not send her business name.
      // `.trim() ||` rather than `??`: Prisma User.name defaults to an empty string.
      // DECISION: PII directions. (a) The CLIENT's e-mail may be shown to the stylist ONLY for an ACTIVE
      // pair (PII minimum before accept; same as getPendingPairRequests + counterpartName). (b) The
      // STYLIST's e-mail NEVER goes to the client: no other surface reveals it (counterpartName deliberately
      // ends at '', the get-my-pairs client branch has no e-mail), and switch-role auto-provision creates a
      // stylist_account WITHOUT display/business_name, so an e-mail fallback would open a NEW leak
      // direction. An empty senderName after the chain: client => the notification is SKIPPED in the
      // service; stylist => the service substitutes the role name in the recipient's language
      // (STYLIST_SENDER_FALLBACK in sendMessagingNotification).
      const isActivePair = result.data.pairStatus === PairingStatusValue.ACTIVE;
      const senderName =
        result.data.senderSide === StylistClientMessageSenderValue.STYLIST
          ? currentUser.stylist_account?.display_name?.trim() ||
            currentUser.stylist_account?.business_name?.trim() ||
            currentUser.name?.trim() ||
            ''
          : currentUser.name?.trim() || (isActivePair ? currentUser.email : '');
      runAfterResponse(() =>
        sendMessagingNotification({
          recipientUserId,
          senderName,
          senderSide: result.data.senderSide,
          pairId: input.pair_id,
        })
      );
      // The in-app row (and push) for the other side, under
      // the SAME gate as the mail (throttle + mute, decided in the operation).
      // The row's name is a display name or null, never the e-mail fallback
      // the mail may use for a nameless client on an ACTIVE pair.
      const isStylistSender =
        result.data.senderSide === StylistClientMessageSenderValue.STYLIST;
      const notificationSenderName = isStylistSender
        ? senderName || null
        : currentUser.name?.trim() || null;
      emitInfoEvent(APP_EVENTS.INFO.MESSAGING.MESSAGING_MESSAGE_SENT, {
        pairId: input.pair_id,
        recipientUserId,
        recipientSide: isStylistSender
          ? StylistClientMessageSenderValue.CLIENT
          : StylistClientMessageSenderValue.STYLIST,
        senderUserId: currentUser.id,
        senderName: notificationSenderName,
      });
    }

    created(
      { message: result.data.message },
      APP_EVENTS.INFO.MESSAGING.MESSAGING_MESSAGE_SENT
    );
  },
});
