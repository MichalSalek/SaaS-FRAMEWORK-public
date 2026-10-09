import { defineHandler } from '@app/http/define-handler';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { runAfterResponse } from '@app/runtime/run-after-response';
import { respondCreated } from '@app/http/http.responses.utils';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';
import { mapErrorToResponse } from '@app/http/error-mapper';
import { sendMessage_IO } from '@domain/messaging/operations/messaging-write.operations';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import { sendMessagingNotification } from '@domain/messaging/messaging-notification.service';
import { requireAuthenticatedContext } from '@domain/user/user.types';
import {
  StylistClientMessageSenderValue,
  type MESSAGING_DTO_API_V1,
} from '@kernel/models/messaging/messaging.dto';

export default defineHandler<
  MESSAGING_DTO_API_V1['MESSAGING_SEND']['REQUEST'],
  MESSAGING_DTO_API_V1['MESSAGING_SEND']['RESPONSE']
>({
  eventName: APP_EVENTS.COMMANDS.MESSAGING.MESSAGING_SEND,
  method: 'post',
  validate: VALIDATION_POLICY.validators.messagingSend,
  handle: async (body, ctx, metadata, res) => {
    const { currentUser } = requireAuthenticatedContext(ctx);
    const result = await sendMessage_IO({
      currentUser,
      pairId: body.pair_id,
      content: body.content,
    });

    if (!result.success) {
      return mapErrorToResponse(res, result.error);
    }

    runAfterResponse(() =>
      recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.MESSAGING.MESSAGING_MESSAGE_SENT,
        user: { id: currentUser.id },
        requestBody: { pair_id: body.pair_id },
        metadata,
      })
    );

    // Notyfikacja e-mail do drugiej strony (throttled w operacji → null gdy burst).
    const recipientUserId = result.data.notifyRecipientUserId;
    if (recipientUserId != null) {
      // Nazwa nadawcy DOBRANA po stronie w tej parze (senderSide z operacji):
      // STYLIST → nazwa biznesowa; CLIENT → imię osobiste. User będący
      // jednocześnie stylistką i klientką, piszący jako CLIENT, NIE wysyła
      // swojej nazwy biznesowej odbiorcy (closing-review LOW — identity leak).
      // `.trim() ||` zamiast `??` — Prisma User.name @default("") (klasa S67a).
      // DECISION (nie usuwaj tego komentarza) — kierunki PII (closing S82):
      // (a) e-mail KLIENTKI wolno pokazać stylistce TYLKO dla pary ACTIVE
      //     (PII-minimum pre-accept: "email dopiero po ACCEPT", parytet
      //     getPendingPairRequests + counterpartName);
      // (b) e-mail STYLISTKI NIGDY nie idzie do klientki — żadna inna
      //     powierzchnia go nie ujawnia (counterpartName celowo kończy na '',
      //     get-my-pairs client-branch bez e-maila); switch-role auto-provision
      //     tworzy stylist_account BEZ display/business_name, więc fallback na
      //     e-mail otwierałby NOWY kierunek leaku.
      // Pusty senderName po łańcuchu → notyfikacja jest POMIJANA w serwisie
      // (guard w sendMessagingNotification) zamiast wysyłać urwany temat.
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
          pairId: body.pair_id,
        })
      );
    }

    const responsePayload: MESSAGING_DTO_API_V1['MESSAGING_SEND']['RESPONSE'] =
      {
        message: result.data.message,
      };
    respondCreated(
      res,
      responsePayload,
      APP_EVENTS.INFO.MESSAGING.MESSAGING_MESSAGE_SENT
    );
  },
});
