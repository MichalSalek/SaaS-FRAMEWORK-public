/**
 * Messaging notification: e-mail the other side about a new message.
 *
 * Best-effort and never throws. Transport is delivery, so a failure does not
 * block a message that is already stored. The 15-minute throttle per sender
 * per pair lives in sendMessage_IO. This file only resolves the recipient and
 * sends, after the response, via runAfterResponse from the send handler.
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
import { resolveLocaleByEmail } from '@app/email-handler/email-locale.resolver';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import {
  StylistClientMessageSenderValue,
  type StylistClientMessageSender,
} from '@kernel/models/db_models.generated.dto';

// DECISION: a stylist without a name is a normal account since onboarding asks only the role (owner
// 2026-10-15). Her client must still learn that a message is waiting, so the sender is named by her role in
// the recipient's language (mirror of CLIENT_NAME_FALLBACK in email-template.renderer.ts), in the nominative
// because the body opens with it; the subject switches to `subjectFromStylist`, which carries the phrase in
// the case its own sentence needs (German „von Ihrer Stylistin”). A nameless client sender is still skipped:
// on a PENDING pair her e-mail must not be shown (PII minimum) and the stylist sees the request in the app.
const STYLIST_SENDER_FALLBACK: Record<LocaleType, string> = {
  pl: 'Twoja stylistka',
  en: 'Your stylist',
  de: 'Ihre Stylistin',
};

const SUBJECT_KEY = 'email.messagingNotification.subject';
const SUBJECT_KEY_FROM_STYLIST =
  'email.messagingNotification.subjectFromStylist';

export const sendMessagingNotification = async (params: {
  recipientUserId: string;
  senderName: string;
  senderSide: StylistClientMessageSender;
  pairId: string;
}): Promise<void> => {
  try {
    // An empty client senderName (a nameless sender on a PENDING pair) skips
    // the mail instead of a subject cut off at "Nowa wiadomość od ". The
    // message still waits in the thread (badge and list). A nameless stylist
    // is named by role (STYLIST_SENDER_FALLBACK), or her client would not
    // learn that a message is waiting.
    const senderName = params.senderName.trim();
    const isNamelessStylist =
      senderName.length === 0 &&
      params.senderSide === StylistClientMessageSenderValue.STYLIST;
    if (senderName.length === 0 && !isNamelessStylist) {
      return;
    }
    const recipient = await DB_CLIENT.use.user.findUnique({
      where: { id: params.recipientUserId },
      select: { email: true, name: true, ...ACTIVITY_CONSENT_SELECT },
    });
    if (recipient?.email == null || recipient.email.length === 0) {
      return;
    }
    // Pairs survive soft-delete by design (Model A, restore is 1:1), but mail
    // to a removed or banned account reaches someone who cannot reply (a
    // soft-deleted user cannot enter the app). The thread message stays and
    // is readable after restore. The mail is skipped.
    // Activity mail: the recipient's activity-notification switch decides as
    // well (owner); both rules live in activity-email-consent.ts.
    // The message itself is already stored; only the email is skipped.
    if (!acceptsActivityEmail(recipient)) {
      return;
    }

    const messagesUrl = `${BRAND_CONFIG.url}${ROUTES_FRONT.MESSAGES}`;
    const recipientUser = {
      email: recipient.email,
      name: recipient.name ?? '',
      id: params.recipientUserId,
    };
    const infoEvent = APP_EVENTS.INFO.EMAIL.EMAIL_MESSAGING_NOTIFICATION_SENT;
    if (isNamelessStylist) {
      // The fallback is chosen per language, so the locale is resolved here
      // and handed on (the same lookup sendTransactionalEmail would do).
      const locale = await resolveLocaleByEmail(recipient.email);
      await sendTransactionalEmail(
        'messaging-notification',
        recipientUser,
        infoEvent,
        { senderName: STYLIST_SENDER_FALLBACK[locale], appUrl: messagesUrl },
        SUBJECT_KEY_FROM_STYLIST,
        locale
      );
      return;
    }
    await sendTransactionalEmail(
      'messaging-notification',
      recipientUser,
      infoEvent,
      { senderName, appUrl: messagesUrl },
      SUBJECT_KEY
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
