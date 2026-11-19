export const NEWSLETTER_CONSENT_ACTION = {
  SUBSCRIBE: 'SUBSCRIBE',
  UNSUBSCRIBE: 'UNSUBSCRIBE',
} as const;

export type NewsletterConsentAction =
  (typeof NEWSLETTER_CONSENT_ACTION)[keyof typeof NEWSLETTER_CONSENT_ACTION];
