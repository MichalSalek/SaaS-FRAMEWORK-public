import { describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';
const { retrieve, listTaxIds } = vi.hoisted(() => ({
  retrieve: vi.fn(),
  listTaxIds: vi.fn(),
}));
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({ customers: { retrieve, listTaxIds } }),
}));
import { getBillingProfile_IO } from './billing-profile.operations';
describe('billing profile', () => {
  it('does not create a customer for an account without one', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({ stripe_customer_id: null }),
      },
    });
    expect(await getBillingProfile_IO('user')).toMatchObject({
      success: true,
      data: { has_customer: false, tax_ids: [] },
    });
    expect(retrieve).not.toHaveBeenCalled();
  });
  it('returns real tax verification status, never inventing a verified VAT ID', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({ stripe_customer_id: 'cus_1' }),
      },
    });
    retrieve.mockResolvedValue({
      name: 'Company',
      address: { country: 'DE', line1: 'Street', city: 'Berlin' },
      metadata: {},
    });
    listTaxIds.mockResolvedValue({
      data: [
        { type: 'eu_vat', value: 'DE123', verification: { status: 'pending' } },
      ],
      has_more: false,
    });
    expect(await getBillingProfile_IO('user')).toMatchObject({
      success: true,
      data: {
        country: 'DE',
        has_company_details: true,
        tax_ids: [
          { type: 'eu_vat', value: 'DE123', verification_status: 'pending' },
        ],
      },
    });
  });
  it('returns an error on Stripe failure instead of an empty profile', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({ stripe_customer_id: 'cus_1' }),
      },
    });
    retrieve.mockRejectedValue(new Error('offline'));
    expect(await getBillingProfile_IO('user')).toMatchObject({
      success: false,
      error: { type: 'ACCOUNT_STRIPE_ERROR' },
    });
  });
});
