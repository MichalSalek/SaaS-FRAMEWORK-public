import { describe, expect, it } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  getLowestEligibleUpgradePlan,
  getQuotaFailureFeature,
  getQuotaUpgradeRoute,
  resolveQuotaSnapshot,
} from './quota.helpers';

describe('resolveQuotaSnapshot', () => {
  it('keeps missing or malformed values unknown', () => {
    expect(resolveQuotaSnapshot(undefined, 5)).toEqual({ state: 'unknown' });
    expect(resolveQuotaSnapshot(4, undefined)).toEqual({ state: 'unknown' });
    expect(resolveQuotaSnapshot(-1, 5)).toEqual({ state: 'unknown' });
    expect(resolveQuotaSnapshot(2, -2)).toEqual({ state: 'unknown' });
  });

  it('distinguishes available, exactly one remaining, and exhausted', () => {
    expect(resolveQuotaSnapshot(3, 5)).toEqual({
      state: 'available',
      count: 3,
      limit: 5,
      remaining: 2,
    });
    expect(resolveQuotaSnapshot(4, 5)).toEqual({
      state: 'one_remaining',
      count: 4,
      limit: 5,
      remaining: 1,
    });
    expect(resolveQuotaSnapshot(5, 5)).toEqual({
      state: 'exhausted',
      count: 5,
      limit: 5,
      remaining: 0,
    });
    expect(resolveQuotaSnapshot(6, 5)).toEqual({
      state: 'exhausted',
      count: 6,
      limit: 5,
      remaining: 0,
    });
  });

  it('recognizes only -1 as unlimited', () => {
    expect(resolveQuotaSnapshot(12, -1)).toEqual({
      state: 'unlimited',
      count: 12,
    });
  });
});

describe('getLowestEligibleUpgradePlan', () => {
  it('chooses the first plan that increases each bounded quota', () => {
    expect(getLowestEligibleUpgradePlan('gallery', PricingPlanValue.FREE)).toBe(
      PricingPlanValue.PRO
    );
    expect(getLowestEligibleUpgradePlan('clients', PricingPlanValue.FREE)).toBe(
      PricingPlanValue.PRO
    );
    expect(getLowestEligibleUpgradePlan('pinned', PricingPlanValue.FREE)).toBe(
      PricingPlanValue.PRO
    );
    expect(getLowestEligibleUpgradePlan('staff', PricingPlanValue.FREE)).toBe(
      PricingPlanValue.STUDIO
    );
  });

  it('continues to the next tier for larger pin quotas and unlimited staff', () => {
    expect(
      getLowestEligibleUpgradePlan('pinned', PricingPlanValue.PRO_PLUS)
    ).toBe(PricingPlanValue.STUDIO);
    expect(getLowestEligibleUpgradePlan('staff', PricingPlanValue.STUDIO)).toBe(
      PricingPlanValue.SCALE
    );
    expect(
      getLowestEligibleUpgradePlan('gallery', PricingPlanValue.PRO)
    ).toBeNull();
  });
});

describe('getQuotaUpgradeRoute', () => {
  it('keeps Scale contact-only instead of sending it to self-serve checkout', () => {
    expect(getQuotaUpgradeRoute(PricingPlanValue.SCALE)).toEqual({
      kind: 'contact',
      href: ROUTES_FRONT.CONTACT,
    });
  });

  it('routes self-serve tiers through the in-app payment funnel', () => {
    expect(getQuotaUpgradeRoute(PricingPlanValue.PRO)).toEqual({
      kind: 'pay',
      planId: PricingPlanValue.PRO,
    });
  });
});

describe('getQuotaFailureFeature', () => {
  it('maps backend plan-limit responses to the attempted feature', () => {
    expect(
      getQuotaFailureFeature(
        'gallery',
        APP_EVENTS.INFO.APPLICATION.PLAN_LIMIT_REACHED_INFO,
        { planType: PricingPlanValue.FREE }
      )
    ).toBe('gallery');
    expect(
      getQuotaFailureFeature(
        'staff',
        APP_EVENTS.INFO.APPLICATION.PLAN_LIMIT_REACHED_INFO,
        { planType: PricingPlanValue.STUDIO }
      )
    ).toBe('staff');
    expect(
      getQuotaFailureFeature(
        'pinned',
        APP_EVENTS.INFO.GALLERY.GALLERY_PIN_LIMIT_REACHED,
        { currentPinned: 3, limit: 3 }
      )
    ).toBe('pinned');
  });

  it('does not turn the clients’ platform cap into a stylist upgrade', () => {
    expect(
      getQuotaFailureFeature(
        'clients',
        APP_EVENTS.INFO.APPLICATION.PLAN_LIMIT_REACHED_INFO,
        { planType: 'PLATFORM' }
      )
    ).toBeNull();
    expect(
      getQuotaFailureFeature(
        'clients',
        APP_EVENTS.INFO.APPLICATION.PLAN_LIMIT_REACHED_INFO,
        { planType: 'unknown' }
      )
    ).toBeNull();
  });
});
