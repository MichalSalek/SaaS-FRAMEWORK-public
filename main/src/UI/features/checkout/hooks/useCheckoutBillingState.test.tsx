import { act, renderHook } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { useCheckoutBillingState } from './useCheckoutBillingState';

const portal = vi.hoisted(() => vi.fn());
vi.mock('./useCheckoutTaxPortal', () => ({
  useCheckoutTaxPortal: (intent: unknown) => {
    portal(intent);
    return { busy: false, isBusy: () => false, open: vi.fn() };
  },
}));
vi.mock('./useVatInvoiceForm', () => ({
  useVatInvoiceForm: () => ({ isOn: true, form: { companyName: 'Salon' } }),
}));

it('reviews a different entered address before Stripe update, with the original session currency', () => {
  const profile = {
    has_customer: true,
    has_company_details: true,
    company_name: 'Salon',
    country: 'PL' as const,
    address_line1: 'Street',
    address_city: 'Krakow',
    address_postal_code: '30-001',
    address_state: null,
    tax_ids: [
      { type: 'eu_vat', value: 'PL1234567890', verification_status: null },
    ],
  };
  const { result } = renderHook(() =>
    useCheckoutBillingState({
      country: 'PL',
      profile,
      addressRequired: true,
      source: 'account-pay',
      planId: PricingPlanValue.PRO,
      billingPeriod: 'month',
      currency: 'eur',
      promo: undefined,
    })
  );
  let allowed = true;
  act(() => {
    allowed = result.current.onCountryInput('US');
  });
  expect(allowed).toBe(false);
  expect(result.current.requiresTaxReview).toBe(true);
  expect(result.current.blocked).toBe(true);
  expect(portal).toHaveBeenLastCalledWith(
    expect.objectContaining({ billingCountry: 'US', currency: 'eur' })
  );
  act(() => {
    allowed = result.current.onCountryInput('PL');
  });
  expect(allowed).toBe(true);
  expect(result.current.requiresTaxReview).toBe(false);
});
