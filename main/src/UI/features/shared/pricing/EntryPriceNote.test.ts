import { describe, it, expect } from 'vitest';
import { UserIcon } from '@phosphor-icons/react';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { selectEntryPrice } from './EntryPriceNote.molecule';
import type { PricingPlanCard } from './hooks/usePricingPlans';

/** A plan card with the fields selectEntryPrice reads; the rest is filler. */
const plan = (
  id: PricingPlanCard['id'],
  priceMonthly: number | null,
  priceYearly: number | null,
  isCustom = false
): PricingPlanCard => ({
  id,
  name: id,
  priceMonthly,
  priceYearly,
  priceYearlyTotal: priceYearly === null ? null : priceYearly * 12,
  icon: UserIcon,
  features: [],
  ...(isCustom ? { isCustom: true } : {}),
});

describe('selectEntryPrice', () => {
  it('bierze najtańszy płatny plan miesięczny i przelicza grosze na złote', () => {
    const result = selectEntryPrice([
      plan(PricingPlanValue.FREE, 0, 0),
      plan(PricingPlanValue.PRO, 7900, 6300),
      plan(PricingPlanValue.PRO_PLUS, 10900, 8700),
      plan(PricingPlanValue.STUDIO, 17900, 14300),
    ]);
    expect(result).toEqual({ monthly: 7900, yearly: 6300, yearlyTotal: 75600 });
  });

  it('pomija FREE — zero to osobna kategoria, nie „najtaniej"', () => {
    const result = selectEntryPrice([
      plan(PricingPlanValue.FREE, 0, 0),
      plan(PricingPlanValue.PRO, 7900, 6300),
    ]);
    expect(result?.monthly).toBe(7900);
  });

  it('pomija plan kontaktowy (SCALE), bo jego cena to null', () => {
    const result = selectEntryPrice([
      plan(PricingPlanValue.PRO, 7900, 6300),
      plan(PricingPlanValue.SCALE, null, null, true),
    ]);
    expect(result).toEqual({ monthly: 7900, yearly: 6300, yearlyTotal: 75600 });
  });

  it('zwraca null, gdy Stripe nie oddał ŻADNEJ ceny płatnego planu', () => {
    // Backend fallback: FREE=0 is always right, paid ones arrive as null.
    const result = selectEntryPrice([
      plan(PricingPlanValue.FREE, 0, 0),
      plan(PricingPlanValue.PRO, null, null),
      plan(PricingPlanValue.STUDIO, null, null),
    ]);
    expect(result).toBeNull();
  });

  it('oddaje samą cenę miesięczną, gdy brak cen rocznych', () => {
    const result = selectEntryPrice([plan(PricingPlanValue.PRO, 7900, null)]);
    expect(result).toEqual({ monthly: 7900, yearly: null, yearlyTotal: null });
  });

  it('zachowuje grosze bez zaokrąglania', () => {
    const result = selectEntryPrice([plan(PricingPlanValue.PRO, 7950, null)]);
    expect(result?.monthly).toBe(7950);
  });
});

it('keeps the full Stripe yearly total instead of multiplying the rounded monthly equivalent', () => {
  const p = plan(PricingPlanValue.PRO, 6050, 4800);
  expect(selectEntryPrice([{ ...p, priceYearlyTotal: 57599 }])).toEqual({
    monthly: 6050,
    yearly: 4800,
    yearlyTotal: 57599,
  });
});
