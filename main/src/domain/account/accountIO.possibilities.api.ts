import { defineEndpoint, defineQuery } from '../../application/http/io';
import { ENDPOINTS } from '../../application/http/http.endpoints';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';

// FDX FAZA 2 (W2.2/W2.3): domena `account` zmigrowana na unified promise-first
// front-door (`defineEndpoint` / `defineQuery`). Każdy `_IO` zwraca teraz
// `Promise<Res>` — hooki wołają go bezpośrednio (bez `toPromise` przy call-site).
// Side-effecty po odpowiedzi (cache-patch, redirect) przeniesione do TanStack Query
// callbacks w hookach — patrz DECISION w `application/http/io.ts`. Nazwy `_IO` zachowane.

export const incrementProfileView_IO = defineEndpoint<
  ACCOUNT_DTO_API_V1['ACCOUNT_INCREMENT_VIEW']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_INCREMENT_VIEW']['RESPONSE'],
  ACCOUNT_DTO_API_V1['ACCOUNT_INCREMENT_VIEW']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ACCOUNT_INCREMENT_VIEW,
  mode: 'post',
});

/* ─── Dashboard feed ─── */

export const getDashboardFeed_IO = defineEndpoint<
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_FEED']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_FEED']['RESPONSE'],
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_FEED']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ACCOUNT_GET_DASHBOARD_FEED,
  mode: 'get',
});

/* ─── Dashboard note ─── */

export const getDashboardNote_IO = defineEndpoint<
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_NOTE']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_NOTE']['RESPONSE'],
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_DASHBOARD_NOTE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ACCOUNT_GET_DASHBOARD_NOTE,
  mode: 'get',
});

export const setDashboardNote_IO = defineEndpoint<
  ACCOUNT_DTO_API_V1['ACCOUNT_SET_DASHBOARD_NOTE']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_SET_DASHBOARD_NOTE']['RESPONSE'],
  ACCOUNT_DTO_API_V1['ACCOUNT_SET_DASHBOARD_NOTE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ACCOUNT_SET_DASHBOARD_NOTE,
  mode: 'post',
});

// DECISION (nie usuwaj tego komentarza):
// D5 (run 25 TRD): updateStylistProfile_IO replaces setLocation_IO, setVanityUrl_IO,
// and updateStylistSocialLinks_IO. Single endpoint posts all 3 dirty sub-sections
// in one atomic transaction (backend $transaction). Frontend collapses 3 mutations
// into 1 button click → 1 round-trip → 1 success/error toast.
export const updateStylistProfile_IO = defineEndpoint<
  ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['REQUEST'],
  ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['RESPONSE'],
  ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.UPDATE_STYLIST_PROFILE,
  mode: 'post',
});

// Zdjęcie profilowe: jeden endpoint na oba kierunki — `avatar_url: null` czyści
// kolumnę i oddaje profil fallbackowi (obraz z OAuth → inicjały).
export const setAccountAvatar_IO = defineEndpoint<
  ACCOUNT_DTO_API_V1['ACCOUNT_SET_AVATAR']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_SET_AVATAR']['RESPONSE'],
  ACCOUNT_DTO_API_V1['ACCOUNT_SET_AVATAR']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ACCOUNT_SET_AVATAR,
  mode: 'post',
});

// Zamknięcie karty „Siła galerii": żądanie bez treści, konto z sesji.
export const dismissGalleryStrength_IO = defineEndpoint<
  ACCOUNT_DTO_API_V1['ACCOUNT_DISMISS_GALLERY_STRENGTH']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_DISMISS_GALLERY_STRENGTH']['RESPONSE'],
  ACCOUNT_DTO_API_V1['ACCOUNT_DISMISS_GALLERY_STRENGTH']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ACCOUNT_DISMISS_GALLERY_STRENGTH,
  mode: 'post',
});

export const getPublicProfile_IO = defineQuery<
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['RESPONSE'],
  ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ACCOUNT_GET_PUBLIC_PROFILE,
  queryFields: req => ({ identifier: req.identifier }),
});

export const createPortalSession_IO = defineEndpoint<
  ACCOUNT_DTO_API_V1['ACCOUNT_STRIPE_PORTAL']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_STRIPE_PORTAL']['RESPONSE'],
  ACCOUNT_DTO_API_V1['ACCOUNT_STRIPE_PORTAL']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ACCOUNT_STRIPE_PORTAL,
  mode: 'post',
});

// SUPERSEDED (W5): startTrial_IO removed — the standalone "start trial" flow is
// replaced by the embedded checkout (checkoutSession_IO). A trial-eligible
// stylist now claims the trial INSIDE PlanCheckoutPanel (card captured, charged
// after the trial), not via a separate hosted-redirect endpoint. The backend
// route was fully removed 2026-07-09 (kernel event + routing + DTO + handler).

/* ─── SPE (W2): plan-choice + embedded payments ─── */

// Dispatcher wyboru planu. RESPONSE = discriminated union po `mode`
// (free_selected | checkout_elements | hosted_fallback) — patrz
// account-checkout.types. Front robi exhaustive switch w PlanCheckoutPanel.
export const checkoutSession_IO = defineEndpoint<
  ACCOUNT_DTO_API_V1['ACCOUNT_CHECKOUT_SESSION']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_CHECKOUT_SESSION']['RESPONSE'],
  ACCOUNT_DTO_API_V1['ACCOUNT_CHECKOUT_SESSION']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ACCOUNT_CHECKOUT_SESSION,
  mode: 'post',
});

// Zmiana planu paid->paid (always_invoice + pending_if_incomplete; SCA inline).
// RESPONSE = discriminated union: { status: 'completed' } | { status:
// 'requires_action'; clientSecret } | { status: 'payment_failed'; reason? }.
export const planChange_IO = defineEndpoint<
  ACCOUNT_DTO_API_V1['ACCOUNT_PLAN_CHANGE']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_PLAN_CHANGE']['RESPONSE'],
  ACCOUNT_DTO_API_V1['ACCOUNT_PLAN_CHANGE']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ACCOUNT_PLAN_CHANGE,
  mode: 'post',
});

// Faktura VAT: zapis danych firmowych (name/adres/NIP) na Stripe Customer PRZED
// checkout.confirm(). RESPONSE = { ok: true }. Subform opcjonalny (B2B).
export const saveVatInvoiceDetails_IO = defineEndpoint<
  ACCOUNT_DTO_API_V1['ACCOUNT_VAT_INVOICE_DETAILS']['REQUEST'],
  ACCOUNT_DTO_API_V1['ACCOUNT_VAT_INVOICE_DETAILS']['RESPONSE'],
  ACCOUNT_DTO_API_V1['ACCOUNT_VAT_INVOICE_DETAILS']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.ACCOUNT_VAT_INVOICE_DETAILS,
  mode: 'post',
});
