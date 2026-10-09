import { getStripe } from './adapters/stripe.adapter';
import { retryStripeOperation } from './stripe-retry.utils';
import { STRIPE_PROJECT_ID } from './stripe.types';

/**
 * Faktura VAT — get-or-create polskiej stawki VAT 23% (usługa elektroniczna).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Nie zakładamy, że obiekty na koncie Stripe należą do tej aplikacji. Tax rate to
 * globalny obiekt konta (nie per-account), więc MUSI być scope'owany metadatą
 * `{ projectId: STRIPE_PROJECT_ID, kind: 'vat_pl_23' }` — inaczej reuse po samym
 * `percentage:23` mógłby złapać stawkę spoza zakresu aplikacji (parytet ze scope'em customerów
 * `getOrCreateStripeCustomer` i cen `isScopedToNailfolio`). Szukamy PO metadacie
 * przez `taxRates.list({active:true, limit:100})` → find; brak → create.
 *
 * Cache module-level (jak customer): stawka VAT jest niezmienna dla całego procesu,
 * więc pierwsze wywołanie robi round-trip do Stripe, kolejne zwracają z cache.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Świadomie AKCEPTUJEMY teoretyczny wyścig „dwa równoległe create" przy pierwszym
 * w życiu checkoutcie (obie ścieżki nie znajdą stawki i obie ją utworzą). Duplikat
 * jest NIESZKODLIWY — obie stawki są identyczne (23% PL VAT), a `find` deterministy-
 * cznie wybiera pierwszą z listy przy kolejnych wywołaniach. Locking dla jednorazowej
 * inicjalizacji konfiguracji byłby over-engineeringiem (owner tworzy stawkę raz przy
 * pierwszym realnym checkoutcie; potem żyje z cache i Stripe).
 */

const VAT_TAX_RATE_KIND = 'vat_pl_23' as const;
const VAT_PERCENTAGE = 23;

// Module-level cache — stawka VAT jest stała dla całego runtime procesu.
let cachedVatTaxRateId: string | null = null;

/** Zwraca id stawki VAT 23% (PL) scope'owanej do Nailfolio; tworzy przy pierwszym użyciu. */
export const getOrCreateVatTaxRate = async (): Promise<string> => {
  if (cachedVatTaxRateId !== null) {
    return cachedVatTaxRateId;
  }

  const stripe = getStripe();

  // 1. Szukaj istniejącej stawki po metadacie (scope + kind).
  const listResult = await retryStripeOperation({
    fn: () => stripe.taxRates.list({ active: true, limit: 100 }),
    namespace: 'STRIPE_VAT_TAX_RATE_LIST',
    payload: { kind: VAT_TAX_RATE_KIND },
  });

  if (!listResult.ok) {
    const lastAttempt = listResult.attempts[listResult.attempts.length - 1];
    throw new Error(
      lastAttempt?.errorMessage ??
        `Stripe taxRates.list failed after ${listResult.attempts.length} attempts`
    );
  }

  const existing = listResult.value.data.find(
    rate =>
      rate.metadata?.projectId === STRIPE_PROJECT_ID &&
      rate.metadata?.kind === VAT_TAX_RATE_KIND
  );

  if (existing) {
    cachedVatTaxRateId = existing.id;
    return existing.id;
  }

  // 2. Brak → utwórz stawkę VAT 23% (PL, usługa elektroniczna).
  const createResult = await retryStripeOperation({
    fn: () =>
      stripe.taxRates.create({
        display_name: 'VAT',
        description: 'VAT 23% (PL, usluga elektroniczna)',
        percentage: VAT_PERCENTAGE,
        inclusive: false,
        country: 'PL',
        jurisdiction: 'PL',
        tax_type: 'vat',
        metadata: {
          projectId: STRIPE_PROJECT_ID,
          kind: VAT_TAX_RATE_KIND,
        },
      }),
    namespace: 'STRIPE_VAT_TAX_RATE_CREATE',
    payload: { kind: VAT_TAX_RATE_KIND },
  });

  if (!createResult.ok) {
    const lastAttempt = createResult.attempts[createResult.attempts.length - 1];
    throw new Error(
      lastAttempt?.errorMessage ??
        `Stripe taxRates.create failed after ${createResult.attempts.length} attempts`
    );
  }

  cachedVatTaxRateId = createResult.value.id;
  return createResult.value.id;
};
