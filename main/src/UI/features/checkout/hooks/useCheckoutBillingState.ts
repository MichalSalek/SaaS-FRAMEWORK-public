import { useRef, useState } from 'react';
import type { StripeCheckoutContact } from '@stripe/stripe-js';
import {
  normalizeCountryCode,
  type CountryCode,
} from '@kernel/domain/localization/country.config';
import type { CheckoutFormProps } from '../components/CheckoutForm.types';
import {
  checkoutCompanyFingerprint,
  savedCompanyBillingName,
} from '../checkout-company.helpers';
import { useAddressReady } from './useAddressReady';
import { useCheckoutTaxPortal } from './useCheckoutTaxPortal';
import { useVatInvoiceForm } from './useVatInvoiceForm';

export function useCheckoutBillingState({
  country,
  profile,
  addressRequired,
  source,
  planId,
  billingPeriod,
  currency,
  promo,
}: {
  country: CheckoutFormProps['billingCountry'];
  profile: CheckoutFormProps['billingProfile'];
  addressRequired: boolean;
  source: NonNullable<CheckoutFormProps['source']>;
  planId: CheckoutFormProps['planId'];
  billingPeriod: CheckoutFormProps['billingPeriod'];
  currency: NonNullable<CheckoutFormProps['currency']>;
  promo: CheckoutFormProps['promo'];
}) {
  const [sharedAddress, setSharedAddress] =
    useState<StripeCheckoutContact | null>(null);
  const [draftCountry, setDraftCountry] = useState<CountryCode | null>(null);
  const actualCountry = normalizeCountryCode(sharedAddress?.address.country);
  const billingCountry =
    draftCountry ?? actualCountry ?? profile?.country ?? country;
  const vat = useVatInvoiceForm(billingCountry, profile);
  // Stripe provider defaults are frozen for a session; do the same for the address requirement.
  const [needsAddress] = useState(
    () => (profile?.country ?? country) !== 'PL' || addressRequired
  );
  const [addressReady, setReady, readyRef] = useAddressReady(!needsAddress);
  const requiresTaxReview = Boolean(
    (draftCountry ?? actualCountry) &&
    profile?.tax_ids.length &&
    profile.country !== (draftCountry ?? actualCountry)
  );
  const onCountryInput = (value: string | null): boolean => {
    const next = normalizeCountryCode(value);
    setDraftCountry(next);
    return Boolean(
      next && (!profile?.tax_ids.length || profile.country === next)
    );
  };
  const blocked =
    requiresTaxReview || !billingCountry || (needsAddress && !actualCountry);
  const taxPortal = useCheckoutTaxPortal({
    source,
    planId,
    billingPeriod,
    billingCountry,
    currency,
    ...(promo && { promo }),
  });
  const fingerprint = checkoutCompanyFingerprint(vat.form, sharedAddress);
  const billingNameRef = useRef(savedCompanyBillingName(profile));
  return {
    sharedAddress,
    setSharedAddress,
    actualCountry,
    billingCountry,
    vat,
    needsAddress,
    addressReady,
    setReady,
    readyRef,
    requiresTaxReview,
    onCountryInput,
    blocked,
    taxPortal,
    fingerprint,
    billingNameRef,
  };
}
