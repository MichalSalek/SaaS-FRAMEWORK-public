/**
 * Listener: PAIR_REQUEST_SENT → mail do stylistki o czekającej prośbie
 * o połączenie (stały-only 2026-07-12: prośba wysłana zdalnie — np. ze
 * sfotografowanego plakatu — nie może wisieć niezauważona; badge w apce
 * widać dopiero po wejściu na ekran Parowanie).
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { subscribeToInfoEvent } from '@app/events/event-bus';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import { activityEmailsAllowed_IO } from '@app/email-handler/activity-email-consent';

subscribeToInfoEvent(
  APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT,
  async payload => {
    // Activity mail: the stylist's activity-notification switch decides (activity-email-consent.ts).
    if (!(await activityEmailsAllowed_IO(payload.stylistUserId))) {
      return;
    }
    // CTA „Otwórz Parowanie" prowadzi wprost na ekran Parowanie (prośby do
    // akceptacji), nie na stronę główną (goły {{appUrl}} → landing).
    const pairingUrl = `${BRAND_CONFIG.url}${ROUTES_FRONT.PAIRING}`;

    await sendTransactionalEmail(
      'pair-request-notification',
      {
        email: payload.stylistEmail,
        name: payload.stylistName,
        id: payload.stylistUserId,
      },
      APP_EVENTS.INFO.EMAIL.EMAIL_PAIR_REQUEST_NOTIFICATION_SENT,
      { clientName: payload.clientName ?? '', appUrl: pairingUrl },
      'email.pairRequestNotification.subject'
    );
  }
);
