import type { PricingPlan } from '../pricing/pricing.config';

/**
 * SPE (Stripe Plan Choice + Embedded Payments) — kontrakt wyboru planu + płatności.
 *
 * SSOT kształtu request/response dla endpointów `account/checkout-session`
 * i `account/plan-change`. Reużywany przez `ACCOUNT_DTO_API_V1` (models/account)
 * oraz walidatory zod (policies/validation/account.validation).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Response = discriminated union po `mode` (D9). Front robi exhaustive switch:
 *  - `free_selected`     — plan FREE wybrany, ZERO Stripe (brak customer/session/karty).
 *  - `checkout_elements` — embedded Payment Element renderowany WEWNĄTRZ appki/web
 *                          (native feel, zero browser-smell — cały sens SPE). `clientSecret`
 *                          z Checkout Session `ui_mode:'custom'` (SDK stripe 20.2.0 —
 *                          'elements' nie istnieje na tej wersji; patrz DECISION w
 *                          account-embedded-checkout.operations.ts).
 *  - `hosted_fallback`   — kontrolowany redirect na hosted Stripe Checkout (za flagą,
 *                          gdy embedded wyłączony/awaria). Swap-able payment-surface.
 */

export type BillingPeriod = 'month' | 'year';

export type CheckoutSessionRequest = {
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  source?: string;
  /**
   * Human-readable promotion code from a lifecycle email (`?promo=`).
   * Invalid or expired codes do not fail checkout; the response sets
   * `promoRejected` and the session is minted at full price.
   */
  promo?: string;
};

export type CheckoutSessionResponse =
  | { mode: 'free_selected' }
  | {
      mode: 'checkout_elements';
      clientSecret: string;
      checkoutSessionId: string;
      returnUrl: string;
      /** Present only when the request carried a promo the server refused. */
      promoRejected?: boolean;
    }
  | {
      mode: 'hosted_fallback';
      url: string;
      checkoutSessionId: string;
      promoRejected?: boolean;
    };

export type PlanChangeRequest = {
  targetPlanId: PricingPlan;
  billingPeriod: BillingPeriod;
};

/**
 * Zmiana planu paid->paid (D4): `subscription.update` z `payment_behavior:'pending_if_incomplete'`
 * + `proration_behavior:'always_invoice'` (cena aplikuje sie do subskrypcji DOPIERO po udanej
 * platnosci proracyjnej faktury; SSOT planu w DB ustawia webhook pending_update_applied).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Discriminated union po `status` (D11). Front robi exhaustive switch — dodanie statusu WYMUSZA
 * obsluge w usePlanChange.ts compile-time (zamyka klase "fałszywy completed na nieoplaconej fakturze").
 *  - `completed`        — prorata naliczona i opłacona (karta on-file one-tap) LUB downgrade/credit
 *                         z amount_due<=0 (zmiana aplikuje sie bez platnosci). Bez clientSecret.
 *  - `requires_action`  — SCA/3DS inline: nieoplacona faktura + `latest_invoice.confirmation_secret`
 *                         (Basil API; NIE payment_intent). `clientSecret` WYMAGANY -> Stripe SDK
 *                         handleNextAction. Cena trzymana w `pending_update` do potwierdzenia.
 *  - `payment_failed`   — platnosc nieudana BEZ actionable secret (np. hard-decline / brak metody):
 *                         faktura nieoplacona, plan NIE przelaczony, `pending_update` czeka/wygasa.
 *                         Front pokazuje BLAD (nie sukces). `reason` = opcjonalny kod diagnostyczny.
 */
export type PlanChangeResponse =
  | { status: 'completed' }
  | { status: 'requires_action'; clientSecret: string }
  | { status: 'payment_failed'; reason?: string };

/**
 * Faktura VAT — dane firmowe kupującego (opcjonalny subform w checkoutcie).
 *
 * DECISION (nie usuwaj tego komentarza):
 * VAT 23% dolicza się do KAŻDEJ płatności (ceny na LP = netto, owner). Ten
 * request jest OPCJONALNY: wysyłany tylko gdy kupujący włączy „Faktura na firmę"
 * i chce faktury z własnym NIP + adresem. B2C i tak dostaje fakturę VAT (bez NIP),
 * więc brak tego requestu ≠ brak VAT. `country` nie jest w DTO — sprzedawca to
 * polski podatnik VAT, adres firmowy zawsze PL (backend hardcode 'PL').
 */
export type VatInvoiceDetailsRequest = {
  companyName: string;
  nip: string;
  addressLine1: string;
  addressCity: string;
  addressPostalCode: string;
};

export type VatInvoiceDetailsResponse = { ok: true };
