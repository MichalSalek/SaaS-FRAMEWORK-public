import { describe, it, expect } from 'vitest';
import { UserIcon } from '@phosphor-icons/react';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { selectEntryPrice } from './EntryPriceNote.molecule';
import type { PricingPlanCard } from './hooks/usePricingPlans';

/** Karta planu z polami, które czyta selectEntryPrice; reszta to wypełniacz. */
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
    expect(result).toEqual({ monthly: '79', yearly: '63' });
  });

  it('pomija FREE — zero to osobna kategoria, nie „najtaniej"', () => {
    const result = selectEntryPrice([
      plan(PricingPlanValue.FREE, 0, 0),
      plan(PricingPlanValue.PRO, 7900, 6300),
    ]);
    expect(result?.monthly).toBe('79');
  });

  it('pomija plan kontaktowy (SCALE), bo jego cena to null', () => {
    const result = selectEntryPrice([
      plan(PricingPlanValue.PRO, 7900, 6300),
      plan(PricingPlanValue.SCALE, null, null, true),
    ]);
    expect(result).toEqual({ monthly: '79', yearly: '63' });
  });

  it('zwraca null, gdy Stripe nie oddał ŻADNEJ ceny płatnego planu', () => {
    // Fallback backendu: FREE=0 jest zawsze poprawne, płatne przychodzą jako null.
    const result = selectEntryPrice([
      plan(PricingPlanValue.FREE, 0, 0),
      plan(PricingPlanValue.PRO, null, null),
      plan(PricingPlanValue.STUDIO, null, null),
    ]);
    expect(result).toBeNull();
  });

  it('oddaje samą cenę miesięczną, gdy brak cen rocznych', () => {
    const result = selectEntryPrice([plan(PricingPlanValue.PRO, 7900, null)]);
    expect(result).toEqual({ monthly: '79', yearly: null });
  });

  it('zaokrągla do pełnych złotych, tak jak PriceSlot', () => {
    const result = selectEntryPrice([plan(PricingPlanValue.PRO, 7950, null)]);
    expect(result?.monthly).toBe('80');
  });
});
