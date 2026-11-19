import { describe, expect, it, vi } from 'vitest';
import type { StripeCheckoutValue } from '@stripe/react-stripe-js/checkout';
import type { UseVatInvoiceForm } from '../hooks/useVatInvoiceForm';
import { updateCheckoutCompany } from './updateCheckoutCompany';

function setup(taxIdType: string, nip: string) {
  const save = vi.fn(async () => {});
  const updateBillingAddress = vi.fn(async () => ({ type: 'success' }));
  const updateTaxIdInfo = vi.fn(async () => ({ type: 'success' }));
  const checkout = {
    updateBillingAddress,
    updateTaxIdInfo,
  } as unknown as StripeCheckoutValue;
  const vat = {
    save,
    line2Known: true,
    savedTaxIds: [],
    form: {
      companyName: 'Company',
      addressLine1: '1 Main St',
      addressLine2: '',
      addressCity: 'Boston',
      addressPostalCode: '02108',
      addressState: 'MA',
      nip,
      taxIdType,
    },
  } as unknown as UseVatInvoiceForm;
  return { checkout, vat, save, updateBillingAddress, updateTaxIdInfo };
}

describe('company details in Stripe checkout', () => {
  it('submits the actual US address and selected EIN before confirming', async () => {
    const ctx = setup('us_ein', '12-3456789');
    await updateCheckoutCompany(ctx.checkout, ctx.vat, 'US');
    expect(ctx.save).toHaveBeenCalledOnce();
    expect(ctx.updateBillingAddress).toHaveBeenCalledWith({
      name: 'Company',
      address: {
        country: 'US',
        line1: '1 Main St',
        line2: null,
        city: 'Boston',
        postal_code: '02108',
        state: 'MA',
      },
    });
    expect(ctx.updateTaxIdInfo).toHaveBeenCalledWith({
      businessName: 'Company',
      taxId: { type: 'us_ein', value: '12-3456789' },
    });
  });
  it('adds the EU prefix to a Polish VAT number', async () => {
    const ctx = setup('eu_vat', '1234567890');
    await updateCheckoutCompany(ctx.checkout, ctx.vat, 'PL');
    expect(ctx.updateTaxIdInfo).toHaveBeenCalledWith({
      businessName: 'Company',
      taxId: { type: 'eu_vat', value: 'PL1234567890' },
    });
  });
  it('accepts a business without a tax ID and stops on Stripe address error', async () => {
    const ctx = setup('', '');
    ctx.updateBillingAddress.mockResolvedValueOnce({ type: 'error' } as never);
    await expect(
      updateCheckoutCompany(ctx.checkout, ctx.vat, 'US')
    ).rejects.toThrow();
    expect(ctx.updateTaxIdInfo).not.toHaveBeenCalled();
  });
  it('uses the already recalculated Stripe address and updates only the company tax ID', async () => {
    const ctx = setup('us_ein', '12-3456789');
    const sharedAddress = {
      name: 'Buyer',
      address: {
        country: 'US',
        line1: '2 New St',
        city: 'Boston',
        postal_code: '02108',
        state: 'MA',
      },
    };
    await updateCheckoutCompany(ctx.checkout, ctx.vat, 'US', sharedAddress);
    expect(ctx.save).toHaveBeenCalledWith(sharedAddress);
    expect(ctx.updateBillingAddress).toHaveBeenCalledWith({
      name: 'Company',
      address: sharedAddress.address,
    });
    expect(ctx.updateTaxIdInfo).toHaveBeenCalledOnce();
  });
  it('synchronizes company name for a shared buyer address without a tax ID', async () => {
    const ctx = setup('', '');
    const contact = {
      name: 'Buyer',
      address: {
        country: 'US',
        line1: '1 Main St',
        city: 'Boston',
        postal_code: '02108',
      },
    };
    await updateCheckoutCompany(ctx.checkout, ctx.vat, 'US', contact);
    expect(ctx.updateBillingAddress).toHaveBeenCalledWith({
      name: 'Company',
      address: contact.address,
    });
    expect(ctx.updateTaxIdInfo).not.toHaveBeenCalled();
  });
  it('does not modify previously saved tax IDs when the inline field is empty', async () => {
    const ctx = setup('eu_vat', '');
    ctx.vat.savedTaxIds = [
      { type: 'eu_vat', value: 'PL1234567890', verification_status: 'pending' },
    ];
    await updateCheckoutCompany(ctx.checkout, ctx.vat, 'PL');
    expect(ctx.updateTaxIdInfo).not.toHaveBeenCalled();
  });
});
