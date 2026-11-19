import { expect, it } from 'vitest';
import { checkoutCompanyFingerprint } from './checkout-company.helpers';
import type { VatFormState } from './hooks/useVatInvoiceForm';

it('does not restart company review when Stripe synchronizes the billing name', () => {
  const form: VatFormState = {
    companyName: 'Salon Ltd',
    addressLine1: '',
    addressLine2: '',
    addressCity: '',
    addressPostalCode: '',
    addressState: '',
    nip: '',
    taxIdType: '',
  };
  const address = { country: 'US', line1: '1 Main St' };
  expect(checkoutCompanyFingerprint(form, { name: 'Buyer', address })).toBe(
    checkoutCompanyFingerprint(form, { name: 'Salon Ltd', address })
  );
});
