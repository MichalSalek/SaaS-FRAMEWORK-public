// UI/features/checkout/hooks/useVatInvoiceForm.ts
// Faktura VAT — stan + walidacja + zapis subformu „Faktura na firmę".
// Wydzielone z CheckoutForm (concern ortogonalny do maszyny stanów płatności),
// żeby CheckoutForm trzymał się w limicie max-lines. Walidacja reużywa walidatory
// kernela (NIP checksum, kod pocztowy PL) przez fieldValidators.

import { useState } from 'react';
import {
  requiredFieldError,
  postalCodePlFieldError,
  nipFieldError,
} from '../../../../application/forms/fieldValidators';
import { useSaveVatInvoiceDetails } from './useSaveVatInvoiceDetails';

export interface VatFormState {
  companyName: string;
  addressLine1: string;
  addressCity: string;
  addressPostalCode: string;
  nip: string;
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
  addressCity: '',
  addressPostalCode: '',
  nip: '',
};

export interface UseVatInvoiceForm {
  isOn: boolean;
  setIsOn: (on: boolean) => void;
  form: VatFormState;
  errors: VatFieldErrors;
  setField: (field: keyof VatFormState, value: string) => void;
  /** Waliduje wszystkie pola; ustawia per-pole błędy; zwraca true gdy OK. */
  validate: (messages: VatValidationMessages) => boolean;
  /** Zapisuje przycięte dane firmy na Stripe Customer (rzuca przy błędzie). */
  save: () => Promise<void>;
}

export function useVatInvoiceForm(): UseVatInvoiceForm {
  const saveVatInvoice = useSaveVatInvoiceDetails();
  const [isOn, setIsOn] = useState(false);
  const [form, setForm] = useState<VatFormState>(EMPTY_VAT_FORM);
  const [errors, setErrors] = useState<VatFieldErrors>({});

  const setField = (field: keyof VatFormState, value: string) => {
    setForm(prev => ({ ...prev, [field]: value }));
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

  const validate = (messages: VatValidationMessages): boolean => {
    const next: VatFieldErrors = {};
    const companyNameErr = requiredFieldError(
      form.companyName,
      messages.required
    );
    if (companyNameErr !== undefined) {
      next.companyName = companyNameErr;
    }
    const addressLine1Err = requiredFieldError(
      form.addressLine1,
      messages.required
    );
    if (addressLine1Err !== undefined) {
      next.addressLine1 = addressLine1Err;
    }
    const cityErr = requiredFieldError(form.addressCity, messages.required);
    if (cityErr !== undefined) {
      next.addressCity = cityErr;
    }
    const postalErr = postalCodePlFieldError(form.addressPostalCode, {
      required: messages.required,
      invalid: messages.postalInvalid,
    });
    if (postalErr !== undefined) {
      next.addressPostalCode = postalErr;
    }
    const nipErr = nipFieldError(form.nip, {
      required: messages.required,
      invalid: messages.nipInvalid,
    });
    if (nipErr !== undefined) {
      next.nip = nipErr;
    }
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const save = async (): Promise<void> => {
    await saveVatInvoice.mutateAsync({
      companyName: form.companyName.trim(),
      nip: form.nip.trim(),
      addressLine1: form.addressLine1.trim(),
      addressCity: form.addressCity.trim(),
      addressPostalCode: form.addressPostalCode.trim(),
    });
  };

  return { isOn, setIsOn, form, errors, setField, validate, save };
}
