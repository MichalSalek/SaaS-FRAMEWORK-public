/**
 * Listener: PAIR_REQUEST_SENT -> mail to the stylist about a waiting connection request.
 * A request sent remotely (e.g. from a photographed poster) must not hang unnoticed; the in-app
 * badge is visible only after opening the Pairing screen.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { subscribeToInfoEvent } from '@app/events/event-bus';
import { DB_CLIENT } from '@app/db/db.client';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import { activityEmailsAllowed_IO } from '@app/email-handler/activity-email-consent';

subscribeToInfoEvent(
  APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT,
  async payload => {
    // Activity mail: the stylist's activity-notification switch decides (activity-email-consent.ts).
    if (!(await activityEmailsAllowed_IO(payload.stylistUserId))) {
      return;
    }
    // Pending requests are above the client list; the QR issuing screen has no request actions.
    const pairingUrl = `${BRAND_CONFIG.url}${ROUTES_FRONT.CLIENTS}`;
    const context = await DB_CLIENT.use.clientStylistPair.findUnique({
      where: { id: payload.pairId },
      select: { request_place: true, request_note: true },
    });

    await sendTransactionalEmail(
      'pair-request-notification',
      {
        email: payload.stylistEmail,
        name: payload.stylistName,
        id: payload.stylistUserId,
      },
      APP_EVENTS.INFO.EMAIL.EMAIL_PAIR_REQUEST_NOTIFICATION_SENT,
      {
        clientName: payload.clientName ?? '',
        appUrl: pairingUrl,
        place: context?.request_place?.trim() ?? '',
        note: context?.request_note?.trim() ?? '',
      },
      'email.pairRequestNotification.subject'
    );
  }
);
