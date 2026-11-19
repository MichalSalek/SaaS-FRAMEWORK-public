import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import {
  isBillingCurrency,
  normalizeCountryCode,
  type BillingCurrency,
  type CountryCode,
} from '@kernel/domain/localization/country.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import {
  deleteFromClientStorage,
  getFromClientStorage,
  setToClientStorage,
} from '../../../application/client-device-storage/clientStorage.possibilities.api';

const KEY = 'nf:checkout-tax-portal';
const TTL_MS = 30 * 60_000;
export interface CheckoutPortalIntent {
  userId: string;
  source: 'onboarding' | 'account-pay';
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  billingCountry: CountryCode;
  currency: BillingCurrency;
  promo?: string;
  createdAt: number;
}
export function saveCheckoutPortalIntent(intent: CheckoutPortalIntent): void {
  setToClientStorage({
    key: KEY,
    value: JSON.stringify(intent),
    sessionOnly: true,
  });
}
export function clearCheckoutPortalIntent(): void {
  deleteFromClientStorage({ key: KEY });
}
export function readCheckoutPortalIntent(
  userId: string
): CheckoutPortalIntent | null {
  const raw = getFromClientStorage({ key: KEY });
  if (!raw) {
    return null;
  }
  try {
    const v: unknown = JSON.parse(raw);
    if (v === null || typeof v !== 'object') {
      return null;
    }
    const item = v as Record<string, unknown>;
    if (
      item['userId'] !== userId ||
      (item['source'] !== 'onboarding' && item['source'] !== 'account-pay') ||
      typeof item['createdAt'] !== 'number' ||
      item['createdAt'] > Date.now() ||
      Date.now() - item['createdAt'] > TTL_MS ||
      typeof item['planId'] !== 'string' ||
      !Object.values(PricingPlanValue).includes(
        item['planId'] as PricingPlan
      ) ||
      item['planId'] === PricingPlanValue.FREE ||
      item['planId'] === PricingPlanValue.SCALE ||
      (item['billingPeriod'] !== 'month' && item['billingPeriod'] !== 'year') ||
      typeof item['billingCountry'] !== 'string' ||
      normalizeCountryCode(item['billingCountry']) !== item['billingCountry'] ||
      typeof item['currency'] !== 'string' ||
      !isBillingCurrency(item['currency'])
    ) {
      return null;
    }
    return item as unknown as CheckoutPortalIntent;
  } catch {
    return null;
  }
}
