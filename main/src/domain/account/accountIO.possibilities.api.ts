import { contractEndpoint } from '../../application/http/io';
import { ACCOUNT_CONTRACTS } from '@kernel/domain/account/account.contracts';

// The `account` domain calls go through the kernel contract. Every `_IO` returns
// `Promise<Res>` and hooks call it directly. Side effects after the response
// live in the hooks' TanStack Query callbacks.

export const incrementProfileView_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_INCREMENT_VIEW,
  {
    // Fire-and-forget view counter (StylistProfilePage): nobody asked for it, so no failure
    // (503 AUTH_UNAVAILABLE included) may toast; the caller swallows the rejection.
    errorFeedbackPolicy: 'background',
  }
);

/* ─── Dashboard feed ─── */

export const getDashboardFeed_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_GET_DASHBOARD_FEED
);

/* ─── Dashboard note ─── */

export const getDashboardNote_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_GET_DASHBOARD_NOTE
);

export const setDashboardNote_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_SET_DASHBOARD_NOTE
);

// updateStylistProfile_IO replaces setLocation_IO, setVanityUrl_IO and updateStylistSocialLinks_IO:
// one endpoint posts all 3 dirty sub-sections in one atomic backend $transaction, so the frontend
// collapses 3 mutations into 1 click, 1 round trip and 1 success/error toast.
export const updateStylistProfile_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.UPDATE_STYLIST_PROFILE
);

// Public name of the stylist account. Onboarding no longer asks for it (owner), so the card after the first photo sets it here; the backend
// also gives the profile its address when it has none yet.
export const changeDisplayName_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_DISPLAY_NAME_CHANGE
);

// Zamknięcie karty „Siła galerii": żądanie bez treści, konto z sesji.
export const dismissGalleryStrength_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_DISMISS_GALLERY_STRENGTH
);

export const getPublicProfile_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_GET_PUBLIC_PROFILE
);

export const createPortalSession_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_STRIPE_PORTAL,
  { successFeedback: 'silent' }
);

export const getBillingProfile_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_BILLING_PROFILE,
  { successFeedback: 'silent', errorFeedbackPolicy: 'background' }
);

// SUPERSEDED (W5): startTrial_IO removed — the standalone "start trial" flow is
// replaced by the embedded checkout (checkoutSession_IO). A trial-eligible
// stylist now claims the trial INSIDE PlanCheckoutPanel (card captured, charged
// after the trial), not via a separate hosted-redirect endpoint. The backend
// route was fully removed (kernel event + routing + DTO + handler).

/* ─── SPE (W2): plan-choice + embedded payments ─── */

// Dispatcher wyboru planu. RESPONSE = discriminated union po `mode`
// (free_selected | checkout_elements | hosted_fallback) — patrz
// account-checkout.types. Front robi exhaustive switch w PlanCheckoutPanel.
export const checkoutSession_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_CHECKOUT_SESSION
);

// Zmiana planu paid->paid (always_invoice + pending_if_incomplete; SCA inline).
// RESPONSE = discriminated union: { status: 'completed' } | { status:
// 'requires_action'; clientSecret } | { status: 'payment_failed'; reason? }.
export const planChange_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_PLAN_CHANGE
);

export const previewPlanChange_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_PLAN_CHANGE_PREVIEW,
  { successFeedback: 'silent', errorFeedbackPolicy: 'background' }
);

// Faktura VAT: zapis danych firmowych (name/adres/NIP) na Stripe Customer PRZED
// checkout.confirm(). RESPONSE = { ok: true }. Subform opcjonalny (B2B).
export const saveVatInvoiceDetails_IO = contractEndpoint(
  ACCOUNT_CONTRACTS.ACCOUNT_VAT_INVOICE_DETAILS
);
