import { DB_CLIENT } from '@app/db/db.client';

/**
 * RODO Art. 15 — newsletter subscription export.
 *
 * NewsletterSubscriber is keyed by email (no FK to User), so it must be
 * explicitly included in the GDPR data export. Returns null if no row exists.
 *
 * Includes full consent history (NewsletterConsentEvent) for RODO Art. 30
 * compliance — every subscribe/unsubscribe action with timestamps.
 */
export const exportNewsletterSubscription = async (
  email: string
): Promise<Record<string, unknown> | null> => {
  const subscription = await DB_CLIENT.use.newsletterSubscriber.findUnique({
    where: { email },
    select: {
      is_active: true,
      created_at: true,
      confirmed_at: true,
      consent_timestamp: true,
      consent_source: true,
      ip_address: true,
      consent_events: {
        select: {
          action: true,
          consent_timestamp: true,
          ip_address: true,
          user_agent: true,
        },
        orderBy: { consent_timestamp: 'asc' },
      },
    },
  });

  if (!subscription) {
    return null;
  }

  return {
    is_active: subscription.is_active,
    subscribed_at: subscription.created_at.toISOString(),
    confirmed_at: subscription.confirmed_at?.toISOString() ?? null,
    consent_timestamp: subscription.consent_timestamp?.toISOString() ?? null,
    consent_source: subscription.consent_source,
    ip_address: subscription.ip_address,
    consent_history: subscription.consent_events.map(event => ({
      action: event.action,
      timestamp: event.consent_timestamp.toISOString(),
      ip_address: event.ip_address,
      user_agent: event.user_agent,
    })),
  };
};
