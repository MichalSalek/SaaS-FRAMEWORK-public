// FDX FAZA 2 (W2.2/W2.3): zmigrowane na unified promise-first front-door
// (`defineEndpoint`). `newsletterSubscribe` zwraca teraz `Promise<Res>` — hook
// woła go bezpośrednio (bez `toPromise` przy call-site). Nazwa zachowana.

import { defineEndpoint } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import type { NEWSLETTER_DTO_API_V1 } from '@kernel/models/newsletter/newsletter.dto';

export const newsletterSubscribe = defineEndpoint<
  NEWSLETTER_DTO_API_V1['NEWSLETTER_SUBSCRIBE']['REQUEST'],
  NEWSLETTER_DTO_API_V1['NEWSLETTER_SUBSCRIBE']['RESPONSE'],
  NEWSLETTER_DTO_API_V1['NEWSLETTER_SUBSCRIBE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.NEWSLETTER_SUBSCRIBE,
  mode: 'post',
});
