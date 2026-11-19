import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';
const { customerUpdate, listTaxIds, createTaxId, deleteTaxId } = vi.hoisted(
  () => ({
    customerUpdate: vi.fn(),
    listTaxIds: vi.fn(),
    createTaxId: vi.fn(),
    deleteTaxId: vi.fn(),
  })
);
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({
    customers: { update: customerUpdate, listTaxIds, createTaxId, deleteTaxId },
  }),
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
import { saveVatInvoiceDetails_IO } from './vat-invoice.operations';
const ACCOUNT_ID = 'acc_test_vat_0001';
const CUSTOMER_ID = 'cus_test_vat';
const PAYLOAD = {
  userId: 'usr_test_vat_0001',
  companyName: 'Test company',
  nip: '1111111111',
  addressLine1: 'Test street 1',
  addressCity: 'Warszawa',
  addressPostalCode: '00-950',
};
describe('invoice address and typed tax ID', () => {
  beforeEach(() => {
    customerUpdate.mockReset().mockResolvedValue({ id: CUSTOMER_ID });
    listTaxIds.mockReset().mockResolvedValue({ data: [] });
    createTaxId.mockReset().mockResolvedValue({ id: 'txi_test' });
    deleteTaxId.mockReset().mockResolvedValue({ id: 'txi_old', deleted: true });
  });
  it.each(['1111111111', 'PL1111111111', 'PL 111-111-11-11'])(
    'normalizes typed Polish EU VAT %s',
    async value => {
      mockDb({
        stylistAccount: {
          findUnique: async () => ({
            account_id: ACCOUNT_ID,
            stripe_customer_id: CUSTOMER_ID,
          }),
        },
      });
      const result = await saveVatInvoiceDetails_IO({
        ...PAYLOAD,
        nip: undefined,
        country: 'PL',
        taxId: { type: 'eu_vat', value },
      });
      expect(result.success).toBe(true);
      expect(createTaxId).toHaveBeenCalledWith(CUSTOMER_ID, {
        type: 'eu_vat',
        value: 'PL1111111111',
      });
    }
  );
  it.each([
    ['Suite 4', 'Suite 4'],
    ['', ''],
  ])('writes or explicitly clears address line 2', async (input, expected) => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          account_id: ACCOUNT_ID,
          stripe_customer_id: CUSTOMER_ID,
        }),
      },
    });
    await saveVatInvoiceDetails_IO({ ...PAYLOAD, addressLine2: input });
    expect(customerUpdate).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({
        address: expect.objectContaining({ line2: expected }),
      })
    );
  });
  it('omits line 2 from a legacy address update', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          account_id: ACCOUNT_ID,
          stripe_customer_id: CUSTOMER_ID,
        }),
      },
    });
    await saveVatInvoiceDetails_IO(PAYLOAD);
    expect(customerUpdate.mock.calls[0]?.[1].address).not.toHaveProperty(
      'line2'
    );
  });
  it('does not replace the same normalized Polish tax ID', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          account_id: ACCOUNT_ID,
          stripe_customer_id: CUSTOMER_ID,
        }),
      },
    });
    listTaxIds.mockResolvedValue({
      data: [{ id: 'txi_existing', type: 'eu_vat', value: 'PL1111111111' }],
    });
    await saveVatInvoiceDetails_IO({
      ...PAYLOAD,
      nip: undefined,
      country: 'PL',
      taxId: { type: 'eu_vat', value: '111-111-11-11' },
    });
    expect(createTaxId).not.toHaveBeenCalled();
    expect(deleteTaxId).not.toHaveBeenCalled();
  });
  it('leaves a foreign EU VAT identifier unchanged', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          account_id: ACCOUNT_ID,
          stripe_customer_id: CUSTOMER_ID,
        }),
      },
    });
    await saveVatInvoiceDetails_IO({
      ...PAYLOAD,
      nip: undefined,
      country: 'DE',
      taxId: { type: 'eu_vat', value: 'DE123456789' },
    });
    expect(createTaxId).toHaveBeenCalledWith(CUSTOMER_ID, {
      type: 'eu_vat',
      value: 'DE123456789',
    });
  });
});
