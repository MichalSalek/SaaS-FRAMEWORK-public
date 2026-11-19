// UI/features/shared/newsletter/hooks/useNewsletterSubscribe.ts
// TQ v5 mutation -- POST /api/v1/public/newsletter-subscribe
// Public endpoint: subscribes the provided email to the newsletter mailing list.
// Stack: TanStack Query v5.

import { useMutation } from '@tanstack/react-query';
import { newsletterSubscribe } from '../../../../../domain/newsletter/newsletterIO.possibilities.api';
import type { NEWSLETTER_DTO_API_V1 } from '@kernel/models/newsletter/newsletter.dto';

/* --- Types --- */

type SubscribeRequest =
  NEWSLETTER_DTO_API_V1['NEWSLETTER_SUBSCRIBE']['REQUEST'];

/* --- Hook --- */

export function useNewsletterSubscribe() {
  return useMutation({
    mutationFn: (req: SubscribeRequest) => newsletterSubscribe(req),
  });
}
