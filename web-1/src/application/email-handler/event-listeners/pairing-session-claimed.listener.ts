/**
 * Listener: PAIRING_SESSION_CLAIMED → send pairing-notification email to stylist.
 *
 * Replaces the previous direct call to sendTransactionalEmail from the
 * pairing/claim-session handler. The handler now only emits the INFO event
 * — this listener owns the email side-effect.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { subscribeToInfoEvent } from '@app/events/event-bus';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import { activityEmailsAllowed_IO } from '@app/email-handler/activity-email-consent';

subscribeToInfoEvent(
  APP_EVENTS.INFO.PAIRING.PAIRING_SESSION_CLAIMED,
  async payload => {
    // Activity mail: the stylist's activity-notification switch decides (activity-email-consent.ts).
    if (!(await activityEmailsAllowed_IO(payload.stylistUserId))) {
      return;
    }
    await sendTransactionalEmail(
      'pairing-notification',
      {
        email: payload.stylistEmail,
        name: payload.stylistName,
        id: payload.stylistUserId,
      },
      APP_EVENTS.INFO.EMAIL.EMAIL_PAIRING_NOTIFICATION_SENT,
      { clientName: payload.clientName ?? '' },
      'email.pairingNotification.subject'
    );
  }
);
