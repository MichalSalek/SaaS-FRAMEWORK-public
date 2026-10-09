/**
 * Messaging notification — e-mail do drugiej strony o nowej wiadomości.
 *
 * Best-effort, never-throws (transport = warstwa dostawy; awaria NIE blokuje
 * wysyłki wiadomości, która już się utrwaliła). Throttling (15 min per nadawca
 * per para) żyje w sendMessage_IO — tu tylko resolve odbiorcy + send. Wołane
 * post-response przez runAfterResponse z handlera send.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import {
  ACTIVITY_CONSENT_SELECT,
  acceptsActivityEmail,
} from '@app/email-handler/activity-email-consent';

export const sendMessagingNotification = async (params: {
  recipientUserId: string;
  senderName: string;
  pairId: string;
}): Promise<void> => {
  try {
    // S82: pusty senderName (bezimienny nadawca na parze PENDING / stylistka
    // bez display/business_name po switch-role) → SKIP zamiast maila z urwanym
    // tematem "Nowa wiadomość od ". Wiadomość i tak czeka w wątku (badge +
    // lista), a e-mail bez nadawcy nie niesie wartości.
    if (params.senderName.trim().length === 0) {
      return;
    }
    const recipient = await DB_CLIENT.use.user.findUnique({
      where: { id: params.recipientUserId },
      select: { email: true, name: true, ...ACTIVITY_CONSENT_SELECT },
    });
    if (recipient?.email == null || recipient.email.length === 0) {
      return;
    }
    // S82: pary przeżywają soft-delete by-design (Model A, restore 1:1), ale
    // NOTYFIKACJA do zdjętego/zbanowanego konta to spam do skrzynki osoby,
    // która nie może odpowiedzieć (soft-deleted nie wejdzie do appki) —
    // wiadomość w wątku zostaje (odczyta po restore), mail skip.
    // Activity mail: the recipient's activity-notification switch decides as
    // well (owner 2026-09-25); both rules live in activity-email-consent.ts.
    // The message itself is already stored; only the email is skipped.
    if (!acceptsActivityEmail(recipient)) {
      return;
    }

    const messagesUrl = `${BRAND_CONFIG.url}${ROUTES_FRONT.MESSAGES}`;
    await sendTransactionalEmail(
      'messaging-notification',
      {
        email: recipient.email,
        name: recipient.name ?? '',
        id: params.recipientUserId,
      },
      APP_EVENTS.INFO.EMAIL.EMAIL_MESSAGING_NOTIFICATION_SENT,
      { senderName: params.senderName, appUrl: messagesUrl },
      'email.messagingNotification.subject'
    );
  } catch (error) {
    reportIssueBackend({
      namespace: 'MESSAGING_NOTIFICATION_FAILED',
      message:
        error instanceof Error
          ? error.message
          : 'messaging notification failed',
      payload: {
        recipientUserId: params.recipientUserId,
        pairId: params.pairId,
      },
      mode: 'error',
    });
  }
};
