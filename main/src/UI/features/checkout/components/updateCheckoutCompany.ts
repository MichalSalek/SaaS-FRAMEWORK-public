import type { StripeCheckoutValue } from '@stripe/react-stripe-js/checkout';
import type { CountryCode } from '@kernel/domain/localization/country.config';
import type { UseVatInvoiceForm } from '../hooks/useVatInvoiceForm';
import { isStripeTaxIdType } from '../tax-id-types';
import type { StripeCheckoutContact } from '@stripe/stripe-js';

export async function updateCheckoutCompany(
  checkout: StripeCheckoutValue,
  vat: UseVatInvoiceForm,
  billingCountry: CountryCode,
  sharedAddress?: StripeCheckoutContact | null
): Promise<void> {
  await vat.save(sharedAddress);
  const address = await checkout.updateBillingAddress(
    sharedAddress
      ? {
          name: vat.form.companyName.trim(),
          address: sharedAddress.address,
        }
      : {
          name: vat.form.companyName.trim(),
          address: {
            country: billingCountry,
            line1: vat.form.addressLine1.trim(),
            ...(vat.line2Known
              ? { line2: vat.form.addressLine2.trim() || null }
              : {}),
            city: vat.form.addressCity.trim(),
            postal_code: vat.form.addressPostalCode.trim(),
            state: vat.form.addressState.trim() || null,
          },
        }
  );
  if (address.type === 'error') {
    throw new Error('Stripe billing address update failed');
  }
  const idValue = vat.form.nip.trim();
  if (vat.savedTaxIds.length > 0) {
    return;
  }
  if (idValue && !isStripeTaxIdType(vat.form.taxIdType)) {
    throw new Error('Unsupported Stripe tax ID type');
  }
  if (idValue && isStripeTaxIdType(vat.form.taxIdType)) {
    const tax = await checkout.updateTaxIdInfo({
      businessName: vat.form.companyName.trim(),
      taxId: {
        type: vat.form.taxIdType,
        value:
          billingCountry === 'PL' && !idValue.toUpperCase().startsWith('PL')
            ? `PL${idValue}`
            : idValue,
      },
    });
    if (tax.type === 'error') {
      throw new Error('Stripe tax ID update failed');
    }
  }
}
