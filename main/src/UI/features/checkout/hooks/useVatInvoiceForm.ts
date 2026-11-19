// UI/features/checkout/hooks/useVatInvoiceForm.ts
// VAT invoice — state + validation + save of the „Faktura na firmę" subform. Split out of
// CheckoutForm (a concern orthogonal to the payment state machine) to keep CheckoutForm within the
// max-lines limit. Validation reuses the kernel validators (NIP checksum, PL postal code) via
// fieldValidators.

import { useEffect, useState } from 'react';
import {
  requiredFieldError,
  postalCodePlFieldError,
} from '../../../../application/forms/fieldValidators';
import { useSaveVatInvoiceDetails } from './useSaveVatInvoiceDetails';
import {
  normalizeCountryCode,
  type CountryCode,
} from '@kernel/domain/localization/country.config';
import type { BillingProfile } from '@kernel/domain/account/billing-profile.contract-schemas';
import { isStripeTaxIdType, taxIdTypesForCountry } from '../tax-id-types';
import type { StripeCheckoutContact } from '@stripe/stripe-js';

export interface VatFormState {
  companyName: string;
  addressLine1: string;
  addressLine2: string;
  addressCity: string;
  addressPostalCode: string;
  nip: string;
  taxIdType: string;
  addressState: string;
}

export type VatFieldErrors = Partial<Record<keyof VatFormState, string>>;

/** Komunikaty walidacji (z i18n tx) wstrzykiwane do walidatora. */
export interface VatValidationMessages {
  required: string;
  postalInvalid: string;
  nipInvalid: string;
}

const EMPTY_VAT_FORM: VatFormState = {
  companyName: '',
  addressLine1: '',
  addressLine2: '',
  addressCity: '',
  addressPostalCode: '',
  nip: '',
  taxIdType: '',
  addressState: '',
};

export interface UseVatInvoiceForm {
  isOn: boolean;
  setIsOn: (on: boolean) => void;
  form: VatFormState;
  line2Known: boolean;
  savedTaxIds: BillingProfile['tax_ids'];
  savedCompanyName: string | null;
  hasSavedCompany: boolean;
  errors: VatFieldErrors;
  setField: (field: keyof VatFormState, value: string) => void;
  /** Validates all fields; sets per-field errors; returns true when OK. */
  validate: (
    messages: VatValidationMessages,
    sharedAddress?: StripeCheckoutContact | null
  ) => boolean;
  /** Saves the trimmed company data on the Stripe Customer (throws on error). */
  save: (sharedAddress?: StripeCheckoutContact | null) => Promise<void>;
}

export function useVatInvoiceForm(
  country: CountryCode | undefined,
  profile?: BillingProfile
): UseVatInvoiceForm {
  const saveVatInvoice = useSaveVatInvoiceDetails();
  const matchingProfile = profile;
  const [isOn, setIsOn] = useState(
    matchingProfile?.has_company_details === true
  );
  const [form, setForm] = useState<VatFormState>(() => ({
    ...EMPTY_VAT_FORM,
    companyName: matchingProfile?.company_name ?? '',
    addressLine1: matchingProfile?.address_line1 ?? '',
    addressLine2: matchingProfile?.address_line2 ?? '',
    addressCity: matchingProfile?.address_city ?? '',
    addressPostalCode: matchingProfile?.address_postal_code ?? '',
    addressState: matchingProfile?.address_state ?? '',
    nip: matchingProfile?.tax_ids[0]?.value ?? '',
    taxIdType:
      matchingProfile?.tax_ids[0]?.type ??
      taxIdTypesForCountry(country ?? '')[0] ??
      '',
  }));
  const [errors, setErrors] = useState<VatFieldErrors>({});
  useEffect(() => {
    if (profile?.tax_ids.length || !country) {
      return;
    }
    setForm(previous => {
      if (
        previous.nip.trim() ||
        taxIdTypesForCountry(country).includes(previous.taxIdType as never)
      ) {
        return previous;
      }
      return { ...previous, taxIdType: taxIdTypesForCountry(country)[0] ?? '' };
    });
  }, [country, profile?.tax_ids.length]);

  const setField = (field: keyof VatFormState, value: string) => {
    setForm(prev => ({
      ...prev,
      [field]: value,
      ...(field === 'nip' &&
        country &&
        !profile?.tax_ids.length &&
        !taxIdTypesForCountry(country).includes(prev.taxIdType as never) && {
          taxIdType: taxIdTypesForCountry(country)[0] ?? '',
        }),
    }));
    // Clear the field's error on edit (re-validated on next pay attempt).
    setErrors(prev => {
      if (prev[field] === undefined) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  };

  const validate = (
    messages: VatValidationMessages,
    sharedAddress?: StripeCheckoutContact | null
  ): boolean => {
    const next: VatFieldErrors = {};
    const actualCountry = sharedAddress
      ? normalizeCountryCode(sharedAddress.address.country)
      : country;
    if (!actualCountry) {
      next.addressLine1 = messages.required;
    }
    const companyNameErr = requiredFieldError(
      form.companyName,
      messages.required
    );
    if (companyNameErr !== undefined) {
      next.companyName = companyNameErr;
    }
    const addressLine1Err = !sharedAddress
      ? requiredFieldError(form.addressLine1, messages.required)
      : undefined;
    if (addressLine1Err !== undefined) {
      next.addressLine1 = addressLine1Err;
    }
    const cityErr =
      !sharedAddress && actualCountry === 'PL'
        ? requiredFieldError(form.addressCity, messages.required)
        : undefined;
    if (cityErr !== undefined) {
      next.addressCity = cityErr;
    }
    const postalErr =
      actualCountry === 'PL'
        ? postalCodePlFieldError(
            sharedAddress
              ? (sharedAddress.address.postal_code ?? '')
              : form.addressPostalCode,
            {
              required: messages.required,
              invalid: messages.postalInvalid,
            }
          )
        : undefined;
    if (postalErr !== undefined) {
      next.addressPostalCode = postalErr;
    }
    if (
      (profile?.tax_ids.length ?? 0) === 0 &&
      form.nip.trim() &&
      !taxIdTypesForCountry(actualCountry ?? '').includes(
        form.taxIdType as never
      ) &&
      !(
        matchingProfile?.tax_ids.some(
          id => id.type === form.taxIdType && id.value === form.nip
        ) && isStripeTaxIdType(form.taxIdType)
      )
    ) {
      next.taxIdType = messages.required;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async (
    sharedAddress?: StripeCheckoutContact | null
  ): Promise<void> => {
    const address = sharedAddress?.address;
    const actualCountry = address
      ? normalizeCountryCode(address.country)
      : country;
    if (!actualCountry) {
      throw new Error('Billing country is required');
    }
    await saveVatInvoice.mutateAsync({
      companyName: form.companyName.trim(),
      country: actualCountry,
      ...(profile?.tax_ids.length
        ? {}
        : {
            taxId: form.nip.trim()
              ? {
                  type: form.taxIdType,
                  value:
                    actualCountry === 'PL' &&
                    !form.nip.trim().toUpperCase().startsWith('PL')
                      ? `PL${form.nip.trim()}`
                      : form.nip.trim(),
                }
              : null,
          }),
      ...((address ? (address.state ?? '') : form.addressState).trim() && {
        addressState: (address
          ? (address.state ?? '')
          : form.addressState
        ).trim(),
      }),
      addressLine1: (address
        ? (address.line1 ?? '')
        : form.addressLine1
      ).trim(),
      ...(address
        ? { addressLine2: (address.line2 ?? '').trim() }
        : matchingProfile?.address_line2 != null
          ? { addressLine2: form.addressLine2.trim() }
          : {}),
      addressCity: (address ? (address.city ?? '') : form.addressCity).trim(),
      addressPostalCode: (address
        ? (address.postal_code ?? '')
        : form.addressPostalCode
      ).trim(),
    });
  };

  return {
    isOn,
    setIsOn,
    form,
    line2Known: matchingProfile?.address_line2 !== undefined,
    savedTaxIds: profile?.tax_ids ?? [],
    savedCompanyName: profile?.company_name ?? null,
    hasSavedCompany:
      profile?.has_company_details === true ||
      (profile?.tax_ids.length ?? 0) > 0,
    errors,
    setField,
    validate,
    save,
  };
}
