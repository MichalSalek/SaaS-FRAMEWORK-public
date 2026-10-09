/**
 * Faktura VAT — saveVatInvoiceDetails_IO unit tests.
 *
 * Mocks the Stripe adapter (customers.update / listTaxIds / createTaxId) and the DB
 * via the global setup proxy (mockDb). Asserts the save-przed-confirm contract:
 * resolve customer → update name+address → idempotent eu_vat tax id (PL<nip>).
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';

// ── Mock the Stripe adapter: only customers.* is called here. ────────────────────
const customerUpdate = vi.fn();
const listTaxIds = vi.fn();
const createTaxId = vi.fn();
const deleteTaxId = vi.fn();
vi.mock('@app/stripe/adapters/stripe.adapter', () => ({
  getStripe: () => ({
    customers: {
      update: customerUpdate,
      listTaxIds,
      createTaxId,
      deleteTaxId,
    },
  }),
}));

// reportIssueBackend (called by retryStripeOperation) is fire-and-forget logging —
// captured (not just stubbed) because the broken-invariant path MUST report.
const { reportIssueBackend } = vi.hoisted(() => ({
  reportIssueBackend: vi.fn(),
}));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend,
}));

import { saveVatInvoiceDetails_IO } from './vat-invoice.operations';

const USER_ID = 'usr_test_vat_0001';
const ACCOUNT_ID = 'acc_test_vat_0001';
const CUSTOMER_ID = 'cus_test_vat';

const PAYLOAD = {
  userId: USER_ID,
  companyName: 'Studio Paznokci Anna Kowalska',
  nip: '1111111111',
  addressLine1: 'ul. Kwiatowa 12/3',
  addressCity: 'Warszawa',
  addressPostalCode: '00-950',
};

describe('saveVatInvoiceDetails_IO', () => {
  beforeEach(() => {
    customerUpdate.mockReset();
    listTaxIds.mockReset();
    createTaxId.mockReset();
    deleteTaxId.mockReset();
    reportIssueBackend.mockReset();
    customerUpdate.mockResolvedValue({ id: CUSTOMER_ID });
    listTaxIds.mockResolvedValue({ data: [] });
    createTaxId.mockResolvedValue({ id: 'txi_test' });
    deleteTaxId.mockResolvedValue({ id: 'txi_old', deleted: true });
  });

  it('happy path: updates customer name+address (country PL) and creates eu_vat PL<nip>', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          account_id: ACCOUNT_ID,
          stripe_customer_id: CUSTOMER_ID,
        }),
      },
    });

    const result = await saveVatInvoiceDetails_IO(PAYLOAD);

    expect(result.success).toBe(true);
    expect(customerUpdate).toHaveBeenCalledWith(
      CUSTOMER_ID,
      expect.objectContaining({
        name: PAYLOAD.companyName,
        address: expect.objectContaining({
          line1: PAYLOAD.addressLine1,
          city: PAYLOAD.addressCity,
          postal_code: PAYLOAD.addressPostalCode,
          country: 'PL',
        }),
      })
    );
    expect(createTaxId).toHaveBeenCalledWith(CUSTOMER_ID, {
      type: 'eu_vat',
      value: 'PL1111111111',
    });
  });

  it('normalizes a spaced/prefixed NIP into the PL<digits> tax id value', async () => {
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
      nip: 'PL 111-111-11-11',
    });

    expect(result.success).toBe(true);
    expect(createTaxId).toHaveBeenCalledWith(CUSTOMER_ID, {
      type: 'eu_vat',
      value: 'PL1111111111',
    });
  });

  it('idempotentnie PO WARTOŚCI: zgodny eu_vat zostaje, nic nie jest tworzone ani kasowane', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          account_id: ACCOUNT_ID,
          stripe_customer_id: CUSTOMER_ID,
        }),
      },
    });
    listTaxIds.mockResolvedValue({
      data: [{ id: 'txi_ok', type: 'eu_vat', value: 'PL1111111111' }],
    });

    const result = await saveVatInvoiceDetails_IO(PAYLOAD);

    expect(result.success).toBe(true);
    expect(customerUpdate).toHaveBeenCalledTimes(1);
    expect(createTaxId).not.toHaveBeenCalled();
    expect(deleteTaxId).not.toHaveBeenCalled();
  });

  it('KOREKTA NIP-u: rozjechany eu_vat jest kasowany i zakładany od nowa', async () => {
    // Regresja, którą ten test pinuje: wersja „istnieje jakikolwiek eu_vat → pomiń"
    // przyjmowała poprawiony NIP, aktualizowała nazwę i adres, zwracała 200 — i
    // zostawiała STARY numer na Customerze. Faktura wychodziła z nową nazwą firmy
    // i błędnym NIP-em, czyli bez możliwości odliczenia VAT przez kupującego.
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          account_id: ACCOUNT_ID,
          stripe_customer_id: CUSTOMER_ID,
        }),
      },
    });
    listTaxIds.mockResolvedValue({
      data: [{ id: 'txi_stary', type: 'eu_vat', value: 'PL9999999999' }],
    });

    const result = await saveVatInvoiceDetails_IO(PAYLOAD);

    expect(result.success).toBe(true);
    expect(deleteTaxId).toHaveBeenCalledWith(CUSTOMER_ID, 'txi_stary');
    expect(createTaxId).toHaveBeenCalledWith(CUSTOMER_ID, {
      type: 'eu_vat',
      value: 'PL1111111111',
    });
  });

  it('nie rusza tax-idów innego typu niż eu_vat', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          account_id: ACCOUNT_ID,
          stripe_customer_id: CUSTOMER_ID,
        }),
      },
    });
    listTaxIds.mockResolvedValue({
      data: [{ id: 'txi_obcy', type: 'gb_vat', value: 'GB123456789' }],
    });

    const result = await saveVatInvoiceDetails_IO(PAYLOAD);

    expect(result.success).toBe(true);
    expect(deleteTaxId).not.toHaveBeenCalled();
    expect(createTaxId).toHaveBeenCalledWith(CUSTOMER_ID, {
      type: 'eu_vat',
      value: 'PL1111111111',
    });
  });

  it('no stripe customer on account → CHECKOUT_CUSTOMER_NOT_READY (409) + report warn, never touches Stripe', async () => {
    // Test przepisany razem z zachowaniem: wcześniej pinował ACCOUNT_STRIPE_ERROR,
    // czyli opaque 500 BEZ telemetrii — front blokował na nim `checkout.confirm()`,
    // a operator nie miał ani jednego wpisu mówiącego dlaczego. To jest przewidywalny
    // stan przejściowy (sesja checkout niezamintowana), więc kontraktem jest osobny
    // błąd domenowy mapowany na 409 + raport złamanego invariantu.
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          account_id: ACCOUNT_ID,
          stripe_customer_id: null,
        }),
      },
    });

    const result = await saveVatInvoiceDetails_IO(PAYLOAD);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('CHECKOUT_CUSTOMER_NOT_READY');
    }
    expect(reportIssueBackend).toHaveBeenCalledWith(
      expect.objectContaining({
        namespace: 'VAT_INVOICE_CUSTOMER_NOT_READY',
        mode: 'warn',
        payload: expect.objectContaining({
          userId: USER_ID,
          accountId: ACCOUNT_ID,
        }),
      })
    );
    expect(customerUpdate).not.toHaveBeenCalled();
    expect(listTaxIds).not.toHaveBeenCalled();
    expect(createTaxId).not.toHaveBeenCalled();
  });

  it('kolejność: tax_idy czytane PRZED customers.update (update jako ostatni krok)', async () => {
    // Kontrakt nie-transakcyjny: awaria w locie ma zostawić Customera z poprzednią,
    // spójną tożsamością. Update nazwy/adresu jako krok 2 zostawiał na porażce
    // tax_id nową firmę ze starym NIP-em — faktura z niepasującym numerem.
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          account_id: ACCOUNT_ID,
          stripe_customer_id: CUSTOMER_ID,
        }),
      },
    });
    listTaxIds.mockResolvedValue({
      data: [{ id: 'txi_stary', type: 'eu_vat', value: 'PL9999999999' }],
    });

    await saveVatInvoiceDetails_IO(PAYLOAD);

    const order = (fn: typeof listTaxIds): number =>
      fn.mock.invocationCallOrder[0] ?? Number.MAX_SAFE_INTEGER;
    expect(order(listTaxIds)).toBeLessThan(order(deleteTaxId));
    expect(order(deleteTaxId)).toBeLessThan(order(createTaxId));
    expect(order(createTaxId)).toBeLessThan(order(customerUpdate));
  });

  it('porażka na tax_id NIE zapisuje nazwy ani adresu na Customerze', async () => {
    mockDb({
      stylistAccount: {
        findUnique: async () => ({
          account_id: ACCOUNT_ID,
          stripe_customer_id: CUSTOMER_ID,
        }),
      },
    });
    // statusCode 400 = błąd trwały → retryStripeOperation kończy po 1 próbie
    // (bez realnych sleepów w teście).
    createTaxId.mockRejectedValue(
      Object.assign(new Error('Invalid tax id'), { statusCode: 400 })
    );

    const result = await saveVatInvoiceDetails_IO(PAYLOAD);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ACCOUNT_STRIPE_ERROR');
    }
    expect(customerUpdate).not.toHaveBeenCalled();
  });

  it('no stylist account row → ACCOUNT_NOT_FOUND', async () => {
    mockDb({
      stylistAccount: { findUnique: async () => null },
    });

    const result = await saveVatInvoiceDetails_IO(PAYLOAD);

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ACCOUNT_NOT_FOUND');
    }
    expect(customerUpdate).not.toHaveBeenCalled();
  });
});
