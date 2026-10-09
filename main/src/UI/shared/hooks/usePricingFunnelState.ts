// UI/shared/hooks/usePricingFunnelState.ts
// Wave W3 (SPE — web-login-first): carries the plan a visitor picked on
// /pricing across the login → onboarding → pay funnel so the in-app pay page
// (Wave W2) can pre-select it instead of dropping the choice at the auth gate.
//
// STORAGE: sessionStorage via the clientStorage adapter (STORAGE_KEYS.PRICING_FUNNEL)
//   — session-scoped because the intent is a single funnel run, not a durable
//   preference. NEVER a raw localStorage/getItem call (audit:storage-keys).
//
// HYBRID PRECEDENCE (deep-link override):
//   URL query (`?planId=&billingPeriod=`) WINS over the stored value, so a
//   shared/bookmarked deep-link to the pay page always reflects the link's
//   plan, even if an earlier funnel run stored a different one. Stored value is
//   the fallback for the normal in-app navigation that drops the query.
//
// SHAPE: { planId: PricingPlan, billingPeriod: BillingPeriod } using the KERNEL
//   types (PricingPlan = FREE|PRO|PRO_PLUS|STUDIO|SCALE, BillingPeriod =
//   'month'|'year') — the exact contract the checkout-session endpoint expects,
//   so nothing has to re-map at the point of payment.

import { useCallback } from 'react';
import { useRouter } from 'next/router';
import {
  PricingPlanValue,
  type PricingPlan,
} from '@kernel/domain/pricing/pricing.config';
import type { BillingPeriod } from '@kernel/domain/user-and-account/account-checkout.types';
import { STORAGE_KEYS } from '../../../application/client-device-storage/storage-keys.config';
import {
  deleteFromClientStorage,
  getFromClientStorage,
  setToClientStorage,
} from '../../../application/client-device-storage/clientStorage.possibilities.api';

/** The plan choice carried through the funnel. Kernel types end-to-end. */
interface PricingFunnelState {
  planId: PricingPlan;
  billingPeriod: BillingPeriod;
  /** Optional `?promo=` from a lifecycle email. Cleared with the rest on logout. */
  promo?: string;
}

// SPE: the funnel carries only SELF-SERVE plans. SCALE is contact-only (no Stripe
// product / checkout) — accepting it via a crafted `?planId=SCALE` deep-link would
// dead-end the onboarding panel on CHECKOUT_PLAN_NOT_FOUND with an infinite Retry
// (onboarding has no plan-picker; it seeds straight from the funnel). FREE is fine
// (backend returns free_selected). A SCALE/unknown planId falls through to null,
// so the consumer shows no preselection (the user picks on the chooser, FP2)
// instead of trapping the user on a dead-end plan.
const VALID_PLAN_IDS: ReadonlySet<string> = new Set(
  Object.values(PricingPlanValue).filter(p => p !== PricingPlanValue.SCALE)
);
const VALID_BILLING_PERIODS: ReadonlySet<string> = new Set<BillingPeriod>([
  'month',
  'year',
]);

/** Narrow an untrusted string to a `PricingPlan`, or null. */
function parsePlanId(raw: string | null | undefined): PricingPlan | null {
  return raw != null && VALID_PLAN_IDS.has(raw) ? (raw as PricingPlan) : null;
}

/** Narrow an untrusted string to a `BillingPeriod`, or null. */
function parseBillingPeriod(
  raw: string | null | undefined
): BillingPeriod | null {
  return raw != null && VALID_BILLING_PERIODS.has(raw)
    ? (raw as BillingPeriod)
    : null;
}

/** First value of a Next.js query field (string | string[] | undefined). */
function firstQueryValue(
  raw: string | string[] | undefined
): string | undefined {
  if (typeof raw === 'string') {
    return raw;
  }
  if (Array.isArray(raw)) {
    return raw[0];
  }
  return undefined;
}

/**
 * Build a complete `PricingFunnelState` from URL query, or null when the query
 * does not fully describe a plan choice. BOTH fields must be present + valid —
 * a half-specified query (planId without billingPeriod) is ignored so the
 * sessionStorage fallback (which is always complete) wins instead.
 */
const PROMO_PATTERN = /^[A-Za-z0-9-]{1,40}$/;

function parsePromo(raw: string | null | undefined): string | undefined {
  if (raw == null || !PROMO_PATTERN.test(raw)) {
    return undefined;
  }
  return raw;
}

function readFromQuery(
  query: ReturnType<typeof useRouter>['query']
): PricingFunnelState | null {
  const planId = parsePlanId(firstQueryValue(query['planId']));
  const billingPeriod = parseBillingPeriod(
    firstQueryValue(query['billingPeriod'])
  );
  if (planId === null || billingPeriod === null) {
    return null;
  }
  const promo = parsePromo(firstQueryValue(query['promo']));
  return promo ? { planId, billingPeriod, promo } : { planId, billingPeriod };
}

/** Read + validate the stored funnel state from sessionStorage, or null. */
function readFromStorage(): PricingFunnelState | null {
  const raw = getFromClientStorage({ key: STORAGE_KEYS.PRICING_FUNNEL });
  if (raw == null || raw === '') {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return null;
  }
  const record = parsed as Record<string, unknown>;
  const planId = parsePlanId(
    typeof record['planId'] === 'string' ? record['planId'] : null
  );
  const billingPeriod = parseBillingPeriod(
    typeof record['billingPeriod'] === 'string' ? record['billingPeriod'] : null
  );
  if (planId === null || billingPeriod === null) {
    return null;
  }
  const promo = parsePromo(
    typeof record['promo'] === 'string' ? record['promo'] : null
  );
  return promo ? { planId, billingPeriod, promo } : { planId, billingPeriod };
}

interface UsePricingFunnelState {
  /** Persist the chosen plan to sessionStorage (entry into the funnel). */
  setPricingFunnel: (state: PricingFunnelState) => void;
  /**
   * Resolve the active plan choice. URL query takes precedence (deep-link
   * override); sessionStorage is the fallback. Returns null when neither
   * source describes a complete, valid choice.
   */
  getPricingFunnel: () => PricingFunnelState | null;
  /** Drop the stored funnel state (call on consumption in pay, or on logout). */
  clearPricingFunnel: () => void;
}

export function usePricingFunnelState(): UsePricingFunnelState {
  const router = useRouter();

  const setPricingFunnel = useCallback((state: PricingFunnelState): void => {
    setToClientStorage({
      key: STORAGE_KEYS.PRICING_FUNNEL,
      value: JSON.stringify(state),
      sessionOnly: true,
    });
  }, []);

  const getPricingFunnel = useCallback((): PricingFunnelState | null => {
    // Hybrid precedence: a fully-specified URL query wins over the stored value.
    return readFromQuery(router.query) ?? readFromStorage();
  }, [router.query]);

  const clearPricingFunnel = useCallback((): void => {
    deleteFromClientStorage({ key: STORAGE_KEYS.PRICING_FUNNEL });
  }, []);

  return { setPricingFunnel, getPricingFunnel, clearPricingFunnel };
}

/**
 * Generic stylist-LP signup CTA: CLEAR any stored plan intent, then route to
 * `href`. Single source for the pair shared by the static pages (Home, Compare,
 * ForStylists) and the blog CTA. PricingPage is NOT a caller: a plan card there
 * carries an explicit plan/billing funnel (its own SSOT), and only that explicit
 * choice takes the stylist through the payment step in onboarding.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Free-first entry (owner 2026-09-23, reverses the 2026-07-14 trial-forward
 * preselection, DOMAIN_SSOT §18). A new stylist starts on Free with no plan
 * decision and no card; the 30-day Pro trial is offered in the app at the moment
 * of value (3rd photo, limits). Clearing here matters: a funnel left over from an
 * earlier pricing-page visit would otherwise route a generic signup into
 * checkout.
 */
export function useFreeSignupCta(href: string): () => void {
  const router = useRouter();
  const { clearPricingFunnel } = usePricingFunnelState();
  return useCallback((): void => {
    clearPricingFunnel();
    void router.push(href);
  }, [router, clearPricingFunnel, href]);
}
