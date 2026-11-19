import type Stripe from 'stripe';
import { SUBSCRIPTION_VAT_CONFIG } from '@app/stripe/stripe.config';
import { getStripe } from './adapters/stripe.adapter';
import {
  retryStripeOperation,
  type StripeRetryResult,
} from './stripe-retry.utils';
import { STRIPE_PROJECT_ID } from './stripe.types';

const VAT_TAX_RATE_KIND = 'vat_pl_23' as const;
const VAT_PERCENTAGE = SUBSCRIPTION_VAT_CONFIG.PERCENTAGE;
const TAX_RATE_PAGE_SIZE = 100;

// Module-level cache: the VAT rate is constant for the whole process runtime.
let cachedVatTaxRateId: string | null = null;

const isReusableVatTaxRate = (rate: Stripe.TaxRate): boolean =>
  rate.active === true &&
  rate.metadata?.projectId === STRIPE_PROJECT_ID &&
  rate.metadata?.kind === VAT_TAX_RATE_KIND &&
  rate.percentage === VAT_PERCENTAGE &&
  rate.inclusive === SUBSCRIPTION_VAT_CONFIG.INCLUSIVE &&
  rate.country === SUBSCRIPTION_VAT_CONFIG.COUNTRY &&
  rate.state === null &&
  rate.jurisdiction === 'PL' &&
  rate.tax_type === 'vat';

const findReusableVatTaxRate = async (
  stripe: ReturnType<typeof getStripe>
): Promise<Stripe.TaxRate | null> => {
  let startingAfter: string | null = null;
  type TaxRatePage = {
    data: Stripe.TaxRate[];
    has_more: boolean;
  };

  while (true) {
    const pageCursor: string | null = startingAfter;
    const listResult: StripeRetryResult<TaxRatePage> =
      await retryStripeOperation<TaxRatePage>({
        fn: () =>
          stripe.taxRates.list({
            active: true,
            inclusive: SUBSCRIPTION_VAT_CONFIG.INCLUSIVE,
            limit: TAX_RATE_PAGE_SIZE,
            ...(pageCursor === null ? {} : { starting_after: pageCursor }),
          }),
        namespace: 'STRIPE_VAT_TAX_RATE_LIST',
        payload: {
          kind: VAT_TAX_RATE_KIND,
          ...(pageCursor === null ? {} : { startingAfter: pageCursor }),
        },
      });

    if (listResult.ok === false) {
      const lastAttempt = listResult.attempts[listResult.attempts.length - 1];
      throw new Error(
        lastAttempt?.errorMessage ??
          `Stripe taxRates.list failed after ${listResult.attempts.length} attempts`
      );
    }

    const existing = listResult.value.data.find(isReusableVatTaxRate);
    if (existing !== undefined) {
      return existing;
    }

    if (listResult.value.has_more !== true) {
      return null;
    }

    const lastRate: Stripe.TaxRate | undefined =
      listResult.value.data[listResult.value.data.length - 1];
    if (lastRate === undefined) {
      throw new Error(
        'Stripe taxRates.list returned has_more without a cursor'
      );
    }
    startingAfter = lastRate.id;
  }
};

/** Returns the id of the 23% (PL) VAT rate scoped to Nailfolio; creates it on first use. */
export const getOrCreateVatTaxRate = async (): Promise<string> => {
  if (cachedVatTaxRateId !== null) {
    return cachedVatTaxRateId;
  }

  const stripe = getStripe();
  const existing = await findReusableVatTaxRate(stripe);

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
        inclusive: SUBSCRIPTION_VAT_CONFIG.INCLUSIVE,
        country: SUBSCRIPTION_VAT_CONFIG.COUNTRY,
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
