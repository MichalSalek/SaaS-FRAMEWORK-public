import { z } from 'zod';
import { defineContracts } from '../../application/contracts/contract.types';
import { newsletterSubscribeSchema } from '../../policies/validation/misc.validation';

const subscribed = z.object({
  subscribed: z.literal(true),
  pending_confirmation: z.literal(true),
});

/**
 * JSON newsletter subscribe. Confirm and unsubscribe stay raw HTML routes.
 */
export const NEWSLETTER_CONTRACTS = defineContracts({
  NEWSLETTER_SUBSCRIBE: {
    summary:
      'Zapis adresu do newslettera z podwójną zgodą. Wysyła mail potwierdzający.',
    group: 'NEWSLETTER',
    kind: 'COMMAND',
    path: 'public/newsletter-subscribe',
    method: 'POST',
    body: newsletterSubscribeSchema,
    query: null,
    response: subscribed,
    successEvents: ['NEWSLETTER_PENDING_CONFIRMATION'],
    auditEvents: [],
    access: 'PUBLIC',
    authCheck: false,
    limiterTier: 'strict',
  },
});

export type NewsletterContracts = typeof NEWSLETTER_CONTRACTS;
