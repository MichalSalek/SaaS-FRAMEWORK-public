/**
 * Listener: SESSION_CONTAINER_SHARED → mail do stylistki o udostępnionej
 * sesji inspiracji (2026-07-12). Klientka wypełnia sesję w domu — bez maila
 * sesja wisi w schowku niezauważona do następnego otwarcia apki (stylistka
 * nie ma taba sesji w bottom-nav, tylko licznik na dashboardzie i drawer).
 *
 * Lookup e-maila stylistki żyje TU (nie w payloadzie): PII nie krąży po
 * szynie zdarzeń, a listener i tak jest async (wysyłka maila). Brak konta /
 * e-maila = cichy no-op (share już się udał; mail jest best-effort).
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { BRAND_CONFIG } from '@kernel/domain/platform/brand.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { subscribeToInfoEvent } from '@app/events/event-bus';
import { sendTransactionalEmail } from '@app/email-handler/email-transactional';
import { DB_CLIENT } from '@app/db/db.client';
import {
  ACTIVITY_CONSENT_SELECT,
  acceptsActivityEmail,
} from '@app/email-handler/activity-email-consent';

subscribeToInfoEvent(
  APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARED,
  async payload => {
    const stylist = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { account_id: payload.stylistAccountId },
      select: {
        created_by_user_id: true,
        created_by_user: {
          select: { email: true, name: true, ...ACTIVITY_CONSENT_SELECT },
        },
      },
    });

    const email = stylist?.created_by_user?.email;
    if (!email) {
      return;
    }
    // Activity mail: the stylist's activity-notification switch decides
    // (activity-email-consent.ts), read in the same query as the address. A
    // failed read throws into the event bus, which reports it: no mail.
    if (!acceptsActivityEmail(stylist.created_by_user)) {
      return;
    }

    // CTA prowadzi WPROST do udostępnionej sesji w skrzynce stylistki
    // (SESSION_DETAIL = '/app/inbox/session/[sessionId]'), nie na stronę główną
    // (goły {{appUrl}} → landing). appUrl w vars różnicuje też klucz dedup maili.
    const sessionUrl = `${BRAND_CONFIG.url}${ROUTES_FRONT.SESSION_DETAIL.replace(
      '[sessionId]',
      payload.sessionId
    )}`;

    await sendTransactionalEmail(
      'session-shared-notification',
      {
        email,
        name: stylist.created_by_user?.name ?? null,
        id: stylist.created_by_user_id,
      },
      APP_EVENTS.INFO.EMAIL.EMAIL_SESSION_SHARED_NOTIFICATION_SENT,
      { clientName: payload.clientName ?? '', appUrl: sessionUrl },
      'email.sessionSharedNotification.subject'
    );
  }
);
