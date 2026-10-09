import { defineEndpoint, defineQuery } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import type { PUBLIC_DTO_API_V1 } from '@kernel/models/public/public.dto';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';

// FDX FAZA 2 (W2.3): domena `public` zmigrowana na unified promise-first
// front-door (`defineEndpoint` / `defineQuery`). Każdy `_IO` zwraca teraz
// `Promise<Res>` — hooki wołają go bezpośrednio (bez `toPromise` przy
// call-site). Side-effecty po odpowiedzi w TanStack Query callbacks w hookach
// — patrz DECISION w `application/http/io.ts`. Nazwy `_IO` zachowane.

/* ─── Contact form submission ─── */

export const submitContactForm_IO = defineEndpoint<
  PUBLIC_DTO_API_V1['CONTACT_FORM_SUBMIT']['REQUEST'],
  PUBLIC_DTO_API_V1['CONTACT_FORM_SUBMIT']['RESPONSE'],
  PUBLIC_DTO_API_V1['CONTACT_FORM_SUBMIT']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.CONTACT_FORM_SUBMIT,
  mode: 'post',
});

/* ─── Public stylists list ─── */

export const getPublicStylistsList_IO = defineQuery<
  PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['REQUEST'],
  PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['RESPONSE'],
  PUBLIC_DTO_API_V1['GET_PUBLIC_STYLISTS_LIST']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.GET_PUBLIC_STYLISTS_LIST,
  queryFields: req => ({
    cursor: req.cursor,
    take: req.take,
    city: req.city,
    searchQuery: req.searchQuery,
  }),
});

/* ─── Public runtime config (maintenance banner) ─── */

// FDX FAZA 2 (W2.3/W2.4): IO przeniesione z UI (useMaintenanceMessage tworzyło je
// inline przez createIOFunction — naruszało warstwy). Public no-auth GET, więc
// należy do `publicIO` (DTO=ADMIN_DTO bo runtime-config jest admin-zarządzany, ale
// odczyt jest publiczny). Fail-soft (resolve '' on error) żyje w HOOKU, nie tu —
// IO to czysty transport. Polityka `background` tłumi per-XHR snackbar przy
// outage backendu, ale zostawia settlement i logowanie. Patrz `http.interceptor`.
export const getPublicRuntimeConfig_IO = defineEndpoint<
  ADMIN_DTO_API_V1['GET_RUNTIME_CONFIG_PUBLIC']['REQUEST'],
  ADMIN_DTO_API_V1['GET_RUNTIME_CONFIG_PUBLIC']['RESPONSE'],
  ADMIN_DTO_API_V1['GET_RUNTIME_CONFIG_PUBLIC']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.GET_RUNTIME_CONFIG_PUBLIC,
  mode: 'get',
  errorFeedbackPolicy: 'background',
});
