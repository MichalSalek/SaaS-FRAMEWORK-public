// usePricingFunnelState.test.ts
// SPE (Wave W3) — plan-funnel state carried across login → onboarding → pay.
//
// Asserts the hybrid precedence contract:
//   - URL query (deep-link) WINS over sessionStorage,
//   - sessionStorage is the fallback when the URL query is absent/incomplete,
//   - set/get/clear roundtrip via the clientStorage adapter (sessionOnly).
//
// Strategy: mock next/router so we control router.query; drive the REAL jsdom
// sessionStorage through the clientStorage adapter (no storage mock — kernel types
// end-to-end). STORAGE_KEYS.PRICING_FUNNEL is the SSOT key (audit:storage-keys).

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook } from '@testing-library/react';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { STORAGE_KEYS } from '../../../application/client-device-storage/storage-keys.config';

// Mutable query the mocked router serves. Reset per test.
const routerQuery: { value: Record<string, string | string[] | undefined> } = {
  value: {},
};

vi.mock('next/router', () => ({
  useRouter: () => ({ query: routerQuery.value }),
}));

import { usePricingFunnelState } from './usePricingFunnelState';

const renderFunnel = () => renderHook(() => usePricingFunnelState()).result;

describe('usePricingFunnelState — SPE plan-funnel hybrid precedence', () => {
  beforeEach(() => {
    routerQuery.value = {};
    sessionStorage.clear();
    localStorage.clear();
  });

  it('set → get roundtrip via sessionStorage when no URL query', () => {
    const result = renderFunnel();

    result.current.setPricingFunnel({
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });

    // Persisted under the SSOT key.
    expect(sessionStorage.getItem(STORAGE_KEYS.PRICING_FUNNEL)).not.toBeNull();

    expect(result.current.getPricingFunnel()).toEqual({
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });
  });

  it('URL query takes precedence over sessionStorage (deep-link override)', () => {
    routerQuery.value = {
      planId: PricingPlanValue.STUDIO,
      billingPeriod: 'year',
    };
    const result = renderFunnel();

    // Stored value differs from the deep-link query.
    result.current.setPricingFunnel({
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });

    // Deep-link wins.
    expect(result.current.getPricingFunnel()).toEqual({
      planId: PricingPlanValue.STUDIO,
      billingPeriod: 'year',
    });
  });

  it('falls back to sessionStorage when URL query is incomplete (planId without billingPeriod)', () => {
    routerQuery.value = { planId: PricingPlanValue.STUDIO }; // half-specified → ignored.
    const result = renderFunnel();

    result.current.setPricingFunnel({
      planId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    });

    expect(result.current.getPricingFunnel()).toEqual({
      planId: PricingPlanValue.PRO_PLUS,
      billingPeriod: 'month',
    });
  });

  it('returns null when neither URL query nor storage describes a complete choice', () => {
    const result = renderFunnel();
    expect(result.current.getPricingFunnel()).toBeNull();
  });

  it('ignores an invalid stored planId (returns null)', () => {
    // Intentional invalid value — tests rejection of a corrupt stored planId.
    const corrupt = JSON.stringify({ planId: 'BOGUS', billingPeriod: 'month' }); // planid-literal-allow: invalid-value rejection test
    sessionStorage.setItem(STORAGE_KEYS.PRICING_FUNNEL, corrupt);
    const result = renderFunnel();
    expect(result.current.getPricingFunnel()).toBeNull();
  });

  it('clear removes the stored funnel state', () => {
    const result = renderFunnel();

    result.current.setPricingFunnel({
      planId: PricingPlanValue.PRO,
      billingPeriod: 'year',
    });
    expect(result.current.getPricingFunnel()).not.toBeNull();

    result.current.clearPricingFunnel();
    expect(sessionStorage.getItem(STORAGE_KEYS.PRICING_FUNNEL)).toBeNull();
    expect(result.current.getPricingFunnel()).toBeNull();
  });

  it('rejects a deep-link query with an invalid billingPeriod (falls back to storage)', () => {
    routerQuery.value = {
      planId: PricingPlanValue.PRO,
      billingPeriod: 'weekly',
    };
    const result = renderFunnel();

    result.current.setPricingFunnel({
      planId: PricingPlanValue.STUDIO,
      billingPeriod: 'year',
    });

    // Invalid query billingPeriod → query ignored → storage wins.
    expect(result.current.getPricingFunnel()).toEqual({
      planId: PricingPlanValue.STUDIO,
      billingPeriod: 'year',
    });
  });

  it('keeps a valid promo from the query and drops a malformed one', () => {
    routerQuery.value = {
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      promo: 'ANNA-7K2Q',
    };
    const withCode = renderFunnel();
    expect(withCode.current.getPricingFunnel()).toEqual({
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      promo: 'ANNA-7K2Q',
    });

    routerQuery.value = {
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      promo: 'has space',
    };
    const malformed = renderFunnel();
    expect(malformed.current.getPricingFunnel()).toEqual({
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
    });
  });
});
