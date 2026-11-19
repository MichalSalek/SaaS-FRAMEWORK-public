import { contractEndpoint } from '../../application/http/io';
import { NEWSLETTER_CONTRACTS } from '@kernel/domain/newsletter/newsletter.contracts';

export const newsletterSubscribe = contractEndpoint(
  NEWSLETTER_CONTRACTS.NEWSLETTER_SUBSCRIBE
);
