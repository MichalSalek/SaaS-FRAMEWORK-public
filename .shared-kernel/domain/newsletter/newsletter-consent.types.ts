/**
 * Newsletter consent action — RODO Art. 30 audit trail.
 *
 * Used in the append-only NewsletterConsentEvent table.
 * SUBSCRIBE = consent granted (double opt-in confirmed).
 * UNSUBSCRIBE = consent withdrawn.
 */
export const NEWSLETTER_CONSENT_ACTION = {
  SUBSCRIBE: 'SUBSCRIBE',
  UNSUBSCRIBE: 'UNSUBSCRIBE',
} as const;

export type NewsletterConsentAction =
  (typeof NEWSLETTER_CONSENT_ACTION)[keyof typeof NEWSLETTER_CONSENT_ACTION];
