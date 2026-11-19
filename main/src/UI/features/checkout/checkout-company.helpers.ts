import type { StripeCheckoutContact } from '@stripe/stripe-js';
import type { VatFormState } from './hooks/useVatInvoiceForm';
import type { BillingProfile } from '@kernel/domain/account/billing-profile.contract-schemas';

export function savedCompanyBillingName(
  profile?: BillingProfile
): string | null {
  return profile?.has_company_details || (profile?.tax_ids.length ?? 0) > 0
    ? (profile?.company_name ?? null)
    : null;
}

/** Stripe can update the contact name after saving the company; the selected address is unchanged. */
export function checkoutCompanyFingerprint(
  form: VatFormState,
  contact: StripeCheckoutContact | null
): string {
  const address = contact?.address;
  return JSON.stringify([
    form,
    address
      ? [
          address.country,
          address.line1 ?? '',
          address.line2 ?? '',
          address.city ?? '',
          address.postal_code ?? '',
          address.state ?? '',
        ]
      : null,
  ]);
}
