import { defineEndpoint } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import type { PRICING_DTO_API_V1 } from '@kernel/models/pricing/pricing.dto';

// FDX FAZA 2 (W2.2): domena `pricing` zmigrowana na unified promise-first
// front-door (`defineEndpoint`). `getPricingPlans_IO` zwraca teraz `Promise<Res>`
// — hooki wołają go bezpośrednio (bez `toPromise` przy call-site).
// Nazwa `_IO` zachowana. Side-effecty zostają w hookach (TanStack Query callbacks).

export const getPricingPlans_IO = defineEndpoint<
  PRICING_DTO_API_V1['PRICING_GET_PLANS']['REQUEST'],
  PRICING_DTO_API_V1['PRICING_GET_PLANS']['RESPONSE'],
  PRICING_DTO_API_V1['PRICING_GET_PLANS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.PRICING_GET_PLANS,
  mode: 'get',
});
